'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getDb, rowToStoredEvent, type StoredEventRow } from '@/lib/client/dexie';
import type { StoredEvent } from '@/lib/events/types';

export function useDocumentEvents(aggregateId: string | undefined): StoredEvent[] | undefined {
  return useLiveQuery(async () => {
    if (!aggregateId) return [];
    const db = getDb();
    const rows: StoredEventRow[] = await db.events
      .where('aggregateId')
      .equals(aggregateId)
      .and((r) => r.status !== 'parked')
      .sortBy('sequenceNumber');
    return rows.map(rowToStoredEvent);
  }, [aggregateId]);
}
