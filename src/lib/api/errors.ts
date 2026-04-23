import type { DocumentEvent } from '@/lib/events/types';

export type ErrorClass = 'none' | 'transient' | 'occ' | 'unrecoverable';

export interface AcceptedEntry {
  id: string;
  serverSeq: number;
}

export interface RejectedEntry {
  id: string;
  errorClass: Exclude<ErrorClass, 'none'>;
  errorCode: string;
  message?: string;
  winningEvent?: DocumentEvent;
  poison?: boolean;
}

export interface BatchResponse {
  errorClass: ErrorClass;
  accepted: AcceptedEntry[];
  rejected: RejectedEntry[];
  retryAfterMs?: number;
  serverAggregate?: unknown;
}

export function overallClass(accepted: AcceptedEntry[], rejected: RejectedEntry[]): ErrorClass {
  if (rejected.length === 0) return 'none';
  const order: Record<Exclude<ErrorClass, 'none'>, number> = {
    transient: 1,
    occ: 2,
    unrecoverable: 3,
  };
  let worst: Exclude<ErrorClass, 'none'> = 'transient';
  for (const r of rejected) {
    if (order[r.errorClass] > order[worst]) worst = r.errorClass;
  }
  return worst;
}
