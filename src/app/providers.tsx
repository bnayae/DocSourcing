'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NetworkStatusProvider, useNetworkStatus } from '@/lib/client/networkStatus';
import { getSyncEngine } from '@/lib/client/syncEngine';

function SyncEngineBoot({ children }: { children: ReactNode }) {
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    const engine = getSyncEngine();
    engine.setOnline(isOnline);
    engine.start();
    return () => {
      engine.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getSyncEngine().setOnline(isOnline);
  }, [isOnline]);

  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <NetworkStatusProvider>
        <SyncEngineBoot>{children}</SyncEngineBoot>
      </NetworkStatusProvider>
    </QueryClientProvider>
  );
}
