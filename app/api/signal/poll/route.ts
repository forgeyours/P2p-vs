import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    const id = searchParams.get('id');

    if (!roomId || !id) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const key = `room:${roomId}:signal:${id}`;

    // Get all signals
    const signals = await kv.lrange(key, 0, -1);

    if (signals && signals.length > 0) {
      // Clear mailbox atomically after reading
      await kv.del(key);
    }

    const parsedMessages = (signals || []).map((msg) => {
      if (typeof msg === 'string') {
        try {
          return JSON.parse(msg);
        } catch {
          return msg;
        }
      }
      return msg;
    });

    return NextResponse.json({ messages: parsedMessages });
  } catch (err) {
    console.error('Error polling signals from KV:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

