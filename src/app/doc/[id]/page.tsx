import Link from 'next/link';
import { DocumentEditor } from '@/components/DocumentEditor';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function DocumentPage({ params }: PageProps) {
  const { id } = await params;
  return (
    <div>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ color: '#0070f3', fontSize: 14 }}>
          ← All documents
        </Link>
      </nav>
      <DocumentEditor id={id} />
    </div>
  );
}
