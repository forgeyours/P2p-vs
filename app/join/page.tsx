'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Video, VideoOff, Mic, MicOff, Play, ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = searchParams.get('roomId') || '';

  const [name, setName] = useState('');
  const [videoOn, setVideoOn] = useState(true);
  const [audioOn, setAudioOn] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [permissionError, setPermissionError] = useState('');

  const videoRef = useRef<HTMLVideoElement>(null);

  // Initialize pre-flight camera stream
  useEffect(() => {
    let activeStream: MediaStream | null = null;

    async function initCamera() {
      try {
        setPermissionError('');
        const media = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
        activeStream = media;
        setStream(media);
        if (videoRef.current) {
          videoRef.current.srcObject = media;
        }
      } catch (err) {
        console.error('Failed to get user media', err);
        setPermissionError('Unable to access camera or microphone. Please ensure permissions are granted!');
      }
    }

    if (roomId) {
      initCamera();
    }

    return () => {
      // Clean up pre-flight tracks
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [roomId]);

  const toggleVideo = () => {
    if (stream) {
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setVideoOn(track.enabled);
      }
    }
  };

  const toggleAudio = () => {
    if (stream) {
      const track = stream.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setAudioOn(track.enabled);
      }
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your display name');
      return;
    }

    // Release pre-flight camera so the call page can request it cleanly
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    // Direct to the unified call room as guest
    router.push(
      `/room?roomId=${roomId}&role=guest&name=${encodeURIComponent(
        name.trim()
      )}&video=${videoOn ? '1' : '0'}&audio=${audioOn ? '1' : '0'}`
    );
  };

  if (!roomId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center bg-neutral-900 border border-neutral-800 rounded-xl p-6">
          <p className="text-red-500 mb-4">Missing room code. Please verify your invitation link.</p>
          <button
            onClick={() => router.push('/')}
            className="bg-neutral-800 text-neutral-200 px-4 py-2 rounded-lg text-xs font-semibold"
          >
            RETURN TO LOBBY
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 md:p-8 bg-[#0A0A0C]">
      <div className="w-full max-w-lg bg-[#121215] border border-white/10 rounded p-6 shadow-2xl relative">
        <button
          onClick={() => router.push('/')}
          className="absolute top-6 left-6 text-white/50 hover:text-white flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>BACK</span>
        </button>

        <div className="text-center mt-8 mb-6">
          <h2 className="text-lg font-mono font-bold tracking-widest text-[#E0E0E6] uppercase">PRE-FLIGHT CONFIG</h2>
          <p className="text-[10px] text-white/40 font-mono mt-1 uppercase tracking-wider">ROOM SYSTEM TARGET ID: {roomId.toUpperCase()}</p>
        </div>

        {/* Camera Preview Box */}
        <div className="relative aspect-video bg-[#1A1A1E] border border-white/10 rounded overflow-hidden mb-6">
          {permissionError ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-xs font-mono text-white/40 uppercase">
              {permissionError}
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          )}

          {/* Controls Overlay */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/80 backdrop-blur-sm border border-white/10 rounded px-4 py-2">
            <button
              onClick={toggleVideo}
              type="button"
              className={`p-2 rounded-full transition-all cursor-pointer ${
                videoOn ? 'bg-white/10 text-[#E0E0E6]' : 'bg-red-950/80 text-red-500 border border-red-500/30'
              }`}
            >
              {videoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleAudio}
              type="button"
              className={`p-2 rounded-full transition-all cursor-pointer ${
                audioOn ? 'bg-white/10 text-[#E0E0E6]' : 'bg-red-950/80 text-red-500 border border-red-500/30'
              }`}
            >
              {audioOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <div>
            <label className="block text-[10px] font-mono text-white/40 mb-2 uppercase tracking-widest">
              YOUR CALLSIGN
            </label>
            <input
              type="text"
              placeholder="CALLSIGN (GUEST)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={15}
              className="w-full bg-[#0A0A0C] border border-white/10 rounded px-4 py-3 text-[#E0E0E6] placeholder-white/20 focus:outline-none focus:border-white/30 text-center font-mono uppercase tracking-wider text-sm"
            />
          </div>

          {error && <p className="text-xs font-mono text-red-500 text-center uppercase tracking-wider">{error}</p>}

          <button
            type="submit"
            className="w-full bg-orange-600 hover:bg-orange-500 active:bg-orange-700 text-white font-bold text-xs uppercase tracking-widest py-3.5 border border-white/10 rounded flex items-center justify-center gap-2 transition-all cursor-pointer shadow-[0_0_15px_rgba(234,88,12,0.3)]"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>ESTABLISH LINK</span>
          </button>
        </form>
      </div>
    </main>
  );
}

export default function GuestJoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-neutral-950 text-neutral-400 font-mono text-xs">
          <span>Configuring camera parameters...</span>
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}
