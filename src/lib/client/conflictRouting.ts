'use client';

import { eventPolicies, MAX_REBASE_ATTEMPTS } from '@/lib/events/policies';
import type { DocumentEventType, DocumentState } from '@/lib/events/types';
import type { BatchResponse, RejectedEntry } from '@/lib/api/errors';
import { applyRebase, bumpRetry, markEventFailed, parkEvent, markEventSynced } from './store';
import { getDb } from './dexie';
import { locateAnchor } from '@/lib/events/anchors';

export interface MirrorDeadLetterFn {
  (entry: {
    id: string;
    aggregateId: string;
    errorClass: string;
    errorCode: string;
    description?: string;
  }): Promise<void>;
}

export interface HandleResult {
  hardBlocked: boolean;
}

async function fetchType(eventId: string): Promise<DocumentEventType | null> {
  const db = getDb();
  const row = await db.events.get(eventId);
  return row ? row.type : null;
}

const serverStateCache = new Map<string, { state: DocumentState; fetchedAt: number }>();
const SERVER_STATE_TTL_MS = 1500;

async function fetchServerState(aggregateId: string): Promise<DocumentState | null> {
  const cached = serverStateCache.get(aggregateId);
  if (cached && Date.now() - cached.fetchedAt < SERVER_STATE_TTL_MS) return cached.state;
  try {
    const res = await fetch(`/api/documents/${aggregateId}/state`);
    if (!res.ok) return null;
    const state = (await res.json()) as DocumentState;
    serverStateCache.set(aggregateId, { state, fetchedAt: Date.now() });
    return state;
  } catch {
    return null;
  }
}

/**
 * For OCC-rejected text events: fetch fresh server state and decide whether
 * the event's anchors are still applicable.
 *
 * Returns true if the event is safe to retry (anchors still match), false if
 * anchors broke and we should park.
 */
async function tryAutoFixAnchors(eventId: string): Promise<boolean> {
  const db = getDb();
  const row = await db.events.get(eventId);
  if (!row) return false;
  if (row.type !== 'TEXT_INSERTED' && row.type !== 'TEXT_DELETED') return true;

  const server = await fetchServerState(row.aggregateId);
  if (!server) return true; // can't verify; let normal retry handle it

  const payload = row.payload as { beforeSentence: string; afterSentence: string; text: string };
  if (row.type === 'TEXT_INSERTED') {
    const at = locateAnchor(server.body, payload.beforeSentence, payload.afterSentence);
    return at !== null;
  }
  // TEXT_DELETED — verify that `before + text + after` still appears uniquely.
  const joined = payload.beforeSentence + payload.text + payload.afterSentence;
  const first = server.body.indexOf(joined);
  if (first === -1) return false;
  const second = server.body.indexOf(joined, first + 1);
  return second === -1;
}

export async function handleBatchResponse(
  response: BatchResponse,
  acceptedLocalSeqBySeq: Map<string, number>,
  mirrorDeadLetter: MirrorDeadLetterFn,
): Promise<HandleResult> {
  for (const a of response.accepted) {
    const knownOldSeq = acceptedLocalSeqBySeq.get(a.id);
    if (knownOldSeq !== undefined && knownOldSeq !== a.serverSeq) {
      await applyRebase(a.id, a.serverSeq);
    } else {
      await markEventSynced(a.id, a.serverSeq);
    }
  }

  let hardBlocked = false;
  for (const r of response.rejected) {
    hardBlocked = (await handleRejected(r, mirrorDeadLetter)) || hardBlocked;
  }
  return { hardBlocked };
}

async function handleRejected(r: RejectedEntry, mirrorDeadLetter: MirrorDeadLetterFn): Promise<boolean> {
  if (r.errorClass === 'occ') {
    const type = await fetchType(r.id);
    if (!type) return false;
    const policy = eventPolicies[type];
    if (policy.occ === 'rebase' || policy.occ === 'append-and-override') {
      const anchorsOk = await tryAutoFixAnchors(r.id);
      if (!anchorsOk) {
        await parkEvent(r.id, 'occ', 'ANCHOR_LOST', 'Sentence anchors no longer match server state');
        await mirrorDeadLetter({
          id: r.id,
          aggregateId: await aggregateIdFor(r.id),
          errorClass: 'occ',
          errorCode: 'ANCHOR_LOST',
          description: 'Sentence anchors no longer match server state',
        });
        return true;
      }
      const retry = await bumpRetry(r.id, r.errorCode);
      if (retry >= MAX_REBASE_ATTEMPTS) {
        await parkEvent(r.id, 'occ', 'REBASE_EXHAUSTED', 'Exceeded rebase attempts');
        await mirrorDeadLetter({
          id: r.id,
          aggregateId: await aggregateIdFor(r.id),
          errorClass: 'occ',
          errorCode: 'REBASE_EXHAUSTED',
          description: 'Exceeded rebase attempts',
        });
        return true;
      }
      return false;
    }
    await parkEvent(r.id, 'occ', r.errorCode, r.message);
    await mirrorDeadLetter({
      id: r.id,
      aggregateId: await aggregateIdFor(r.id),
      errorClass: 'occ',
      errorCode: r.errorCode,
      ...(r.message !== undefined ? { description: r.message } : {}),
    });
    return policy.visibility === 'notify';
  }

  if (r.errorClass === 'unrecoverable') {
    if (r.poison) {
      await parkEvent(r.id, 'poison', r.errorCode, r.message);
    } else {
      await markEventFailed(r.id, r.errorCode);
    }
    await mirrorDeadLetter({
      id: r.id,
      aggregateId: await aggregateIdFor(r.id),
      errorClass: 'unrecoverable',
      errorCode: r.errorCode,
      ...(r.message !== undefined ? { description: r.message } : {}),
    });
    return true;
  }

  await bumpRetry(r.id, r.errorCode);
  return false;
}

async function aggregateIdFor(eventId: string): Promise<string> {
  const db = getDb();
  const row = await db.events.get(eventId);
  return row?.aggregateId ?? '';
}
