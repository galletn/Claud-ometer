import { NextResponse } from 'next/server';
import { getDesktopInfo } from '@/lib/claude-data/desktop';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await getDesktopInfo());
  } catch (error) {
    console.error('Error fetching Claude Desktop data:', error);
    return NextResponse.json({ error: 'Failed to fetch Claude Desktop data' }, { status: 500 });
  }
}
