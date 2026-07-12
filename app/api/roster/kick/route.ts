import { redis } from '@/src/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { roomId, id, hostSecret } = await req.json();

    if (!roomId || !id || !hostSecret) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Verify host secret
    const storedSecret = await redis.get(`room:${roomId}:hostSecret`);
    if (!storedSecret || storedSecret !== hostSecret) {
      return NextResponse.json({ error: 'Unauthorized administrative operation' }, { status: 401 });
    }

    const rosterKey = `room:${roomId}:roster:${id}`;
    const setKey = `room:${roomId}:roster_ids`;

    // 1. Delete the user's roster state
    await redis.del(rosterKey);
    await redis.srem(setKey, id);

    // 2. Post a high-priority system signal to their mailbox so their client handles the ejection immediately
    const signalKey = `room:${roomId}:signal:${id}`;
    const systemSignal = {
      from: 'system',
      type: 'kick',
      payload: {},
    };
    await redis.rpush(signalKey, JSON.stringify(systemSignal));
    await redis.expire(signalKey, 60);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error kicking participant:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

