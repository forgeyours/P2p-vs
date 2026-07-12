import { redis } from '@/src/lib/redis';
import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST() {
  try {
    // Generate simple readable 6-character code
    const roomId = crypto.randomBytes(3).toString('hex').toLowerCase();
    const hostSecret = crypto.randomBytes(16).toString('hex');

    // Store host secret with a 6-hour TTL (21600 seconds)
    await redis.set(`room:${roomId}:hostSecret`, hostSecret, 'EX', 21600);

    return NextResponse.json({ roomId, hostSecret });
  } catch (err) {
    console.error('Error creating room in Redis:', err);
    return NextResponse.json({ error: 'Failed to create room' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';


