'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PeerConnectionManager } from '@/src/lib/peerConnectionManager';
import { StreamCompositor } from '@/src/lib/compositor';
import { joinRoster, fetchRoster, pollSignals, kickParticipant } from '@/src/lib/signaling';
import BroadcastCanvas from './BroadcastCanvas';
import GuestInvitePanel from './GuestInvitePanel';
import MediaUploadPanel from './MediaUploadPanel';
import LiveChatPanel from './LiveChatPanel';
import { 
  Video, VideoOff, Mic, MicOff, Users, 
  Smartphone, Monitor, Play, Square, Eye, EyeOff, Trash2, 
  Tv, Youtube, Radio, ChevronLeft, ChevronRight, Copy, Check 
} from 'lucide-react';

interface CallRoomProps {
  roomId: string;
  role: 'host' | 'guest';
  initialName: string;
  initialVideo: boolean;
  initialAudio: boolean;
}

export default function CallRoom({
  roomId,
  role,
  initialName,
  initialVideo,
  initialAudio,
}: CallRoomProps) {
  const router = useRouter();

  // Participant ID: persist in sessionStorage to survive tab refreshes
  const [localId] = useState(() => {
    if (typeof window !== 'undefined') {
      const stored = sessionStorage.getItem(`peerId:${roomId}`);
      if (stored) return stored;
      const id = `${role}_${Math.random().toString(36).substring(2, 8)}`;
      sessionStorage.setItem(`peerId:${roomId}`, id);
      return id;
    }
    return '';
  });

  const [localName] = useState(initialName || (role === 'host' ? 'Director (Host)' : 'Guest'));
  const [videoOn, setVideoOn] = useState(initialVideo);
  const [audioOn, setAudioOn] = useState(initialAudio);
  
  // Media Devices
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  
  // Roster & Layout States
  const [roster, setRoster] = useState<any[]>([]);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [installNote, setInstallNote] = useState(false);

  // Host Action Toggles (Host only state)
  const [mutedPeers, setMutedPeers] = useState<string[]>([]);
  const [hiddenPeers, setHiddenPeers] = useState<string[]>([]);

  // Media Share State
  const [activeMedia, setActiveMedia] = useState<{
    type: 'image' | 'video' | 'pdf';
    url: string;
    currentPage?: number;
    totalPages?: number;
  } | null>(null);

  // YouTube Integration States
  const [ytConnected, setYtConnected] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytTitle, setYtTitle] = useState('My P2P Live Stream');
  const [ytDesc, setYtDesc] = useState('Shared via MeshStream Live Production.');
  const [broadcastId, setBroadcastId] = useState('');
  const [liveChatId, setLiveChatId] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamName, setStreamName] = useState('');
  const [streamCopied, setStreamCopied] = useState(false);
  const [streamState, setStreamState] = useState<'idle' | 'created' | 'live' | 'completed'>('idle');

  // Refs for WebRTC / Compositor
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositorRef = useRef<StreamCompositor | null>(null);
  const pcmRef = useRef<PeerConnectionManager | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  // Media Sharing Reference Elements
  const sharedImageRef = useRef<HTMLImageElement | null>(null);
  const sharedVideoRef = useRef<HTMLVideoElement | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfDocRef = useRef<any>(null);

  const hostSecret = typeof window !== 'undefined' ? localStorage.getItem(`hostSecret:${roomId}`) || '' : '';

  // 1. Initial local camera & mic capture
  useEffect(() => {
    async function initDevice() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);

        // Turn on/off according to initial settings
        stream.getVideoTracks().forEach((t) => (t.enabled = videoOn));
        stream.getAudioTracks().forEach((t) => (t.enabled = audioOn));

        // Setup compositor if Host
        if (role === 'host' && canvasRef.current) {
          const comp = new StreamCompositor(canvasRef.current);
          comp.setOrientation(orientation);
          comp.start();
          comp.addParticipant(localId, localName, stream, true);
          compositorRef.current = comp;
        }

        // Setup WebRTC connection manager
        pcmRef.current = new PeerConnectionManager(roomId, localId, role);
      } catch (err) {
        console.error('Failed to get media devices:', err);
        alert('Please grant camera and microphone access permissions!');
      }
    }

    initDevice();

    return () => {
      // Clean up on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (compositorRef.current) {
        compositorRef.current.stop();
      }
      if (pcmRef.current) {
        pcmRef.current.closeAll();
      }
    };
  }, []);

  // 2. Continuous heartbeats, polling, and synchronization loops
  useEffect(() => {
    if (!localId) return;

    // Heartbeat: registers or refreshes our presence in Vercel KV roster
    const sendHeartbeat = async () => {
      await joinRoster(roomId, localId, role, hostSecret);
    };

    // Sync Roster: gets the list of active members
    const syncRoster = async () => {
      const activeList = await fetchRoster(roomId);
      setRoster(activeList);

      // Check if we have been kicked from the roster (guests only)
      if (role === 'guest') {
        const stillInRoster = activeList.some((p) => p.id === localId);
        if (!stillInRoster) {
          // Keep heartbeats off and drop
          return;
        }
      }

      // Automatically spin up WebRTC connections to newly discovered peers
      if (pcmRef.current && localStreamRef.current) {
        activeList.forEach((peer) => {
          if (peer.id === localId) return; // Skip self
          if (peer.role === 'spectator') return; // Spectator is one-way from host only

          // Lexicographical comparison rule to initiate
          const isInitiator = pcmRef.current!.shouldInitiateOffer(peer.id, peer.role);

          pcmRef.current!.createPeerConnection({
            peerId: peer.id,
            peerRole: peer.role,
            localStream: localStreamRef.current,
            onTrack: (remoteStream) => {
              console.log(`Received track from ${peer.id}`);
              if (role === 'host' && compositorRef.current) {
                // Host mixes guests dynamically into compositor canvas
                compositorRef.current.addParticipant(peer.id, peer.id, remoteStream);
              } else {
                // Guest renders other guests locally
                attachRemoteVideo(peer.id, remoteStream);
              }
            },
            onConnectionState: (state) => {
              console.log(`Connection with ${peer.id} state: ${state}`);
              if (state === 'failed' || state === 'closed') {
                handlePeerDisconnect(peer.id);
              }
            },
          });
        });

        // Clean up peer connections for members that have left
        const rosterIds = new Set(activeList.map((p) => p.id));
      }
    };

    // Signaling Poller: Polls WebRTC handshakes every 1.2 seconds
    const pollInbox = async () => {
      const signals = await pollSignals(roomId, localId);
      for (const sig of signals) {
        if (sig.from === 'system' && sig.type === 'kick') {
          alert('You have been removed from the room by the director!');
          router.push('/');
          return;
        }

        if (pcmRef.current) {
          const peer = roster.find((p) => p.id === sig.from);
          const peerRole = peer ? peer.role : 'guest';

          // Host can feed composited canvas stream to spectators
          const outStream = (role === 'host' && peerRole === 'spectator')
            ? compositorRef.current?.getCompositedStream() || localStreamRef.current
            : localStreamRef.current;

          await pcmRef.current.handleSignal(
            sig.from,
            sig.type,
            sig.payload,
            outStream,
            (remoteStream) => {
              if (role === 'host' && compositorRef.current) {
                compositorRef.current.addParticipant(sig.from, sig.from, remoteStream);
              } else {
                attachRemoteVideo(sig.from, remoteStream);
              }
            },
            (state) => {
              if (state === 'failed' || state === 'closed') {
                handlePeerDisconnect(sig.from);
              }
            },
            peerRole
          );
        }
      }
    };

    // Run immediately, then interval
    sendHeartbeat();
    syncRoster();

    const heartbeatTimer = setInterval(sendHeartbeat, 5000);
    const rosterTimer = setInterval(syncRoster, 5000);
    const signalingTimer = setInterval(pollInbox, 1200);

    return () => {
      clearInterval(heartbeatTimer);
      clearInterval(rosterTimer);
      clearInterval(signalingTimer);
    };
  }, [localId, roster]);

  const handlePeerDisconnect = (peerId: string) => {
    if (pcmRef.current) pcmRef.current.closePeer(peerId);
    if (compositorRef.current) compositorRef.current.removeParticipant(peerId);
    
    // Remove guest video element
    const el = document.getElementById(`video-${peerId}`) as HTMLVideoElement;
    if (el) el.remove();
  };

  const attachRemoteVideo = (peerId: string, stream: MediaStream) => {
    let el = document.getElementById(`video-${peerId}`) as HTMLVideoElement;
    if (!el) {
      el = document.createElement('video');
      el.id = `video-${peerId}`;
      el.autoplay = true;
      el.playsInline = true;
      el.className = 'w-full h-full object-cover rounded border border-white/10 bg-[#0A0A0C]';
      el.setAttribute('referrerpolicy', 'no-referrer');
      
      const grid = document.getElementById('remote-videos-grid');
      if (grid) {
        const container = document.createElement('div');
        container.className = 'relative aspect-video';
        
        // Label
        const label = document.createElement('span');
        label.className = 'absolute bottom-2 left-2 bg-[#121215]/90 border border-white/10 text-[9px] text-[#E0E0E6] px-2 py-0.5 rounded font-mono uppercase tracking-wider';
        label.innerText = peerId.toUpperCase();

        container.appendChild(el);
        container.appendChild(label);
        grid.appendChild(container);
      }
    }
    el.srcObject = stream;
  };

  // 3. UI control triggers (Mute, Camera toggles)
  const toggleLocalVideo = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setVideoOn(track.enabled);
      }
    }
  };

  const toggleLocalAudio = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) {
        track.enabled = !track.enabled;
        setAudioOn(track.enabled);
      }
    }
  };

  // 4. Host controls (Mute output, Hide canvas, Kick peer)
  const handleHostMute = (peerId: string) => {
    if (role !== 'host' || !compositorRef.current) return;
    const isMuted = compositorRef.current.isMuted(peerId);
    compositorRef.current.setMute(peerId, !isMuted);

    setMutedPeers((prev) =>
      isMuted ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const handleHostHide = (peerId: string) => {
    if (role !== 'host' || !compositorRef.current) return;
    const isHidden = compositorRef.current.isHidden(peerId);
    compositorRef.current.setHide(peerId, !isHidden);

    setHiddenPeers((prev) =>
      isHidden ? prev.filter((id) => id !== peerId) : [...prev, peerId]
    );
  };

  const handleHostKick = async (peerId: string) => {
    if (role !== 'host') return;
    const confirmKick = window.confirm(`Are you sure you want to remove guest ${peerId} from the call?`);
    if (!confirmKick) return;

    await kickParticipant(roomId, peerId, hostSecret);
    handlePeerDisconnect(peerId);
  };

  const handleOrientationToggle = () => {
    const nextO = orientation === 'landscape' ? 'portrait' : 'landscape';
    setOrientation(nextO);
    if (compositorRef.current) {
      compositorRef.current.setOrientation(nextO);
    }
  };

  // 5. PWA Fullscreen Broadcast mode
  const handleBroadcastModeToggle = async () => {
    const nextMode = !broadcastMode;
    setBroadcastMode(nextMode);

    if (nextMode) {
      // Trigger native fullscreen
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        }
      } catch (err) {
        console.warn('Fullscreen request deferred by browser security', err);
      }

      // Check if in PWA / Standalone mode
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
      if (!isStandalone) {
        setInstallNote(true);
      }
    } else {
      if (document.exitFullscreen) {
        try {
          await document.exitFullscreen();
        } catch (e) {}
      }
    }
  };

  // 6. Media upload/sharing callbacks
  const handleMediaSelect = async (url: string, type: 'image' | 'video' | 'pdf', file: File | null) => {
    if (!compositorRef.current) return;

    setActiveMedia({ type, url });

    if (type === 'image') {
      const img = new Image();
      img.src = url;
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        compositorRef.current?.setSharedMedia('image_share', 'image', url, img);
      };
      sharedImageRef.current = img;
    } else if (type === 'video') {
      const video = document.createElement('video');
      video.src = url;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.muted = true;
      video.setAttribute('referrerpolicy', 'no-referrer');
      video.play().catch((e) => console.warn(e));
      
      // Paint video onto canvas frame by frame in draw loop
      video.addEventListener('play', () => {
        compositorRef.current?.setSharedMedia('video_share', 'video', url, video);
      });
      sharedVideoRef.current = video;
    } else if (type === 'pdf') {
      // PDF handling using pdfjs-dist
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
        
        const loadingTask = pdfjs.getDocument(url);
        const doc = await loadingTask.promise;
        pdfDocRef.current = doc;
        
        setActiveMedia({
          type: 'pdf',
          url,
          currentPage: 1,
          totalPages: doc.numPages,
        });

        renderPdfPage(doc, 1);
      } catch (err) {
        console.error('Failed to init pdf worker:', err);
        alert('PDF parsing failed. Please ensure pdfjs is loaded correctly.');
      }
    }
  };

  const renderPdfPage = async (doc: any, pageNum: number) => {
    if (!doc) return;
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      let canvas = pdfCanvasRef.current;
      if (!canvas) {
        canvas = document.createElement('canvas');
        pdfCanvasRef.current = canvas;
      }
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderContext = {
        canvasContext: canvas.getContext('2d')!,
        viewport: viewport,
      };

      await page.render(renderContext).promise;

      if (compositorRef.current && activeMedia) {
        compositorRef.current.setSharedMedia('pdf_share', 'pdf', activeMedia.url, canvas);
      }
    } catch (err) {
      console.error('PDF rendering error:', err);
    }
  };

  const handlePdfPrev = () => {
    if (activeMedia && activeMedia.currentPage && activeMedia.currentPage > 1) {
      const prevPage = activeMedia.currentPage - 1;
      setActiveMedia({ ...activeMedia, currentPage: prevPage });
      renderPdfPage(pdfDocRef.current, prevPage);
    }
  };

  const handlePdfNext = () => {
    if (activeMedia && activeMedia.currentPage && activeMedia.totalPages && activeMedia.currentPage < activeMedia.totalPages) {
      const nextPage = activeMedia.currentPage + 1;
      setActiveMedia({ ...activeMedia, currentPage: nextPage });
      renderPdfPage(pdfDocRef.current, nextPage);
    }
  };

  const handleClearMedia = () => {
    if (compositorRef.current) {
      compositorRef.current.clearSharedMedia();
    }
    setActiveMedia(null);
    sharedImageRef.current = null;
    if (sharedVideoRef.current) {
      sharedVideoRef.current.pause();
      sharedVideoRef.current = null;
    }
    pdfDocRef.current = null;
  };

  // 7. YouTube Integration Controls
  const handleLinkYouTube = async () => {
    setYtLoading(true);
    try {
      const res = await fetch(`/api/youtube/authorize?roomId=${roomId}`);
      const data = await res.json();
      if (data.url) {
        // Open Google OAuth direct popup
        const width = 600;
        const height = 700;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        const authWin = window.open(
          data.url,
          'youtube_oauth_popup',
          `width=${width},height=${height},left=${left},top=${top}`
        );

        if (!authWin) {
          alert('Popup blocked by browser! Please allow popups to authorize your Google Account.');
        }
      }
    } catch (e) {
      console.error('Failed to link YouTube', e);
    } finally {
      setYtLoading(false);
    }
  };

  // Listen to postMessage from oauth-callback
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      const origin = e.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      if (e.data?.type === 'YOUTUBE_OAUTH_SUCCESS') {
        setYtConnected(true);
        alert('YouTube account connected successfully!');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleCreateBroadcast = async () => {
    setYtLoading(true);
    try {
      const res = await fetch('/api/youtube/create-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, title: ytTitle, description: ytDesc }),
      });
      if (!res.ok) throw new Error('Failed to create broadcast');
      const data = await res.json();

      setBroadcastId(data.broadcastId);
      setLiveChatId(data.liveChatId);
      setRtmpUrl(data.rtmpUrl);
      setStreamName(data.streamName);
      setStreamState('created');
    } catch (err: any) {
      alert(err.message || 'YouTube broadcast creation error. Please verify that live streaming is enabled on your YouTube channel!');
    } finally {
      setYtLoading(false);
    }
  };

  const handleTransitionStream = async (target: 'live' | 'complete') => {
    setYtLoading(true);
    try {
      const res = await fetch('/api/youtube/transition-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, broadcastId, status: target }),
      });
      if (!res.ok) throw new Error('Failed to transition broadcast state');
      
      if (target === 'live') {
        setStreamState('live');
      } else {
        setStreamState('completed');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setYtLoading(false);
    }
  };

  const copyStreamKey = async () => {
    try {
      await navigator.clipboard.writeText(streamName);
      setStreamCopied(true);
      setTimeout(() => setStreamCopied(false), 2000);
    } catch (e) {}
  };

  // 8. RENDER FULL SCREEN BROADCAST ONLY
  if (broadcastMode) {
    return (
      <div className="fixed inset-0 w-screen h-screen bg-black z-50 flex items-center justify-center">
        <canvas ref={canvasRef} className="w-full h-full object-contain" />

        {/* Floating Controller overlay (Exit Broadcast Mode) */}
        <div className="absolute top-4 right-4 opacity-0 hover:opacity-100 transition-opacity flex items-center gap-3 bg-[#121215] border border-white/10 p-3 rounded z-50">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-widest">MINIMAL BROADCAST MONITOR</span>
          <button
            onClick={handleBroadcastModeToggle}
            className="bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] uppercase font-mono tracking-wider px-3.5 py-1.5 rounded transition-all cursor-pointer"
          >
            EXIT MONITOR
          </button>
        </div>

        {/* Install home screen hint */}
        {installNote && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-[#121215] border border-white/10 rounded p-4 shadow-2xl flex flex-col gap-2 max-w-sm text-center z-50 font-mono">
            <span className="text-xs font-bold text-red-500 uppercase tracking-wider">SYSTEM INFO: PERSISTENT SHORTCUT</span>
            <p className="text-[10px] text-white/40 leading-normal uppercase">
              TO PREVENT OS CHROME DECORATION, SELECT "ADD TO HOME SCREEN" FROM YOUR MOBILE BROWSER PANEL AND RELAUNCH AS A PWA.
            </p>
            <button
              onClick={() => setInstallNote(false)}
              className="bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-white text-[10px] py-1.5 rounded uppercase tracking-wider cursor-pointer"
            >
              DISMISS
            </button>
          </div>
        )}
      </div>
    );
  }

  // 9. STANDARD MASTER CONTROLLER UI
  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-12 gap-6 p-4 md:p-6 bg-[#0A0A0C] max-w-7xl mx-auto">
      {/* LEFT FEED COLUMN: 7 Columns */}
      <div className="lg:col-span-7 flex flex-col gap-5">
        <div className="aspect-video w-full rounded overflow-hidden relative">
          {role === 'host' ? (
            <BroadcastCanvas ref={canvasRef} orientation={orientation} />
          ) : (
            <div className="w-full h-full aspect-video bg-[#121215] border border-white/10 rounded flex flex-col items-center justify-center gap-3">
              <Tv className="w-8 h-8 text-white/20 animate-pulse" />
              <p className="text-xs text-white/50 font-mono uppercase tracking-widest text-center">COMPOSITED OUTPUT MONITORED BY HOST</p>
              <p className="text-[10px] text-white/30 uppercase tracking-wider text-center">Keep communicating naturally with other active peers</p>
            </div>
          )}
        </div>

        {/* Local device preview and status */}
        <div className="bg-[#121215] border border-white/10 rounded p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-12 h-12 rounded overflow-hidden bg-[#0A0A0C] border border-white/10">
              <video
                ref={(el) => {
                  if (el && localStream) el.srcObject = localStream;
                }}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
            </div>
            <div>
              <p className="text-xs font-bold text-[#E0E0E6] uppercase tracking-wider font-mono">{localName.toUpperCase()}</p>
              <p className="text-[9px] font-mono text-white/40 uppercase tracking-widest mt-0.5">
                ID: {localId.toUpperCase()} • ROLE: {role === 'host' ? 'DIRECTOR' : 'GUEST'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={toggleLocalVideo}
              className={`p-2.5 rounded border text-xs font-bold font-mono uppercase tracking-widest transition-all cursor-pointer ${
                videoOn
                  ? 'bg-[#1A1A1E] border-white/10 text-[#E0E0E6] hover:bg-[#232328]'
                  : 'bg-red-950/40 border-red-500/30 text-red-500'
              }`}
            >
              {videoOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
            </button>
            <button
              onClick={toggleLocalAudio}
              className={`p-2.5 rounded border text-xs font-bold font-mono uppercase tracking-widest transition-all cursor-pointer ${
                audioOn
                  ? 'bg-[#1A1A1E] border-white/10 text-[#E0E0E6] hover:bg-[#232328]'
                  : 'bg-red-950/40 border-red-500/30 text-red-500'
              }`}
            >
              {audioOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Other Members / Raw Video grids */}
        <div className="space-y-3">
          <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-widest flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-orange-500" />
            <span>RAW MESH CALL NODES</span>
          </h4>
          <div id="remote-videos-grid" className="grid grid-cols-2 gap-3" />
        </div>
      </div>

      {/* RIGHT CONTROLS COLUMN: 5 Columns */}
      <div className="lg:col-span-5 flex flex-col gap-5 overflow-y-auto">
        {/* Room Header Info */}
        <div className="bg-[#121215] border border-white/10 rounded p-4 flex items-center justify-between">
          <div>
            <span className="text-[9px] text-red-500 font-mono tracking-widest font-bold uppercase">ROOM CHANNEL</span>
            <h2 className="text-lg font-bold text-[#E0E0E6] tracking-tight uppercase font-mono">CODE: {roomId}</h2>
          </div>
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to leave the call?')) router.push('/');
            }}
            className="text-[10px] bg-red-950/30 hover:bg-red-900/30 border border-red-500/30 text-red-500 px-3.5 py-2 rounded font-bold font-mono uppercase tracking-widest transition-all cursor-pointer"
          >
            LEAVE
          </button>
        </div>

        {/* Share invites panel */}
        <GuestInvitePanel roomId={roomId} />

        {/* HOST PANEL CONTROLS */}
        {role === 'host' && (
          <div className="bg-[#121215] border border-white/10 rounded p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Radio className="w-4 h-4 text-orange-500" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">MONITOR MIX & OVERLAYS</h3>
            </div>

            {/* Customizer customization */}
            <div className="flex justify-between items-center bg-[#0A0A0C] p-3 rounded border border-white/5 text-xs font-mono">
              <span className="font-bold text-white/40 uppercase tracking-wider text-[10px]">PROGRAM RATIO (ORIENTATION)</span>
              <button
                onClick={handleOrientationToggle}
                className="bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-white px-3.5 py-1.5 rounded flex items-center gap-1.5 font-bold font-mono uppercase tracking-wider text-[10px] cursor-pointer"
              >
                {orientation === 'landscape' ? <Monitor className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}
                <span>{orientation === 'landscape' ? '16:9 LANDSCAPE' : '9:16 PORTRAIT'}</span>
              </button>
            </div>

            {/* Active Members Roster */}
            <div className="space-y-2">
              <p className="text-[10px] font-mono text-white/40 uppercase tracking-widest">ACTIVE PEER ROSTER</p>
              <div className="space-y-2.5">
                {roster.filter(p => p.id !== localId && p.role === 'guest').length === 0 ? (
                  <p className="text-[10px] font-mono text-white/20 uppercase tracking-wider text-center py-2 italic">NO ACTIVE PEER CHANNELS FOUND</p>
                ) : (
                  roster.filter(p => p.id !== localId && p.role === 'guest').map((peer) => {
                    const isMuted = mutedPeers.includes(peer.id);
                    const isHidden = hiddenPeers.includes(peer.id);

                    return (
                      <div key={peer.id} className="flex justify-between items-center bg-[#0A0A0C] border border-white/10 p-2.5 rounded text-xs font-mono">
                        <span className="text-[#E0E0E6] font-bold uppercase">{peer.id}</span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleHostMute(peer.id)}
                            className={`p-1.5 rounded transition-all cursor-pointer ${isMuted ? 'bg-red-950/50 text-red-500 border border-red-500/20' : 'bg-[#1A1A1E] text-white/60 hover:bg-[#232328]'}`}
                            title="MUTE/UNMUTE AUDIO MIX"
                          >
                            {isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleHostHide(peer.id)}
                            className={`p-1.5 rounded transition-all cursor-pointer ${isHidden ? 'bg-red-950/50 text-red-500 border border-red-500/20' : 'bg-[#1A1A1E] text-white/60 hover:bg-[#232328]'}`}
                            title="HIDE/SHOW FROM MONITOR FEED"
                          >
                            {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleHostKick(peer.id)}
                            className="p-1.5 rounded bg-red-900/10 hover:bg-red-900/20 text-red-500 border border-red-500/10 transition-all cursor-pointer"
                            title="TERMINATE LINK"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Fullscreen Broadcast Launch */}
            <button
              onClick={handleBroadcastModeToggle}
              className="w-full bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold font-mono tracking-widest uppercase py-3.5 px-4 rounded shadow-[0_0_15px_rgba(234,88,12,0.3)] border border-white/10 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Tv className="w-4 h-4" />
              <span>FULL-SCREEN PROGRAM OUTPUT (PRISM FEED)</span>
            </button>
          </div>
        )}

        {/* MEDIA SHARE PANEL */}
        {role === 'host' && (
          <div className="space-y-4">
            <MediaUploadPanel
              onMediaSelect={handleMediaSelect}
              onClearMedia={handleClearMedia}
              activeMedia={activeMedia}
            />

            {activeMedia && activeMedia.type === 'pdf' && (
              <div className="bg-[#121215] border border-white/10 rounded p-4 flex justify-between items-center text-xs font-mono">
                <span className="text-white/50 uppercase tracking-widest text-[10px]">PDF PAGE DECK: {activeMedia.currentPage} / {activeMedia.totalPages}</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={handlePdfPrev}
                    disabled={activeMedia.currentPage === 1}
                    className="p-1 px-2.5 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-white rounded disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={handlePdfNext}
                    disabled={activeMedia.currentPage === activeMedia.totalPages}
                    className="p-1 px-2.5 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-white rounded disabled:opacity-30 cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* YOUTUBE INTEGRATION PANEL */}
        {role === 'host' && (
          <div className="bg-[#121215] border border-white/10 rounded p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Youtube className="w-4 h-4 text-orange-500" />
              <h3 className="text-xs font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">YOUTUBE RTMP SYNC</h3>
            </div>

            {!ytConnected && streamState === 'idle' ? (
              <button
                onClick={handleLinkYouTube}
                disabled={ytLoading}
                className="w-full bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-widest font-mono py-3.5 px-4 rounded border border-white/10 shadow-[0_0_15px_rgba(220,38,38,0.3)] flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Youtube className="w-4 h-4 fill-current" />
                <span>{ytLoading ? 'CONNECTING...' : 'AUTHORIZE YOUTUBE ACCOUNT'}</span>
              </button>
            ) : streamState === 'idle' ? (
              <div className="space-y-3">
                <div className="space-y-2 text-xs font-mono">
                  <label className="block text-white/40 uppercase tracking-widest text-[9px] mb-1">BROADCAST TITLE</label>
                  <input
                    type="text"
                    value={ytTitle}
                    onChange={(e) => setYtTitle(e.target.value)}
                    className="w-full bg-[#0A0A0C] border border-white/10 rounded px-3 py-2 text-[#E0E0E6] focus:outline-none focus:border-white/30 font-mono uppercase tracking-wider text-xs"
                  />
                </div>
                <div className="space-y-2 text-xs font-mono">
                  <label className="block text-white/40 uppercase tracking-widest text-[9px] mb-1">BROADCAST DESCRIPTION</label>
                  <textarea
                    value={ytDesc}
                    onChange={(e) => setYtDesc(e.target.value)}
                    rows={2}
                    className="w-full bg-[#0A0A0C] border border-white/10 rounded px-3 py-2 text-[#E0E0E6] focus:outline-none focus:border-white/30 font-mono text-xs uppercase"
                  />
                </div>
                <button
                  onClick={handleCreateBroadcast}
                  disabled={ytLoading}
                  className="w-full bg-[#1A1A1E] hover:bg-[#232328] text-white font-bold font-mono uppercase text-xs py-2.5 rounded tracking-widest border border-white/10 cursor-pointer transition-all"
                >
                  {ytLoading ? 'REGISTERING...' : 'CREATE LIVE BROADCAST SLOT'}
                </button>
              </div>
            ) : (
              <div className="space-y-4 text-xs font-mono bg-[#0A0A0C] p-4 border border-white/10 rounded">
                <div className="space-y-2">
                  <span className="text-white/40 block uppercase tracking-widest text-[9px]">RTMP INGESTION SERVER:</span>
                  <input
                    type="text"
                    readOnly
                    value={rtmpUrl}
                    className="w-full bg-[#121215] border border-white/5 p-2 rounded text-white/80 font-mono text-[10px] outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <span className="text-white/40 block uppercase tracking-widest text-[9px]">STREAM KEY:</span>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      readOnly
                      value={streamName}
                      className="flex-1 bg-[#121215] border border-white/5 p-2 rounded text-white/80 font-mono text-[10px] outline-none"
                    />
                    <button
                      onClick={copyStreamKey}
                      className="bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-[#E0E0E6] p-2 px-3 rounded flex items-center gap-1 font-mono text-[10px] uppercase font-bold shrink-0 cursor-pointer"
                    >
                      {streamCopied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                      <span>{streamCopied ? 'COPIED' : 'COPY'}</span>
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/5 flex justify-between items-center">
                  <span className="text-[9px] text-white/40 uppercase tracking-widest">STATE: <span className="text-red-500 font-bold uppercase">{streamState}</span></span>
                  <div className="flex gap-1.5">
                    {streamState === 'created' && (
                      <button
                        onClick={() => handleTransitionStream('live')}
                        disabled={ytLoading}
                        className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>GO LIVE</span>
                      </button>
                    )}
                    {(streamState === 'live' || streamState === 'created') && (
                      <button
                        onClick={() => handleTransitionStream('complete')}
                        disabled={ytLoading}
                        className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded flex items-center gap-1 text-[10px] font-bold font-mono uppercase tracking-wider cursor-pointer"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>STOP</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Chat Poller panel */}
            {liveChatId && (
              <LiveChatPanel roomId={roomId} liveChatId={liveChatId} />
            )}
          </div>
        )}
      </div>
    </main>
  );
}
