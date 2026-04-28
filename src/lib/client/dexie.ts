'use client';

import Dexie, { type Table } from 'dexie';
import type { DocumentEvent, StoredEvent, SyncStatus } from '@/lib/events/types';

export interface StoredEventRow {
  id: string;
  aggregateId: string;
  type: DocumentEvent['type'];
  payload: DocumentEvent['payload'];
  createdAt: number;
  sequenceNumber: number;
  status: SyncStatus;
  syncedAt?: number;
  retryCount: number;
  lastErrorCode?: string;
}

export interface InvestigationRow {
  id: string;
  aggregateId: string | null;
  originalEvent: unknown;
  errorClass: string;
  errorCode: string;
  description: string | null;
  parkedAt: number;
}

export class DocDB extends Dexie {
  events!: Table<StoredEventRow, string>;
  eventInvestigation!: Table<InvestigationRow, string>;

  constructor() {
    super('doc-sourcing');
    this.version(1).stores({
      events:
        'id, aggregateId, createdAt, sequenceNumber, status, [aggregateId+sequenceNumber]',
      eventInvestigation: 'id, aggregateId, parkedAt',
    });
    // v2: switched TEXT_INSERTED/TEXT_DELETED to anchor-based payloads.
    // The old position-based events are incompatible, so wipe both stores.
    this.version(2)
      .stores({
        events:
          'id, aggregateId, createdAt, sequenceNumber, status, [aggregateId+sequenceNumber]',
        eventInvestigation: 'id, aggregateId, parkedAt',
      })
      .upgrade(async (tx) => {
        await tx.table('events').clear();
        await tx.table('eventInvestigation').clear();
      });
  }
}

let _db: DocDB | null = null;

export function getDb(): DocDB {
  if (typeof window === 'undefined') {
    throw new Error('Dexie is only available in the browser');
  }
  if (!_db) _db = new DocDB();
  return _db;
}

export function rowToStoredEvent(row: StoredEventRow): StoredEvent {
  return {
    id: row.id,
    aggregateId: row.aggregateId,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt,
    sequenceNumber: row.sequenceNumber,
    status: row.status,
    ...(row.syncedAt !== undefined ? { syncedAt: row.syncedAt } : {}),
    retryCount: row.retryCount,
    ...(row.lastErrorCode !== undefined ? { lastErrorCode: row.lastErrorCode } : {}),
  } as StoredEvent;
}
