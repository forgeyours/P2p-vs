import { put } from '@vercel/blob';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return NextResponse.json(
        { error: 'Vercel Blob token not configured' },
        { status: 500 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    // 50MB client-side upload cap
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: '檔案大小不可超過 50MB' }, { status: 400 });
    }

    // Upload to Vercel Blob
    const blob = await put(file.name, file, {
      access: 'public',
      token,
    });

    return NextResponse.json({ url: blob.url });
  } catch (err: any) {
    console.error('Blob upload error:', err);
    return NextResponse.json({ error: err.message || 'Blob upload failed' }, { status: 500 });
  }
}
export const dynamic = 'force-dynamic';
