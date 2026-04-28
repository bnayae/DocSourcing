'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { addEvent } from '@/lib/client/store';
import { getSyncEngine } from '@/lib/client/syncEngine';
import { useDocumentState } from '@/hooks/useDocumentState';
import { useDocumentEvents } from '@/hooks/useDocumentEvents';
import { useServerDocumentState } from '@/hooks/useServerDocumentState';
import { useRemoteEventSync } from '@/hooks/useRemoteEventSync';
import { sentenceWindowAt, truncateAnchors } from '@/lib/events/anchors';
import { useAnchorCharsSetting } from '@/hooks/useAnchorCharsSetting';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { computeStateFromEvents } from '@/lib/events/reduce';
import type { DocumentEvent, StoredEvent } from '@/lib/events/types';
import { OfflineBadge } from './OfflineBadge';
import { PendingEventsBadge } from './PendingEventsBadge';
import { OfflineSimulationToggle } from './OfflineSimulationToggle';
import { EventSidebar } from './EventSidebar';
import { ConflictModal } from './ConflictModal';
import { subscribeRemoteConflicts, type RemoteConflictDetail } from '@/lib/client/remoteIngest';
import {
  computeServerBody,
  computeLocalBody,
  takeServerVersion,
  resolveWithUserVersion,
  overrideWithUserVersion,
} from '@/lib/client/conflictResolve';
import { getDb, rowToStoredEvent } from '@/lib/client/dexie';

interface Props {
  id: string;
}

interface Diff {
  position: number;
  removed: number;
  inserted: string;
}

const BODY_THROTTLE_MS = 500;

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

const STALE_THRESHOLD_MS = 10_000;

function toDomainEvent(e: StoredEvent): DocumentEvent {
  const { id, aggregateId, type, payload, createdAt, sequenceNumber } = e;
  return { id, aggregateId, type, payload, createdAt, sequenceNumber } as DocumentEvent;
}

export function DocumentEditor({ id }: Props) {
  const { loading, display, confirmed, pendingCount } = useDocumentState(id);
  const allEvents = useDocumentEvents(id) ?? [];
  const { data: serverState } = useServerDocumentState(id);
  useRemoteEventSync(id, serverState ?? null);
  const [anchorChars, setAnchorChars] = useAnchorCharsSetting();
  const anchorCharsRef = useRef(anchorChars);
  useEffect(() => { anchorCharsRef.current = anchorChars; }, [anchorChars]);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [bodyDraft, setBodyDraft] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);
  const [conflict, setConflict] = useState<RemoteConflictDetail | null>(null);
  const [conflictBodies, setConflictBodies] = useState<{ server: string; local: string } | null>(null);

  // Listen for Rule 3 conflicts surfaced by the remote-ingest pipeline.
  useEffect(() => {
    if (!id) return undefined;
    return subscribeRemoteConflicts(async (detail) => {
      if (detail.aggregateId !== id) return;
      // Snapshot bodies right when the conflict fires so the modal panes are stable.
      const db = getDb();
      const rows = await db.events.where('aggregateId').equals(id).toArray();
      const synced = rows.filter((r) => r.status === 'synced').map(rowToStoredEvent);
      const pending = rows.filter((r) => r.status === 'pending').map(rowToStoredEvent);
      const server = computeServerBody(id, synced, detail.remoteEvents);
      const local = computeLocalBody(id, synced, pending);
      setConflict(detail);
      setConflictBodies({ server, local });
    });
  }, [id]);
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null);

  const latestSyncedSeq = useMemo(() => {
    let max = 0;
    for (const e of allEvents) {
      if (e.status === 'synced' && e.sequenceNumber > max) max = e.sequenceNumber;
    }
    return max;
  }, [allEvents]);

  // Selecting the latest event (or beyond) means "live" — editable.
  const isTimeTraveling = selectedSeq !== null && selectedSeq < latestSyncedSeq;

  // Time-travel state: fold synced events up to and including selectedSeq.
  const pastState = useMemo(() => {
    if (!isTimeTraveling) return null;
    const upTo = allEvents
      .filter((e) => e.status === 'synced' && e.sequenceNumber <= selectedSeq!)
      .map(toDomainEvent);
    return computeStateFromEvents(id, upTo);
  }, [isTimeTraveling, selectedSeq, allEvents, id]);

  // Track when pending count first became non-zero (used to detect staleness).
  const pendingSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (pendingCount === 0) {
      pendingSinceRef.current = null;
      return;
    }
    if (pendingSinceRef.current === null) {
      pendingSinceRef.current = Date.now();
    }
  }, [pendingCount]);

  // Compute staleness: pending events haven't drained for STALE_THRESHOLD_MS
  // while the server's lastSeq is at or behind our confirmed lastSeq.
  useEffect(() => {
    const tick = () => {
      const since = pendingSinceRef.current;
      if (since === null) {
        setIsStale(false);
        return;
      }
      const elapsed = Date.now() - since;
      const serverBehind =
        !serverState || serverState.lastSeq <= confirmed.lastSeq;
      setIsStale(elapsed > STALE_THRESHOLD_MS && serverBehind && pendingCount > 0);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pendingCount, serverState, confirmed.lastSeq]);

  // Pause/resume sync engine based on stale flag. Background auto-fix still
  // runs on each kick so we periodically retry.
  useEffect(() => {
    const engine = getSyncEngine();
    if (isStale) {
      engine.pause();
      const t = setInterval(() => {
        engine.resume();
        engine.kick();
      }, 5000);
      return () => clearInterval(t);
    }
    engine.resume();
    return undefined;
  }, [isStale]);

  const titleValue = isTimeTraveling
    ? pastState!.title
    : (titleDraft ?? display.title);
  const bodyValue = isTimeTraveling
    ? pastState!.body
    : (bodyDraft ?? display.body);

  // The last body value we successfully committed as events. The next flush
  // will diff from this, not from whatever is on-screen right now.
  const committedBodyRef = useRef(display.body);
  useEffect(() => {
    if (bodyDraft === null) {
      committedBodyRef.current = display.body;
    }
  }, [display.body, bodyDraft]);

  // Drop the local draft only once the live state catches up. Clearing it
  // earlier causes a momentary "snap back" to the pre-edit body, and any
  // characters typed during that flash are diffed against a stale baseline,
  // which silently drops them.
  useEffect(() => {
    if (bodyDraft !== null && bodyDraft === display.body) {
      setBodyDraft(null);
    }
  }, [bodyDraft, display.body]);

  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDraftRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const flushBody = useCallback(async () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const next = latestDraftRef.current;
    if (next === null) return;
    const prev = committedBodyRef.current;
    const diff = diffStrings(prev, next);
    latestDraftRef.current = null;
    if (!diff) return;
    committedBodyRef.current = next;
    const limit = anchorCharsRef.current;
    if (diff.removed > 0) {
      const removedText = prev.slice(diff.position, diff.position + diff.removed);
      const rawBefore = sentenceWindowAt(prev, diff.position).before;
      const rawAfter = sentenceWindowAt(prev, diff.position + diff.removed).after;
      const { before, after } = truncateAnchors(rawBefore, rawAfter, limit);
      await addEvent({
        type: 'TEXT_DELETED',
        aggregateId: id,
        payload: { beforeSentence: before, afterSentence: after, text: removedText },
      });
    }
    if (diff.inserted.length > 0) {
      const postDelete = prev.slice(0, diff.position) + prev.slice(diff.position + diff.removed);
      const rawBefore = sentenceWindowAt(postDelete, diff.position).before;
      const rawAfter = sentenceWindowAt(postDelete, diff.position).after;
      const { before, after } = truncateAnchors(rawBefore, rawAfter, limit);
      await addEvent({
        type: 'TEXT_INSERTED',
        aggregateId: id,
        payload: { beforeSentence: before, afterSentence: after, text: diff.inserted },
      });
    }
    // Don't clear bodyDraft here. We let the catch-up effect drop it once
    // display.body folds in the new event(s) — otherwise the textarea snaps
    // back to the pre-edit text for one paint and silently swallows any
    // characters typed during that flash.
    getSyncEngine().kick();
  }, [id]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  const insertAtCursor = useCallback((text: string) => {
    if (isTimeTraveling) return;
    const ta = textareaRef.current;
    const current = latestDraftRef.current ?? bodyDraft ?? display.body;
    const start = ta?.selectionStart ?? current.length;
    const end = ta?.selectionEnd ?? current.length;
    const next = current.slice(0, start) + text + current.slice(end);
    if (selectedSeq !== null) setSelectedSeq(null);
    latestDraftRef.current = next;
    setBodyDraft(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => { void flushBody(); }, BODY_THROTTLE_MS);
    // Restore caret just after the inserted text on next paint.
    requestAnimationFrame(() => {
      const t = textareaRef.current;
      if (!t) return;
      const caret = start + text.length;
      t.focus();
      t.setSelectionRange(caret, caret);
    });
  }, [bodyDraft, display.body, flushBody, isTimeTraveling, selectedSeq]);

  const speech = useSpeechRecognition({
    onFinalTranscript: (transcript) => {
      const ta = textareaRef.current;
      const current = latestDraftRef.current ?? bodyDraft ?? display.body;
      const caret = ta?.selectionStart ?? current.length;
      const needsLeadingSpace = caret > 0 && !/\s$/.test(current.slice(0, caret));
      insertAtCursor((needsLeadingSpace ? ' ' : '') + transcript);
    },
  });

  function onBodyChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    // If the user types while pinned to the latest event, drop the pin so
    // the next emitted event doesn't push them back into time-travel mode.
    if (selectedSeq !== null && !isTimeTraveling) setSelectedSeq(null);
    latestDraftRef.current = next;
    setBodyDraft(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      void flushBody();
    }, BODY_THROTTLE_MS);
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
    await flushBody();
    await addEvent({ type: 'DOCUMENT_ARCHIVED', aggregateId: id, payload: {} });
    getSyncEngine().kick();
  }

  const statusLine = useMemo(() => {
    if (loading) return 'Loading…';
    const serverPart = serverState ? ` · server seq ${serverState.lastSeq}` : '';
    const stalePart = isStale ? ' · STALE — sync paused, retrying' : '';
    return `Confirmed seq ${confirmed.lastSeq} · display seq ${display.lastSeq}${serverPart}${stalePart}`;
  }, [loading, confirmed.lastSeq, display.lastSeq, serverState, isStale]);

  // Render confirmed body in default color, with the unsynced delta in red.
  const stalePreview = useMemo(() => {
    if (!isStale) return null;
    const a = confirmed.body;
    const b = display.body;
    const d = diffStrings(a, b);
    if (!d) return null;
    return (
      <div
        style={{
          padding: 12,
          border: '1px solid #f5c2c7',
          borderRadius: 4,
          background: '#fff5f5',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        <div style={{ fontSize: 11, color: '#842029', marginBottom: 6, fontWeight: 600 }}>
          Best-effort preview — red text is unsynced and may not reach the server.
        </div>
        <span>{a.slice(0, d.position)}</span>
        {d.removed > 0 && (
          <span style={{ color: '#dc3545', textDecoration: 'line-through' }}>
            {a.slice(d.position, d.position + d.removed)}
          </span>
        )}
        {d.inserted.length > 0 && (
          <span style={{ color: '#dc3545' }}>{d.inserted}</span>
        )}
        <span>{a.slice(d.position + d.removed)}</span>
      </div>
    );
  }, [isStale, confirmed.body, display.body]);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            value={titleValue}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            placeholder="Untitled"
            readOnly={isTimeTraveling}
            style={{
              flex: 1,
              minWidth: 200,
              padding: '6px 10px',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: 16,
              fontWeight: 600,
              background: isTimeTraveling ? '#f8f9fa' : '#fff',
            }}
          />
          <PendingEventsBadge count={pendingCount} />
          <OfflineBadge />
          <OfflineSimulationToggle />
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: '#555',
            }}
            title="Maximum characters captured before/after each text edit as anchors. Smaller = lighter events but more conflict-prone."
          >
            Anchor chars:
            <input
              type="number"
              min={0}
              max={500}
              value={anchorChars}
              onChange={(e) => setAnchorChars(Number(e.target.value))}
              style={{
                width: 56,
                padding: '2px 6px',
                border: '1px solid #ccc',
                borderRadius: 4,
                fontSize: 12,
              }}
            />
          </label>
          {!display.isArchived ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={isTimeTraveling}
              style={{
                padding: '4px 10px',
                border: '1px solid #ccc',
                borderRadius: 4,
                background: isTimeTraveling ? '#e9ecef' : '#fff',
                cursor: isTimeTraveling ? 'not-allowed' : 'pointer',
                fontSize: 12,
              }}
            >
              Archive
            </button>
          ) : (
            <span style={{ fontSize: 12, color: '#856404' }}>Archived</span>
          )}
        </header>

        {isTimeTraveling && (
          <div
            style={{
              padding: '6px 10px',
              border: '1px solid #b6effb',
              background: '#cff4fc',
              borderRadius: 4,
              fontSize: 12,
              color: '#055160',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Viewing state at event #{selectedSeq} (read-only)</span>
            <button
              type="button"
              onClick={() => setSelectedSeq(null)}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                border: '1px solid #0d6efd',
                borderRadius: 4,
                background: '#0d6efd',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Return to Live
            </button>
          </div>
        )}

        <div style={{ position: 'relative' }}>
          <textarea
            ref={textareaRef}
            value={bodyValue}
            onChange={onBodyChange}
            onBlur={() => void flushBody()}
            rows={20}
            readOnly={isTimeTraveling}
            style={{
              width: '100%',
              padding: 12,
              paddingRight: 52,
              border: '1px solid #ccc',
              borderRadius: 4,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 14,
              lineHeight: 1.5,
              resize: 'vertical',
              background: isTimeTraveling ? '#f8f9fa' : '#fff',
              boxSizing: 'border-box',
            }}
          />
          {speech.supported && !isTimeTraveling && (
            <button
              type="button"
              onClick={() => (speech.listening ? speech.stop() : speech.start())}
              title={speech.listening ? 'Stop dictation' : 'Start dictation'}
              aria-label={speech.listening ? 'Stop dictation' : 'Start dictation'}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 36,
                height: 36,
                borderRadius: '50%',
                border: '1px solid',
                borderColor: speech.listening ? '#dc3545' : '#ccc',
                background: speech.listening ? '#dc3545' : '#fff',
                color: speech.listening ? '#fff' : '#333',
                cursor: 'pointer',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: speech.listening ? '0 0 0 4px rgba(220,53,69,0.2)' : 'none',
              }}
            >
              {speech.listening ? '■' : '🎤'}
            </button>
          )}
          {speech.error && (
            <div
              style={{
                position: 'absolute',
                top: 50,
                right: 8,
                background: '#f8d7da',
                color: '#842029',
                fontSize: 11,
                padding: '2px 6px',
                borderRadius: 4,
                border: '1px solid #f5c2c7',
                maxWidth: 200,
              }}
            >
              Mic: {speech.error}
            </div>
          )}
        </div>

        {stalePreview}

        <footer style={{ fontSize: 12, color: isStale ? '#dc3545' : '#888' }}>{statusLine}</footer>
      </div>

      <EventSidebar
        events={allEvents}
        selectedSeq={selectedSeq}
        onSelect={setSelectedSeq}
      />

      {conflict && conflictBodies && (
        <ConflictModal
          serverBody={conflictBodies.server}
          initialLocalBody={conflictBodies.local}
          remoteEvents={conflict.remoteEvents}
          onTakeServer={async () => {
            await takeServerVersion(id, conflict.remoteEvents);
            setConflict(null);
            setConflictBodies(null);
          }}
          onResolve={async (resolvedBody) => {
            await resolveWithUserVersion(id, conflict.remoteEvents, resolvedBody);
            setConflict(null);
            setConflictBodies(null);
          }}
          onOverride={async (resolvedBody) => {
            await overrideWithUserVersion(id, conflict.remoteEvents, resolvedBody);
            setConflict(null);
            setConflictBodies(null);
          }}
          onDismiss={() => {
            setConflict(null);
            setConflictBodies(null);
            getSyncEngine().resume();
          }}
        />
      )}
    </div>
  );
}
