import React, { useState } from 'react';
import { X, Coins, CheckCircle2, ExternalLink } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const CoinPurchaseModal: React.FC = () => {
  const {
    openCoinModal,
    setOpenCoinModal,
    selectedCoinPack,
    submitPurchaseRequest,
    addToast,
  } = useApp();

  const [submitting, setSubmitting] = useState(false);
  const [waUrl, setWaUrl] = useState<string | null>(null);

  if (!openCoinModal || !selectedCoinPack) return null;

  const handleRequest = async () => {
    setSubmitting(true);
    try {
      const res = await submitPurchaseRequest({
        itemType: 'coin_pack',
        itemName: `${selectedCoinPack.coins} YASHI Coins Pack`,
        coinAmount: selectedCoinPack.coins,
        priceLkr: selectedCoinPack.priceLkr,
        priceFormatted: `LKR ${selectedCoinPack.priceLkr.toLocaleString()}`,
      });
      addToast(res.message, res.success ? 'success' : 'error');
      if (res.success && res.whatsappUrl) {
        setWaUrl(res.whatsappUrl);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setWaUrl(null);
    setOpenCoinModal(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Purchase Coin Pack</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 flex items-center justify-between">
            <div>
              <p className="text-lg font-black text-white">{selectedCoinPack.coins.toLocaleString()} Coins</p>
              <p className="text-xs text-slate-400">~{selectedCoinPack.daysEstimate} days capacity</p>
            </div>
            <p className="text-lg font-extrabold text-emerald-400">
              LKR {selectedCoinPack.priceLkr.toLocaleString()}
            </p>
          </div>

          {waUrl ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Purchase request created! Send your receipt via WhatsApp for instant coin top-up.</span>
              </div>
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open WhatsApp Payment Chat
              </a>
            </div>
          ) : (
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleRequest}
                disabled={submitting}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                {submitting ? 'Creating Request...' : 'Confirm Order'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
