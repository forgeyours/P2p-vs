'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

// Dynamically import SpectatorPlayer with SSR disabled
const SpectatorPlayer = dynamic(() => import('@/src/components/SpectatorPlayer'), {
  ssr: false,
});

function WatchContent() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('roomId') || '';

  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-[#0A0A0C]">
        <div className="text-center bg-neutral-900 border border-neutral-800 rounded-xl p-6">
          <p className="text-red-500 font-mono mb-4 uppercase text-xs tracking-wider">Missing Room ID parameter</p>
          <a
            href="/"
            className="inline-block bg-neutral-800 text-neutral-200 px-4 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider font-mono"
          >
            Return to Lobby
          </a>
        </div>
      </div>
    );
  }

  return <SpectatorPlayer roomId={roomId} />;
}

export default function WatchPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-400 font-mono text-xs uppercase tracking-widest">
          <span>Connecting to live broadcast stream...</span>
        </div>
      }
    >
      <WatchContent />
    </Suspense>
  );
}
