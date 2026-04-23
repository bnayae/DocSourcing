import { NextResponse } from 'next/server';
import { getAllAggregates } from '@/lib/db/queries';

export const runtime = 'nodejs';

export async function GET() {
  const items = await getAllAggregates();
  return NextResponse.json({ items });
}
