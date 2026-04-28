'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DocumentEvent } from '@/lib/events/types';

interface Props {
  serverBody: string;
  initialLocalBody: string;
  remoteEvents: DocumentEvent[];
  onTakeServer: () => void | Promise<void>;
  onResolve: (resolvedBody: string) => void | Promise<void>;
  onOverride: (resolvedBody: string) => void | Promise<void>;
  onDismiss: () => void;
}

interface Diff {
  start: number;
  endA: number;
  endB: number;
}

function diff(a: string, b: string): Diff | null {
  if (a === b) return null;
  let start = 0;
  const minLen = Math.min(a.length, b.length);
  while (start < minLen && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, endA, endB };
}

function highlightedBody(body: string, range: { start: number; end: number } | null) {
  if (!range || range.end <= range.start) {
    return <span>{body}</span>;
  }
  return (
    <>
      <span>{body.slice(0, range.start)}</span>
      <span style={{ background: '#fff3cd', color: '#664d03', padding: '0 1px' }}>
        {body.slice(range.start, range.end)}
      </span>
      <span>{body.slice(range.end)}</span>
    </>
  );
}

export function ConflictModal({
  serverBody,
  initialLocalBody,
  onTakeServer,
  onResolve,
  onOverride,
  onDismiss,
}: Props) {
  const [draft, setDraft] = useState(initialLocalBody);
  const [busy, setBusy] = useState<null | 'take' | 'resolve' | 'override'>(null);

  // Lock body scroll while modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const d = useMemo(() => diff(serverBody, draft), [serverBody, draft]);
  const serverRange = d ? { start: d.start, end: d.endA } : null;
  const localRange = d ? { start: d.start, end: d.endB } : null;

  const wrap = async (kind: 'take' | 'resolve' | 'override', fn: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(kind);
    try { await fn(); }
    finally { setBusy(null); }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Resolve conflict"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
          width: 'min(1100px, 100%)',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header style={{ padding: '12px 16px', borderBottom: '1px solid #e5e5e5' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Concurrent edit conflict</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#666' }}>
            Another user changed the document while you had unsynced edits. Edit the right
            side to merge, take the server&rsquo;s version, or override with your version.
          </p>
        </header>

        <div style={{ display: 'flex', gap: 12, padding: 12, flex: 1, minHeight: 0 }}>
          <section style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#0d6efd' }}>Server version</div>
            <div
              style={{
                flex: 1,
                padding: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                background: '#f8f9fa',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                overflow: 'auto',
                minHeight: 200,
              }}
            >
              {highlightedBody(serverBody, serverRange)}
            </div>
          </section>

          <section style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#dc3545' }}>Your version (editable)</div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{
                flex: 1,
                padding: 10,
                border: '1px solid #ccc',
                borderRadius: 4,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 13,
                lineHeight: 1.5,
                resize: 'none',
                minHeight: 200,
              }}
            />
            <div
              style={{
                fontSize: 12,
                color: '#666',
                padding: 8,
                background: '#fff8e1',
                borderRadius: 4,
                border: '1px solid #ffe69c',
                maxHeight: 80,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {highlightedBody(draft, localRange)}
            </div>
          </section>
        </div>

        <footer
          style={{
            padding: 12,
            borderTop: '1px solid #e5e5e5',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy !== null}
            style={btnStyle('#fff', '#333')}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => wrap('take', onTakeServer)}
            disabled={busy !== null}
            style={btnStyle('#fff', '#0d6efd', '#0d6efd')}
          >
            {busy === 'take' ? 'Taking…' : 'Take server version'}
          </button>
          <button
            type="button"
            onClick={() => wrap('resolve', () => onResolve(draft))}
            disabled={busy !== null}
            style={btnStyle('#198754', '#fff')}
          >
            {busy === 'resolve' ? 'Resolving…' : 'Resolve with my version'}
          </button>
          <button
            type="button"
            onClick={() => wrap('override', () => onOverride(draft))}
            disabled={busy !== null}
            style={btnStyle('#dc3545', '#fff')}
            title="Discard the conflicting server events and keep your version"
          >
            {busy === 'override' ? 'Overriding…' : 'Override with my version'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function btnStyle(bg: string, color: string, border?: string): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 4,
    border: `1px solid ${border ?? bg}`,
    background: bg,
    color,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  };
}
