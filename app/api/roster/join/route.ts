import { redis } from '@/src/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

// POST: Add or update heartbeat for a participant
export async function POST(req: NextRequest) {
  try {
    const { roomId, id, role, hostSecret } = await req.json();

    if (!roomId || !id || !role) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Security check: Only allow true hosts to join as host
    if (role === 'host') {
      const storedSecret = await redis.get(`room:${roomId}:hostSecret`);
      if (!storedSecret || storedSecret !== hostSecret) {
        return NextResponse.json({ error: 'Unauthorized host role' }, { status: 401 });
      }
    }

    const rosterKey = `room:${roomId}:roster:${id}`;
    const setKey = `room:${roomId}:roster_ids`;

    // Save/refresh roster entry with 15-second expiration
    await redis.set(rosterKey, JSON.stringify({ id, role, joinedAt: Date.now() }), 'EX', 15);
    // Add to Set of member IDs
    await redis.sadd(setKey, id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Error in roster join:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET: Fetch active participant roster
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
      return NextResponse.json({ error: 'Missing roomId' }, { status: 400 });
    }

    const setKey = `room:${roomId}:roster_ids`;
    const ids = await redis.smembers(setKey);

    if (!ids || ids.length === 0) {
      return NextResponse.json({ roster: [] });
    }

    // Retrieve active roster keys
    const entries = await Promise.all(
      ids.map(async (id: string) => {
        const raw = await redis.get(`room:${roomId}:roster:${id}`);
        let val = null;
        if (raw) {
          try {
            val = JSON.parse(raw);
          } catch (e) {
            console.error('Error parsing roster entry:', e);
          }
        }
        return { id, val };
      })
    );

    const activeRoster: any[] = [];
    const expiredIds: string[] = [];

    entries.forEach((item) => {
      if (item.val) {
        activeRoster.push(item.val);
      } else {
        expiredIds.push(item.id);
      }
    });

    // Clean up expired entries in redis set asynchronously
    if (expiredIds.length > 0) {
      await redis.srem(setKey, ...expiredIds);
    }

    return NextResponse.json({ roster: activeRoster });
  } catch (err) {
    console.error('Error fetching roster:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';

