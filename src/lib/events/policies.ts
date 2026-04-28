import type { DocumentEventType } from './types';

export type OccPolicy = 'rebase' | 'reject-and-investigate' | 'append-and-override';
export type Visibility = 'silent' | 'notify';

export interface EventPolicy {
  occ: OccPolicy;
  visibility: Visibility;
}

export const eventPolicies: Record<DocumentEventType, EventPolicy> = {
  DOCUMENT_CREATED:  { occ: 'reject-and-investigate', visibility: 'notify' },
  DOCUMENT_RENAMED:  { occ: 'append-and-override',    visibility: 'silent' },
  TEXT_INSERTED:     { occ: 'rebase',                 visibility: 'silent' },
  TEXT_DELETED:      { occ: 'rebase',                 visibility: 'silent' },
  DOCUMENT_ARCHIVED: { occ: 'reject-and-investigate', visibility: 'notify' },
  // Conflict-resolution events: rebase silently (server may reorder seq) but
  // on persistent failure we surface them to the user via the conflict UI.
  FIX:               { occ: 'rebase',                 visibility: 'silent' },
  CORRECTION:        { occ: 'rebase',                 visibility: 'silent' },
  OVERRIDE:          { occ: 'append-and-override',    visibility: 'notify' },
};

export const MAX_REBASE_ATTEMPTS = 3;
export const POISON_RETRY_THRESHOLD = 5;
export const SILENT_RETRY_THRESHOLD = 3;
export const SILENT_RETRY_WINDOW_MS = 30_000;
