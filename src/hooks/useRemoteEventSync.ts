'use client';

import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/client/dexie';
import { ingestRemoteEvents } from '@/lib/client/remoteIngest';
import { getSyncEngine } from '@/lib/client/syncEngine';
import type { DocumentState } from '@/lib/events/types';

/**
 * When the polled server state advances past our local synced log, fetch the
 * missing events and write them into Dexie. Driven off `useServerDocumentState`
 * — call this hook with the latest `serverState`.
 *
 * Listens to a same-browser BroadcastChannel for instant nudges from sibling
 * tabs that just finished a sync.
 */
export function useRemoteEventSync(
  aggregateId: string | undefined,
  serverState: DocumentState | null | undefined,
): void {
  const localMaxSyncedSeq = useLiveQuery(async () => {
    if (!aggregateId) return 0;
    const db = getDb();
    const rows = await db.events
      .where('aggregateId')
      .equals(aggregateId)
      .and((r) => r.status === 'synced')
      .toArray();
    let max = 0;
    for (const r of rows) if (r.sequenceNumber > max) max = r.sequenceNumber;
    return max;
  }, [aggregateId]) ?? 0;

  // Avoid concurrent ingests racing each other.
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!aggregateId) return;
    if (!serverState) return;
    if (serverState.lastSeq <= localMaxSyncedSeq) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;
    void ingestRemoteEvents(aggregateId, localMaxSyncedSeq)
      .then((outcome) => {
        if (outcome.kind === 'rule3-conflict') {
          // Pause sync until the user resolves the conflict in the modal.
          // The modal (step 5) will resume it after Resolve/Take server/Override.
          getSyncEngine().pause();
        }
      })
      .finally(() => {
        inFlightRef.current = false;
      });
  }, [aggregateId, serverState, localMaxSyncedSeq]);

  // BroadcastChannel cross-tab nudge.
  useEffect(() => {
    if (!aggregateId) return;
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`docsourcing:${aggregateId}`);
    channel.onmessage = (event) => {
      if (event.data?.type !== 'remote-events-available') return;
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      void ingestRemoteEvents(aggregateId, localMaxSyncedSeq)
        .then((outcome) => {
          if (outcome.kind === 'rule3-conflict') getSyncEngine().pause();
        })
        .finally(() => {
          inFlightRef.current = false;
        });
    };
    return () => channel.close();
  }, [aggregateId, localMaxSyncedSeq]);
}

/** Notify sibling tabs in the same browser that new server events are available. */
export function broadcastRemoteEventsAvailable(aggregateId: string): void {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(`docsourcing:${aggregateId}`);
  channel.postMessage({ type: 'remote-events-available' });
  channel.close();
}
