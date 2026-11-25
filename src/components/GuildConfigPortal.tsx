import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Globe2,
  Loader2,
  RefreshCw,
  Send,
  Shield,
  Trophy,
  AlertTriangle,
  Users,
  Clock,
  ArrowLeft,
} from 'lucide-react';

interface LiveRegion {
  id: string;
  region_name: string;
  region_code: string;
  tier: string;
  enabled: boolean;
}

interface PortalOrder {
  id: string;
  mode: 'TEST' | 'LIVE';
  serviceType: string;
  productName: string;
  botQuantity: number;
  amountLkr: number;
  status: string;
  statusReason: string;
  processingStage: string;
  guildConfig?: {
    regionId: string;
    regionName: string;
    clanId: string;
    submittedVia: string;
    submittedAt: string;
  } | null;
  payment?: {
    bank: string;
    amountLkr: number;
    transactionId: string;
    paidAt: string;
  } | null;
  delivery?: {
    success: boolean;
    groupId?: string;
    botCount?: number;
    region?: string;
    clanId?: string;
    completedAt?: string;
    errorMessage?: string;
  } | null;
  liveGlory?: {
    currentGlory?: number | string;
    clanName?: string;
    clanLevel?: number | string;
    memberCount?: number | string;
    groupStatus: string;
    uptime?: string;
    lastUpdatedAt: string;
    errors?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface PortalData {
  brandName: string;
  order: PortalOrder;
  regions: LiveRegion[];
}

interface GuildConfigPortalProps {
  orderId: string;
  token: string;
  onExitPreview?: () => void;
}

const PROCESSING_STEPS = [
  { key: 'PAYMENT_VERIFIED', label: 'Payment Verified' },
  { key: 'GUILD_DETAILS_VERIFIED', label: 'Guild Details Verified' },
  { key: 'CONNECTING_FFGLORY', label: 'Connecting to FFGlory' },
  { key: 'LAUNCH_REQUEST_SUBMITTED', label: 'Launch Request Submitted' },
  { key: 'WAITING_API_RESPONSE', label: 'Waiting for API Response' },
];

function getStageNumber(stage: string, status: string): number {
  if (status === 'DELIVERED' || stage === 'LAUNCHED') return 6;
  switch (stage) {
    case 'PAYMENT_VERIFIED': return 1;
    case 'GUILD_DETAILS_VERIFIED': return 2;
    case 'CONNECTING_FFGLORY': return 3;
    case 'LAUNCH_REQUEST_SUBMITTED': return 4;
    case 'WAITING_API_RESPONSE': return 5;
    default: return 2;
  }
}

export const GuildConfigPortal: React.FC<GuildConfigPortalProps> = ({
  orderId,
  token,
  onExitPreview,
}) => {
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Phase 5 Form State
  const [selectedRegionId, setSelectedRegionId] = useState('');
  const [guildIdInput, setGuildIdInput] = useState('');
  const [copiedDetails, setCopiedDetails] = useState(false);
  const [copiedGroupId, setCopiedGroupId] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Phase 8 Live Glory State
  const [refreshingGlory, setRefreshingGlory] = useState(false);
  const [gloryCooldown, setGloryCooldown] = useState(0);

  const loadPortal = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch(
        `/api/guild-portal/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.message || 'Unable to verify this Guild Configuration link.');
        setLoading(false);
        return;
      }
      setData(json.data);
      setError(null);
      if (json.data?.regions?.length > 0 && !selectedRegionId) {
        setSelectedRegionId(json.data.order?.guildConfig?.regionId || json.data.regions[0].id);
      }
      if (json.data?.order?.guildConfig?.clanId && !guildIdInput) {
        setGuildIdInput(json.data.order.guildConfig.clanId);
      }
    } catch (e: any) {
      setError(e?.message || 'Network error loading Guild Portal.');
    } finally {
      setLoading(false);
    }
  }, [orderId, token, selectedRegionId, guildIdInput]);

  useEffect(() => {
    void loadPortal(false);
  }, [loadPortal]);

  // Poll while launching (real status updates — zero fake timers)
  useEffect(() => {
    if (!data?.order) return;
    if (data.order.status !== 'WAITING_DELIVERY') return;
    const id = window.setInterval(() => {
      void loadPortal(true);
    }, 3000);
    return () => window.clearInterval(id);
  }, [data?.order?.status, loadPortal]);

  // Cooldown countdown for Live Glory refresh
  useEffect(() => {
    if (gloryCooldown <= 0) return;
    const t = window.setTimeout(() => setGloryCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [gloryCooldown]);

  const handleRefreshLiveGlory = useCallback(async () => {
    if (refreshingGlory) return;
    setRefreshingGlory(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/guild-portal/${encodeURIComponent(orderId)}/live-glory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (json.cooldownRemainingSec) {
        setGloryCooldown(Number(json.cooldownRemainingSec));
      }
      if (json.liveGlory) {
        setData((prev) =>
          prev
            ? { ...prev, order: { ...prev.order, liveGlory: json.liveGlory } }
            : prev
        );
      }
      if (!json.success) {
        setActionNotice({ type: 'err', text: json.message || 'Unable to refresh Live Glory.' });
      }
    } catch (e: any) {
      setActionNotice({ type: 'err', text: e?.message || 'Network error refreshing Live Glory.' });
    } finally {
      setRefreshingGlory(false);
    }
  }, [orderId, token, refreshingGlory]);

  // Auto-fetch live glory once when delivered & refresh every 35s respectfully
  useEffect(() => {
    if (data?.order?.status !== 'DELIVERED' || !data?.order?.delivery?.groupId) return;
    if (!data.order.liveGlory) {
      void handleRefreshLiveGlory();
    }
    const id = window.setInterval(() => {
      void handleRefreshLiveGlory();
    }, 35000);
    return () => window.clearInterval(id);
  }, [data?.order?.status, data?.order?.delivery?.groupId]);

  const selectedRegionObj = data?.regions.find((r) => r.id === selectedRegionId);

  const handleCopyDetails = async () => {
    const cleanId = guildIdInput.replace(/\s+/g, '').trim();
    if (!selectedRegionId) {
      setActionNotice({ type: 'err', text: 'Please select your Guild Region first.' });
      return;
    }
    if (!/^\d{5,18}$/.test(cleanId)) {
      setActionNotice({ type: 'err', text: 'Enter a valid numeric Guild ID (5–18 digits) before copying.' });
      return;
    }

    const formatted = [
      `YASHI HALLS GUILD CONFIG`,
      `Order ID: ${orderId}`,
      `Region: ${selectedRegionId} (${selectedRegionObj?.region_name || selectedRegionId.toUpperCase()})`,
      `Guild ID: ${cleanId}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(formatted);
      setCopiedDetails(true);
      setActionNotice({
        type: 'ok',
        text: 'Guild details copied to clipboard. Paste them in the WhatsApp chat — or press SUBMIT DETAILS to launch now.',
      });
      window.setTimeout(() => setCopiedDetails(false), 3000);
    } catch {
      setActionNotice({
        type: 'err',
        text: 'Clipboard access blocked by browser. Use SUBMIT DETAILS below to submit directly.',
      });
    }
  };

  const handleSubmitDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = guildIdInput.replace(/\s+/g, '').trim();
    if (!selectedRegionId) {
      setActionNotice({ type: 'err', text: 'Please select your Guild Region.' });
      return;
    }
    if (!/^\d{5,18}$/.test(cleanId)) {
      setActionNotice({ type: 'err', text: 'Please enter a valid numeric Guild ID (5–18 digits).' });
      return;
    }

    setSubmitting(true);
    setActionNotice(null);
    try {
      const res = await fetch(`/api/guild-portal/${encodeURIComponent(orderId)}/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          regionId: selectedRegionId,
          clanId: cleanId,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setActionNotice({ type: 'err', text: json.message || 'Guild launch failed.' });
      } else {
        setActionNotice({ type: 'ok', text: json.message || 'Guild details submitted and launch completed!' });
      }
      await loadPortal(true);
    } catch (err: any) {
      setActionNotice({ type: 'err', text: err?.message || 'Submission failed.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#07040F] text-slate-100 flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          <p className="text-sm text-slate-400">Loading YASHI HALLS Guild Portal...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#07040F] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#110921] border border-purple-500/25 rounded-2xl p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
          <h1 className="text-xl font-bold text-white">Guild Configuration Link Unavailable</h1>
          <p className="text-sm text-slate-400">{error || 'Invalid or expired order link.'}</p>
          {onExitPreview && (
            <button
              onClick={onExitPreview}
              className="px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-semibold transition-colors"
            >
              Return to Dashboard
            </button>
          )}
        </div>
      </div>
    );
  }

  const { order, regions } = data;
  const isDelivered = order.status === 'DELIVERED' && Boolean(order.delivery?.groupId);
  const isLaunching = submitting || order.status === 'WAITING_DELIVERY';
  const isReadyToConfigure =
    !isDelivered &&
    !isLaunching &&
    (order.status === 'PAYMENT_VERIFIED' || order.status === 'DELIVERY_FAILED');
  const stageNum = getStageNumber(order.processingStage, order.status);

  return (
    <div className="min-h-screen bg-[#07040F] text-slate-100 relative overflow-x-hidden">
      {/* Subtle ambient Dark Purple backdrop */}
      <div className="fixed top-[-140px] right-[-100px] w-[460px] h-[460px] rounded-full bg-purple-700/15 blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-140px] left-[-120px] w-[420px] h-[420px] rounded-full bg-violet-800/15 blur-[140px] pointer-events-none" />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12 relative z-10 space-y-6">
        {/* Top Brand Bar */}
        <header className="flex items-center justify-between gap-4 pb-5 border-b border-purple-500/20">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-purple-500 to-violet-800 flex items-center justify-center font-extrabold text-white text-base tracking-tight shadow-lg shadow-purple-950/60">
              YH
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-wide text-white leading-tight">
                {data.brandName || 'YASHI HALLS'}
              </h1>
              <p className="text-xs text-purple-300/80">
                Order {order.id} · {order.botQuantity} Glory Bots · {order.mode === 'TEST' ? 'Test Mode' : 'Live Delivery'}
              </p>
            </div>
          </div>
          {onExitPreview && (
            <button
              onClick={onExitPreview}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-purple-500/25 bg-[#120A24] hover:bg-purple-950/60 text-xs font-medium text-purple-200 transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          )}
        </header>

        {/* Order Metadata Strip (Clean unboxed typography) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 px-5 rounded-2xl bg-[#10091E] border border-purple-500/20">
          <div>
            <p className="text-xs text-slate-400">Order ID</p>
            <p className="text-sm font-mono font-bold text-white mt-0.5 tabular-nums">{order.id}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Selected Package</p>
            <p className="text-sm font-semibold text-purple-200 mt-0.5 tabular-nums">{order.botQuantity} BOTS</p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Verified Payment</p>
            <p className="text-sm font-mono font-bold text-emerald-400 mt-0.5 tabular-nums">
              LKR {order.amountLkr.toLocaleString('en-US')}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400">Order Status</p>
            <p className="text-sm font-semibold text-white mt-0.5">{order.status.replace(/_/g, ' ')}</p>
          </div>
        </div>

        {/* Action Feedback Banner */}
        {actionNotice && (
          <div
            className={`px-4 py-3 rounded-xl border text-sm flex items-start gap-2.5 ${
              actionNotice.type === 'ok'
                ? 'bg-emerald-950/40 border-emerald-500/35 text-emerald-200'
                : 'bg-rose-950/40 border-rose-500/35 text-rose-200'
            }`}
          >
            {actionNotice.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-400" />
            ) : (
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-400" />
            )}
            <span>{actionNotice.text}</span>
          </div>
        )}

        {/* PHASE 5 — INTERACTIVE GUILD CONFIGURATION CARD */}
        {isReadyToConfigure && (
          <section className="bg-[#110921] border border-purple-500/30 rounded-2xl p-6 sm:p-8 space-y-6">
            <div>
              <p className="text-xs font-semibold text-purple-400">Payment Verified · Step 2 of 2</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
                GLORY BOT CONFIGURATION
              </h2>
              <p className="text-sm text-slate-300 mt-1.5">
                Please enter your Guild Details to continue. Select your Guild Region, enter your Guild ID and press COPY DETAILS to send in WhatsApp — or press SUBMIT DETAILS to launch automatically.
              </p>
            </div>

            {order.status === 'DELIVERY_FAILED' && order.delivery?.errorMessage && (
              <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200 space-y-1">
                <p className="font-semibold text-rose-300">Previous Launch Attempt Failed</p>
                <p>{order.delivery.errorMessage}</p>
              </div>
            )}

            <form onSubmit={handleSubmitDetails} className="space-y-6">
              {/* Live FFGlory Region Selection (from GET /api/pricing) */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-white flex items-center gap-2">
                    <Globe2 className="w-4 h-4 text-purple-400" />
                    Select Guild Region
                  </label>
                  <span className="text-xs text-slate-400">
                    {regions.length} live FFGlory regions available
                  </span>
                </div>

                {regions.length === 0 ? (
                  <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 text-xs text-amber-200">
                    Unable to load live regions from FFGlory right now. Please tap refresh shortly.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {regions.map((reg) => {
                      const active = selectedRegionId === reg.id;
                      return (
                        <button
                          key={reg.id}
                          type="button"
                          onClick={() => setSelectedRegionId(reg.id)}
                          className={`text-left px-4 py-3 rounded-xl border transition-all min-h-[58px] ${
                            active
                              ? 'bg-purple-600/25 border-purple-400 text-white shadow-sm shadow-purple-900/40'
                              : 'bg-[#0B0616] border-purple-500/20 text-slate-300 hover:border-purple-400/50 hover:text-white'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-bold truncate">{reg.region_name}</span>
                            {active && <Check className="w-4 h-4 text-purple-300 shrink-0" />}
                          </div>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">
                            {reg.region_code || reg.id.toUpperCase()} · {reg.tier}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Guild ID Input */}
              <div className="space-y-2">
                <label htmlFor="guild-id-input" className="text-sm font-semibold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-400" />
                  Free Fire Guild / Clan ID
                </label>
                <input
                  id="guild-id-input"
                  type="text"
                  inputMode="numeric"
                  value={guildIdInput}
                  onChange={(e) => setGuildIdInput(e.target.value.replace(/[^\d]/g, '').slice(0, 18))}
                  placeholder="Enter Your Guild ID"
                  className="w-full px-4 py-3.5 rounded-xl bg-[#090512] border border-purple-500/30 focus:border-purple-400 focus:outline-none text-base font-mono text-white placeholder:text-slate-500 tabular-nums"
                  required
                />
                <p className="text-xs text-slate-400">
                  Numeric Free Fire Guild ID only (e.g., 1234567890). Double-check before launching.
                </p>
              </div>

              {/* Primary Action Buttons: COPY DETAILS & SUBMIT DETAILS */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCopyDetails}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-purple-400/40 bg-[#180E30] hover:bg-purple-900/40 text-sm font-bold text-purple-100 transition-colors whitespace-nowrap"
                >
                  {copiedDetails ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      COPIED TO CLIPBOARD
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-purple-300" />
                      COPY DETAILS
                    </>
                  )}
                </button>

                <button
                  type="submit"
                  disabled={submitting || !selectedRegionId || guildIdInput.length < 5}
                  className="w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-bold text-white transition-colors whitespace-nowrap"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      LAUNCHING...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      SUBMIT DETAILS
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        )}

        {/* PHASE 7 — REAL-STATUS PROCESSING CARD (NO FAKE PERCENTAGES) */}
        {isLaunching && (
          <section className="bg-[#110921] border border-purple-500/35 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-purple-400">Live API Execution</p>
                <h2 className="text-2xl font-extrabold text-white mt-1">
                  YOUR GLORY BOTS ARE LAUNCHING
                </h2>
                <p className="text-sm text-slate-300 mt-1">
                  {order.statusReason || 'Submitting verified guild launch request to FFGlory API.'}
                </p>
              </div>
              <Loader2 className="w-7 h-7 text-purple-400 animate-spin shrink-0 mt-1" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-3.5 px-4 rounded-xl bg-[#0A0514] border border-purple-500/20 text-xs">
              <div>
                <span className="text-slate-400">Order ID</span>
                <p className="font-mono font-bold text-white mt-0.5">{order.id}</p>
              </div>
              <div>
                <span className="text-slate-400">Guild ID</span>
                <p className="font-mono font-bold text-purple-200 mt-0.5">
                  {order.guildConfig?.clanId || guildIdInput || '—'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Region</span>
                <p className="font-semibold text-white mt-0.5">
                  {order.guildConfig?.regionName || selectedRegionObj?.region_name || selectedRegionId.toUpperCase()}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Selected Qty</span>
                <p className="font-semibold text-purple-300 mt-0.5">{order.botQuantity} BOTS</p>
              </div>
            </div>

            {/* Real 5-Stage Status Tracker */}
            <div className="space-y-2.5">
              {PROCESSING_STEPS.map((step, idx) => {
                const idxNum = idx + 1;
                const isDone = idxNum < stageNum;
                const isActive = idxNum === stageNum;
                return (
                  <div
                    key={step.key}
                    className={`flex items-center justify-between px-4 py-3 rounded-xl border ${
                      isDone
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
                        : isActive
                        ? 'bg-purple-950/40 border-purple-400/50 text-white'
                        : 'bg-[#0A0514] border-purple-500/15 text-slate-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : isActive ? (
                        <Loader2 className="w-4 h-4 text-purple-400 animate-spin shrink-0" />
                      ) : (
                        <span className="w-4 h-4 rounded-full border border-slate-600 inline-block shrink-0" />
                      )}
                      <span className="text-sm font-semibold">{step.label}</span>
                    </div>
                    <span className="text-xs font-mono">
                      {isDone ? 'Done' : isActive ? 'Active' : 'Pending'}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* PHASE 8 — SUCCESS CARD & LIVE GLORY MONITOR */}
        {isDelivered && order.delivery && (
          <div className="space-y-6">
            <section className="bg-[#110921] border border-emerald-500/35 rounded-2xl p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-emerald-400">
                    {order.mode === 'TEST' ? 'Test Mode Verified Launch' : 'FFGlory Launch Confirmed'}
                  </p>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-white mt-1 tracking-tight">
                    GLORY BOTS SUCCESSFULLY LAUNCHED!
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!order.delivery?.groupId) return;
                    await navigator.clipboard.writeText(order.delivery.groupId).catch(() => {});
                    setCopiedGroupId(true);
                    window.setTimeout(() => setCopiedGroupId(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-purple-500/30 bg-[#190F33] hover:bg-purple-900/40 text-xs font-semibold text-purple-100 whitespace-nowrap"
                >
                  {copiedGroupId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedGroupId ? 'Copied Group ID' : 'Copy Group ID'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2 border-t border-purple-500/20">
                <div>
                  <p className="text-xs text-slate-400">Order ID</p>
                  <p className="text-base font-mono font-bold text-white mt-1 tabular-nums">{order.id}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Group ID</p>
                  <p className="text-base font-mono font-bold text-purple-300 mt-1 break-all">
                    {order.delivery.groupId}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Guild / Clan ID</p>
                  <p className="text-base font-mono font-bold text-white mt-1 tabular-nums">
                    {order.delivery.clanId || order.guildConfig?.clanId || '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Region</p>
                  <p className="text-base font-semibold text-white mt-1">
                    {order.guildConfig?.regionName || (order.delivery.region || '').toUpperCase()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Actual Bot Count (API)</p>
                  <p className="text-base font-mono font-bold text-emerald-300 mt-1 tabular-nums">
                    {order.delivery.botCount ?? '—'} Bots
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Launch Time</p>
                  <p className="text-sm font-mono text-slate-200 mt-1 tabular-nums">
                    {order.delivery.completedAt
                      ? new Date(order.delivery.completedAt).toLocaleString()
                      : '—'}
                  </p>
                </div>
              </div>
            </section>

            {/* LIVE GLORY DATA CARD */}
            <section className="bg-[#110921] border border-purple-500/30 rounded-2xl p-6 sm:p-8 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-purple-400">FFGlory Real-Time Telemetry</p>
                  <h3 className="text-xl font-extrabold text-white mt-0.5 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-purple-400" />
                    Live Glory &amp; Clan Monitor
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={handleRefreshLiveGlory}
                  disabled={refreshingGlory || gloryCooldown > 0}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-bold text-white transition-colors whitespace-nowrap"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${refreshingGlory ? 'animate-spin' : ''}`} />
                  {refreshingGlory
                    ? 'Refreshing...'
                    : gloryCooldown > 0
                    ? `Wait ${gloryCooldown}s`
                    : 'Refresh Live Glory'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-5 rounded-xl bg-[#180E33] border border-purple-500/35">
                  <p className="text-xs text-purple-300 font-semibold">Current Glory</p>
                  <p className="text-3xl font-mono font-extrabold text-white mt-2 tabular-nums">
                    {order.liveGlory?.currentGlory !== undefined
                      ? String(order.liveGlory.currentGlory)
                      : '—'}
                  </p>
                </div>

                <div className="p-5 rounded-xl bg-[#0D071B] border border-purple-500/20 space-y-2">
                  <div>
                    <p className="text-xs text-slate-400">Clan Name</p>
                    <p className="text-base font-bold text-white mt-0.5 truncate">
                      {order.liveGlory?.clanName || 'Awaiting Clan Info'}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-300 pt-1">
                    <span>Level: <strong className="font-mono text-white">{order.liveGlory?.clanLevel ?? '—'}</strong></span>
                    {order.liveGlory?.memberCount !== undefined && (
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-purple-400" />
                        <strong className="font-mono text-white">{order.liveGlory.memberCount}</strong>
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#0D071B] border border-purple-500/20 space-y-2">
                  <div>
                    <p className="text-xs text-slate-400">Group Status</p>
                    <p className="text-base font-bold text-emerald-400 mt-0.5 uppercase">
                      {order.liveGlory?.groupStatus || 'Running'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-slate-400 pt-1 font-mono tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                    <span>
                      {order.liveGlory?.lastUpdatedAt
                        ? new Date(order.liveGlory.lastUpdatedAt).toLocaleTimeString()
                        : 'Just launched'}
                    </span>
                  </div>
                </div>
              </div>

              {order.liveGlory?.errors && order.liveGlory.errors.length > 0 && (
                <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-500/25 rounded-lg px-3.5 py-2.5">
                  {order.liveGlory.errors.join(' · ')}
                </p>
              )}
            </section>
          </div>
        )}

        {/* Pending Payment Notice if customer opens link before payment verification */}
        {!isReadyToConfigure && !isLaunching && !isDelivered && (
          <section className="bg-[#110921] border border-amber-500/30 rounded-2xl p-6 text-center space-y-2">
            <h2 className="text-lg font-bold text-white">Payment Verification Pending</h2>
            <p className="text-sm text-slate-300">
              {order.statusReason || 'Please complete your bank payment and upload your payment receipt in WhatsApp first.'}
            </p>
          </section>
        )}

        <footer className="text-center text-xs text-slate-500 pt-2">
          YASHI HALLS Automated Guild Order &amp; Live Glory Platform
        </footer>
      </div>
    </div>
  );
};
