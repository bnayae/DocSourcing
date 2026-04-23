import { DocumentList } from '@/components/DocumentList';

export default function HomePage() {
  return (
    <div>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>DocSourcing</h1>
        <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
          Event-sourced document collaboration — offline-first.
        </p>
      </header>
      <DocumentList />
    </div>
  );
}
