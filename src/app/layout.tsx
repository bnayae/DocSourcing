import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'DocSourcing',
  description: 'Event-sourced document collaboration.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', background: '#fafafa' }}>
        <Providers>
          <main
            style={{
              maxWidth: 960,
              margin: '0 auto',
              padding: '32px 24px',
              minHeight: '100vh',
              boxSizing: 'border-box',
            }}
          >
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
