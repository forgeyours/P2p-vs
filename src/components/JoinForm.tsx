'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Video, Eye, ArrowRight } from 'lucide-react';

export default function JoinForm() {
  const router = useRouter();
  const [roomId, setRoomId] = useState('');
  const [role, setRole] = useState<'guest' | 'spectator'>('guest');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedCode = roomId.trim().toLowerCase();
    if (!trimmedCode) {
      setError('Please enter a room code');
      return;
    }

    if (trimmedCode.length < 4) {
      setError('Invalid room code');
      return;
    }

    setLoading(true);
    if (role === 'guest') {
      router.push(`/join?roomId=${trimmedCode}`);
    } else {
      router.push(`/watch?roomId=${trimmedCode}`);
    }
  };

  return (
    <form id="join-room-form" onSubmit={handleSubmit} className="w-full space-y-5">
      <div>
        <label className="block text-[10px] text-white/40 leading-none uppercase tracking-widest font-mono mb-2">
          ROOM CODE
        </label>
        <input
          id="room-code-input"
          type="text"
          placeholder="ENTER CODE"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          maxLength={10}
          className="w-full bg-[#0A0A0C] border border-white/10 rounded px-4 py-3.5 text-[#E0E0E6] placeholder-white/20 focus:outline-none focus:border-white/30 text-center font-mono text-lg uppercase tracking-widest"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          id="select-guest-btn"
          type="button"
          onClick={() => setRole('guest')}
          className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded border text-[11px] font-mono uppercase tracking-wider transition-all ${
            role === 'guest'
              ? 'bg-white/10 border-white/20 text-[#E0E0E6] shadow-[0_0_8px_rgba(255,255,255,0.05)]'
              : 'bg-white/5 border-white/5 text-white/40 hover:text-white/60 hover:bg-white/10'
          }`}
        >
          <Video className="w-4 h-4 text-red-500" />
          <span>AS GUEST</span>
        </button>

        <button
          id="select-spectator-btn"
          type="button"
          onClick={() => setRole('spectator')}
          className={`flex flex-col items-center justify-center gap-1.5 p-3 rounded border text-[11px] font-mono uppercase tracking-wider transition-all ${
            role === 'spectator'
              ? 'bg-white/10 border-white/20 text-[#E0E0E6] shadow-[0_0_8px_rgba(255,255,255,0.05)]'
              : 'bg-white/5 border-white/5 text-white/40 hover:text-white/60 hover:bg-white/10'
          }`}
        >
          <Eye className="w-4 h-4 text-blue-400" />
          <span>SPECTATE</span>
        </button>
      </div>

      {error && (
        <div id="join-form-error" className="text-xs font-mono text-red-500 text-center uppercase tracking-wider">
          {error}
        </div>
      )}

      <button
        id="join-submit-btn"
        type="submit"
        disabled={loading}
        className="w-full bg-[#1A1A1E] hover:bg-[#232328] active:bg-[#151518] text-[#E0E0E6] border border-white/10 rounded font-bold font-mono text-xs uppercase tracking-widest py-3.5 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
      >
        <span>{loading ? 'CONNECTING...' : 'JOIN SESSION'}</span>
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </form>
  );
}
