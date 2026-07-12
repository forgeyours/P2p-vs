'use client';

import React, { useState, useEffect } from 'react';
import { Copy, Check, Users, ShieldAlert } from 'lucide-react';

interface InvitePanelProps {
  roomId: string;
}

export default function GuestInvitePanel({ roomId }: InvitePanelProps) {
  const [copiedGuest, setCopiedGuest] = useState(false);
  const [copiedWatch, setCopiedWatch] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  const guestLink = `${origin}/join?roomId=${roomId}`;
  const watchLink = `${origin}/watch?roomId=${roomId}`;

  const copyToClipboard = async (text: string, setCopied: (v: boolean) => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  return (
    <div id="invite-panel" className="bg-[#121215] border border-white/10 rounded p-5 space-y-4">
      <div className="flex items-center gap-2 border-b border-white/10 pb-3">
        <Users className="w-4 h-4 text-orange-500" />
        <h3 className="text-xs font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">INVITATION CHANNELS</h3>
      </div>

      {/* Guest Link */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">GUEST INVITATION LINK</span>
          <span className="text-[9px] bg-red-500/10 border border-red-500/20 text-red-500 px-1.5 py-0.5 rounded font-mono uppercase font-bold tracking-wider">MAX 3 PEERS</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={guestLink}
            className="flex-1 bg-[#0A0A0C] border border-white/10 rounded px-3 py-2 text-xs font-mono text-white/70 select-all outline-none"
          />
          <button
            onClick={() => copyToClipboard(guestLink, setCopiedGuest)}
            className="px-3 py-2 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 rounded text-[10px] font-bold font-mono uppercase tracking-wider text-[#E0E0E6] flex items-center gap-1 transition-all cursor-pointer"
          >
            {copiedGuest ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedGuest ? 'COPIED' : 'COPY'}</span>
          </button>
        </div>
      </div>

      {/* Watch Link */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">SPECTATOR BROADCAST LINK</span>
          <span className="text-[9px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded font-mono uppercase font-bold tracking-wider">PURE P2P</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={watchLink}
            className="flex-1 bg-[#0A0A0C] border border-white/10 rounded px-3 py-2 text-xs font-mono text-white/70 select-all outline-none"
          />
          <button
            onClick={() => copyToClipboard(watchLink, setCopiedWatch)}
            className="px-3 py-2 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 rounded text-[10px] font-bold font-mono uppercase tracking-wider text-[#E0E0E6] flex items-center gap-1 transition-all cursor-pointer"
          >
            {copiedWatch ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedWatch ? 'COPIED' : 'COPY'}</span>
          </button>
        </div>
      </div>

      {/* Note about STUN direct connections */}
      <div className="bg-[#0A0A0C] rounded p-3 border border-white/5 flex items-start gap-2 text-[10px] text-white/30 leading-normal uppercase font-mono tracking-tight">
        <ShieldAlert className="w-3.5 h-3.5 text-yellow-600/80 shrink-0 mt-0.5" />
        <p>
          DIRECT P2P ENCRYPTION. IN CASE OF STRICT SYMMETRIC NAT OR FIREWALL INTERFERENCE, PLEASE ENGAGE MOBILE LTE/5G OR STANDARD ACCESSIBLE WI-FI STATIONS.
        </p>
      </div>
    </div>
  );
}
