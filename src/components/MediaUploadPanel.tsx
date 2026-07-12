'use client';

import React, { useState, useRef } from 'react';
import { Upload, FileImage, FileVideo, FileText, Trash2 } from 'lucide-react';

interface MediaUploadPanelProps {
  onMediaSelect: (url: string, type: 'image' | 'video' | 'pdf', file: File | null) => void;
  onClearMedia: () => void;
  activeMedia: {
    type: 'image' | 'video' | 'pdf';
    url: string;
  } | null;
}

export default function MediaUploadPanel({
  onMediaSelect,
  onClearMedia,
  activeMedia,
}: MediaUploadPanelProps) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    setError('');
    // 50MB Cap
    if (file.size > 50 * 1024 * 1024) {
      setError('File size cannot exceed 50MB');
      return;
    }

    let type: 'image' | 'video' | 'pdf' | null = null;
    if (file.type.startsWith('image/')) {
      type = 'image';
    } else if (file.type.startsWith('video/')) {
      type = 'video';
    } else if (file.type === 'application/pdf') {
      type = 'pdf';
    } else {
      setError('Unsupported file format. Please upload an image, video, or PDF.');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/media-upload', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Upload failed');
      }

      const data = await res.json();
      if (data.url) {
        onMediaSelect(data.url, type, file);
      } else {
        throw new Error('Invalid URL returned');
      }
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(err.message || 'File upload failed, please check Vercel Blob permissions');
    } finally {
      setUploading(false);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleUpload(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  return (
    <div id="media-upload-panel" className="bg-[#121215] border border-white/10 rounded p-5 space-y-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <Upload className="w-4 h-4 text-orange-500" />
          <h3 className="text-xs font-bold uppercase tracking-widest text-[#E0E0E6] font-mono">MEDIA DECK</h3>
        </div>
        {activeMedia && (
          <button
            onClick={onClearMedia}
            className="px-2 py-1.5 bg-red-900/40 border border-red-500/50 text-red-500 text-[9px] font-bold uppercase font-mono tracking-wider rounded cursor-pointer transition-all"
          >
            <Trash2 className="w-3 h-3 inline mr-1" />
            <span>CLEAR DECK</span>
          </button>
        )}
      </div>

      {activeMedia ? (
        <div className="bg-[#0A0A0C] rounded p-3 border border-white/10 space-y-3">
          <div className="flex items-center gap-2 text-xs">
            {activeMedia.type === 'image' && <FileImage className="w-4 h-4 text-emerald-400 shrink-0" />}
            {activeMedia.type === 'video' && <FileVideo className="w-4 h-4 text-pink-400 shrink-0" />}
            {activeMedia.type === 'pdf' && <FileText className="w-4 h-4 text-yellow-400 shrink-0" />}
            <span className="font-mono text-white/70 truncate flex-1">{activeMedia.url}</span>
          </div>

          <div className="text-[10px] text-white/40 leading-normal bg-[#121215] p-2.5 rounded border border-white/5 uppercase font-mono tracking-tight">
            <span>MEDIA MOUNTED ON BROADCAST FEED.</span>
          </div>
        </div>
      ) : (
        <div
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border border-dashed rounded p-6 text-center cursor-pointer transition-all ${
            dragActive
              ? 'border-orange-500 bg-orange-500/5'
              : 'border-white/20 hover:border-white/30 bg-[#0A0A0C]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,video/*,application/pdf"
            onChange={handleChange}
            disabled={uploading}
          />
          <div className="flex flex-col items-center gap-2">
            <Upload className={`w-8 h-8 ${uploading ? 'animate-bounce text-orange-500' : 'text-white/20'}`} />
            <span className="text-xs font-bold font-mono uppercase tracking-widest text-[#E0E0E6]">
              {uploading ? 'UPLOADING...' : 'MOUNT MEDIA FILE'}
            </span>
            <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider">
              DRAG FILE OR CLICK (PNG, JPG, MP4, PDF • MAX 50MB)
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-xs font-mono text-red-500 text-center uppercase tracking-wider">{error}</p>}
    </div>
  );
}
