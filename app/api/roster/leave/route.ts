import { redis } from '@/src/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { roomId, id } = await req.json();

    if (!roomId || !id) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const rosterKey = `room:${roomId}:roster:${id}`;
    const setKey = `room:${roomId}:roster_ids`;

    // Delete the roster entry and remove the ID from the set
    await redis.del(rosterKey);
    await redis.srem(setKey, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in roster leave:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
