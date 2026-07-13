'use client';

import React, { useEffect, useState, useRef } from 'react';
import { subscribe, addLog } from '@/src/lib/logger';
import { Terminal, ChevronUp, ChevronDown, Trash2, Copy, Check } from 'lucide-react';

export default function DebugOverlay() {
  const [logs, setLogs] = useState<string[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to global log buffer
    const unsubscribe = subscribe((updatedLogs) => {
      setLogs(updatedLogs);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isOpen && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy logs to clipboard:', err);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#121215] border-t border-white/15 shadow-[0_-5px_15px_rgba(0,0,0,0.5)] font-mono text-xs select-none">
      {/* Control bar */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-4 py-2 bg-[#1A1A1E] cursor-pointer hover:bg-[#232328] transition-colors"
      >
        <div className="flex items-center gap-2 text-orange-500 font-bold">
          <Terminal className="w-4 h-4 animate-pulse" />
          <span className="text-[10px] uppercase tracking-widest font-semibold font-mono">ON-SCREEN WEBRTC & SIGNAL DIAGNOSTICS ({logs.length})</span>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleCopy}
            disabled={logs.length === 0}
            className={`p-1 rounded cursor-pointer transition-colors ${
              logs.length === 0 
                ? 'text-white/20 cursor-not-allowed' 
                : 'text-white/40 hover:text-emerald-400'
            }`}
            title="Copy diagnostics to clipboard"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button 
            onClick={(e) => {
              e.stopPropagation();
              addLog('Clearing diagnostic overlay logs...');
              // Simple way to reset state
              setLogs([]);
            }}
            className="p-1 text-white/40 hover:text-red-400 rounded cursor-pointer transition-colors"
            title="Clear overlay display"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {isOpen ? <ChevronDown className="w-4 h-4 text-white/50" /> : <ChevronUp className="w-4 h-4 text-white/50" />}
        </div>
      </div>

      {/* Log Console Body */}
      {isOpen && (
        <div 
          ref={containerRef}
          className="h-40 overflow-y-auto bg-[#0A0A0C] p-3 space-y-1 select-text scrollbar-thin scrollbar-thumb-white/10"
        >
          {logs.length === 0 ? (
            <div className="text-white/20 text-[10px] uppercase italic text-center py-4">
              NO SIGNALS OR WEBRTC PACKETS EXCHANGED YET
            </div>
          ) : (
            logs.map((log, idx) => {
              let color = 'text-[#D0D0D5]';
              if (log.includes('Error') || log.includes('Failed') || log.includes('WARNING') || log.includes('error')) {
                color = 'text-red-400';
              } else if (log.includes('pc.oniceconnectionstatechange') || log.includes('connected') || log.includes('SUCCESS')) {
                color = 'text-green-400';
              } else if (log.includes('offer') || log.includes('answer') || log.includes('Offer') || log.includes('Answer')) {
                color = 'text-yellow-400';
              } else if (log.includes('ICE candidate') || log.includes('ice-candidate')) {
                color = 'text-blue-300';
              } else if (log.includes('leave') || log.includes('Disconnect') || log.includes('disconnect')) {
                color = 'text-orange-400';
              }
              
              return (
                <div key={idx} className={`text-[10px] leading-relaxed break-all font-mono border-b border-white/5 pb-0.5 ${color}`}>
                  {log}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
