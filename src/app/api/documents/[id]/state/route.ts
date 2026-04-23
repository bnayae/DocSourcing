import { NextResponse } from 'next/server';
import { getAggregate } from '@/lib/db/queries';

export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET current aggregate state.
 *
 * `?at=<unix_ms>` time-travel is a planned extension (Step 8 of the skill).
 * For the scaffold we return the current aggregate and flag the stub so
 * callers get an honest signal.
 */
export async function GET(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const atParam = url.searchParams.get('at');

  const state = await getAggregate(id);
  if (!state) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

  if (atParam !== null) {
    return NextResponse.json({
      ...state,
      timeTravel: {
        requestedAt: Number.parseInt(atParam, 10),
        resolved: false,
        note: 'Time-travel is not yet implemented; returning current state.',
      },
    });
  }

  return NextResponse.json(state);
}
