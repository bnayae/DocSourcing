'use client';

import { eventPolicies, MAX_REBASE_ATTEMPTS } from '@/lib/events/policies';
import type { DocumentEventType } from '@/lib/events/types';
import type { BatchResponse, RejectedEntry } from '@/lib/api/errors';
import { applyRebase, bumpRetry, markEventFailed, parkEvent, markEventSynced } from './store';
import { getDb } from './dexie';

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
