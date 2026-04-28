'use client';

import { getDb, rowToStoredEvent } from './dexie';
import type { DocumentEvent } from '@/lib/events/types';
import { classifyRemoteIngest, type IngestVerdict } from './conflictClassify';
import { parkEvent } from './store';

interface ServerEventRow {
  id: string;
  aggregateId: string;
  type: DocumentEvent['type'];
  payload: DocumentEvent['payload'];
  createdAt: number;
  sequenceNumber: number;
}

export type IngestOutcome =
  | { kind: 'no-remote-events' }
  | { kind: 'rule1-no-local-edits'; ingested: number }
  | { kind: 'rule2-non-overlapping'; ingested: number }
  | { kind: 'rule4-redundant-locals'; ingested: number; droppedLocalIds: string[] }
  | { kind: 'rule3-conflict'; remoteEvents: DocumentEvent[]; conflictingLocalIds: string[] }
  | { kind: 'fetch-failed' };

const CONFLICT_EVENT = 'docsourcing:remote-conflict';

export interface RemoteConflictDetail {
  aggregateId: string;
  remoteEvents: DocumentEvent[];
  conflictingLocalIds: string[];
}

export function subscribeRemoteConflicts(
  fn: (detail: RemoteConflictDetail) => void,
): () => void {
  const handler = (e: Event) => fn((e as CustomEvent<RemoteConflictDetail>).detail);
  window.addEventListener(CONFLICT_EVENT, handler);
  return () => window.removeEventListener(CONFLICT_EVENT, handler);
}

/**
 * Fetch every event the server has for `aggregateId` strictly after
 * `afterSeq`, classify the situation, and act per the conflict rules.
 *
 *  R1) No local pending edits → ingest blindly.
 *  R2) Local pending edits but anchors still locatable post-ingest → ingest;
 *      the SyncEngine's existing OCC-rebase pipeline will renumber locals.
 *  R3) Anchor lost on at least one local pending event → DO NOT ingest.
 *      Dispatch a window event so the editor opens the side-by-side modal.
 *      Caller (the hook) is responsible for pausing the sync engine.
 */
export async function ingestRemoteEvents(
  aggregateId: string,
  afterSeq: number,
): Promise<IngestOutcome> {
  let res: Response;
  try {
    res = await fetch(
      `/api/documents/${aggregateId}/events?afterSeq=${encodeURIComponent(String(afterSeq))}`,
    );
  } catch {
    return { kind: 'fetch-failed' };
  }
  if (!res.ok) return { kind: 'fetch-failed' };

  const body = (await res.json()) as { items?: ServerEventRow[] };
  const items = body.items ?? [];
  if (items.length === 0) return { kind: 'no-remote-events' };

  const remoteEvents: DocumentEvent[] = items.map((ev) => ({
    id: ev.id,
    aggregateId: ev.aggregateId,
    type: ev.type,
    payload: ev.payload,
    createdAt: ev.createdAt,
    sequenceNumber: ev.sequenceNumber,
  } as DocumentEvent));

  const db = getDb();

  // Snapshot local state for classification before any writes.
  const allLocal = await db.events.where('aggregateId').equals(aggregateId).toArray();
  const localSyncedEvents = allLocal.filter((r) => r.status === 'synced').map(rowToStoredEvent);
  const localPendingEvents = allLocal.filter((r) => r.status === 'pending').map(rowToStoredEvent);

  // Drop any "remote" events we already have locally (e.g., we just round-tripped them).
  const localIds = new Set(allLocal.map((r) => r.id));
  const trulyNewRemote = remoteEvents.filter((e) => !localIds.has(e.id));
  if (trulyNewRemote.length === 0) return { kind: 'no-remote-events' };

  const verdict: IngestVerdict = classifyRemoteIngest({
    aggregateId,
    localSyncedEvents,
    localPendingEvents,
    remoteEvents: trulyNewRemote,
  });

  if (verdict.kind === 'rule4-redundant-locals') {
    // Drop the local pending events first — they're already covered by the
    // server's events. Park (rather than delete) so the dead letter shows the
    // discarded work for inspection.
    for (const id of verdict.redundantLocalIds) {
      await parkEvent(id, 'occ', 'REDUNDANT_AFTER_REMOTE',
        'Local pending event made redundant by remote events');
    }
    let ingested = 0;
    await db.transaction('rw', db.events, async () => {
      for (const ev of trulyNewRemote) {
        await db.events.put({
          id: ev.id,
          aggregateId: ev.aggregateId,
          type: ev.type,
          payload: ev.payload,
          createdAt: ev.createdAt,
          sequenceNumber: ev.sequenceNumber,
          status: 'synced',
          syncedAt: Date.now(),
          retryCount: 0,
        });
        ingested += 1;
      }
    });
    return {
      kind: 'rule4-redundant-locals',
      ingested,
      droppedLocalIds: verdict.redundantLocalIds,
    };
  }

  if (verdict.kind === 'rule3-conflict') {
    // Don't write anything to Dexie. Surface the conflict so the editor can
    // open the modal. Sync engine pause is the caller's responsibility.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<RemoteConflictDetail>(CONFLICT_EVENT, {
          detail: {
            aggregateId,
            remoteEvents: trulyNewRemote,
            conflictingLocalIds: verdict.conflictingLocalIds,
          },
        }),
      );
    }
    return {
      kind: 'rule3-conflict',
      remoteEvents: trulyNewRemote,
      conflictingLocalIds: verdict.conflictingLocalIds,
    };
  }

  // Rule 1 or 2: ingest the remote events.
  let ingested = 0;
  await db.transaction('rw', db.events, async () => {
    for (const ev of trulyNewRemote) {
      await db.events.put({
        id: ev.id,
        aggregateId: ev.aggregateId,
        type: ev.type,
        payload: ev.payload,
        createdAt: ev.createdAt,
        sequenceNumber: ev.sequenceNumber,
        status: 'synced',
        syncedAt: Date.now(),
        retryCount: 0,
      });
      ingested += 1;
    }
  });

  return { kind: verdict.kind, ingested };
}
