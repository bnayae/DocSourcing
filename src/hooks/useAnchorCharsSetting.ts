'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'docsourcing.anchorChars';
export const DEFAULT_ANCHOR_CHARS = 80;
export const MIN_ANCHOR_CHARS = 0;
export const MAX_ANCHOR_CHARS = 500;

const listeners = new Set<() => void>();

function read(): number {
  if (typeof window === 'undefined') return DEFAULT_ANCHOR_CHARS;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return DEFAULT_ANCHOR_CHARS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_ANCHOR_CHARS;
  return Math.max(MIN_ANCHOR_CHARS, Math.min(MAX_ANCHOR_CHARS, n));
}

function write(value: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(MIN_ANCHOR_CHARS, Math.min(MAX_ANCHOR_CHARS, Math.floor(value)));
  window.localStorage.setItem(STORAGE_KEY, String(clamped));
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let cachedValue: number | null = null;
function getSnapshot(): number {
  if (cachedValue === null) cachedValue = read();
  return cachedValue;
}
// Invalidate cache on changes so useSyncExternalStore re-reads.
listeners.add(() => {
  cachedValue = read();
});

export function useAnchorCharsSetting(): [number, (n: number) => void] {
  const value = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => DEFAULT_ANCHOR_CHARS,
  );
  const set = useCallback((n: number) => write(n), []);

  // Sync cross-tab: when localStorage changes from another tab, refresh.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        cachedValue = read();
        for (const fn of listeners) fn();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return [value, set];
}

/** Synchronous read for non-React code (e.g. event emission paths). */
export function getAnchorCharsLimit(): number {
  return read();
}
