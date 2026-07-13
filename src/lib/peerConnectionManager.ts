import { sendSignal } from './signaling';
import { addLog } from './logger';

export interface PeerConnectionConfig {
  roomId: string;
  localId: string;
  peerId: string;
  localRole: 'host' | 'guest' | 'spectator';
  peerRole: 'host' | 'guest' | 'spectator';
  localStream: MediaStream | null;
  onTrack: (stream: MediaStream) => void;
  onConnectionState: (state: RTCIceConnectionState) => void;
}

export class PeerConnectionManager {
  private connections = new Map<string, RTCPeerConnection>();
  private iceQueues = new Map<string, RTCIceCandidateInit[]>();

  constructor(
    private roomId: string,
    private localId: string,
    private localRole: 'host' | 'guest' | 'spectator'
  ) {}

  /**
   * Checks if we already have a connection for the specified peer.
   */
  public hasConnection(peerId: string): boolean {
    return this.connections.has(peerId);
  }

  /**
   * Checks if we should initiate the offer based on our lexicographical rule or role.
   */
  public shouldInitiateOffer(
    peerId: string,
    peerRole: 'host' | 'guest' | 'spectator'
  ): boolean {
    let result = false;
    if (this.localRole === 'host' && (peerRole === 'guest' || peerRole === 'spectator')) {
      // Host always initiates connection to guest/spectator
      result = true;
    } else if (this.localRole === 'guest' && peerRole === 'host') {
      // Guest never initiates to host (waits for host's offer)
      result = false;
    } else if (this.localRole === 'spectator' || peerRole === 'host') {
      // Spectator never initiates; guest waits for host
      result = false;
    } else {
      // Guest <-> Guest uses lexicographical comparison
      result = this.localId < peerId;
    }

    addLog(
      `[WEBRTC DIAGNOSTIC] shouldInitiateOffer: peerId=${peerId}, peerRole=${peerRole}, localId=${this.localId}, localRole=${this.localRole}, result=${result}`
    );
    return result;
  }

  /**
   * Creates and registers a peer connection with another participant.
   */
  public async createPeerConnection({
    peerId,
    peerRole,
    localStream,
    onTrack,
    onConnectionState,
  }: Omit<PeerConnectionConfig, 'roomId' | 'localId' | 'localRole'>): Promise<RTCPeerConnection> {
    addLog(`[WEBRTC DIAGNOSTIC] createPeerConnection for peerId=${peerId}, peerRole=${peerRole}`);

    // If connection already exists, close it first
    if (this.connections.has(peerId)) {
      addLog(`[WEBRTC DIAGNOSTIC] Connection to ${peerId} already exists. Closing existing connection before re-creating.`);
      this.closePeer(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
      ],
    });

    this.connections.set(peerId, pc);
    this.iceQueues.set(peerId, []);

    // Add local tracks to peer connection
    if (localStream && this.localRole !== 'spectator' && peerRole !== 'spectator') {
      addLog(`[WEBRTC DIAGNOSTIC] Adding local tracks to pc for peerId=${peerId}. Tracks count: ${localStream.getTracks().length}`);
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    } else if (localStream && this.localRole === 'host' && peerRole === 'spectator') {
      // Host sending composited streams to spectators
      addLog(`[WEBRTC DIAGNOSTIC] Host adding composited tracks to spectator pc for peerId=${peerId}`);
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    } else {
      addLog(`[WEBRTC DIAGNOSTIC] No local tracks added to pc for peerId=${peerId} (localStream is null or participant role is spectator).`);
    }

    // Ice Candidate handling
    let candidateCount = 0;
    const iceTimer = setTimeout(() => {
      if (candidateCount === 0) {
        addLog(`[WEBRTC DIAGNOSTIC] WARNING: No ICE candidates generated for peerId=${peerId} within 5 seconds. Possible STUN/ICE gathering failure.`, true);
      } else {
        addLog(`[WEBRTC DIAGNOSTIC] ICE candidate check: generated ${candidateCount} candidates for peerId=${peerId} so far.`);
      }
    }, 5000);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidateCount++;
        addLog(`[WEBRTC DIAGNOSTIC] Generated ICE candidate #${candidateCount} for peerId=${peerId}: ${event.candidate.candidate}`);
        sendSignal(
          this.roomId,
          this.localId,
          peerId,
          'ice-candidate',
          event.candidate.toJSON()
        );
      } else {
        addLog(`[WEBRTC DIAGNOSTIC] ICE candidate generation finished (null candidate received) for peerId=${peerId}. Total generated: ${candidateCount}`);
        clearTimeout(iceTimer);
      }
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      addLog(`[WEBRTC DIAGNOSTIC] pc.oniceconnectionstatechange for peerId=${peerId}: state changed to ${pc.iceConnectionState}`);
      onConnectionState(pc.iceConnectionState);
    };

    // Track stream arrival
    pc.ontrack = (event) => {
      addLog(`[WEBRTC DIAGNOSTIC] pc.ontrack fired for peerId=${peerId}. Track kind=${event.track.kind}, id=${event.track.id}, Streams count=${event.streams.length}`);
      if (event.streams && event.streams[0]) {
        addLog(`[WEBRTC DIAGNOSTIC] pc.ontrack stream ID=${event.streams[0].id}, tracks count=${event.streams[0].getTracks().length}`);
        onTrack(event.streams[0]);
      } else {
        addLog(`[WEBRTC DIAGNOSTIC] pc.ontrack fired but no streams were attached for peerId=${peerId}!`, true);
      }
    };

    // If we are the initiator, generate offer
    if (this.shouldInitiateOffer(peerId, peerRole)) {
      try {
        addLog(`[WEBRTC DIAGNOSTIC] Creating offer for peerId=${peerId}`);
        const offer = await pc.createOffer();
        addLog(`[WEBRTC DIAGNOSTIC] setLocalDescription for peerId=${peerId}, state before=${pc.signalingState}`);
        await pc.setLocalDescription(offer);
        addLog(`[WEBRTC DIAGNOSTIC] Sending offer to peerId=${peerId}, state after=${pc.signalingState}`);
        await sendSignal(this.roomId, this.localId, peerId, 'offer', offer);

        // Watchdog: if we sent an offer but the peer never answered (signal
        // missed due to a dropped poll, backgrounded tab, etc.), resend it once.
        setTimeout(() => {
          if (pc.signalingState === 'have-local-offer' && pc.connectionState !== 'closed') {
            addLog(`[WEBRTC DIAGNOSTIC] No answer received from peerId=${peerId} after 10s. Resending offer.`);
            sendSignal(this.roomId, this.localId, peerId, 'offer', offer);
          }
        }, 10000);
      } catch (err: any) {
        addLog(`[WEBRTC DIAGNOSTIC] Error creating/sending offer for ${peerId}: ${err?.message || err}`, true);
      }
    }

    return pc;
  }

  /**
   * Processes incoming signals from the polling queue.
   */
  public async handleSignal(
    peerId: string,
    type: 'offer' | 'answer' | 'ice-candidate' | 'kick',
    payload: any,
    localStream: MediaStream | null,
    onTrack: (stream: MediaStream) => void,
    onConnectionState: (state: RTCIceConnectionState) => void,
    peerRole: 'host' | 'guest' | 'spectator'
  ) {
    let pc = this.connections.get(peerId);

    if (!pc) {
      addLog(`[WEBRTC DIAGNOSTIC] handleSignal dynamic connection creation for peerId=${peerId}`);
      // Create connection dynamically on receipt of signal
      pc = await this.createPeerConnection({
        peerId,
        peerRole,
        localStream,
        onTrack,
        onConnectionState,
      });
    }

    if (type === 'offer') {
      try {
        addLog(`[WEBRTC DIAGNOSTIC] Offer received from peerId=${peerId}. Current signalingState=${pc.signalingState}`);
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        addLog(`[WEBRTC DIAGNOSTIC] setRemoteDescription completed for offer from peerId=${peerId}. New signalingState=${pc.signalingState}`);

        addLog(`[WEBRTC DIAGNOSTIC] Creating answer for peerId=${peerId}`);
        const answer = await pc.createAnswer();
        addLog(`[WEBRTC DIAGNOSTIC] setLocalDescription (answer) for peerId=${peerId}, state before=${pc.signalingState}`);
        await pc.setLocalDescription(answer);
        addLog(`[WEBRTC DIAGNOSTIC] Sending answer to peerId=${peerId}, state after=${pc.signalingState}`);
        await sendSignal(this.roomId, this.localId, peerId, 'answer', answer);

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        addLog(`[WEBRTC DIAGNOSTIC] Processing ${queue.length} queued ICE candidates for peerId=${peerId}`);
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err: any) {
        addLog(`[WEBRTC DIAGNOSTIC] Error handling offer from peerId=${peerId}: ${err?.message || err}`, true);
      }
    } else if (type === 'answer') {
      try {
        addLog(`[WEBRTC DIAGNOSTIC] Answer received from peerId=${peerId}. Current signalingState=${pc.signalingState}`);
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        addLog(`[WEBRTC DIAGNOSTIC] setRemoteDescription completed for answer from peerId=${peerId}. New signalingState=${pc.signalingState}`);

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        addLog(`[WEBRTC DIAGNOSTIC] Processing ${queue.length} queued ICE candidates for peerId=${peerId}`);
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err: any) {
        addLog(`[WEBRTC DIAGNOSTIC] Error handling answer from peerId=${peerId}: ${err?.message || err}`, true);
      }
    } else if (type === 'ice-candidate') {
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          addLog(`[WEBRTC DIAGNOSTIC] Adding ICE candidate immediately for peerId=${peerId}`);
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        } else {
          // Queue candidates until remote description is set
          addLog(`[WEBRTC DIAGNOSTIC] Queueing ICE candidate for peerId=${peerId} (remoteDescription not set yet)`);
          const queue = this.iceQueues.get(peerId) || [];
          queue.push(payload);
          this.iceQueues.set(peerId, queue);
        }
      } catch (err: any) {
        addLog(`[WEBRTC DIAGNOSTIC] Error adding ICE candidate for peerId=${peerId}: ${err?.message || err}`, true);
      }
    }
  }

  /**
   * Retrieves all currently connected peer IDs.
   */
  public getActivePeerIds(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Closes connection with a single peer.
   */
  public closePeer(peerId: string) {
    addLog(`[WEBRTC DIAGNOSTIC] closePeer called for peerId=${peerId}`);
    const pc = this.connections.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
      this.connections.delete(peerId);
    }
    this.iceQueues.delete(peerId);
  }

  /**
   * Closes all active connections and cleans resources.
   */
  public closeAll() {
    addLog('[WEBRTC DIAGNOSTIC] closeAll connections called.');
    this.connections.forEach((pc) => {
      try {
        pc.close();
      } catch (e) {}
    });
    this.connections.clear();
    this.iceQueues.clear();
  }
}
