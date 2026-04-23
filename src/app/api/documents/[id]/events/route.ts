import { NextResponse } from 'next/server';
import { getEventsAfter, getRecentEvents } from '@/lib/db/queries';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const afterParam = url.searchParams.get('afterSeq');
  if (afterParam !== null) {
    const afterSeq = Number.parseInt(afterParam, 10);
    if (!Number.isFinite(afterSeq) || afterSeq < 0) {
      return NextResponse.json({ error: 'INVALID_afterSeq' }, { status: 400 });
    }
    const items = await getEventsAfter(id, afterSeq);
    return NextResponse.json({ items });
  }
  const items = await getRecentEvents(id, 10);
  return NextResponse.json({ items });
}
