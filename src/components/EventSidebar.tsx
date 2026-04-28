'use client';

import type { StoredEvent } from '@/lib/events/types';

interface Props {
  events: StoredEvent[];
  selectedSeq: number | null;
  onSelect: (seq: number | null) => void;
}

function summarize(e: StoredEvent): string {
  switch (e.type) {
    case 'DOCUMENT_CREATED':
      return `created "${e.payload.title}"`;
    case 'DOCUMENT_RENAMED':
      return `renamed → "${e.payload.title}"`;
    case 'TEXT_INSERTED': {
      const t = e.payload.text;
      return `insert "${t.length > 20 ? t.slice(0, 20) + '…' : t}"`;
    }
    case 'TEXT_DELETED': {
      const t = e.payload.text;
      return `delete "${t.length > 20 ? t.slice(0, 20) + '…' : t}"`;
    }
    case 'DOCUMENT_ARCHIVED':
      return 'archived';
    default:
      return (e as { type: string }).type;
  }
}

const STATUS_COLOR: Record<StoredEvent['status'], string> = {
  synced: '#198754',
  pending: '#fd7e14',
  failed: '#dc3545',
  parked: '#6c757d',
};

export function EventSidebar({ events, selectedSeq, onSelect }: Props) {
  return (
    <aside
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid #e5e5e5',
        padding: 12,
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxHeight: '80vh',
        overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 13 }}>Event log</strong>
        <button
          type="button"
          onClick={() => onSelect(null)}
          disabled={selectedSeq === null}
          style={{
            fontSize: 11,
            padding: '2px 8px',
            border: '1px solid #ccc',
            borderRadius: 4,
            background: selectedSeq === null ? '#e9ecef' : '#0d6efd',
            color: selectedSeq === null ? '#6c757d' : '#fff',
            cursor: selectedSeq === null ? 'default' : 'pointer',
          }}
        >
          Live
        </button>
      </header>

      {events.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888' }}>No events yet.</div>
      ) : (
        <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.map((e) => {
            const isSelected = selectedSeq === e.sequenceNumber;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => onSelect(e.sequenceNumber)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 8px',
                    border: '1px solid',
                    borderColor: isSelected ? '#0d6efd' : '#e5e5e5',
                    background: isSelected ? '#e7f1ff' : '#fff',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>#{e.sequenceNumber}</span>
                    <span style={{ color: STATUS_COLOR[e.status], fontSize: 10, textTransform: 'uppercase' }}>
                      {e.status}
                    </span>
                  </div>
                  <div style={{ color: '#333' }}>{summarize(e)}</div>
                  <div style={{ color: '#888', fontSize: 10 }}>
                    {new Date(e.createdAt).toLocaleTimeString()}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
