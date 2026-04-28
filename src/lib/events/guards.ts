import type {
  CorrectionEvent,
  DocumentArchivedEvent,
  DocumentCreatedEvent,
  DocumentEvent,
  DocumentRenamedEvent,
  FixEvent,
  OverrideEvent,
  TextDeletedEvent,
  TextInsertedEvent,
} from './types';

export const isDocumentCreated = (e: DocumentEvent): e is DocumentCreatedEvent =>
  e.type === 'DOCUMENT_CREATED';

export const isDocumentRenamed = (e: DocumentEvent): e is DocumentRenamedEvent =>
  e.type === 'DOCUMENT_RENAMED';

export const isTextInserted = (e: DocumentEvent): e is TextInsertedEvent =>
  e.type === 'TEXT_INSERTED';

export const isTextDeleted = (e: DocumentEvent): e is TextDeletedEvent =>
  e.type === 'TEXT_DELETED';

export const isDocumentArchived = (e: DocumentEvent): e is DocumentArchivedEvent =>
  e.type === 'DOCUMENT_ARCHIVED';

export const isFix = (e: DocumentEvent): e is FixEvent => e.type === 'FIX';
export const isCorrection = (e: DocumentEvent): e is CorrectionEvent =>
  e.type === 'CORRECTION';
export const isOverride = (e: DocumentEvent): e is OverrideEvent => e.type === 'OVERRIDE';
