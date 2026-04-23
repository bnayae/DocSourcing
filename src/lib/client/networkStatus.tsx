'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface NetworkStatusValue {
  isOnline: boolean;
  isManuallyOffline: boolean;
  toggleManualOffline: () => void;
}

const NetworkStatusContext = createContext<NetworkStatusValue | null>(null);

export function NetworkStatusProvider({ children }: { children: ReactNode }) {
  const [browserOnline, setBrowserOnline] = useState(true);
  const [isManuallyOffline, setIsManuallyOffline] = useState(false);

  useEffect(() => {
    const update = () => setBrowserOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const toggleManualOffline = useCallback(() => {
    setIsManuallyOffline((v) => !v);
  }, []);

  const value = useMemo<NetworkStatusValue>(
    () => ({
      isOnline: browserOnline && !isManuallyOffline,
      isManuallyOffline,
      toggleManualOffline,
    }),
    [browserOnline, isManuallyOffline, toggleManualOffline],
  );

  return (
    <NetworkStatusContext.Provider value={value}>{children}</NetworkStatusContext.Provider>
  );
}

export function useNetworkStatus(): NetworkStatusValue {
  const ctx = useContext(NetworkStatusContext);
  if (!ctx) throw new Error('useNetworkStatus must be used within NetworkStatusProvider');
  return ctx;
}
