'use client';

import { computeStateFromEvents } from '@/lib/events/reduce';
import type { DocumentEvent, StoredEvent } from '@/lib/events/types';
import { locateAnchor } from '@/lib/events/anchors';

export type IngestVerdict =
  | { kind: 'rule1-no-local-edits' }
  | { kind: 'rule2-non-overlapping' }
  // Rule 4: locals would change body if applied, but the body produced by
  // (synced + remote + locals) is identical to (synced + remote) — i.e. the
  // user's local edits are now redundant with the server's. Drop the locals.
  | { kind: 'rule4-redundant-locals'; redundantLocalIds: string[] }
  | { kind: 'rule3-conflict'; conflictingLocalIds: string[] };

interface AnchoredPayload {
  beforeSentence: string;
  afterSentence: string;
  text: string;
}

function isAnchoredEvent(
  e: StoredEvent,
): e is StoredEvent & { payload: AnchoredPayload } {
  return e.type === 'TEXT_INSERTED' || e.type === 'TEXT_DELETED' ||
         e.type === 'FIX' || e.type === 'CORRECTION';
}

function toDomainEvent(e: StoredEvent): DocumentEvent {
  const { id, aggregateId, type, payload, createdAt, sequenceNumber } = e;
  return { id, aggregateId, type, payload, createdAt, sequenceNumber } as DocumentEvent;
}

/**
 * Decide how to handle a batch of remote events about to be ingested.
 *
 * Inputs:
 * - `localSyncedEvents`: every event already in Dexie with status 'synced'.
 * - `localPendingEvents`: every local pending event for this aggregate.
 * - `remoteEvents`: the new events fetched from the server.
 *
 * Rules (per the spec):
 *  R1) No local pending edits  → remote wins, ingest blindly.
 *  R2) Every local pending event's anchor pair is still locatable in the
 *      body that results from folding (synced + remote) events
 *      → remote wins, ingest. Locals will OCC-rebase on next sync.
 *  R3) At least one local pending event's anchors are gone after the remote
 *      fold → conflict; caller should pause sync and surface the modal.
 */
export function classifyRemoteIngest(args: {
  aggregateId: string;
  localSyncedEvents: StoredEvent[];
  localPendingEvents: StoredEvent[];
  remoteEvents: DocumentEvent[];
}): IngestVerdict {
  const { aggregateId, localSyncedEvents, localPendingEvents, remoteEvents } = args;

  if (localPendingEvents.length === 0) {
    return { kind: 'rule1-no-local-edits' };
  }

  // Fold synced + remote (deduped by id) to get the post-ingest body.
  const byId = new Map<string, DocumentEvent>();
  for (const e of localSyncedEvents) byId.set(e.id, toDomainEvent(e));
  for (const e of remoteEvents) byId.set(e.id, e);
  const postIngestState = computeStateFromEvents(aggregateId, [...byId.values()]);
  const body = postIngestState.body;

  const conflictingLocalIds: string[] = [];
  for (const local of localPendingEvents) {
    if (!isAnchoredEvent(local)) continue; // non-text events: no anchor to check
    const at = locateAnchor(body, local.payload.beforeSentence, local.payload.afterSentence);
    if (at === null) {
      conflictingLocalIds.push(local.id);
    }
  }

  if (conflictingLocalIds.length === 0) {
    // Anchors all valid. Either Rule 2 (locals will change the body further)
    // or Rule 4 (locals would no-op against the post-remote body — they're
    // redundant with the server's events).
    const allWithLocals = new Map(byId);
    for (const e of localPendingEvents) {
      allWithLocals.set(e.id, toDomainEvent(e));
    }
    const withLocalsState = computeStateFromEvents(aggregateId, [...allWithLocals.values()]);
    if (withLocalsState.body === body) {
      return {
        kind: 'rule4-redundant-locals',
        redundantLocalIds: localPendingEvents.map((e) => e.id),
      };
    }
    return { kind: 'rule2-non-overlapping' };
  }

  return { kind: 'rule3-conflict', conflictingLocalIds };
}
