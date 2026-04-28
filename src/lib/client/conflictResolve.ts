'use client';

import { v4 as uuid } from 'uuid';
import { getDb, rowToStoredEvent, type StoredEventRow } from './dexie';
import { computeStateFromEvents } from '@/lib/events/reduce';
import { sentenceWindowAt, truncateAnchors } from '@/lib/events/anchors';
import { getAnchorCharsLimit } from '@/hooks/useAnchorCharsSetting';
import type { DocumentEvent, StoredEvent } from '@/lib/events/types';
import { addEvent, parkEvent } from './store';
import { getSyncEngine } from './syncEngine';

interface AnchoredPayload {
  beforeSentence: string;
  afterSentence: string;
  text: string;
}

function toDomainEvent(e: StoredEvent): DocumentEvent {
  const { id, aggregateId, type, payload, createdAt, sequenceNumber } = e;
  return { id, aggregateId, type, payload, createdAt, sequenceNumber } as DocumentEvent;
}

async function readLocal(
  aggregateId: string,
): Promise<{ synced: StoredEvent[]; pending: StoredEvent[] }> {
  const db = getDb();
  const rows = await db.events.where('aggregateId').equals(aggregateId).toArray();
  return {
    synced: rows.filter((r) => r.status === 'synced').map(rowToStoredEvent),
    pending: rows.filter((r) => r.status === 'pending').map(rowToStoredEvent),
  };
}

async function ingestRemoteRows(remoteEvents: DocumentEvent[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.events, async () => {
    for (const ev of remoteEvents) {
      const existing = await db.events.get(ev.id);
      if (existing) continue;
      const row: StoredEventRow = {
        id: ev.id,
        aggregateId: ev.aggregateId,
        type: ev.type,
        payload: ev.payload,
        createdAt: ev.createdAt,
        sequenceNumber: ev.sequenceNumber,
        status: 'synced',
        syncedAt: Date.now(),
        retryCount: 0,
      };
      await db.events.put(row);
    }
  });
}

/** Body produced by folding (synced + remote). */
export function computeServerBody(
  aggregateId: string,
  synced: StoredEvent[],
  remote: DocumentEvent[],
): string {
  const byId = new Map<string, DocumentEvent>();
  for (const e of synced) byId.set(e.id, toDomainEvent(e));
  for (const e of remote) byId.set(e.id, e);
  return computeStateFromEvents(aggregateId, [...byId.values()]).body;
}

/**
 * The user's intended body, prior to the remote events arriving:
 * fold (synced + local pending). This is what the user was looking at
 * before the conflict surfaced.
 */
export function computeLocalBody(
  aggregateId: string,
  synced: StoredEvent[],
  pending: StoredEvent[],
): string {
  const byId = new Map<string, DocumentEvent>();
  for (const e of synced) byId.set(e.id, toDomainEvent(e));
  for (const e of pending) byId.set(e.id, toDomainEvent(e));
  return computeStateFromEvents(aggregateId, [...byId.values()]).body;
}

/**
 * "Take server": ingest remote, park every local pending event so they don't
 * get retried. The user discards their local edits.
 */
export async function takeServerVersion(
  aggregateId: string,
  remoteEvents: DocumentEvent[],
): Promise<void> {
  const { pending } = await readLocal(aggregateId);
  for (const p of pending) {
    await parkEvent(p.id, 'occ', 'TAKE_SERVER',
      'User chose server version in conflict resolution');
  }
  await ingestRemoteRows(remoteEvents);
  getSyncEngine().resume();
  getSyncEngine().kick();
}

/**
 * "Resolve" with the user's edited body: ingest remote first (so the user's
 * text is layered on top), park the local pending events that conflict, then
 * append CORRECTION events that transform the post-ingest body into the
 * user's resolved body.
 *
 * For simplicity the correction is encoded as a single anchored insert that
 * appends a delta or as multiple events covering the diff. We compute the
 * diff between server body and resolved body and emit one TEXT_DELETED
 * (typed as CORRECTION) and/or one TEXT_INSERTED (typed as CORRECTION).
 */
export async function resolveWithUserVersion(
  aggregateId: string,
  remoteEvents: DocumentEvent[],
  resolvedBody: string,
): Promise<void> {
  const { synced, pending } = await readLocal(aggregateId);

  // Park the locally pending events — they're being replaced by CORRECTION events.
  for (const p of pending) {
    await parkEvent(p.id, 'occ', 'RESOLVED_BY_USER',
      'Superseded by user-resolved correction');
  }

  await ingestRemoteRows(remoteEvents);

  const serverBody = computeServerBody(aggregateId, synced, remoteEvents);

  if (serverBody === resolvedBody) {
    getSyncEngine().resume();
    getSyncEngine().kick();
    return;
  }

  // Find first/last differing positions between serverBody and resolvedBody.
  let start = 0;
  const minLen = Math.min(serverBody.length, resolvedBody.length);
  while (start < minLen && serverBody[start] === resolvedBody[start]) start++;
  let endServer = serverBody.length;
  let endResolved = resolvedBody.length;
  while (
    endServer > start &&
    endResolved > start &&
    serverBody[endServer - 1] === resolvedBody[endResolved - 1]
  ) {
    endServer--;
    endResolved--;
  }

  const removedText = serverBody.slice(start, endServer);
  const insertedText = resolvedBody.slice(start, endResolved);
  const limit = getAnchorCharsLimit();

  if (removedText.length > 0) {
    const rawBefore = sentenceWindowAt(serverBody, start).before;
    const rawAfter = sentenceWindowAt(serverBody, endServer).after;
    const { before, after } = truncateAnchors(rawBefore, rawAfter, limit);
    await addEvent({
      type: 'TEXT_DELETED',
      aggregateId,
      payload: { beforeSentence: before, afterSentence: after, text: removedText },
    });
  }

  if (insertedText.length > 0) {
    // Recompute anchors against the post-delete body.
    const postDeleteBody = serverBody.slice(0, start) + serverBody.slice(endServer);
    const rawBefore = sentenceWindowAt(postDeleteBody, start).before;
    const rawAfter = sentenceWindowAt(postDeleteBody, start).after;
    const { before, after } = truncateAnchors(rawBefore, rawAfter, limit);
    await addEvent({
      type: 'CORRECTION',
      aggregateId,
      payload: { beforeSentence: before, afterSentence: after, text: insertedText },
    });
  }

  getSyncEngine().resume();
  getSyncEngine().kick();
}

/**
 * "Override": ingest the remote events but emit a single OVERRIDE event that
 * declares the local pending events as undone and replaces the body with the
 * user's text. Local pending events stay in the log (parked locally) but are
 * never sent — the OVERRIDE supersedes them.
 *
 * The undoneEventIds also include the pending events (so the server side, on
 * any future fold, knows to skip them — though they were never accepted by
 * the server in the first place; including their ids is harmless and keeps
 * the bookkeeping symmetric for client replays).
 */
export async function overrideWithUserVersion(
  aggregateId: string,
  remoteEvents: DocumentEvent[],
  resolvedBody: string,
): Promise<void> {
  const { pending } = await readLocal(aggregateId);
  const undoneLocalIds = pending.map((p) => p.id);

  for (const p of pending) {
    await parkEvent(p.id, 'occ', 'OVERRIDDEN_BY_USER',
      'Superseded by OVERRIDE event');
  }

  await ingestRemoteRows(remoteEvents);

  await addEvent({
    type: 'OVERRIDE',
    aggregateId,
    payload: {
      undoneEventIds: undoneLocalIds,
      replacementText: resolvedBody,
    },
  });

  getSyncEngine().resume();
  getSyncEngine().kick();
}

// Re-export uuid in case callers want to mint ids elsewhere.
export { uuid as _uuid };
