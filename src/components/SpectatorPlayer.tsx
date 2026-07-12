'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { pollSignals, joinRoster, sendSignal } from '@/src/lib/signaling';
import { Tv, Radio, Eye, Volume2, ArrowLeft, Loader2 } from 'lucide-react';

interface SpectatorPlayerProps {
  roomId: string;
}

export default function SpectatorPlayer({ roomId }: SpectatorPlayerProps) {
  const router = useRouter();
  
  const [spectatorId] = useState(() => `spectator_${Math.random().toString(36).substring(2, 8)}`);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [needsClickToPlay, setNeedsClickToPlay] = useState(true);
  const [connState, setConnState] = useState<string>('connecting');
  const [error, setError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    let active = true;

    // Join the room roster as spectator and maintain heartbeat
    const sendHeartbeat = async () => {
      if (!active) return;
      await joinRoster(roomId, spectatorId, 'spectator');
    };

    // Poll signaling messages every 1.2 seconds
    const pollInbox = async () => {
      if (!active) return;
      const signals = await pollSignals(roomId, spectatorId);
      for (const sig of signals) {
        if (sig.from === 'system' && sig.type === 'kick') {
          alert('You have been removed from the room by the director!');
          router.push('/');
          return;
        }

        await handleIncomingSignal(sig.from, sig.type, sig.payload);
      }
    };

    sendHeartbeat();
    const heartbeatTimer = setInterval(sendHeartbeat, 5000);
    const pollingTimer = setInterval(pollInbox, 1200);

    return () => {
      active = false;
      clearInterval(heartbeatTimer);
      clearInterval(pollingTimer);
      if (pcRef.current) {
        pcRef.current.close();
      }
    };
  }, [roomId, spectatorId]);

  const handleIncomingSignal = async (
    fromId: string,
    type: 'offer' | 'answer' | 'ice-candidate' | 'kick',
    payload: any
  ) => {
    let pc = pcRef.current;

    if (!pc) {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal(roomId, spectatorId, fromId, 'ice-candidate', e.candidate.toJSON());
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc) {
          setConnState(pc.iceConnectionState);
        }
      };

      pc.ontrack = (e) => {
        if (e.streams && e.streams[0]) {
          setStream(e.streams[0]);
          if (videoRef.current) {
            videoRef.current.srcObject = e.streams[0];
          }
        }
      };
    }

    if (type === 'offer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(roomId, spectatorId, fromId, 'answer', answer);

        // Process any queued candidates
        const queue = iceQueueRef.current;
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        iceQueueRef.current = [];
      } catch (err) {
        console.error('Failed to handle host offer:', err);
        setError('Unable to establish connection with the director host.');
      }
    } else if (type === 'ice-candidate') {
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        } else {
          iceQueueRef.current.push(payload);
        }
      } catch (err) {
        console.error('Failed to add candidate:', err);
      }
    }
  };

  const handleStartViewing = () => {
    setNeedsClickToPlay(false);
    if (videoRef.current) {
      videoRef.current.play().catch((e) => {
        console.warn('Playback failed:', e);
        // Fallback or request interaction again
      });
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen bg-[#0A0A0C] flex flex-col justify-between p-4 md:p-6 overflow-hidden">
      {/* Mini top header bar */}
      <div className="flex justify-between items-center bg-[#121215] border border-white/10 px-4 py-3 rounded z-30">
        <button
          onClick={() => router.push('/')}
          className="text-white/40 hover:text-white flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>EXIT</span>
        </button>
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-orange-500" />
          <span className="text-[10px] font-mono font-bold text-[#E0E0E6] uppercase tracking-wider">MONITOR RECEIVER WATCH: {roomId.toUpperCase()}</span>
        </div>
        <div className="flex items-center gap-1.5 font-mono">
          <span className={`w-1.5 h-1.5 rounded-full ${connState === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-yellow-500 animate-pulse'}`} />
          <span className="text-[9px] uppercase tracking-wider text-white/40">
            {connState === 'connected' ? 'LINK SUCCESS' : 'LINKING...'}
          </span>
        </div>
      </div>

      {/* Main Stream Viewport */}
      <div className="flex-1 w-full flex items-center justify-center relative my-4 bg-black border border-white/5 rounded overflow-hidden">
        {error ? (
          <div className="text-center p-6 bg-[#121215] border border-white/10 rounded max-w-sm z-20 font-mono">
            <p className="text-red-500 text-xs mb-3 uppercase tracking-wider">{error}</p>
            <p className="text-[10px] text-white/40 leading-normal uppercase tracking-tight">
              ESTABLISH FAILURE. UNABLE TO SECURE P2P DESCRIPTIONS FROM HOST. PLEASE CONFIRM HOST IS ON-AIR AND GO-LIVE ROUTE IS SELECTED.
            </p>
          </div>
        ) : stream ? (
          <div className="w-full h-full relative flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-contain"
            />

            {/* Click to play overlay to bypass browser audio rules */}
            {needsClickToPlay && (
              <div className="absolute inset-0 bg-[#0A0A0C]/95 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-20 p-6">
                <div className="bg-orange-600/10 border border-orange-500/20 text-orange-500 p-4 rounded-full">
                  <Volume2 className="w-8 h-8" />
                </div>
                <div className="text-center max-w-xs space-y-1 font-mono uppercase">
                  <p className="text-xs font-bold text-[#E0E0E6] tracking-widest">CONNECT SOUND CARRIER</p>
                  <p className="text-[9px] text-white/40 leading-normal tracking-wider">
                    BROWSER AUDIO POLICY REQUIRES USER GESTURE TO INITIALIZE MIXER OUTPUT.
                  </p>
                </div>
                <button
                  onClick={handleStartViewing}
                  className="bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold text-xs uppercase tracking-widest py-3 px-5 rounded border border-white/10 shadow-[0_0_15px_rgba(234,88,12,0.3)] transition-all cursor-pointer"
                >
                  START VIEWING LIVE
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center flex flex-col items-center gap-3 z-15 font-mono">
            <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
            <p className="text-xs font-bold text-white/40 uppercase tracking-widest">WAITING FOR BROADCAST CARRIER OFFER...</p>
            <p className="text-[9px] text-white/20 uppercase tracking-wider">Confirm that host is active in the room</p>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div className="bg-[#121215] py-3 border border-white/10 rounded text-center text-[9px] text-white/30 font-mono flex items-center justify-center gap-1.5 shrink-0 uppercase tracking-widest">
        <Radio className="w-3.5 h-3.5 text-red-500" />
        <span>100% SECURE MESH NETWORK. DIRECT RECIPIENT. NO CENTRAL RELAY SERVERS.</span>
      </div>
    </div>
  );
}
