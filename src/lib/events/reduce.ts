import {
  type DocumentEvent,
  type DocumentState,
  emptyDocumentState,
} from './types';

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function applyEvent(state: DocumentState, event: DocumentEvent): DocumentState {
  switch (event.type) {
    case 'DOCUMENT_CREATED':
      return {
        ...state,
        title: event.payload.title,
        ownerId: event.payload.ownerId,
        body: '',
        isArchived: false,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };

    case 'DOCUMENT_RENAMED':
      return {
        ...state,
        title: event.payload.title,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };

    case 'TEXT_INSERTED': {
      const pos = clamp(event.payload.position, 0, state.body.length);
      const body = state.body.slice(0, pos) + event.payload.text + state.body.slice(pos);
      return {
        ...state,
        body,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };
    }

    case 'TEXT_DELETED': {
      const pos = clamp(event.payload.position, 0, state.body.length);
      const len = clamp(event.payload.length, 0, state.body.length - pos);
      const body = state.body.slice(0, pos) + state.body.slice(pos + len);
      return {
        ...state,
        body,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };
    }

    case 'DOCUMENT_ARCHIVED':
      return {
        ...state,
        isArchived: true,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };

    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function computeStateFromEvents(
  aggregateId: string,
  events: readonly DocumentEvent[],
): DocumentState {
  const ordered = [...events].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  return ordered.reduce(applyEvent, emptyDocumentState(aggregateId));
}
