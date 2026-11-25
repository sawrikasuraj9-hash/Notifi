import React, { useState } from 'react';
import { X, Crown, Coins, ExternalLink, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PLAN_TIERS } from '../data/initialData';

export const PlanPurchaseModal: React.FC = () => {
  const {
    planToPurchase,
    setPlanToPurchase,
    coins,
    purchasePlan,
    submitPurchaseRequest,
    addToast,
  } = useApp();

  const [processing, setProcessing] = useState(false);
  const [waUrl, setWaUrl] = useState<string | null>(null);

  if (!planToPurchase) return null;

  const tier = PLAN_TIERS.find((t) => t.id === planToPurchase);
  if (!tier) return null;

  const hasEnoughCoins = coins >= tier.priceCoins;
  const priceLkr = tier.id === 'business' ? 1500 : tier.id === 'pro' ? 600 : 0;

  const handleBuyWithCoins = async () => {
    setProcessing(true);
    try {
      const res = await purchasePlan(tier.id);
      addToast(res.message, res.success ? 'success' : 'error');
      if (res.success) {
        setWaUrl(null);
        setPlanToPurchase(null);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleManualOrder = async () => {
    if (tier.id === 'mini') return;
    setProcessing(true);
    try {
      const res = await submitPurchaseRequest({
        itemType: 'plan',
        itemName: tier.name,
        planId: tier.id,
        priceLkr,
        priceFormatted: `LKR ${priceLkr.toLocaleString()}`,
      });
      addToast(res.message, res.success ? 'success' : 'error');
      if (res.success && res.whatsappUrl) {
        setWaUrl(res.whatsappUrl);
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleClose = () => {
    setWaUrl(null);
    setPlanToPurchase(null);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Activate {tier.name}</h3>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-4 space-y-1">
            <p className="text-xs text-cyan-400 font-bold uppercase">{tier.badge}</p>
            <p className="text-base font-bold text-white">{tier.name}</p>
            <p className="text-xs text-slate-400">{tier.description}</p>
            <div className="pt-2 flex items-center justify-between text-xs">
              <span className="text-slate-400">Plan Cost:</span>
              <span className="font-bold text-amber-400">
                {tier.isFree ? 'FREE' : `${tier.priceCoins} Coins (or LKR ${priceLkr.toLocaleString()})`}
              </span>
            </div>
          </div>

          {waUrl ? (
            <div className="space-y-3">
              <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3.5 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Order request recorded! Contact admin on WhatsApp to complete activation.</span>
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
            <div className="space-y-2.5">
              <button
                onClick={handleBuyWithCoins}
                disabled={processing || (!tier.isFree && !hasEnoughCoins)}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                <Coins className="w-4 h-4" />
                {tier.isFree
                  ? 'Switch to Free Plan'
                  : hasEnoughCoins
                  ? `Pay ${tier.priceCoins} Coins (Balance: ${coins})`
                  : `Need ${tier.priceCoins - coins} More Coins`}
              </button>

              {!tier.isFree && (
                <button
                  onClick={handleManualOrder}
                  disabled={processing}
                  className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-semibold text-xs transition cursor-pointer"
                >
                  Pay via Bank Transfer (LKR {priceLkr.toLocaleString()})
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
