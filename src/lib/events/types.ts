export interface BaseEventFields {
  id: string;
  aggregateId: string;
  createdAt: number;
  sequenceNumber: number;
}

export interface DocumentCreatedEvent extends BaseEventFields {
  type: 'DOCUMENT_CREATED';
  payload: { title: string; ownerId: string };
}

export interface DocumentRenamedEvent extends BaseEventFields {
  type: 'DOCUMENT_RENAMED';
  payload: { title: string };
}

export interface TextInsertedEvent extends BaseEventFields {
  type: 'TEXT_INSERTED';
  payload: { beforeSentence: string; afterSentence: string; text: string };
}

export interface TextDeletedEvent extends BaseEventFields {
  type: 'TEXT_DELETED';
  payload: { beforeSentence: string; afterSentence: string; text: string };
}

export interface DocumentArchivedEvent extends BaseEventFields {
  type: 'DOCUMENT_ARCHIVED';
  payload: Record<string, never>;
}

/**
 * Auto-merge event emitted when an OCC conflict has no overlap. Same shape
 * as TEXT_INSERTED — kept as a distinct type so the timeline shows that the
 * change came from automatic conflict resolution, not direct user input.
 */
export interface FixEvent extends BaseEventFields {
  type: 'FIX';
  payload: { beforeSentence: string; afterSentence: string; text: string };
}

/**
 * User-resolved partial edit emitted from the conflict modal "Resolve" path.
 * Same shape as TEXT_INSERTED, distinct type for provenance.
 */
export interface CorrectionEvent extends BaseEventFields {
  type: 'CORRECTION';
  payload: { beforeSentence: string; afterSentence: string; text: string };
}

/**
 * Override event: the user has chosen to keep their version on top of
 * the server's events. Records the local pending event IDs that this
 * override supersedes and the full replacement body. Reducer treats the
 * listed IDs as no-ops when folding and sets `body` to `replacementText`.
 *
 * Events are immutable — the undone events stay in the log, they're just
 * skipped during state derivation.
 */
export interface OverrideEvent extends BaseEventFields {
  type: 'OVERRIDE';
  payload: { undoneEventIds: string[]; replacementText: string };
}

export type DocumentEvent =
  | DocumentCreatedEvent
  | DocumentRenamedEvent
  | TextInsertedEvent
  | TextDeletedEvent
  | DocumentArchivedEvent
  | FixEvent
  | CorrectionEvent
  | OverrideEvent;

export type DocumentEventType = DocumentEvent['type'];

export type SyncStatus = 'pending' | 'synced' | 'failed' | 'parked';

export type StoredEvent = DocumentEvent & {
  status: SyncStatus;
  syncedAt?: number;
  retryCount: number;
  lastErrorCode?: string;
};

export interface DocumentState {
  id: string;
  title: string;
  body: string;
  ownerId: string | null;
  isArchived: boolean;
  lastSeq: number;
  lastEventAt: number;
}

export function emptyDocumentState(id: string): DocumentState {
  return {
    id,
    title: '',
    body: '',
    ownerId: null,
    isArchived: false,
    lastSeq: 0,
    lastEventAt: 0,
  };
}
