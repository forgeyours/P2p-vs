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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    const liveChatId = searchParams.get('liveChatId');
    const pageToken = searchParams.get('pageToken');

    if (!roomId || !liveChatId) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const accessToken = await getValidAccessToken(roomId);

    let url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('YouTube live chat fetch error:', text);
      return NextResponse.json({ error: `無法獲取聊天訊息: ${text}` }, { status: 500 });
    }

    const data = await response.json();

    const messages = (data.items || []).map((item: any) => ({
      id: item.id,
      publishedAt: item.snippet?.publishedAt,
      text: item.snippet?.displayMessage,
      authorName: item.authorDetails?.displayName,
      authorProfileImageUrl: item.authorDetails?.profileImageUrl,
      isChatOwner: item.authorDetails?.isChatOwner,
    }));

    return NextResponse.json({
      messages,
      nextPageToken: data.nextPageToken,
      pollingIntervalMillis: data.pollingIntervalMillis || 5000,
    });
  } catch (err: any) {
    console.error('YouTube Live Chat API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
