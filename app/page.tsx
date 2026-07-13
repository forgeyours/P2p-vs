'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import JoinForm from '@/src/components/JoinForm';
import { Radio, Plus, Settings2, ShieldCheck, Film } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function LobbyPage() {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreateRoom = async () => {
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/room/create', {
        method: 'POST',
      });
      if (!res.ok) {
        throw new Error('Server failed to create room');
      }
      const data = await res.json();
      if (data.roomId && data.hostSecret) {
        // Save host secret in client-side localStorage
        localStorage.setItem(`hostSecret:${data.roomId}`, data.hostSecret);
        // Direct to room page as host
        router.push(`/room?roomId=${data.roomId}&role=host`);
      } else {
        throw new Error('Invalid response from server');
      }
    } catch (err: any) {
      console.error('Error creating room:', err);
      setError(err.message || 'Unable to create room, please try again later');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-4 md:p-8 bg-[#0A0A0C]">
      <div className="w-full max-w-md bg-[#121215] border border-white/10 rounded p-6 md:p-8 shadow-2xl relative overflow-hidden">
        {/* Hardware details - corner screws or accents */}
        <div className="absolute top-2 left-2 w-1.5 h-1.5 rounded-full bg-white/20" />
        <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-white/20" />
        <div className="absolute bottom-2 left-2 w-1.5 h-1.5 rounded-full bg-white/20" />
        <div className="absolute bottom-2 right-2 w-1.5 h-1.5 rounded-full bg-white/20" />

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-8 relative z-10">
          <div className="flex items-center gap-2 bg-[#1A1A1E] border border-white/10 px-3 py-1.5 rounded mb-5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)] animate-pulse"></div>
            <span className="font-mono text-[10px] font-bold tracking-widest text-red-500 uppercase">SYSTEM READY</span>
          </div>
          
          <h1 className="text-2xl font-mono font-bold tracking-wider text-[#E0E0E6] flex items-center gap-2">
            <Film className="w-5 h-5 text-orange-500" />
            <span>MESHSTREAM</span>
          </h1>
          <p className="text-xs font-mono text-white/40 mt-2 max-w-sm uppercase tracking-tight">
            LIGHTWEIGHT LIVE BROADCAST ENGINE. PURE P2P MESH WITHOUT MEDIA SERVERS, LOCAL AUDIO MIXING, LOW-LATENCY WEBRTC STREAMING.
          </p>
        </div>

        {/* Host Creation Section */}
        <div className="space-y-4 mb-6">
          <button
            id="create-room-btn"
            onClick={handleCreateRoom}
            disabled={creating}
            className="w-full py-4 bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold text-xs uppercase tracking-widest shadow-[0_0_15px_rgba(234,88,12,0.4)] border border-white/10 rounded transition-all cursor-pointer disabled:opacity-50"
          >
            {creating ? 'INITIALIZING DECK...' : 'CREATE ROOM (HOST)'}
          </button>

          {error && (
            <p className="text-xs font-mono text-red-500 text-center uppercase tracking-wider">{error}</p>
          )}
        </div>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-6">
          <div className="border-t border-white/10 w-full" />
          <span className="absolute bg-[#121215] px-3 text-[10px] font-mono text-white/40 uppercase tracking-[0.2em]">
            OR CONNECT
          </span>
        </div>

        {/* Join Code Section */}
        <JoinForm />

        {/* Core Capabilities Footer */}
        <div className="mt-8 pt-5 border-t border-white/5 flex items-center justify-between text-white/40 text-[9px] font-mono uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-green-500" />
            <span>P2P SECURE LINK</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Settings2 className="w-3.5 h-3.5 text-blue-400" />
            <span>NO MEDIA SERVER</span>
          </div>
        </div>
      </div>
    </main>
  );
}
