import { NextResponse } from 'next/server';
import { eventPolicies } from '@/lib/events/policies';
import type { DocumentEvent, DocumentEventType } from '@/lib/events/types';
import type { AcceptedEntry, BatchResponse, RejectedEntry } from '@/lib/api/errors';
import { overallClass } from '@/lib/api/errors';
import {
  getAggregate,
  getEventAt,
  getMaxSeq,
  insertEventWithSeq,
  tryInsertEvent,
} from '@/lib/db/queries';
import { withTransaction } from '@/lib/db/pool';

export const runtime = 'nodejs';

const KNOWN_TYPES = new Set<DocumentEventType>([
  'DOCUMENT_CREATED',
  'DOCUMENT_RENAMED',
  'TEXT_INSERTED',
  'TEXT_DELETED',
  'DOCUMENT_ARCHIVED',
]);

function isEvent(x: unknown): x is DocumentEvent {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.aggregateId === 'string' &&
    typeof o.type === 'string' &&
    KNOWN_TYPES.has(o.type as DocumentEventType) &&
    typeof o.createdAt === 'number' &&
    typeof o.sequenceNumber === 'number' &&
    typeof o.payload === 'object' &&
    o.payload !== null
  );
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        errorClass: 'unrecoverable',
        accepted: [],
        rejected: [{ id: '', errorClass: 'unrecoverable', errorCode: 'INVALID_JSON' }],
      } satisfies BatchResponse,
      { status: 400 },
    );
  }

  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json(
      {
        errorClass: 'unrecoverable',
        accepted: [],
        rejected: [{ id: '', errorClass: 'unrecoverable', errorCode: 'EMPTY_BATCH' }],
      } satisfies BatchResponse,
      { status: 400 },
    );
  }

  const accepted: AcceptedEntry[] = [];
  const rejected: RejectedEntry[] = [];

  await withTransaction(async (client) => {
    for (const raw of events) {
      if (!isEvent(raw)) {
        const id = (raw as { id?: unknown })?.id;
        rejected.push({
          id: typeof id === 'string' ? id : '',
          errorClass: 'unrecoverable',
          errorCode: 'INVALID_EVENT_SHAPE',
        });
        continue;
      }
      const event = raw;

      const { inserted } = await tryInsertEvent(client, event);
      if (inserted) {
        accepted.push({ id: event.id, serverSeq: event.sequenceNumber });
        continue;
      }

      const policy = eventPolicies[event.type];
      const winning = await getEventAt(client, event.aggregateId, event.sequenceNumber);

      if (policy.occ === 'rebase' || policy.occ === 'append-and-override') {
        const newSeq = (await getMaxSeq(client, event.aggregateId)) + 1;
        await insertEventWithSeq(client, event, newSeq);
        accepted.push({ id: event.id, serverSeq: newSeq });
        continue;
      }

      const rejection: RejectedEntry = {
        id: event.id,
        errorClass: 'occ',
        errorCode: 'SEQUENCE_CONFLICT',
        message: `Sequence ${event.sequenceNumber} already taken for aggregate ${event.aggregateId}`,
        ...(winning ? { winningEvent: winning } : {}),
      };
      rejected.push(rejection);
    }
  });

  const firstAggregate = events.find(isEvent)?.aggregateId;
  const serverAggregate = firstAggregate ? await getAggregate(firstAggregate) : null;

  const payload: BatchResponse = {
    errorClass: overallClass(accepted, rejected),
    accepted,
    rejected,
    ...(serverAggregate ? { serverAggregate } : {}),
  };
  return NextResponse.json(payload);
}
