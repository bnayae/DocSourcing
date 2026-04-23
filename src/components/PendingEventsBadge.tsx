'use client';

interface Props {
  count: number;
}

export function PendingEventsBadge({ count }: Props) {
  if (count === 0) return null;
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      background: '#fff3cd',
      color: '#856404',
      fontSize: 12,
      fontWeight: 600,
    }}>
      {count} pending
    </span>
  );
}
