import React, { useState } from 'react';
import { Sparkles, Check, Copy, Terminal } from 'lucide-react';
import { useApp } from '../context/AppContext';

const PREVIEW_COMMANDS = [
  { cmd: '.menu', desc: 'Interactive Cyber HTML Menu' },
  { cmd: '.panal', desc: 'Guild & Panel Service Selector' },
  { cmd: '.song', desc: 'YouTube High-Speed MP3' },
  { cmd: '.ai', desc: 'YASHI Smart AI Assistant' },
  { cmd: '.sticker', desc: 'HD WebP Sticker Maker' },
  { cmd: '.ping', desc: 'Live Engine Latency Check' },
];

export const WhatsAppMenuInteractivePreview: React.FC = () => {
  const { serverBotState, addToast } = useApp();
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const botName = serverBotState?.config?.botName || 'YASHI HALLS MINI';
  const prefix = serverBotState?.config?.prefix || '.';

  const handleCopy = (raw: string) => {
    const formatted = raw.replace(/^\./, prefix);
    navigator.clipboard?.writeText(formatted).catch(() => {});
    setCopiedCmd(formatted);
    addToast(`Copied ${formatted} to clipboard`, 'info');
    setTimeout(() => setCopiedCmd(null), 1600);
  };

  return (
    <div className="rounded-2xl bg-gradient-to-br from-[#0a101d] via-[#0e0b22] to-[#081224] border border-cyan-500/25 p-5 shadow-xl">
      <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center text-cyan-400">
            <Terminal className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white">{botName} • Quick Commands</h3>
            <p className="text-[11px] text-slate-400">Tap any command to copy for WhatsApp</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-[10px] font-bold text-purple-300">
          <Sparkles className="w-3 h-3" />
          HTML Card Ready
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {PREVIEW_COMMANDS.map((item) => {
          const displayCmd = item.cmd.replace(/^\./, prefix);
          const isCopied = copiedCmd === displayCmd;
          return (
            <button
              key={item.cmd}
              onClick={() => handleCopy(item.cmd)}
              className="group text-left p-3 rounded-xl bg-slate-950/70 hover:bg-slate-900/90 border border-slate-800/90 hover:border-cyan-500/40 transition flex items-center justify-between gap-2 cursor-pointer"
            >
              <div className="min-w-0">
                <p className="text-xs font-mono font-bold text-cyan-300 truncate">{displayCmd}</p>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">{item.desc}</p>
              </div>
              <span className="text-slate-500 group-hover:text-cyan-400 shrink-0">
                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
