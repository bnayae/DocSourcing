'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { addEvent } from '@/lib/client/store';
import { getSyncEngine } from '@/lib/client/syncEngine';
import { useDocumentState } from '@/hooks/useDocumentState';
import { OfflineBadge } from './OfflineBadge';
import { PendingEventsBadge } from './PendingEventsBadge';
import { OfflineSimulationToggle } from './OfflineSimulationToggle';

interface Props {
  id: string;
}

interface Diff {
  position: number;
  removed: number;
  inserted: string;
}

/**
 * Compute a minimal single-range diff between two strings. Works for typical
 * single-cursor edits (typing, pasting, deleting a selection). Doesn't try to
 * handle two independent edits in one transition — that is vanishingly rare for
 * a debounced onChange on a <textarea>.
 */
function diffStrings(prev: string, next: string): Diff | null {
  if (prev === next) return null;
  let start = 0;
  const maxStart = Math.min(prev.length, next.length);
  while (start < maxStart && prev[start] === next[start]) start++;
  let endPrev = prev.length;
  let endNext = next.length;
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--;
    endNext--;
  }
  return {
    position: start,
    removed: endPrev - start,
    inserted: next.slice(start, endNext),
  };
}

export function DocumentEditor({ id }: Props) {
  const { loading, display, confirmed, pendingCount } = useDocumentState(id);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const bodyValue = display.body;
  const titleValue = titleDraft ?? display.title;

  const lastBodyRef = useRef(bodyValue);
  useEffect(() => {
    lastBodyRef.current = bodyValue;
  }, [bodyValue]);

  async function onBodyChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    const prev = lastBodyRef.current;
    lastBodyRef.current = next;
    const diff = diffStrings(prev, next);
    if (!diff) return;
    if (diff.removed > 0) {
      await addEvent({
        type: 'TEXT_DELETED',
        aggregateId: id,
        payload: { position: diff.position, length: diff.removed },
      });
    }
    if (diff.inserted.length > 0) {
      await addEvent({
        type: 'TEXT_INSERTED',
        aggregateId: id,
        payload: { position: diff.position, text: diff.inserted },
      });
    }
    getSyncEngine().kick();
  }

  async function commitTitle() {
    if (titleDraft === null) return;
    const trimmed = titleDraft.trim();
    setTitleDraft(null);
    if (trimmed && trimmed !== display.title) {
      await addEvent({
        type: 'DOCUMENT_RENAMED',
        aggregateId: id,
        payload: { title: trimmed },
      });
      getSyncEngine().kick();
    }
  }

  async function onArchive() {
    await addEvent({ type: 'DOCUMENT_ARCHIVED', aggregateId: id, payload: {} });
    getSyncEngine().kick();
  }

  const statusLine = useMemo(() => {
    if (loading) return 'Loading…';
    return `Confirmed seq ${confirmed.lastSeq} · display seq ${display.lastSeq}`;
  }, [loading, confirmed.lastSeq, display.lastSeq]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <input
          value={titleValue}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={commitTitle}
          placeholder="Untitled"
          style={{
            flex: 1,
            minWidth: 200,
            padding: '6px 10px',
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 16,
            fontWeight: 600,
          }}
        />
        <PendingEventsBadge count={pendingCount} />
        <OfflineBadge />
        <OfflineSimulationToggle />
        {!display.isArchived ? (
          <button
            type="button"
            onClick={onArchive}
            style={{
              padding: '4px 10px',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Archive
          </button>
        ) : (
          <span style={{ fontSize: 12, color: '#856404' }}>Archived</span>
        )}
      </header>

      <textarea
        value={bodyValue}
        onChange={onBodyChange}
        rows={20}
        style={{
          width: '100%',
          padding: 12,
          border: '1px solid #ccc',
          borderRadius: 4,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 14,
          lineHeight: 1.5,
          resize: 'vertical',
        }}
      />

      <footer style={{ fontSize: 12, color: '#888' }}>{statusLine}</footer>
    </div>
  );
}
