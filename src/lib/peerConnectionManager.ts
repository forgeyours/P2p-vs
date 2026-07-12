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
   * Checks if we should initiate the offer based on our lexicographical rule or role.
   */
  public shouldInitiateOffer(
    peerId: string,
    peerRole: 'host' | 'guest' | 'spectator'
  ): boolean {
    if (this.localRole === 'host' && peerRole === 'spectator') {
      // Host always initiates connection to spectator
      return true;
    }
    if (this.localRole === 'spectator' || peerRole === 'host') {
      // Spectator never initiates; host connects to guest/spectator and lower ID handles guests
      return false;
    }

    // Guests <-> Guest or Host <-> Guest uses lexicographical comparison
    return this.localId < peerId;
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
    // If connection already exists, close it first
    if (this.connections.has(peerId)) {
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
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    } else if (localStream && this.localRole === 'host' && peerRole === 'spectator') {
      // Host sending composited streams to spectators
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

    // Ice Candidate handling
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignal(
          this.roomId,
          this.localId,
          peerId,
          'ice-candidate',
          event.candidate.toJSON()
        );
      }
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      onConnectionState(pc.iceConnectionState);
    };

    // Track stream arrival
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        onTrack(event.streams[0]);
      }
    };

    // If we are the initiator, generate offer
    if (this.shouldInitiateOffer(peerId, peerRole)) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await sendSignal(this.roomId, this.localId, peerId, 'offer', offer);
      } catch (err) {
        console.error(`Error creating offer for ${peerId}:`, err);
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
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendSignal(this.roomId, this.localId, peerId, 'answer', answer);

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err) {
        console.error('Error handling offer:', err);
      }
    } else if (type === 'answer') {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));

        // Process any queued ICE candidates for this peer
        const queue = this.iceQueues.get(peerId) || [];
        for (const candidate of queue) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        this.iceQueues.set(peerId, []);
      } catch (err) {
        console.error('Error handling answer:', err);
      }
    } else if (type === 'ice-candidate') {
      try {
        if (pc.remoteDescription && pc.remoteDescription.type) {
          await pc.addIceCandidate(new RTCIceCandidate(payload));
        } else {
          // Queue candidates until remote description is set
          const queue = this.iceQueues.get(peerId) || [];
          queue.push(payload);
          this.iceQueues.set(peerId, queue);
        }
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  }

  /**
   * Closes connection with a single peer.
   */
  public closePeer(peerId: string) {
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
    this.connections.forEach((pc) => pc.close());
    this.connections.clear();
    this.iceQueues.clear();
  }
}
