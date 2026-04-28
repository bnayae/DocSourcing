import {
  type DocumentEvent,
  type DocumentState,
  emptyDocumentState,
} from './types';
import { applyDelete, applyInsert } from './anchors';

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
      const { beforeSentence, afterSentence, text } = event.payload;
      const next = applyInsert(state.body, beforeSentence, afterSentence, text);
      // If anchors are missing in local state we still advance lastSeq so the
      // log stays monotonic; the body just doesn't change.
      return {
        ...state,
        body: next ?? state.body,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };
    }

    case 'TEXT_DELETED': {
      const { beforeSentence, afterSentence, text } = event.payload;
      const next = applyDelete(state.body, beforeSentence, afterSentence, text);
      return {
        ...state,
        body: next ?? state.body,
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

    case 'FIX':
    case 'CORRECTION': {
      // Same anchored-insert semantics as TEXT_INSERTED.
      const { beforeSentence, afterSentence, text } = event.payload;
      const next = applyInsert(state.body, beforeSentence, afterSentence, text);
      return {
        ...state,
        body: next ?? state.body,
        lastSeq: Math.max(state.lastSeq, event.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, event.createdAt),
      };
    }

    case 'OVERRIDE':
      return {
        ...state,
        body: event.payload.replacementText,
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
  // Collect every event id mentioned by any OVERRIDE event's undone list.
  // These are still in the log (immutable) but contribute nothing to state.
  const undone = new Set<string>();
  for (const e of ordered) {
    if (e.type === 'OVERRIDE') {
      for (const id of e.payload.undoneEventIds) undone.add(id);
    }
  }
  return ordered.reduce<DocumentState>((state, e) => {
    if (undone.has(e.id)) {
      // Still bump bookkeeping so lastSeq/lastEventAt stay monotonic.
      return {
        ...state,
        lastSeq: Math.max(state.lastSeq, e.sequenceNumber),
        lastEventAt: Math.max(state.lastEventAt, e.createdAt),
      };
    }
    return applyEvent(state, e);
  }, emptyDocumentState(aggregateId));
}
