'use client';

import { useMemo } from 'react';
import { computeStateFromEvents } from '@/lib/events/reduce';
import { emptyDocumentState, type DocumentEvent, type DocumentState, type StoredEvent } from '@/lib/events/types';
import { useDocumentEvents } from './useDocumentEvents';

export interface DocumentStateView {
  loading: boolean;
  confirmed: DocumentState;
  display: DocumentState;
  pendingCount: number;
  failedCount: number;
}

function toDomainEvent(e: StoredEvent): DocumentEvent {
  const { id, aggregateId, type, payload, createdAt, sequenceNumber } = e;
  return { id, aggregateId, type, payload, createdAt, sequenceNumber } as DocumentEvent;
}

export function useDocumentState(aggregateId: string | undefined): DocumentStateView {
  const events = useDocumentEvents(aggregateId);

  return useMemo<DocumentStateView>(() => {
    const id = aggregateId ?? '';
    if (events === undefined) {
      const empty = emptyDocumentState(id);
      return { loading: true, confirmed: empty, display: empty, pendingCount: 0, failedCount: 0 };
    }
    const synced = events.filter((e) => e.status === 'synced').map(toDomainEvent);
    const pending = events.filter((e) => e.status === 'pending').map(toDomainEvent);
    const failedCount = events.filter((e) => e.status === 'failed').length;

    const confirmed = computeStateFromEvents(id, synced);
    const display = computeStateFromEvents(id, [...synced, ...pending]);

    return {
      loading: false,
      confirmed,
      display,
      pendingCount: pending.length,
      failedCount,
    };
  }, [aggregateId, events]);
}
