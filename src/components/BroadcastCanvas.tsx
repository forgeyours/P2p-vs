'use client';

import React, { forwardRef } from 'react';
import { Monitor, HelpCircle } from 'lucide-react';

interface BroadcastCanvasProps {
  orientation: 'landscape' | 'portrait';
}

const BroadcastCanvas = forwardRef<HTMLCanvasElement, BroadcastCanvasProps>(
  ({ orientation }, ref) => {
    const isLandscape = orientation === 'landscape';

    return (
      <div className="relative w-full h-full flex flex-col items-center justify-center bg-[#0A0A0C] border border-white/10 rounded overflow-hidden">
        {/* Monitor Header Status Bar */}
        <div className="absolute top-0 inset-x-0 bg-[#121215] border-b border-white/10 px-4 py-2.5 flex items-center justify-between text-[10px] font-mono text-white/40 z-10 uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <Monitor className="w-3.5 h-3.5 text-red-500 animate-pulse" />
            <span className="font-bold text-[#E0E0E6]">PROGRAM OUTPUT (1080P CANVAS)</span>
          </div>
          <div className="flex items-center gap-4">
            <span>{isLandscape ? '16:9 FHD' : '9:16 MOBILE'}</span>
            <span>{isLandscape ? '1280 × 720' : '720 × 1280'}</span>
            <span className="text-red-500 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-red-600 rounded-full shadow-[0_0_8px_rgba(220,38,38,0.8)] animate-pulse" />
              ON AIR
            </span>
          </div>
        </div>

        {/* Composited Canvas viewport */}
        <div className="w-full h-full flex items-center justify-center p-4 pt-14 pb-4">
          <div
            className={`relative flex items-center justify-center bg-[#1A1A1E] border-2 border-white/5 shadow-2xl transition-all duration-300 p-1 ${
              isLandscape ? 'aspect-video w-full' : 'aspect-[9/16] h-full max-h-[75vh]'
            }`}
          >
            <canvas
              ref={ref}
              className="w-full h-full object-contain bg-black"
            />
          </div>
        </div>

        {/* Floating Indicator */}
        <div className="absolute bottom-3 left-4 text-[9px] font-mono text-white/30 bg-black/60 border border-white/5 px-2.5 py-1 rounded flex items-center gap-1 uppercase tracking-tight">
          <HelpCircle className="w-3 h-3 text-white/40" />
          <span>REAL-TIME PROGRAM COMPOSITION FEED</span>
        </div>
      </div>
    );
  }
);

BroadcastCanvas.displayName = 'BroadcastCanvas';

export default BroadcastCanvas;
