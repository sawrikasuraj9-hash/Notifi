import React from 'react';
import { X, Crown, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PLAN_TIERS } from '../data/initialData';

export const BillingModal: React.FC = () => {
  const {
    openProModal,
    setOpenProModal,
    user,
    setPlanToPurchase,
  } = useApp();

  if (!openProModal) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-[#0a101d]">
          <div className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white">Upgrade Your YASHI Plan</h3>
          </div>
          <button
            onClick={() => setOpenProModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {PLAN_TIERS.map((tier) => {
            const isCurrent = user.plan === tier.id;
            return (
              <div
                key={tier.id}
                className={`rounded-2xl p-5 border flex flex-col justify-between gap-4 ${
                  tier.id === 'business'
                    ? 'bg-gradient-to-b from-purple-950/40 to-slate-950 border-purple-500/45'
                    : tier.id === 'pro'
                    ? 'bg-gradient-to-b from-cyan-950/40 to-slate-950 border-cyan-500/45'
                    : 'bg-slate-950/80 border-slate-800'
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-400">
                      {tier.badge}
                    </span>
                    {isCurrent && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">
                        Active
                      </span>
                    )}
                  </div>
                  <h4 className="text-base font-bold text-white">{tier.name}</h4>
                  <p className="text-2xl font-black text-white">
                    {tier.isFree ? 'FREE' : `${tier.priceCoins} Coins`}
                  </p>
                  <p className="text-xs text-slate-400">{tier.description}</p>
                  <ul className="space-y-1.5 pt-2">
                    {tier.features.map((f) => (
                      <li key={f} className="text-xs text-slate-300 flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <button
                  disabled={isCurrent}
                  onClick={() => {
                    setOpenProModal(false);
                    setPlanToPurchase(tier.id);
                  }}
                  className={`w-full py-2.5 rounded-xl font-bold text-xs transition cursor-pointer ${
                    isCurrent
                      ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : `Select ${tier.badge}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
