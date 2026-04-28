'use client';

import { getDb, type StoredEventRow } from './dexie';
import type { DocumentEvent } from '@/lib/events/types';
import type { BatchResponse } from '@/lib/api/errors';
import {
  POISON_RETRY_THRESHOLD,
  SILENT_RETRY_THRESHOLD,
  SILENT_RETRY_WINDOW_MS,
} from '@/lib/events/policies';
import { bumpRetry, parkEvent } from './store';
import { handleBatchResponse } from './conflictRouting';
import { broadcastRemoteEventsAvailable } from '@/hooks/useRemoteEventSync';

type SyncListener = (syncedIds: string[]) => void;

function rowToEvent(r: StoredEventRow): DocumentEvent {
  return {
    id: r.id,
    aggregateId: r.aggregateId,
    type: r.type,
    payload: r.payload,
    createdAt: r.createdAt,
    sequenceNumber: r.sequenceNumber,
  } as DocumentEvent;
}

async function mirrorDeadLetter(entry: {
  id: string;
  aggregateId: string;
  errorClass: string;
  errorCode: string;
  description?: string;
}): Promise<void> {
  try {
    await fetch('/api/events/dead-letter', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(entry),
    });
  } catch {
    // Best-effort mirror; failure is non-fatal locally.
  }
}

export class SyncEngine {
  private running = false;
  private stopped = true;
  private isOnline = true;
  private paused = false;
  private transientFailures = 0;
  private firstFailureAt: number | null = null;
  private backoffMs = 1000;
  private readonly listeners = new Set<SyncListener>();
  private wakeTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    this.stopped = false;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.wakeTimer) {
      clearTimeout(this.wakeTimer);
      this.wakeTimer = null;
    }
  }

  setOnline(value: boolean): void {
    const was = this.isOnline;
    this.isOnline = value;
    if (!was && value) this.kick();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.kick();
  }

  isPaused(): boolean {
    return this.paused;
  }

  onSyncComplete(fn: SyncListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  kick(): void {
    if (this.running || this.stopped || !this.isOnline || this.paused) return;
    void this.loop();
  }

  private schedule(ms: number): void {
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      void this.loop();
    }, ms);
  }

  private async loop(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (!this.stopped && this.isOnline && !this.paused) {
        const nextAggregate = await this.pickNextAggregate();
        if (!nextAggregate) break;

        const events = await this.pendingEventsFor(nextAggregate);
        if (events.length === 0) continue;

        const serverResponse = await this.postBatch(events);
        if (!serverResponse) {
          this.handleTransient();
          this.schedule(this.backoffMs);
          return;
        }

        this.transientFailures = 0;
        this.firstFailureAt = null;
        this.backoffMs = 1000;

        const acceptedLocalSeqBySeq = new Map<string, number>(
          events.map((e) => [e.id, e.sequenceNumber] as const),
        );
        const result = await handleBatchResponse(
          serverResponse,
          acceptedLocalSeqBySeq,
          mirrorDeadLetter,
        );

        await this.detectPoison(nextAggregate);

        for (const a of serverResponse.accepted) {
          this.emit([a.id]);
        }

        // Wake up sibling tabs (same browser) so they ingest right away
        // instead of waiting for the next 10s poll.
        if (serverResponse.accepted.length > 0) {
          broadcastRemoteEventsAvailable(nextAggregate);
        }

        if (result.hardBlocked) continue;
      }
    } finally {
      this.running = false;
    }
  }

  private async pickNextAggregate(): Promise<string | null> {
    const db = getDb();
    const rows = await db.events.where('status').equals('pending').toArray();
    if (rows.length === 0) return null;
    rows.sort((a, b) => a.createdAt - b.createdAt);
    return rows[0]?.aggregateId ?? null;
  }

  private async pendingEventsFor(aggregateId: string): Promise<StoredEventRow[]> {
    const db = getDb();
    const rows = await db.events
      .where('aggregateId')
      .equals(aggregateId)
      .and((r) => r.status === 'pending')
      .toArray();
    rows.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    return rows;
  }

  private async postBatch(events: StoredEventRow[]): Promise<BatchResponse | null> {
    try {
      const res = await fetch('/api/events/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: events.map(rowToEvent) }),
      });
      if (res.status >= 500 || res.status === 408 || res.status === 429) return null;
      return (await res.json()) as BatchResponse;
    } catch {
      return null;
    }
  }

  private handleTransient(): void {
    this.transientFailures += 1;
    if (this.firstFailureAt === null) this.firstFailureAt = Date.now();
    this.backoffMs = Math.min(this.backoffMs * 2, 30_000);

    const noisy =
      this.transientFailures > SILENT_RETRY_THRESHOLD ||
      Date.now() - (this.firstFailureAt ?? Date.now()) > SILENT_RETRY_WINDOW_MS;
    if (noisy) {
      // Hook for a UI toast — intentionally minimal in the scaffold.
    }
  }

  private async detectPoison(aggregateId: string): Promise<void> {
    const db = getDb();
    const rows = await db.events
      .where('aggregateId')
      .equals(aggregateId)
      .and((r) => r.status === 'pending' && r.retryCount >= POISON_RETRY_THRESHOLD)
      .toArray();
    for (const row of rows) {
      await parkEvent(
        row.id,
        'poison',
        row.lastErrorCode ?? 'POISON_THRESHOLD',
        'Retry threshold exceeded',
      );
      window.dispatchEvent(new CustomEvent('poison-pill-detected', { detail: { id: row.id } }));
    }
  }

  private emit(ids: string[]): void {
    for (const fn of this.listeners) fn(ids);
  }

  async recordRetry(id: string, errorCode: string): Promise<void> {
    await bumpRetry(id, errorCode);
  }
}

let _engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (typeof window === 'undefined') {
    throw new Error('SyncEngine is only available in the browser');
  }
  if (!_engine) _engine = new SyncEngine();
  return _engine;
}
