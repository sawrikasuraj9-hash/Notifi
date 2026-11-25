import React, { useState } from 'react';
import { X, Gift, Copy, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const InviteModal: React.FC = () => {
  const { openInviteModal, setOpenInviteModal, user, addToast } = useApp();
  const [copied, setCopied] = useState(false);

  if (!openInviteModal) return null;

  const refCode = `YH-${(user.username || 'USER').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6) || 'BOT'}`;
  const inviteLink = `${window.location.origin}/?ref=${encodeURIComponent(refCode)}`;

  const handleCopy = () => {
    navigator.clipboard?.writeText(inviteLink).catch(() => {});
    setCopied(true);
    addToast('Referral link copied to clipboard!', 'success');
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Gift className="w-5 h-5 text-purple-400" />
            <h3 className="text-sm font-bold text-white">Invite Friends & Earn Coins</h3>
          </div>
          <button
            onClick={() => setOpenInviteModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Share your personal invite link with friends. Both of you receive bonus YASHI Coins when
            they launch their first WhatsApp bot.
          </p>

          <div className="rounded-xl bg-slate-950 border border-slate-800 p-3 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
              className="flex-1 bg-transparent text-xs font-mono text-cyan-300 focus:outline-none truncate"
            />
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
