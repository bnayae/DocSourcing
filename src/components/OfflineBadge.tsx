'use client';

import { useNetworkStatus } from '@/lib/client/networkStatus';

export function OfflineBadge() {
  const { isOnline, isManuallyOffline } = useNetworkStatus();
  if (isOnline) return null;
  const label = isManuallyOffline ? 'Offline (simulated)' : 'Offline';
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
      {label}
    </span>
  );
}
