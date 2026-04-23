'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '@/lib/client/dexie';
import { computeStateFromEvents } from '@/lib/events/reduce';
import type { DocumentEvent, DocumentState } from '@/lib/events/types';

export interface DocumentSummary {
  id: string;
  title: string;
  isArchived: boolean;
  lastEventAt: number;
  pendingCount: number;
}

export function useDocumentList(): DocumentSummary[] | undefined {
  return useLiveQuery(async () => {
    const db = getDb();
    const all = await db.events.where('status').notEqual('parked').toArray();
    const byAggregate = new Map<string, typeof all>();
    for (const row of all) {
      const bucket = byAggregate.get(row.aggregateId) ?? [];
      bucket.push(row);
      byAggregate.set(row.aggregateId, bucket);
    }
    const result: DocumentSummary[] = [];
    for (const [id, rows] of byAggregate) {
      const synced = rows.filter((r) => r.status === 'synced');
      const pending = rows.filter((r) => r.status === 'pending');
      const domainEvents: DocumentEvent[] = [...synced, ...pending].map((r) => ({
        id: r.id,
        aggregateId: r.aggregateId,
        type: r.type,
        payload: r.payload,
        createdAt: r.createdAt,
        sequenceNumber: r.sequenceNumber,
      })) as DocumentEvent[];
      const state: DocumentState = computeStateFromEvents(id, domainEvents);
      result.push({
        id,
        title: state.title || '(untitled)',
        isArchived: state.isArchived,
        lastEventAt: state.lastEventAt,
        pendingCount: pending.length,
      });
    }
    result.sort((a, b) => b.lastEventAt - a.lastEventAt);
    return result;
  }, []);
}
