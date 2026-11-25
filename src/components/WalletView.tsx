import React, { useState } from 'react';
import { Coins, Gift, Sparkles, Clock, ArrowUpRight, ArrowDownLeft, Tag } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { COIN_PACKS } from '../data/initialData';

export const WalletView: React.FC = () => {
  const {
    coins,
    transactions,
    claimDailyCoins,
    isClaimReady,
    cooldownSeconds,
    redeemPromoCode,
    setSelectedCoinPack,
    setOpenCoinModal,
    addToast,
  } = useApp();

  const [promoCode, setPromoCode] = useState('');

  const handleDailyClaim = () => {
    const res = claimDailyCoins();
    addToast(res.message, res.success ? 'success' : 'info');
  };

  const handlePromo = (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    const res = redeemPromoCode(promoCode.trim());
    addToast(res.message, res.success ? 'success' : 'error');
    if (res.success) setPromoCode('');
  };

  const formatCooldown = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="rounded-2xl bg-gradient-to-br from-[#0b152a] via-[#0e1026] to-[#081523] border border-cyan-500/25 p-6 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">
              YASHI Wallet Balance
            </p>
            <div className="mt-2 flex items-baseline gap-2.5">
              <Coins className="w-7 h-7 text-amber-400" />
              <span className="text-4xl font-black text-white tracking-tight">
                {coins.toLocaleString()}
              </span>
              <span className="text-sm font-semibold text-slate-400">Coins</span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Use coins to upgrade plans, unlock bot slots, or activate premium modules.
            </p>
          </div>

          <button
            onClick={handleDailyClaim}
            disabled={!isClaimReady}
            className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition cursor-pointer ${
              isClaimReady
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-slate-800/80 text-slate-400 border border-slate-700 cursor-not-allowed'
            }`}
          >
            {isClaimReady ? <Gift className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
            {isClaimReady ? 'Claim Daily +10 Coins' : `Next claim in ${formatCooldown(cooldownSeconds)}`}
          </button>
        </div>
      </div>

      {/* Coin Packs */}
      <div className="space-y-3">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          Top Up Coin Packs
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COIN_PACKS.map((pack) => (
            <div
              key={pack.id}
              className={`rounded-2xl p-5 border flex flex-col justify-between gap-4 transition ${
                pack.isBestValue
                  ? 'bg-gradient-to-b from-cyan-950/50 to-[#0a101d] border-cyan-500/50 shadow-lg shadow-cyan-500/10'
                  : 'bg-[#0a101d] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl font-black text-white">{pack.coins.toLocaleString()}</span>
                  {pack.isBestValue && (
                    <span className="px-2 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 text-[10px] font-bold uppercase">
                      Best Value
                    </span>
                  )}
                </div>
                <p className="text-xs text-amber-400 font-semibold mt-0.5">YASHI Coins</p>
                <p className="text-xs text-slate-400 mt-3">
                  ~{pack.daysEstimate} days • Up to {pack.maxBots} bot slots
                </p>
              </div>
              <div className="space-y-2.5">
                <p className="text-lg font-extrabold text-emerald-400">
                  LKR {pack.priceLkr.toLocaleString()}
                </p>
                <button
                  onClick={() => {
                    setSelectedCoinPack(pack);
                    setOpenCoinModal(true);
                  }}
                  className="w-full py-2.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 font-semibold text-xs transition cursor-pointer"
                >
                  Purchase Pack
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Promo Code */}
      <form
        onSubmit={handlePromo}
        className="rounded-2xl bg-[#0a101d] border border-slate-800 p-5 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
      >
        <div className="flex items-center gap-2 text-slate-300 text-xs font-semibold shrink-0">
          <Tag className="w-4 h-4 text-purple-400" />
          Promo Code
        </div>
        <input
          type="text"
          value={promoCode}
          onChange={(e) => setPromoCode(e.target.value)}
          placeholder="Enter promo code (e.g. YASHI-LAUNCH)"
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition cursor-pointer"
        >
          Redeem
        </button>
      </form>

      {/* Transaction History */}
      <div className="rounded-2xl bg-[#0a101d] border border-slate-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h3 className="text-sm font-bold text-white">Recent Transactions</h3>
        </div>
        <div className="divide-y divide-slate-800/70">
          {transactions.length === 0 ? (
            <p className="p-6 text-xs text-slate-400 text-center">No transactions recorded yet.</p>
          ) : (
            transactions.slice(0, 25).map((tx) => {
              const isPositive = tx.amount >= 0;
              return (
                <div key={tx.id} className="px-5 py-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        isPositive
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-rose-500/15 text-rose-400'
                      }`}
                    >
                      {isPositive ? (
                        <ArrowDownLeft className="w-4 h-4" />
                      ) : (
                        <ArrowUpRight className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{tx.title}</p>
                      <p className="text-[11px] text-slate-500">{tx.date}</p>
                    </div>
                  </div>
                  <span
                    className={`text-xs font-bold shrink-0 ${
                      isPositive ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {isPositive ? `+${tx.amount}` : tx.amount} Coins
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
