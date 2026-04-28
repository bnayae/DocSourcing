'use client';

interface Props {
  count: number;
}

export function PendingEventsBadge({ count }: Props) {
  const synced = count === 0;
  const label = synced ? 'All synced' : `${count} pending`;
  const style = synced
    ? { background: '#d4edda', color: '#155724' }
    : { background: '#fff3cd', color: '#856404' };
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 12,
      fontWeight: 600,
      ...style,
    }}>
      {label}
    </span>
  );
}
