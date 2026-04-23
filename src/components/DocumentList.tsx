'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { v4 as uuid } from 'uuid';
import { useDocumentList } from '@/hooks/useDocumentList';
import { addEvent } from '@/lib/client/store';
import { getSyncEngine } from '@/lib/client/syncEngine';

const DEV_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export function DocumentList() {
  const docs = useDocumentList();
  const [title, setTitle] = useState('');

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const aggregateId = uuid();
    await addEvent({
      type: 'DOCUMENT_CREATED',
      aggregateId,
      payload: { title: title.trim(), ownerId: DEV_OWNER_ID },
    });
    setTitle('');
    getSyncEngine().kick();
  }

  return (
    <div>
      <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New document title"
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4 }}
        />
        <button
          type="submit"
          style={{ padding: '6px 14px', border: 0, background: '#0070f3', color: '#fff', borderRadius: 4, cursor: 'pointer' }}
        >
          Create
        </button>
      </form>

      {docs === undefined ? (
        <p style={{ color: '#888' }}>Loading…</p>
      ) : docs.length === 0 ? (
        <p style={{ color: '#888' }}>No documents yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {docs.map((d) => (
            <li
              key={d.id}
              style={{
                padding: '8px 10px',
                border: '1px solid #eee',
                borderRadius: 4,
                marginBottom: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <Link href={`/doc/${d.id}`} style={{ textDecoration: 'none', color: '#222' }}>
                {d.title}
                {d.isArchived ? ' (archived)' : ''}
              </Link>
              {d.pendingCount > 0 ? (
                <span style={{ fontSize: 12, color: '#856404' }}>{d.pendingCount} pending</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
