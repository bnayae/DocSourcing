'use client';

import { useNetworkStatus } from '@/lib/client/networkStatus';

export function OfflineSimulationToggle() {
  const enabled = process.env.NEXT_PUBLIC_ENABLE_OFFLINE_SIMULATION === 'true';
  const { isManuallyOffline, toggleManualOffline } = useNetworkStatus();
  if (!enabled) return null;
  return (
    <button
      type="button"
      onClick={toggleManualOffline}
      style={{
        padding: '4px 10px',
        border: '1px solid #ccc',
        borderRadius: 4,
        background: isManuallyOffline ? '#f8d7da' : '#d4edda',
        color: isManuallyOffline ? '#721c24' : '#155724',
        cursor: 'pointer',
        fontSize: 12,
      }}
    >
      {isManuallyOffline ? 'Go Online' : 'Simulate Offline'}
    </button>
  );
}
