'use client';
import { X } from 'lucide-react';
import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function Modal({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center p-0 md:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[100dvh] md:max-h-[90dvh]">
        <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-white rounded-t-2xl z-10 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900 truncate pr-2">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-4 overflow-y-auto overscroll-contain pb-[max(env(safe-area-inset-bottom),1rem)]">
          {children}
        </div>
      </div>
    </div>
  );
}
