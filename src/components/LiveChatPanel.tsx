'use client';

import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, RefreshCw, Star } from 'lucide-react';

interface ChatMessage {
  id: string;
  publishedAt: string;
  text: string;
  authorName: string;
  authorProfileImageUrl: string;
  isChatOwner: boolean;
}

interface LiveChatPanelProps {
  roomId: string;
  liveChatId: string;
}

export default function LiveChatPanel({ roomId, liveChatId }: LiveChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');

  const nextPageTokenRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);

  const fetchChat = async () => {
    if (!liveChatId || !roomId) return;
    try {
      let url = `/api/youtube/live-chat?roomId=${roomId}&liveChatId=${liveChatId}`;
      if (nextPageTokenRef.current) {
        url += `&pageToken=${nextPageTokenRef.current}`;
      }

      const res = await fetch(url);
      const contentType = res.headers.get('content-type');
      const isJson = contentType && contentType.includes('application/json');

      if (!res.ok) {
        let errMsg = 'Unable to retrieve chat logs';
        if (isJson) {
          const data = await res.json();
          errMsg = data.error || errMsg;
        } else {
          const text = await res.text();
          errMsg = text || errMsg;
        }
        throw new Error(errMsg);
      }

      if (!isJson) {
        throw new Error('Server returned invalid response type');
      }

      const data = await res.json();

      if (data.messages && data.messages.length > 0) {
        setMessages((prev) => {
          // Prevent duplicates by checking ID
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = data.messages.filter((m: ChatMessage) => !existingIds.has(m.id));
          return [...prev, ...newMsgs];
        });
      }

      nextPageTokenRef.current = data.nextPageToken;

      // Plan next poll using YouTube-recommended interval or default 5s
      const delay = Math.max(data.pollingIntervalMillis || 5000, 3000);
      if (active) {
        if (intervalIdRef.current) clearTimeout(intervalIdRef.current);
        intervalIdRef.current = setTimeout(fetchChat, delay);
      }
    } catch (err: any) {
      console.warn('Chat poll warning:', err);
      setError(err.message || 'Chatroom connection error');
    }
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    fetchChat().then(() => setLoading(false));

    return () => {
      setActive(false);
      if (intervalIdRef.current) {
        clearTimeout(intervalIdRef.current);
      }
    };
  }, [liveChatId]);

  // Autoscroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div id="live-chat-panel" className="bg-[#121215] border border-white/10 rounded p-5 flex flex-col h-[350px] space-y-3">
      {/* Panel Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-orange-500 animate-pulse" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">LIVE CHAT FEED</h3>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-white/40">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
          <span>CONNECTED</span>
        </div>
      </div>

      {/* Chat messages box */}
      <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 scrollbar-none">
        {error && (
          <div className="text-[10px] font-mono text-red-500 bg-red-950/20 border border-red-900/40 p-2 rounded text-center uppercase tracking-wider">
            {error}
          </div>
        )}

        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 text-xs gap-1 font-mono uppercase tracking-widest">
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-white/10 mb-1" />
            <span>WAITING FOR INCOMING CHAT...</span>
            <span className="text-[9px] text-white/20">Ensure RTMP broadcast is active</span>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="flex gap-2.5 items-start text-xs font-mono">
              {/* Avatar */}
              <img
                src={msg.authorProfileImageUrl || 'https://picsum.photos/32/32'}
                alt={msg.authorName}
                className="w-6 h-6 rounded border border-white/10 shrink-0"
                referrerPolicy="no-referrer"
              />

              {/* Message Details */}
              <div className="space-y-0.5 max-w-[85%]">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`font-mono font-bold text-[10px] ${msg.isChatOwner ? 'text-red-500' : 'text-white/60'}`}>
                    {msg.authorName.toUpperCase()}
                  </span>
                  {msg.isChatOwner && (
                    <span className="bg-red-500/10 border border-red-500/20 text-[9px] text-red-500 px-1 rounded flex items-center gap-0.5 font-bold">
                      <Star className="w-2.5 h-2.5 fill-current" />
                      HOST
                    </span>
                  )}
                </div>
                <p className="text-[#E0E0E6] bg-[#0A0A0C] px-2 py-1 rounded border border-white/5 inline-block leading-relaxed break-words text-[11px]">
                  {msg.text}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
