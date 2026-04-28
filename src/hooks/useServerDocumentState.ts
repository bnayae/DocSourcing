'use client';

import { useQuery } from '@tanstack/react-query';
import type { DocumentState } from '@/lib/events/types';

const POLL_INTERVAL_MS = 10000;

async function fetchState(id: string): Promise<DocumentState | null> {
  const res = await fetch(`/api/documents/${id}/state`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`state fetch failed: ${res.status}`);
  return (await res.json()) as DocumentState;
}

export function useServerDocumentState(aggregateId: string | undefined) {
  return useQuery({
    queryKey: ['document-state', aggregateId],
    queryFn: () => fetchState(aggregateId!),
    enabled: Boolean(aggregateId),
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
