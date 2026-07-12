import { sendSignal } from './signaling';

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

    console.log(
      `[WEBRTC DIAGNOSTIC] shouldInitiateOffer called: peerId=${peerId}, peerRole=${peerRole}, localId=${this.localId}, localRole=${this.localRole}, result=${result}`
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
    console.log(`[WEBRTC DIAGNOSTIC] createPeerConnection for peerId=${peerId}, peerRole=${peerRole}`);

    // If connection already exists, close it first
    if (this.connections.has(peerId)) {
      console.log(`[WEBRTC DIAGNOSTIC] Connection to ${peerId} already exists. Closing existing connection before re-creating.`);
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
      console.log(`[WEBRTC DIAGNOSTIC] Adding local tracks to pc for peerId=${peerId}. Tracks count: ${localStream.getTracks().length}`);
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    } else if (localStream && this.localRole === 'host' && peerRole === 'spectator') {
      // Host sending composited streams to spectators
      console.log(`[WEBRTC DIAGNOSTIC] Host adding composited tracks to spectator pc for peerId=${peerId}`);
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    } else {
      console.log(`[WEBRTC DIAGNOSTIC] No local tracks added to pc for peerId=${peerId} (localStream is null or participant role is spectator).`);
    }

    // Ice Candidate handling
    let candidateCount = 0;
    const iceTimer = setTimeout(() => {
      if (candidateCount === 0) {
        console.warn(`[WEBRTC DIAGNOSTIC] WARNING: No ICE candidates generated for peerId=${peerId} within 5 seconds. Possible STUN/ICE gathering failure.`);
      } else {
        console.log(`[WEBRTC DIAGNOSTIC] ICE candidate check: generated ${candidateCount} candidates for peerId=${peerId} so far.`);
      }
    }, 5000);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        candidateCount++;
        console.log(`[WEBRTC DIAGNOSTIC] Generated ICE candidate #${candidateCount} for peerId=${peerId}: ${JSON.stringify(event.candidate.candidate)}`);
        sendSignal(
          this.roomId,
          this.localId,
          peerId,
          'ice-candidate',
          event.candidate.toJSON()
        );
      } else {
        console.log(`[WEBRTC DIAGNOSTIC] ICE candidate generation finished (null candidate received) for peerId=${peerId}. Total generated: ${candidateCount}`);
        clearTimeout(iceTimer);
      }
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      console.log(`[WEBRTC DIAGNOSTIC] pc.oniceconnectionstatechange for peerId=${peerId}: state changed to ${pc.iceConnectionState}`);
      onConnectionState(pc.iceConnectionState);
    };

    // Track stream arrival
    pc.ontrack = (event) => {
      console.log(`[WEBRTC DIAGNOSTIC] pc.ontrack fired for peerId=${peerId}. Track kind=${event.track.kind}, id=${event.track.id}, Streams count=${event.streams.length}`);
      if (event.streams && event.streams[0]) {
        console.log(`[WEBRTC DIAGNOSTIC] pc.ontrack stream ID=${event.streams[0].id}, tracks count=${event.streams[0].getTracks().length}`);
        onTrack(event.streams[0]);
      } else {
        console.warn(`[WEBRTC DIAGNOSTIC] pc.ontrack fired but no streams were attached for peerId=${peerId}!`);
      }
    };

    // If we are the initiator, generate offer
    if (this.shouldInitiateOffer(peerId, peerRole)) {
      try {
        console.log(`[WEBRTC DIAGNOSTIC] Creating offer for peerId=${peerId}`);
        const offer = await pc.createOffer();
        console.log(`[WEBRTC DIAGNOSTIC] setLocalDescription for peerId=${peerId}, state before=${pc.signalingState}`);
        await pc.setLocalDescription(offer);
        console.log(`[WEBRTC DIAGNOSTIC] Sending offer to peerId=${peerId}, state after=${pc.signalingState}`);
        await sendSignal(this.roomId, this.localId, peerId, 'offer', offer);
      } catch (err) {
        console.error(`[WEBRTC DIAGNOSTIC] Error creating/sending offer for ${peerId}:`, err);
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
      console.log(`[WEBRTC DIAGNOSTIC] handleSignal dynamic connection creation for peerId=${peerId}`);
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
        console.log(`[WEBRTC DIAGNOSTIC] Offer received from peerId=${peerId}. Current signalingState=${pc.signalingState}`);
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        console.log(`[WEBRTC DIAGNOSTIC] setRemoteDescription completed for offer from peerId=${peerId}. New signalingState=${pc.signalingState}`);

        console.log(`[WEBRTC DIAGNOSTIC] Creating answer for peerId=${peerId}`);
        const answer = await pc.createAnswer();
        console.log(`[WEBRTC DIAGNOSTIC] setLocalDescription (answer) for peerId=${peerId}, state before=${pc.signalingState}`);
        await pc.setLocalDescription(answer);
        console.log(`[WEBRTC DIAGNOSTIC] Sending answer to peerId=${peerId}, state after=${pc.signalingState}`);
        await sendSignal(this.roomId, this.localId, peerId, 'answer', answer);

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        console.log(`[WEBRTC DIAGNOSTIC] Processing ${queue.length} queued ICE candidates for peerId=${peerId}`);
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err) {
        console.error(`[WEBRTC DIAGNOSTIC] Error handling offer from peerId=${peerId}:`, err);
      }
    } else if (type === 'answer') {
      try {
        console.log(`[WEBRTC DIAGNOSTIC] Answer received from peerId=${peerId}. Current signalingState=${pc.signalingState}`);
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        console.log(`[WEBRTC DIAGNOSTIC] setRemoteDescription completed for answer from peerId=${peerId}. New signalingState=${pc.signalingState}`);

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        console.log(`[WEBRTC DIAGNOSTIC] Processing ${queue.length} queued ICE candidates for peerId=${peerId}`);
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err) {
        console.error(`[WEBRTC DIAGNOSTIC] Error handling answer from peerId=${peerId}:`, err);
      }
    } else if (type === 'ice-candidate') {
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          console.log(`[WEBRTC DIAGNOSTIC] Adding ICE candidate immediately for peerId=${peerId}`);
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        } else {
          // Queue candidates until remote description is set
          console.log(`[WEBRTC DIAGNOSTIC] Queueing ICE candidate for peerId=${peerId} (remoteDescription not set yet)`);
          const queue = this.iceQueues.get(peerId) || [];
          queue.push(payload);
          this.iceQueues.set(peerId, queue);
        }
      } catch (err) {
        console.error(`[WEBRTC DIAGNOSTIC] Error adding ICE candidate for peerId=${peerId}:`, err);
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
    console.log(`[WEBRTC DIAGNOSTIC] closePeer called for peerId=${peerId}`);
    const pc = this.connections.get(peerId);
    if (pc) {
      pc.close();
      this.connections.delete(peerId);
    }
    this.iceQueues.delete(peerId);
  }

  /**
   * Closes all active connections and cleans resources.
   */
  public closeAll() {
    console.log('[WEBRTC DIAGNOSTIC] closeAll connections called.');
    this.connections.forEach((pc) => pc.close());
    this.connections.clear();
    this.iceQueues.clear();
  }
}
