import { kv } from '@vercel/kv';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');
    const roomId = searchParams.get('state'); // State holds the roomId

    if (!code || !roomId) {
      return NextResponse.json({ error: 'Missing code or room state' }, { status: 400 });
    }

    const clientId = process.env.YOUTUBE_CLIENT_ID;
    const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const redirectUri = `${appUrl}/api/youtube/oauth-callback`;

    if (!clientId || !clientSecret) {
      return NextResponse.json({ error: 'OAuth client credentials not configured' }, { status: 500 });
    }

    // Exchange authorization code for tokens
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Failed to exchange tokens:', errText);
      return NextResponse.json({ error: 'Token exchange failed' }, { status: 500 });
    }

    const tokens = await response.json();

    // Store tokens in Vercel KV with 6-hour TTL
    await kv.set(`room:${roomId}:youtubeTokens`, tokens, { ex: 21600 });

    // Return simple HTML page to notify parent and close popup
    return new NextResponse(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>YouTube 認證成功</title>
          <style>
            body {
              background-color: #0a0a0a;
              color: #f5f5f5;
              font-family: monospace;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
            }
            .card {
              border: 1px solid #ef4444;
              background-color: #171717;
              padding: 24px;
              border-radius: 12px;
              text-align: center;
              box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
            }
            h2 { color: #ef4444; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>認證成功！</h2>
            <p>已成功取得 YouTube Live Data API 存取權限。</p>
            <p>此視窗即將自動關閉...</p>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'YOUTUBE_OAUTH_SUCCESS' }, '*');
            }
            setTimeout(function() {
              window.close();
            }, 1500);
          </script>
        </body>
      </html>
      `,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }
    );
  } catch (err: any) {
    console.error('YouTube OAuth Callback error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
