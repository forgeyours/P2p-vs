import { computeLayout, ParticipantInfo, ActiveMedia } from './computeLayout';
import { addLog } from './logger';

export class StreamCompositor {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private audioCtx: AudioContext | null = null;
  private audioDestination: MediaStreamAudioDestinationNode | null = null;

  // Track each participant's metadata and elements
  private participants = new Map<
    string,
    {
      id: string;
      name: string;
      stream: MediaStream;
      videoEl: HTMLVideoElement;
      audioSourceNode: MediaStreamAudioSourceNode | null;
      isSpeaking: boolean;
    }
  >();

  // Host-level overrides (Muted from Web Audio, Hidden from layout)
  private mutedPeers = new Set<string>();
  private hiddenPeers = new Set<string>();

  // Media sharing
  private activeMedia: {
    id: string;
    type: 'video' | 'image' | 'pdf';
    url: string;
    element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
  } | null = null;

  private orientation: 'landscape' | 'portrait' = 'landscape';
  private frameId: number | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Could not get 2D canvas context');
    }
    this.ctx = context;

    // Initialize Web Audio API for mixing
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
        this.audioDestination = this.audioCtx.createMediaStreamDestination();
      }
    }
  }

  /**
   * Registers a participant (host or guest) and maps their stream tracks.
   */
  public addParticipant(id: string, name: string, stream: MediaStream, isLocal: boolean = false) {
    // Clean up if already exists
    if (this.participants.has(id)) {
      this.removeParticipant(id);
    }

    // Create a hidden video element for canvas source
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = isLocal; // Local preview must be muted to avoid echo
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('referrerpolicy', 'no-referrer');

    // To prevent Chrome/Android from suspending the video playback, we MUST append it to the DOM (hidden)
    if (typeof document !== 'undefined') {
      let container = document.getElementById('compositor-hidden-videos');
      if (!container) {
        container = document.createElement('div');
        container.id = 'compositor-hidden-videos';
        container.setAttribute('style', 'position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0.001; overflow: hidden; pointer-events: none; z-index: -9999;');
        document.body.appendChild(container);
      }
      container.appendChild(video);
    }

    video.play().catch((err) => console.warn('Video playback deferred:', err));

    let sourceNode: MediaStreamAudioSourceNode | null = null;

    if (this.audioCtx && this.audioDestination && !isLocal) {
      try {
        // Only mix remote guest audio tracks
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length > 0) {
          sourceNode = this.audioCtx.createMediaStreamSource(new MediaStream(audioTracks));
          // Connect to mixed output if not host-muted
          if (!this.mutedPeers.has(id)) {
            sourceNode.connect(this.audioDestination);
          }
        }
      } catch (err) {
        console.error('Failed to initialize audio source node:', err);
      }
    }

    this.participants.set(id, {
      id,
      name,
      stream,
      videoEl: video,
      audioSourceNode: sourceNode,
      isSpeaking: false,
    });
  }

  /**
   * Unregisters a participant and cleans up their nodes/elements.
   */
  public removeParticipant(id: string) {
    const p = this.participants.get(id);
    if (p) {
      p.videoEl.pause();
      p.videoEl.srcObject = null;
      p.videoEl.remove();

      if (p.audioSourceNode) {
        try {
          p.audioSourceNode.disconnect();
        } catch (e) {}
      }
      this.participants.delete(id);
    }
  }

  /**
   * Marks a participant speaking state for outline rendering.
   */
  public setSpeaking(id: string, isSpeaking: boolean) {
    const p = this.participants.get(id);
    if (p) {
      p.isSpeaking = isSpeaking;
    }
  }

  /**
   * Sets the orientation of the composited output.
   */
  public setOrientation(orientation: 'landscape' | 'portrait') {
    this.orientation = orientation;
    if (orientation === 'landscape') {
      this.canvas.width = 1280;
      this.canvas.height = 720;
    } else {
      this.canvas.width = 720;
      this.canvas.height = 1280;
    }
  }

  /**
   * Instantly disconnects or reconnects a guest's audio stream.
   */
  public setMute(id: string, isMuted: boolean) {
    if (isMuted) {
      this.mutedPeers.add(id);
      const p = this.participants.get(id);
      if (p && p.audioSourceNode && this.audioDestination) {
        try {
          p.audioSourceNode.disconnect(this.audioDestination);
        } catch (e) {}
      }
    } else {
      this.mutedPeers.delete(id);
      const p = this.participants.get(id);
      if (p && p.audioSourceNode && this.audioDestination) {
        try {
          p.audioSourceNode.connect(this.audioDestination);
        } catch (e) {}
      }
    }
  }

  /**
   * Excludes or includes a participant in the layout rendering.
   */
  public setHide(id: string, isHidden: boolean) {
    if (isHidden) {
      this.hiddenPeers.add(id);
    } else {
      this.hiddenPeers.delete(id);
    }
  }

  /**
   * Returns whether a participant is hidden by the host.
   */
  public isHidden(id: string): boolean {
    return this.hiddenPeers.has(id);
  }

  /**
   * Returns whether a participant is muted by the host.
   */
  public isMuted(id: string): boolean {
    return this.mutedPeers.has(id);
  }

  /**
   * Sets up local media sharing.
   */
  public setSharedMedia(
    id: string,
    type: 'video' | 'image' | 'pdf',
    url: string,
    element: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement
  ) {
    this.activeMedia = {
      id,
      type,
      url,
      element,
    };
  }

  /**
   * Clears active media sharing.
   */
  public clearSharedMedia() {
    this.activeMedia = null;
  }

  /**
   * Starts the animation frame canvas drawing loop.
   */
  public start() {
    if (this.frameId) return;

    // Default dimensions
    this.setOrientation(this.orientation);

    const render = () => {
      this.draw();
      this.frameId = requestAnimationFrame(render);
    };
    this.frameId = requestAnimationFrame(render);

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  /**
   * Stops the canvas drawing loop.
   */
  public stop() {
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.participants.forEach((p) => {
      p.videoEl.pause();
      p.videoEl.srcObject = null;
      p.videoEl.remove();
    });
    this.participants.clear();

    if (typeof document !== 'undefined') {
      const container = document.getElementById('compositor-hidden-videos');
      if (container) {
        container.remove();
      }
    }
  }

  /**
   * Checks if the compositor loop is active and the canvas is fully sized.
   */
  public isRunning(): boolean {
    return this.frameId !== null && this.canvas.width > 0 && this.canvas.height > 0;
  }

  /**
   * Returns the combined composited MediaStream.
   */
  public getCompositedStream(): MediaStream {
    let videoTracks = this.canvas.captureStream(30).getVideoTracks();
    const logMsg = `[WEBRTC DIAGNOSTIC] getCompositedStream: canvas.width=${this.canvas.width}, canvas.height=${this.canvas.height}, videoTracks.length=${videoTracks.length}`;
    console.log(logMsg);
    addLog(logMsg);

    if (videoTracks.length === 0) {
      const warnMsg = `[WEBRTC DIAGNOSTIC WARNING] getCompositedStream: 0 video tracks returned! Canvas might not be fully initialized or visible yet. Attempting instant capture retry...`;
      console.warn(warnMsg);
      addLog(warnMsg, true);

      // Instant retry
      videoTracks = this.canvas.captureStream(30).getVideoTracks();
      if (videoTracks.length === 0) {
        const errMsg = `[WEBRTC DIAGNOSTIC ERROR] getCompositedStream: Failed to capture video track after retry. Canvas dimensions: ${this.canvas.width}x${this.canvas.height}`;
        console.error(errMsg);
        addLog(errMsg, true);
        throw new Error(errMsg);
      }
    }

    // Ensure we have a dummy fallback audio track if Web Audio failed to load
    let audioTracks: MediaStreamTrack[] = [];
    if (this.audioDestination && this.audioDestination.stream) {
      audioTracks = this.audioDestination.stream.getAudioTracks();
    }

    if (audioTracks.length === 0) {
      // Create a silent audio track
      if (typeof window !== 'undefined') {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = ctx.createOscillator();
        const dest = ctx.createMediaStreamDestination();
        const gain = ctx.createGain();
        gain.gain.value = 0; // mute
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        audioTracks = dest.stream.getAudioTracks();
      }
    }

    return new MediaStream([videoTracks[0], ...audioTracks]);
  }

  /**
   * Core draw execution on the canvas context.
   */
  private draw() {
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // 1. Reset canvas background
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, cw, ch);

    // 2. Prepare participant input (excluding any peers flagged as hidden)
    const activeParticipants: ParticipantInfo[] = [];
    this.participants.forEach((p) => {
      if (!this.hiddenPeers.has(p.id)) {
        activeParticipants.push({
          id: p.id,
          isSpeaking: p.isSpeaking,
        });
      }
    });

    const activeMediaLayout: ActiveMedia | null = this.activeMedia
      ? {
          id: this.activeMedia.id,
          type: this.activeMedia.type,
          url: this.activeMedia.url,
        }
      : null;

    // 3. Compute exact rect layouts
    const rects = computeLayout(activeParticipants, activeMediaLayout, this.orientation);

    // 4. Draw each calculated partition
    rects.forEach((rect) => {
      const rx = (rect.x / 100) * cw;
      const ry = (rect.y / 100) * ch;
      const rw = (rect.w / 100) * cw;
      const rh = (rect.h / 100) * ch;

      this.ctx.save();

      // Clip bounds
      this.ctx.beginPath();
      this.ctx.rect(rx, ry, rw, rh);
      this.ctx.clip();

      if (rect.id === 'media' && this.activeMedia) {
        // Draw media share
        const el = this.activeMedia.element;
        if (el) {
          // Keep aspect ratio
          let imgW = 0;
          let imgH = 0;

          if (el instanceof HTMLVideoElement) {
            imgW = el.videoWidth || 640;
            imgH = el.videoHeight || 480;
          } else if (el instanceof HTMLImageElement) {
            imgW = el.naturalWidth || 640;
            imgH = el.naturalHeight || 480;
          } else {
            imgW = el.width || 640;
            imgH = el.height || 480;
          }

          const ratio = Math.min(rw / imgW, rh / imgH);
          const dw = imgW * ratio;
          const dh = imgH * ratio;
          const dx = rx + (rw - dw) / 2;
          const dy = ry + (rh - dh) / 2;

          this.ctx.drawImage(el, dx, dy, dw, dh);
        }
      } else {
        // Draw participant video frame
        const p = this.participants.get(rect.id);
        if (p && p.videoEl && p.videoEl.readyState >= 2) {
          const vw = p.videoEl.videoWidth;
          const vh = p.videoEl.videoHeight;
          const ratio = Math.max(rw / vw, rh / vh);
          const dw = vw * ratio;
          const dh = vh * ratio;
          const dx = rx + (rw - dw) / 2;
          const dy = ry + (rh - dh) / 2;

          this.ctx.drawImage(p.videoEl, dx, dy, dw, dh);

          // Speech highlight ring / border
          if (p.isSpeaking) {
            this.ctx.strokeStyle = '#ef4444'; // Red-500
            this.ctx.lineWidth = 6;
            this.ctx.strokeRect(rx + 3, ry + 3, rw - 6, rh - 6);
          }

          // Overlay display name
          this.ctx.fillStyle = 'rgba(10, 10, 10, 0.6)';
          this.ctx.font = 'bold 12px monospace';
          const padding = 6;
          const text = p.name;
          const textWidth = this.ctx.measureText(text).width;

          this.ctx.fillRect(rx + 12, ry + rh - 32, textWidth + padding * 2, 22);
          this.ctx.fillStyle = '#ffffff';
          this.ctx.fillText(text, rx + 12 + padding, ry + rh - 17);
        } else {
          // Loading/Disconnected video tile placeholder
          this.ctx.fillStyle = '#171717';
          this.ctx.fillRect(rx, ry, rw, rh);

          this.ctx.fillStyle = '#525252';
          this.ctx.font = '14px monospace';
          const placeholderText = p ? `WAITING FOR ${p.name.toUpperCase()}...` : 'LOADING...';
          const textW = this.ctx.measureText(placeholderText).width;
          this.ctx.fillText(placeholderText, rx + (rw - textW) / 2, ry + rh / 2);
        }
      }

      this.ctx.restore();
    });
  }
}
