import React from 'react';
import { Bot } from 'lucide-react';

interface CyberBotHologramProps {
  size?: 'sm' | 'md' | 'lg';
  isOnline?: boolean;
}

export const CyberBotHologram: React.FC<CyberBotHologramProps> = ({
  size = 'md',
  isOnline = false,
}) => {
  const dims =
    size === 'sm'
      ? 'w-11 h-11 rounded-xl'
      : size === 'lg'
      ? 'w-20 h-20 rounded-2xl'
      : 'w-14 h-14 rounded-2xl';
  const iconSize = size === 'sm' ? 'w-5 h-5' : size === 'lg' ? 'w-9 h-9' : 'w-7 h-7';

  return (
    <div className="relative inline-flex items-center justify-center shrink-0">
      <div
        className={`absolute inset-0 blur-md rounded-2xl transition-opacity duration-500 ${
          isOnline
            ? 'bg-gradient-to-tr from-cyan-500/45 via-emerald-400/35 to-purple-500/40 opacity-100'
            : 'bg-slate-700/25 opacity-60'
        }`}
      />
      <div
        className={`relative ${dims} border flex items-center justify-center shadow-lg transition-colors ${
          isOnline
            ? 'bg-gradient-to-br from-cyan-950/90 via-[#0b152a] to-purple-950/90 border-cyan-400/50 text-cyan-300'
            : 'bg-[#0a101d] border-slate-700/80 text-slate-400'
        }`}
      >
        <Bot className={iconSize} />
        <span
          className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#0a101d] ${
            isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
          }`}
        />
      </div>
    </div>
  );
};
