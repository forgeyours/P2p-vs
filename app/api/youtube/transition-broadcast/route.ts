import { redis } from '@/src/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

async function getValidAccessToken(roomId: string): Promise<string> {
  const raw = await redis.get(`room:${roomId}:youtubeTokens`);
  if (!raw) {
    throw new Error('請先授權連結 YouTube 帳號');
  }

  let tokens: any;
  try {
    tokens = JSON.parse(raw);
  } catch (e) {
    throw new Error('解析 YouTube 憑證失敗');
  }

  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;

  if (tokens.refresh_token && clientId && clientSecret) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: tokens.refresh_token,
          grant_type: 'refresh_token',
        }),
      });

      if (response.ok) {
        const refreshed = await response.json();
        const updatedTokens = {
          ...tokens,
          ...refreshed,
        };
        await redis.set(`room:${roomId}:youtubeTokens`, JSON.stringify(updatedTokens), 'EX', 21600);
        return updatedTokens.access_token;
      }
    } catch (e) {
      console.warn('Failed to refresh token, using current:', e);
    }
  }

  return tokens.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const { roomId, broadcastId, status } = await req.json();

    if (!roomId || !broadcastId || !status) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(roomId);

    // Transition state
    // broadcastStatus can be: "testing", "live", "complete"
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/transition?id=${broadcastId}&broadcastStatus=${status}&part=id,status`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Failed to transition broadcast:', errText);
      return NextResponse.json({ error: `轉換直播狀態失敗: ${errText}` }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json({ success: true, status: data.status?.broadcastStatus });
  } catch (err: any) {
    console.error('YouTube transition error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
