import { redis } from '@/src/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { roomId, fromId, toId, type, payload } = await req.json();

    if (!roomId || !fromId || !toId || !type) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const key = `room:${roomId}:signal:${toId}`;
    const message = {
      from: fromId,
      type,
      payload,
    };

    // Push to list and set list expiry to 60s
    await redis.rpush(key, JSON.stringify(message));
    await redis.expire(key, 60);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error sending signal in Redis:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

