'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Users,
  Copy,
  Check,
  Radio,
  Tv,
  Youtube,
  Smartphone,
  Monitor,
  Eye,
  EyeOff,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
} from 'lucide-react';
import { joinRoster, fetchRoster, pollSignals, kickParticipant } from '@/src/lib/signaling';
import { PeerConnectionManager } from '../lib/peerConnectionManager';
import { StreamCompositor } from '../lib/compositor';
import BroadcastCanvas from './BroadcastCanvas';
import GuestInvitePanel from './GuestInvitePanel';
import MediaUploadPanel from './MediaUploadPanel';
import LiveChatPanel from './LiveChatPanel';
import { addLog } from '@/src/lib/logger';
import DebugOverlay from './DebugOverlay';

interface CallRoomProps {
  roomId: string;
  role: 'host' | 'guest';
  initialName: string;
  initialVideo?: boolean;
  initialAudio?: boolean;
}

export default function CallRoom({
  roomId,
  role,
  initialName,
  initialVideo = true,
  initialAudio = true,
}: CallRoomProps) {
  const router = useRouter();
  
  const [localId] = useState(() => {
    if (role === 'host') {
      return `host_${Math.random().toString(36).substring(2, 8)}`;
    } else {
      return `guest_${Math.random().toString(36).substring(2, 8)}`;
    }
  });

  const [localName] = useState(() => initialName || (role === 'host' ? 'Director' : 'Guest'));
  const [hostSecret, setHostSecret] = useState('');

  const [roster, setRoster] = useState<any[]>([]);
  const [videoOn, setVideoOn] = useState(initialVideo);
  const [audioOn, setAudioOn] = useState(initialAudio);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [installNote, setInstallNote] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);

  // Host overlays/mixing states
  const [mutedPeers, setMutedPeers] = useState<string[]>([]);
  const [hiddenPeers, setHiddenPeers] = useState<string[]>([]);

  // YouTube RTMP synchronization states
  const [ytConnected, setYtConnected] = useState(false);
  const [ytLoading, setYtLoading] = useState(false);
  const [ytTitle, setYtTitle] = useState(`${localName.toUpperCase()}'S MASTER FEED`);
  const [ytDesc, setYtDesc] = useState(`LIVE P2P MESH BROADCAST VIA ROOM ${roomId}`);
  const [broadcastId, setBroadcastId] = useState('');
  const [liveChatId, setLiveChatId] = useState('');
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamName, setStreamName] = useState('');
  const [streamState, setStreamState] = useState<'idle' | 'created' | 'live' | 'completed'>('idle');
  const [streamCopied, setStreamCopied] = useState(false);

  // Shared media state
  const [activeMedia, setActiveMedia] = useState<{
    type: 'image' | 'video' | 'pdf';
    url: string;
    currentPage?: number;
    totalPages?: number;
  } | null>(null);

  // WebRTC references
  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const pcmRef = useRef<PeerConnectionManager | null>(null);
  const compositorRef = useRef<StreamCompositor | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const missingCountRef = useRef<Record<string, number>>({});
  const rosterRef = useRef<any[]>([]);

  // Shared Media elements
  const sharedImageRef = useRef<HTMLImageElement | null>(null);
  const sharedVideoRef = useRef<HTMLVideoElement | null>(null);
  const pdfDocRef = useRef<any | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch host secret if we are the host
  useEffect(() => {
    if (role === 'host') {
      const sec = localStorage.getItem(`hostSecret:${roomId}`) || '';
      setHostSecret(sec);
    }
  }, [role, roomId]);

  // 1. Initialize local media capture
  useEffect(() => {
    async function initMedia() {
      try {
        addLog('[WEBRTC DIAGNOSTIC] Requesting user media (video/audio)...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        addLog('[WEBRTC DIAGNOSTIC] Local media capture successfully established.');

        // Set initial track states based on preferences
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) videoTrack.enabled = videoOn;
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) audioTrack.enabled = audioOn;

        // Initialize WebRTC peer manager
        pcmRef.current = new PeerConnectionManager(roomId, localId, role);

        // Register on roster
        await joinRoster(roomId, localId, role, hostSecret);
      } catch (err: any) {
        addLog('[WEBRTC DIAGNOSTIC] Failed to get local user media / join roster: ' + (err?.message || err), true);
        alert('Could not access camera or microphone. Please grant system permissions and try again.');
        router.push('/');
      }
    }

    if (role === 'guest' || (role === 'host' && hostSecret)) {
      initMedia();
    }

    return () => {
      // Clean up media tracks on unmount
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (pcmRef.current) {
        pcmRef.current.closeAll();
      }
    };
  }, [roomId, localId, role, router, hostSecret]);

  // 1.1 Reactive StreamCompositor loop for Host
  useEffect(() => {
    if (role === 'host' && localStream && canvasRef.current) {
      if (!compositorRef.current) {
        addLog('[WEBRTC DIAGNOSTIC] Initializing host StreamCompositor loop...');
        const comp = new StreamCompositor(canvasRef.current);
        comp.addParticipant(localId, localName, localStream, true);
        comp.start();
        compositorRef.current = comp;
      }
    }
    return () => {
      if (compositorRef.current) {
        compositorRef.current.stop();
        compositorRef.current = null;
      }
    };
  }, [role, localStream, canvasRef.current, localId, localName]);

  // 2. Continuous background poll loop: Signaling + Roster + Heartbeat
  useEffect(() => {
    const sendHeartbeat = async () => {
      await joinRoster(roomId, localId, role, hostSecret);
    };

    const syncRoster = async () => {
      const activeList = await fetchRoster(roomId);
      if (activeList) {
        setRoster(activeList);
        rosterRef.current = activeList;

        // For any newly connected peer, initiate WebRTC peer connection
        activeList.forEach((peer) => {
          if (peer.id === localId) return;

          // Only the HOST is allowed to connect to spectators. If a guest or
          // another spectator tries to also negotiate with a spectator, it will
          // corrupt the spectator's single shared RTCPeerConnection. Skip entirely.
          if (peer.role === 'spectator' && role !== 'host') return;

          // Check if we already have an active connection
          if (pcmRef.current!.hasConnection(peer.id)) {
            // Reset counter since we are connected to them and they are in the active roster
            if (missingCountRef.current[peer.id]) {
              delete missingCountRef.current[peer.id];
            }
            return;
          }

          // If we should initiate the offer, create peer connection.
          // Guests wait for hosts, hosts initiate immediately.
          let outStream = localStreamRef.current;
          if (role === 'host' && peer.role === 'spectator') {
            if (!compositorRef.current || !compositorRef.current.isRunning()) {
              addLog(`[WEBRTC DIAGNOSTIC] syncRoster: Deferring peer connection with spectator ${peer.id} because compositor is not running yet.`);
              return; // Wait for next sync roster tick
            }
            try {
              outStream = compositorRef.current.getCompositedStream();
            } catch (err: any) {
              addLog(`[WEBRTC DIAGNOSTIC ERROR] syncRoster: Failed to get compositor stream for spectator ${peer.id}: ${err?.message || err}`, true);
              return; // Wait for next sync roster tick
            }
          }

          addLog(`[WEBRTC DIAGNOSTIC] syncRoster: Found unconnected peer ${peer.id} (${peer.role}). Creating Peer Connection.`);
          pcmRef.current!.createPeerConnection({
            peerId: peer.id,
            peerRole: peer.role,
            localStream: outStream,
            onTrack: (remoteStream) => {
              addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Received track from syncRoster for peerId=${peer.id}, streamId=${remoteStream.id}`);
              if (role === 'host' && compositorRef.current) {
                addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Adding participant ${peer.id} to compositor`);
                compositorRef.current.addParticipant(peer.id, peer.id, remoteStream);
              }
              // Both host and guest render raw remote videos
              attachRemoteVideo(peer.id, remoteStream);
            },
            onConnectionState: (state) => {
              addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Connection with ${peer.id} state from syncRoster: ${state}`);
              if (state === 'failed' || state === 'closed') {
                pcmRef.current?.closePeer(peer.id);
                handlePeerDisconnect(peer.id);
              }
            },
          });
        });

        // Clean up peer connections for members that have left, with grace mechanism
        const activeIds = new Set(activeList.map((p) => p.id));
        const trackedIds = pcmRef.current!.getActivePeerIds();
        trackedIds.forEach((pid) => {
          if (!activeIds.has(pid)) {
            const currentCount = (missingCountRef.current[pid] || 0) + 1;
            missingCountRef.current[pid] = currentCount;
            if (currentCount >= 3) {
              addLog(`[WEBRTC DIAGNOSTIC] Cleaning up left participant (missing ${currentCount} consecutive roster checks): ${pid}`);
              pcmRef.current?.closePeer(pid);
              handlePeerDisconnect(pid);
              delete missingCountRef.current[pid];
            } else {
              addLog(`[WEBRTC DIAGNOSTIC] Participant ${pid} missing from roster (consecutive count: ${currentCount}/3). Deferring cleanup.`);
            }
          } else {
            // Reset counter since peer is present in the active roster
            if (missingCountRef.current[pid]) {
              delete missingCountRef.current[pid];
            }
          }
        });
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
          const peer = rosterRef.current.find((p) => p.id === sig.from);
          const peerRole = peer ? peer.role : 'guest';

          // Same rule as syncRoster: only the host talks to spectators. If this
          // client isn't the host, drop any signal that claims to be from/about
          // a spectator rather than letting it corrupt a peer connection.
          if (peerRole === 'spectator' && role !== 'host') {
            addLog(`[WEBRTC DIAGNOSTIC] Ignoring stray spectator signal from ${sig.from} (local role is ${role}, not host)`);
            continue;
          }

          // Host can feed composited canvas stream to spectators
          let outStream = localStreamRef.current;
          if (role === 'host' && peerRole === 'spectator') {
            if (!compositorRef.current || !compositorRef.current.isRunning()) {
              addLog(`[WEBRTC DIAGNOSTIC] pollInbox: Compositor is not running yet for signal from spectator ${sig.from}. Falling back to localStream.`);
            } else {
              try {
                outStream = compositorRef.current.getCompositedStream();
              } catch (err: any) {
                addLog(`[WEBRTC DIAGNOSTIC ERROR] pollInbox: Failed to get compositor stream for spectator signal from ${sig.from}: ${err?.message || err}`, true);
              }
            }
          }

          addLog(`[WEBRTC DIAGNOSTIC] Incoming signal from ${sig.from} (${sig.type})`);
          await pcmRef.current.handleSignal(
            sig.from,
            sig.type,
            sig.payload,
            outStream,
            (remoteStream) => {
              addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Received track from handleSignal for peerId=${sig.from}, streamId=${remoteStream.id}`);
              if (role === 'host' && compositorRef.current) {
                addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Adding participant ${sig.from} to compositor`);
                compositorRef.current.addParticipant(sig.from, sig.from, remoteStream);
              }
              // Both host and guest render raw remote videos
              attachRemoteVideo(sig.from, remoteStream);
            },
            (state) => {
              addLog(`[WEBRTC DIAGNOSTIC CALLBACK] Connection with ${sig.from} state from handleSignal: ${state}`);
              if (state === 'failed' || state === 'closed') {
                pcmRef.current?.closePeer(sig.from);
                handlePeerDisconnect(sig.from);
              }
            },
            peerRole
          );
        }
      }
    };

    if (role === 'guest' || (role === 'host' && hostSecret)) {
      sendHeartbeat();
      syncRoster();

      const heartbeatTimer = setInterval(sendHeartbeat, 5000);
      const rosterTimer = setInterval(syncRoster, 5000);
      const signalingTimer = setInterval(pollInbox, 1200);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          addLog('[WEBRTC DIAGNOSTIC] Tab became visible again. Forcing immediate resync.');
          sendHeartbeat();
          syncRoster();
          pollInbox();
        }
      };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(heartbeatTimer);
        clearInterval(rosterTimer);
        clearInterval(signalingTimer);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [localId, roomId, role, hostSecret]);

  const handlePeerDisconnect = (peerId: string) => {
    addLog(`[WEBRTC DIAGNOSTIC] handlePeerDisconnect called for peerId=${peerId}`);
    if (pcmRef.current) pcmRef.current.closePeer(peerId);
    if (compositorRef.current) compositorRef.current.removeParticipant(peerId);
    
    // Remove guest video element
    const el = document.getElementById(`video-${peerId}`) as HTMLVideoElement;
    if (el) el.remove();
  };

  const attachRemoteVideo = (peerId: string, stream: MediaStream) => {
    addLog(`[WEBRTC DIAGNOSTIC] attachRemoteVideo called for peerId=${peerId}, streamId=${stream.id}, tracks count=${stream.getTracks().length}`);
    let el = document.getElementById(`video-${peerId}`) as HTMLVideoElement;
    if (!el) {
      addLog(`[WEBRTC DIAGNOSTIC] Creating remote video element for peerId=${peerId}`);
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
      } else {
        addLog(`[WEBRTC DIAGNOSTIC] grid element 'remote-videos-grid' not found when trying to attach video for peerId=${peerId}`, true);
      }
    }
    
    el.srcObject = stream;
    addLog(`[WEBRTC DIAGNOSTIC] Assigned stream to video element for peerId=${peerId}`);
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

  const handleLeave = () => {
    setShowLeaveModal(true);
  };

  const executeLeave = async () => {
    setShowLeaveModal(false);
    addLog('[SYSTEM ACTION] Starting executeLeave sequence...');

    // 1. Close all WebRTC peer connections
    try {
      if (pcmRef.current) {
        addLog('[SYSTEM ACTION] Closing all peer connections in pcmRef...');
        pcmRef.current.closeAll();
        addLog('[SYSTEM ACTION] Closed peer connections successfully.');
      } else {
        addLog('[SYSTEM ACTION] peerConnectionManager is not initialized.');
      }
    } catch (err: any) {
      addLog(`[SYSTEM ACTION] Error closing peer connections: ${err?.message || err}`, true);
    }

    // 2. Stop all local media tracks
    try {
      if (localStreamRef.current) {
        addLog('[SYSTEM ACTION] Stopping local media tracks...');
        localStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
            addLog(`[SYSTEM ACTION] Track stopped successfully: kind=${track.kind}`);
          } catch (e: any) {
            addLog(`[SYSTEM ACTION] Error stopping track ${track.kind}: ${e?.message || e}`, true);
          }
        });
        addLog('[SYSTEM ACTION] Stopped local media tracks successfully.');
      } else {
        addLog('[SYSTEM ACTION] localStreamRef is null, no tracks to stop.');
      }
    } catch (err: any) {
      addLog(`[SYSTEM ACTION] Error during track stopping: ${err?.message || err}`, true);
    }

    // 3. Stop compositor if host
    try {
      if (compositorRef.current) {
        addLog('[SYSTEM ACTION] Stopping stream compositor...');
        compositorRef.current.stop();
        addLog('[SYSTEM ACTION] Stopped stream compositor successfully.');
      } else {
        addLog('[SYSTEM ACTION] compositorRef is null, no compositor to stop.');
      }
    } catch (err: any) {
      addLog(`[SYSTEM ACTION] Error stopping compositor: ${err?.message || err}`, true);
    }

    // 4. Remove self from the roster via API call
    try {
      addLog(`[SYSTEM ACTION] Removing self (${localId}) from room (${roomId}) roster...`);
      const res = await fetch('/api/roster/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, id: localId }),
      });
      addLog(`[SYSTEM ACTION] Roster leave response status: ${res.status}`);
    } catch (err: any) {
      addLog(`[SYSTEM ACTION] Error removing self from roster: ${err?.message || err}`, true);
    }

    // 5. Navigate to Home
    try {
      addLog('[SYSTEM ACTION] Navigating to homepage...');
      router.push('/');
    } catch (err: any) {
      addLog(`[SYSTEM ACTION] Error routing to homepage: ${err?.message || err}`, true);
    }
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
      const contentType = res.headers.get('content-type');
      if (!res.ok || !contentType || !contentType.includes('application/json')) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
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
    } catch (e: any) {
      console.error('Failed to link YouTube', e);
      alert(`連結 YouTube 失敗: ${e.message || e}`);
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
      const contentType = res.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      if (!res.ok) {
        let errMsg = 'Failed to create broadcast';
        if (isJson) {
          const d = await res.json();
          errMsg = d.error || errMsg;
        } else {
          const text = await res.text();
          errMsg = text || errMsg;
        }
        throw new Error(errMsg);
      }
      if (!isJson) {
        throw new Error('Invalid server response format');
      }
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
      const contentType = res.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');
      if (!res.ok) {
        let errMsg = 'Failed to transition broadcast state';
        if (isJson) {
          const d = await res.json();
          errMsg = d.error || errMsg;
        } else {
          const text = await res.text();
          errMsg = text || errMsg;
        }
        throw new Error(errMsg);
      }
      
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
    <>
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
            onClick={handleLeave}
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
                    className="p-1 px-2.5 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-[#E0E0E6] rounded disabled:opacity-30 cursor-pointer"
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
    <DebugOverlay />
    {showLeaveModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm font-mono">
        <div className="w-full max-w-sm bg-[#121215] border border-white/10 rounded-lg p-5 shadow-2xl space-y-4">
          <div className="space-y-1">
            <span className="text-[10px] text-red-500 tracking-widest font-bold uppercase font-mono">TERMINATE CHANNELS</span>
            <h3 className="text-sm font-bold text-[#E0E0E6] uppercase tracking-wider font-mono">CONFIRM DISCONNECTION?</h3>
          </div>
          <p className="text-[10px] text-white/50 leading-relaxed uppercase font-mono">
            Leaving will shut down your active stream session, stop camera hardware, and unsubscribe you from the peer roster.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={() => setShowLeaveModal(false)}
              className="flex-1 bg-[#1A1A1E] hover:bg-[#232328] border border-white/10 text-[#E0E0E6] text-[10px] py-2 rounded font-bold uppercase tracking-wider cursor-pointer transition-colors font-mono"
            >
              CANCEL
            </button>
            <button
              onClick={executeLeave}
              className="flex-1 bg-red-600 hover:bg-red-500 text-white text-[10px] py-2 rounded font-bold uppercase tracking-wider cursor-pointer transition-colors font-mono"
            >
              DISCONNECT & LEAVE
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
}
