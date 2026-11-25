import React from 'react';
import { X, Headphones, MessageCircle, Copy } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { APP_CONFIG } from '../data/initialData';

export const SupportModal: React.FC = () => {
  const { openSupportModal, setOpenSupportModal, adminWhatsappNumber, addToast } = useApp();

  if (!openSupportModal) return null;

  const hotline = adminWhatsappNumber || APP_CONFIG.ownerHotline;
  const waHref = `https://wa.me/${hotline.replace(/\D/g, '')}`;

  const copyHotline = () => {
    navigator.clipboard?.writeText(hotline).catch(() => {});
    addToast('Support WhatsApp number copied!', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Headphones className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">YASHI HALLS Support</h3>
          </div>
          <button
            onClick={() => setOpenSupportModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Need help pairing your WhatsApp bot, configuring Guild Glory pricing, or setting up the
            Android Pay APK? Reach our support desk directly.
          </p>

          <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 flex items-center justify-between gap-2">
            <div>
              <p className="text-[11px] text-slate-500">WhatsApp Hotline</p>
              <p className="text-sm font-mono font-bold text-cyan-300">+{hotline}</p>
            </div>
            <button
              onClick={copyHotline}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs text-slate-300 transition cursor-pointer"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>

          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
          >
            <MessageCircle className="w-4 h-4" />
            Chat on WhatsApp
          </a>
        </div>
      </div>
    </div>
  );
};
