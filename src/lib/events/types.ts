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
  payload: { position: number; text: string };
}

export interface TextDeletedEvent extends BaseEventFields {
  type: 'TEXT_DELETED';
  payload: { position: number; length: number };
}

export interface DocumentArchivedEvent extends BaseEventFields {
  type: 'DOCUMENT_ARCHIVED';
  payload: Record<string, never>;
}

export type DocumentEvent =
  | DocumentCreatedEvent
  | DocumentRenamedEvent
  | TextInsertedEvent
  | TextDeletedEvent
  | DocumentArchivedEvent;

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
