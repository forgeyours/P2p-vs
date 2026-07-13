import { addLog } from './logger';

export interface RosterEntry {
  id: string;
  role: 'host' | 'guest' | 'spectator';
  joinedAt: number;
}

export interface SignalingMessage {
  from: string;
  type: 'offer' | 'answer' | 'ice-candidate' | 'kick';
  payload: any;
}

/**
 * Registers or sends a heartbeat for a participant in the room roster.
 */
export async function joinRoster(
  roomId: string,
  participantId: string,
  role: 'host' | 'guest' | 'spectator',
  hostSecret?: string
): Promise<boolean> {
  try {
    const res = await fetch('/api/roster/join', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId, id: participantId, role, hostSecret }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      const warnMsg = `[WEBRTC DIAGNOSTIC ERROR] joinRoster: Heartbeat failed with status ${res.status}: ${errorText}`;
      console.error(warnMsg);
      addLog(warnMsg, true);
      return false;
    }
    return true;
  } catch (err: any) {
    const errMsg = `[WEBRTC DIAGNOSTIC ERROR] joinRoster: Network/unexpected error during heartbeat: ${err?.message || err}`;
    console.error(errMsg);
    addLog(errMsg, true);
    return false;
  }
}

/**
 * Posts a signaling message into a recipient's mailbox on Vercel KV.
 */
export async function sendSignal(
  roomId: string,
  fromId: string,
  toId: string,
  type: 'offer' | 'answer' | 'ice-candidate',
  payload: any
): Promise<boolean> {
  try {
    const res = await fetch('/api/signal/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId, fromId, toId, type, payload }),
    });
    return res.ok;
  } catch (err) {
    console.error('Error sending signal', err);
    return false;
  }
}

/**
 * Polls and flushes incoming signaling messages for a participant from Vercel KV.
 */
export async function pollSignals(
  roomId: string,
  participantId: string
): Promise<SignalingMessage[]> {
  try {
    const res = await fetch(`/api/signal/poll?roomId=${roomId}&id=${participantId}`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.messages || [];
  } catch (err) {
    console.error('Error polling signals', err);
    return [];
  }
}

/**
 * Fetches the active participant roster for a given room.
 */
export async function fetchRoster(roomId: string): Promise<RosterEntry[]> {
  try {
    const res = await fetch(`/api/roster/join?roomId=${roomId}`);
    if (!res.ok) {
      return [];
    }
    const data = await res.json();
    return data.roster || [];
  } catch (err) {
    console.error('Error fetching roster', err);
    return [];
  }
}

/**
 * Triggers host-gated participant kick from the roster.
 */
export async function kickParticipant(
  roomId: string,
  participantId: string,
  hostSecret: string
): Promise<boolean> {
  try {
    const res = await fetch('/api/roster/kick', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId, id: participantId, hostSecret }),
    });
    return res.ok;
  } catch (err) {
    console.error('Error kicking participant', err);
    return false;
  }
}
