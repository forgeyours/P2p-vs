import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';

async function getValidAccessToken(roomId: string): Promise<string> {
  const tokens: any = await kv.get(`room:${roomId}:youtubeTokens`);
  if (!tokens) {
    throw new Error('請先授權連結 YouTube 帳號');
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
        await kv.set(`room:${roomId}:youtubeTokens`, updatedTokens, { ex: 21600 });
        return updatedTokens.access_token;
      }
    } catch (e) {
      console.warn('Failed to refresh access token, using current:', e);
    }
  }

  return tokens.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const { roomId, title, description } = await req.json();

    if (!roomId || !title) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(roomId);

    // 1. Create Live Broadcast
    const broadcastRes = await fetch(
      'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status,contentDetails',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title,
            description: description || 'MeshStream 直播導播輸出。',
            scheduledStartTime: new Date().toISOString(),
          },
          status: {
            privacyStatus: 'unlisted', // unlisted by default for safety
            selfDeclaredMadeForKids: false,
          },
          contentDetails: {
            enableAutoStart: true,
            enableAutoEnd: true,
          },
        }),
      }
    );

    if (!broadcastRes.ok) {
      const err = await broadcastRes.json();
      throw new Error(`YouTube Broadcast 建立失敗: ${JSON.stringify(err)}`);
    }

    const broadcastData = await broadcastRes.json();
    const broadcastId = broadcastData.id;
    const liveChatId = broadcastData.snippet?.liveChatId;

    // 2. Create Live Stream (Ingestion points)
    const streamRes = await fetch(
      'https://www.googleapis.com/youtube/v3/liveStreams?part=snippet,cdn',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          snippet: {
            title: `${title}-Stream`,
          },
          cdn: {
            frameRate: '30fps',
            ingestionType: 'rtmp',
            resolution: '1080p',
          },
        }),
      }
    );

    if (!streamRes.ok) {
      const err = await streamRes.json();
      throw new Error(`YouTube Stream 建立失敗: ${JSON.stringify(err)}`);
    }

    const streamData = await streamRes.json();
    const streamId = streamData.id;
    const rtmpUrl = streamData.cdn?.ingestionInfo?.ingestionAddress;
    const streamName = streamData.cdn?.ingestionInfo?.streamName; // Stream Key

    // 3. Bind Broadcast to Stream
    const bindRes = await fetch(
      `https://www.googleapis.com/youtube/v3/liveBroadcasts/bind?id=${broadcastId}&streamId=${streamId}&part=id`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!bindRes.ok) {
      throw new Error('綁定 Broadcast 與 Stream 失敗');
    }

    return NextResponse.json({
      broadcastId,
      liveChatId,
      rtmpUrl,
      streamName,
    });
  } catch (err: any) {
    console.error('YouTube creation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
