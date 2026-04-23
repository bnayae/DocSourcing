import { NextResponse } from 'next/server';
import { listInvestigation, parkEventServerSide } from '@/lib/db/queries';

export const runtime = 'nodejs';

interface DeadLetterInput {
  id: string;
  aggregateId?: string;
  errorClass: string;
  errorCode: string;
  description?: string;
  originalEvent?: unknown;
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'INVALID_JSON' }, { status: 400 });
  }
  const input = body as DeadLetterInput;
  if (!input?.id || !input.errorClass || !input.errorCode) {
    return NextResponse.json({ error: 'MISSING_FIELDS' }, { status: 400 });
  }

  await parkEventServerSide({
    id: input.id,
    aggregateId: input.aggregateId ?? null,
    originalEvent: input.originalEvent ?? null,
    errorClass: input.errorClass,
    errorCode: input.errorCode,
    ...(input.description !== undefined ? { description: input.description } : {}),
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const rows = await listInvestigation(100);
  return NextResponse.json({ items: rows });
}
