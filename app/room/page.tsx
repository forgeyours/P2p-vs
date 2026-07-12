'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import CallRoom with SSR disabled
const CallRoom = dynamic(() => import('@/src/components/CallRoom'), {
  ssr: false,
});

function RoomContent() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('roomId') || '';
  const role = (searchParams.get('role') || 'guest') as 'host' | 'guest';
  const name = searchParams.get('name') || '';
  const video = searchParams.get('video') !== '0'; // default true
  const audio = searchParams.get('audio') !== '0'; // default true

  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center bg-neutral-900 border border-neutral-800 rounded-xl p-6">
          <p className="text-red-500 font-mono mb-4">缺少房間參數 Room ID</p>
          <a
            href="/"
            className="inline-block bg-neutral-800 text-neutral-200 px-4 py-2 rounded-lg text-xs font-semibold"
          >
            返回大廳
          </a>
        </div>
      </div>
    );
  }

  return (
    <CallRoom
      roomId={roomId}
      role={role}
      initialName={name}
      initialVideo={video}
      initialAudio={audio}
    />
  );
}

export default function RoomPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-400 font-mono text-xs">
          <span>正在連接通話信令主機... Connecting...</span>
        </div>
      }
    >
      <RoomContent />
    </Suspense>
  );
}
