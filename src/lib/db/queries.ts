import 'server-only';
import type { PoolClient } from 'pg';
import { pool, query } from './pool';
import type { DocumentEvent, DocumentState } from '@/lib/events/types';

interface AggregateRow {
  id: string;
  title: string;
  body: string;
  owner_id: string | null;
  is_archived: boolean;
  last_seq: number;
  last_event_at: string | number;
  updated_at: Date;
}

interface EventRow {
  id: string;
  aggregate_id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string | number;
  sequence_number: number;
}

function rowToState(row: AggregateRow): DocumentState {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    ownerId: row.owner_id,
    isArchived: row.is_archived,
    lastSeq: row.last_seq,
    lastEventAt: Number(row.last_event_at),
  };
}

function rowToEvent(row: EventRow): DocumentEvent {
  return {
    id: row.id,
    aggregateId: row.aggregate_id,
    type: row.type,
    payload: row.payload,
    createdAt: Number(row.created_at),
    sequenceNumber: row.sequence_number,
  } as DocumentEvent;
}

export async function getAllAggregates(): Promise<DocumentState[]> {
  const rows = await query<AggregateRow>(
    'SELECT id, title, body, owner_id, is_archived, last_seq, last_event_at, updated_at FROM document_aggregate ORDER BY updated_at DESC',
  );
  return rows.map(rowToState);
}

export async function getAggregate(id: string): Promise<DocumentState | null> {
  const rows = await query<AggregateRow>(
    'SELECT id, title, body, owner_id, is_archived, last_seq, last_event_at, updated_at FROM document_aggregate WHERE id = $1',
    [id],
  );
  const row = rows[0];
  return row ? rowToState(row) : null;
}

export async function getEventsAfter(aggregateId: string, afterSeq: number): Promise<DocumentEvent[]> {
  const rows = await query<EventRow>(
    `SELECT id, aggregate_id, type, payload, created_at, sequence_number
     FROM documents_events
     WHERE aggregate_id = $1 AND sequence_number > $2
     ORDER BY sequence_number ASC`,
    [aggregateId, afterSeq],
  );
  return rows.map(rowToEvent);
}

export async function getRecentEvents(aggregateId: string, limit = 10): Promise<DocumentEvent[]> {
  const rows = await query<EventRow>(
    `SELECT id, aggregate_id, type, payload, created_at, sequence_number
     FROM documents_events
     WHERE aggregate_id = $1
     ORDER BY sequence_number DESC
     LIMIT $2`,
    [aggregateId, limit],
  );
  return rows.map(rowToEvent);
}

export async function getMaxSeq(client: PoolClient, aggregateId: string): Promise<number> {
  const res = await client.query<{ max: number | null }>(
    'SELECT COALESCE(MAX(sequence_number), 0) AS max FROM documents_events WHERE aggregate_id = $1',
    [aggregateId],
  );
  return res.rows[0]?.max ?? 0;
}

export async function getEventAt(
  client: PoolClient,
  aggregateId: string,
  seq: number,
): Promise<DocumentEvent | null> {
  const res = await client.query<EventRow>(
    `SELECT id, aggregate_id, type, payload, created_at, sequence_number
     FROM documents_events WHERE aggregate_id = $1 AND sequence_number = $2`,
    [aggregateId, seq],
  );
  const row = res.rows[0];
  return row ? rowToEvent(row) : null;
}

export async function tryInsertEvent(
  client: PoolClient,
  event: DocumentEvent,
): Promise<{ inserted: boolean }> {
  const res = await client.query(
    `INSERT INTO documents_events (id, aggregate_id, type, payload, created_at, sequence_number)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)
     ON CONFLICT (aggregate_id, sequence_number) DO NOTHING`,
    [
      event.id,
      event.aggregateId,
      event.type,
      JSON.stringify(event.payload),
      event.createdAt,
      event.sequenceNumber,
    ],
  );
  return { inserted: (res.rowCount ?? 0) > 0 };
}

export async function insertEventWithSeq(
  client: PoolClient,
  event: DocumentEvent,
  newSeq: number,
): Promise<void> {
  await client.query(
    `INSERT INTO documents_events (id, aggregate_id, type, payload, created_at, sequence_number)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      event.id,
      event.aggregateId,
      event.type,
      JSON.stringify(event.payload),
      event.createdAt,
      newSeq,
    ],
  );
}

export async function parkEventServerSide(params: {
  id: string;
  aggregateId: string | null;
  originalEvent: DocumentEvent | unknown;
  errorClass: string;
  errorCode: string;
  description?: string;
}): Promise<void> {
  await query(
    `INSERT INTO event_investigation (id, aggregate_id, original_event, error_class, error_code, description)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      params.id,
      params.aggregateId,
      JSON.stringify(params.originalEvent),
      params.errorClass,
      params.errorCode,
      params.description ?? null,
    ],
  );
}

export async function listInvestigation(limit = 100): Promise<
  Array<{
    id: string;
    aggregateId: string | null;
    originalEvent: unknown;
    errorClass: string;
    errorCode: string;
    description: string | null;
    parkedAt: string;
    resolvedAt: string | null;
    resolution: string | null;
  }>
> {
  const rows = await query<{
    id: string;
    aggregate_id: string | null;
    original_event: unknown;
    error_class: string;
    error_code: string;
    description: string | null;
    parked_at: Date;
    resolved_at: Date | null;
    resolution: string | null;
  }>(
    `SELECT id, aggregate_id, original_event, error_class, error_code, description, parked_at, resolved_at, resolution
     FROM event_investigation
     ORDER BY parked_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    aggregateId: r.aggregate_id,
    originalEvent: r.original_event,
    errorClass: r.error_class,
    errorCode: r.error_code,
    description: r.description,
    parkedAt: r.parked_at.toISOString(),
    resolvedAt: r.resolved_at ? r.resolved_at.toISOString() : null,
    resolution: r.resolution,
  }));
}

// Forces the Pool to be imported (silences unused-import under isolatedModules).
export const __pool = pool;
