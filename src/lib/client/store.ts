'use client';

import Dexie from 'dexie';
import { v4 as uuid } from 'uuid';
import { getDb, type StoredEventRow } from './dexie';
import type { DocumentEvent, DocumentEventType } from '@/lib/events/types';

type EventInput = {
  [K in DocumentEventType]: {
    type: K;
    aggregateId: string;
    payload: Extract<DocumentEvent, { type: K }>['payload'];
  };
}[DocumentEventType];

/**
 * Append a new event locally with status='pending'.
 * Sequence number = max(non-parked seq for this aggregate) + 1.
 */
export async function addEvent(input: EventInput): Promise<StoredEventRow> {
  const db = getDb();
  return db.transaction('rw', db.events, async () => {
    const rows = await db.events
      .where('aggregateId')
      .equals(input.aggregateId)
      .and((r) => r.status !== 'parked')
      .toArray();
    const maxSeq = rows.reduce((m, r) => Math.max(m, r.sequenceNumber), 0);
    const row: StoredEventRow = {
      id: uuid(),
      aggregateId: input.aggregateId,
      type: input.type,
      payload: input.payload,
      createdAt: Date.now(),
      sequenceNumber: maxSeq + 1,
      status: 'pending',
      retryCount: 0,
    };
    await db.events.add(row);
    return row;
  });
}

export async function markEventSynced(id: string, serverSeq?: number): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.events, async () => {
    const existing = await db.events.get(id);
    if (!existing) return;
    await db.events.put({
      ...existing,
      status: 'synced',
      syncedAt: Date.now(),
      ...(serverSeq !== undefined ? { sequenceNumber: serverSeq } : {}),
    });
  });
}

export async function markEventFailed(id: string, errorCode: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.events, async () => {
    const existing = await db.events.get(id);
    if (!existing) return;
    await db.events.put({
      ...existing,
      status: 'failed',
      lastErrorCode: errorCode,
    });
  });
}

export async function bumpRetry(id: string, errorCode: string): Promise<number> {
  const db = getDb();
  let next = 0;
  await db.transaction('rw', db.events, async () => {
    const existing = await db.events.get(id);
    if (!existing) return;
    next = existing.retryCount + 1;
    await db.events.put({
      ...existing,
      retryCount: next,
      lastErrorCode: errorCode,
    });
  });
  return next;
}

/**
 * Park an event (poison pill) and renumber subsequent pending events on the same
 * aggregate DOWNWARD by 1 to close the gap.
 */
export async function parkEvent(id: string, errorClass: string, errorCode: string, description?: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.events, db.eventInvestigation, async () => {
    const existing = await db.events.get(id);
    if (!existing) return;

    await db.events.put({ ...existing, status: 'parked' });

    await db.eventInvestigation.put({
      id: existing.id,
      aggregateId: existing.aggregateId,
      originalEvent: existing,
      errorClass,
      errorCode,
      description: description ?? null,
      parkedAt: Date.now(),
    });

    const subsequent = await db.events
      .where('[aggregateId+sequenceNumber]')
      .between(
        [existing.aggregateId, existing.sequenceNumber + 1],
        [existing.aggregateId, Dexie.maxKey],
      )
      .and((r) => r.status === 'pending')
      .toArray();

    for (const r of subsequent) {
      await db.events.put({ ...r, sequenceNumber: r.sequenceNumber - 1 });
    }
  });
}

/**
 * After a server-side rebase, reassign the event's sequenceNumber to `serverSeq`
 * and renumber subsequent local pending events on the same aggregate to close the gap.
 */
export async function applyRebase(id: string, serverSeq: number): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.events, async () => {
    const existing = await db.events.get(id);
    if (!existing) return;
    const oldSeq = existing.sequenceNumber;
    await db.events.put({
      ...existing,
      sequenceNumber: serverSeq,
      status: 'synced',
      syncedAt: Date.now(),
    });

    if (serverSeq === oldSeq) return;

    const subsequent = await db.events
      .where('aggregateId')
      .equals(existing.aggregateId)
      .and((r) => r.status === 'pending' && r.sequenceNumber > oldSeq)
      .toArray();

    const delta = serverSeq - oldSeq;
    for (const r of subsequent) {
      await db.events.put({ ...r, sequenceNumber: r.sequenceNumber + delta });
    }
  });
}
