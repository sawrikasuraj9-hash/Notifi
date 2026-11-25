import React, { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../firebase';
import {
  Download,
  Smartphone,
  KeyRound,
  Copy,
  Check,
  RefreshCw,
  Eye,
  EyeOff,
  Save,
  Send,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  BatteryCharging,
  Radio,
  Wifi,
  Globe,
  ShieldAlert,
} from 'lucide-react';
import { soundFX } from '../utils/sound';
import { downloadPayApkViaBlob, sendPayApkToWhatsApp } from '../utils/apkDownload';

interface PayDevice {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  batteryLevel?: number;
  simOperator?: string;
  lastConnectNotifiedAt?: string;
  lastSeenAt: string;
}

interface PayEvent {
  id: string;
  source: 'sms' | 'notification' | 'test';
  bank: string;
  amountLkr: number;
  balanceLkr?: number | null;
  reference: string;
  sender: string;
  rawMessage: string;
  status: 'matched' | 'unmatched' | 'ignored';
  matchedOrderId?: string;
  matchedCustomer?: string;
  deviceName?: string;
  timestamp: string;
}

interface PayOrder {
  id: string;
  customerJid: string;
  customerNumber: string;
  productId: string;
  productName: string;
  packageDays?: string;
  priceDisplay: string;
  amountLkr: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  matchedRef?: string;
  matchedBank?: string;
  createdAt: string;
  paidAt?: string;
}

interface PayStatusPayload {
  tenantId: string;
  linkKey?: string;
  serverOrigin?: string;
  tunnel?: {
    active: boolean;
    url: string | null;
    status: 'disabled' | 'starting' | 'connected' | 'error';
    error?: string;
    startedAt?: string;
  };
  config: {
    enabled: boolean;
    webhookSecret: string;
    autoMatchOrders: boolean;
    notifyOwnerOnPayment: boolean;
    notifyCustomerOnMatch: boolean;
    bankDetailsText: string;
    minAmountLkr: number;
    lkrPerUsdRate: number;
  };
  devices: PayDevice[];
  events: PayEvent[];
  orders: PayOrder[];
  apk: {
    available: boolean;
    filename: string;
    version: string;
    packageName: string;
    sizeBytes: number;
    sha256: string;
  };
  stats: {
    totalPaidLkr: number;
    matchedCount: number;
    pendingOrdersCount: number;
    activeDevicesCount: number;
  };
}

interface BusinessPayPanelProps {
  businessBotUserId: string;
  onToast: (message: string, type?: 'success' | 'info' | 'error') => void;
}

function formatBytesLabel(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const BusinessPayPanel: React.FC<BusinessPayPanelProps> = ({
  businessBotUserId,
  onToast,
}) => {
  const [data, setData] = useState<PayStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSecret, setShowSecret] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<'events' | 'orders'>('events');

  // Editable config fields
  const [enabled, setEnabled] = useState(true);
  const [autoMatchOrders, setAutoMatchOrders] = useState(true);
  const [notifyOwnerOnPayment, setNotifyOwnerOnPayment] = useState(true);
  const [notifyCustomerOnMatch, setNotifyCustomerOnMatch] = useState(true);
  const [bankDetailsText, setBankDetailsText] = useState('');
  const [minAmountLkr, setMinAmountLkr] = useState('10');
  const [lkrPerUsdRate, setLkrPerUsdRate] = useState('300');
  const [testAmount, setTestAmount] = useState('1500');
  const [configSynced, setConfigSynced] = useState(false);
  const [waTargetPhone, setWaTargetPhone] = useState('');
  const [isSendingWaApk, setIsSendingWaApk] = useState(false);
  const [isDownloadingApk, setIsDownloadingApk] = useState(false);
  const [isTestingConnect, setIsTestingConnect] = useState(false);

  const handleTestConnectAlert = async () => {
    if (isTestingConnect) return;
    soundFX.playClick();
    setIsTestingConnect(true);
    try {
      const res = await authFetch('/api/business/pay/test-connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': businessBotUserId,
        },
        body: JSON.stringify({ userId: businessBotUserId }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'Owner WhatsApp connect alert sent!', 'success');
      } else {
        onToast(json.message || 'Failed to send Owner WhatsApp connect alert.', 'error');
      }
    } catch {
      onToast('Network error sending Owner WhatsApp connect alert.', 'error');
    } finally {
      setIsTestingConnect(false);
    }
  };

  const handleSendWaApk = async () => {
    if (isSendingWaApk) return;
    soundFX.playClick();
    setIsSendingWaApk(true);
    try {
      const result = await sendPayApkToWhatsApp(businessBotUserId, waTargetPhone);
      if (result.success) {
        soundFX.playSuccess();
        onToast(result.message, 'success');
      } else {
        onToast(result.message, 'error');
      }
    } catch {
      onToast('WhatsApp වෙත APK එක යැවීමේදී දෝෂයක් ඇති විය.', 'error');
    } finally {
      setIsSendingWaApk(false);
    }
  };

  const handleBlobDownloadApk = async () => {
    if (isDownloadingApk) return;
    soundFX.playClick();
    setIsDownloadingApk(true);
    try {
      await downloadPayApkViaBlob();
      soundFX.playSuccess();
      onToast('YashiHallsPay-v1.0.0.apk ඩවුන්ලෝඩ් විය — Tap කර Install කරන්න!', 'success');
    } catch (err: any) {
      onToast(err?.message || 'Browser Download අවහිර විය. Send APK to My WhatsApp භාවිතා කරන්න.', 'error');
    } finally {
      setIsDownloadingApk(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const activeOrigin = data?.serverOrigin || origin;
  const webhookUrl = `${activeOrigin}/api/business/pay/webhook`;

  const fetchPayStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/business/pay/status', {
        headers: { 'x-user-id': businessBotUserId },
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          const payload: PayStatusPayload = json.data;
          setData(payload);
          if (!configSynced && payload.config) {
            setConfigSynced(true);
            setEnabled(payload.config.enabled);
            setAutoMatchOrders(payload.config.autoMatchOrders);
            setNotifyOwnerOnPayment(payload.config.notifyOwnerOnPayment);
            setNotifyCustomerOnMatch(payload.config.notifyCustomerOnMatch);
            setBankDetailsText(payload.config.bankDetailsText || '');
            setMinAmountLkr(String(payload.config.minAmountLkr ?? 10));
            setLkrPerUsdRate(String(payload.config.lkrPerUsdRate ?? 300));
          }
        }
      }
    } catch {
      // ignore transient poll errors
    } finally {
      setLoading(false);
    }
  }, [businessBotUserId, configSynced]);

  useEffect(() => {
    fetchPayStatus();
    const timer = setInterval(fetchPayStatus, 4000);
    return () => clearInterval(timer);
  }, [fetchPayStatus]);

  const copyText = (fieldKey: string, value: string, label: string) => {
    if (!value) return;
    soundFX.playClick();
    navigator.clipboard.writeText(value);
    setCopiedField(fieldKey);
    onToast(`${label} copied!`, 'success');
    setTimeout(() => {
      setCopiedField((prev) => (prev === fieldKey ? null : prev));
    }, 2200);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setIsSaving(true);
    try {
      const res = await authFetch('/api/business/pay/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': businessBotUserId,
        },
        body: JSON.stringify({
          userId: businessBotUserId,
          enabled,
          autoMatchOrders,
          notifyOwnerOnPayment,
          notifyCustomerOnMatch,
          bankDetailsText,
          minAmountLkr: Number(minAmountLkr) || 0,
          lkrPerUsdRate: Number(lkrPerUsdRate) || 300,
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast('YASHI HALLS Pay settings saved!', 'success');
        await fetchPayStatus();
      } else {
        onToast(json.message || 'Failed to save Pay settings', 'error');
      }
    } catch {
      onToast('Network error saving Pay settings', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRotateSecret = async () => {
    soundFX.playClick();
    setIsRotating(true);
    try {
      const res = await authFetch('/api/business/pay/rotate-secret', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': businessBotUserId,
        },
        body: JSON.stringify({ userId: businessBotUserId }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        setConfirmRotate(false);
        setShowSecret(true);
        onToast('New Pay Secret Key generated. Update your Android app with the new key.', 'info');
        await fetchPayStatus();
      } else {
        onToast(json.message || 'Failed to rotate secret key', 'error');
      }
    } catch {
      onToast('Failed to rotate secret key', 'error');
    } finally {
      setIsRotating(false);
    }
  };

  const handleSendTestAlert = async () => {
    soundFX.playClick();
    setIsTesting(true);
    try {
      const amt = Number(testAmount) > 0 ? Number(testAmount) : 1500;
      const res = await authFetch('/api/business/pay/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': businessBotUserId,
        },
        body: JSON.stringify({
          userId: businessBotUserId,
          amountLkr: amt,
          bank: 'Commercial Bank',
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        const matched = json.data?.matchedOrder?.id;
        onToast(
          matched
            ? `Test LKR ${amt} matched Order ${matched} & notified on WhatsApp!`
            : `Test LKR ${amt} payment logged and sent to Business Bot.`,
          'success'
        );
        await fetchPayStatus();
      } else {
        onToast(json.message || 'Test alert failed', 'error');
      }
    } catch {
      onToast('Failed to send test alert', 'error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleOrderStatusChange = async (orderId: string, status: PayOrder['status']) => {
    soundFX.playClick();
    try {
      const res = await authFetch(`/api/business/pay/orders/${encodeURIComponent(orderId)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': businessBotUserId,
        },
        body: JSON.stringify({ userId: businessBotUserId, status }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(`Order ${orderId} marked as ${status.toUpperCase()}`, 'success');
        await fetchPayStatus();
      } else {
        onToast(json.message || 'Failed to update order', 'error');
      }
    } catch {
      onToast('Failed to update order', 'error');
    }
  };

  const secretKey = data?.config?.webhookSecret || '';
  const maskedSecret = secretKey
    ? `${secretKey.slice(0, 8)}••••••••••••••••${secretKey.slice(-6)}`
    : 'Loading...';

  const activeDevices = (data?.devices || []).filter(
    (d) => Date.now() - new Date(d.lastSeenAt).getTime() < 1000 * 60 * 15
  );
  const latestDevice = activeDevices[0] || (data?.devices && data.devices[0]) || null;
  const isAppConnected = activeDevices.length > 0;
  const hasPairedHistory = (data?.devices?.length || 0) > 0;

  return (
    <div className="space-y-5">
      {/* 0. LIVE ANDROID APP <-> BUSINESS BOT CONNECTION BANNER */}
      <div
        className={`rounded-3xl p-4 sm:p-5 border transition-colors ${
          isAppConnected
            ? 'bg-emerald-950/35 border-emerald-500/55'
            : hasPairedHistory
            ? 'bg-amber-950/25 border-amber-500/45'
            : 'bg-[#0b1324] border-cyan-500/35'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
                isAppConnected
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-cyan-500/15 border-cyan-400/40 text-cyan-300'
              }`}
            >
              {isAppConnected ? (
                <Wifi className="w-5 h-5" />
              ) : (
                <Radio className="w-5 h-5" />
              )}
            </div>
            <div className="space-y-1 min-w-0">
              <div className="flex items-center flex-wrap gap-2">
                <span
                  className={`inline-block w-2.5 h-2.5 rounded-full ${
                    isAppConnected
                      ? 'bg-emerald-400 animate-pulse'
                      : hasPairedHistory
                      ? 'bg-amber-400'
                      : 'bg-cyan-400 animate-pulse'
                  }`}
                />
                <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
                  {isAppConnected
                    ? 'YASHI HALLS Pay App සම්බන්ධයි (CONNECTED)'
                    : hasPairedHistory
                    ? 'Android App එක අවසන් වරට සම්බන්ධ වී ඇත (IDLE)'
                    : 'Android App සම්බන්ධතාවය බලාපොරොත්තුවෙන් (WAITING FOR APP)'}
                </h2>
              </div>

              {latestDevice ? (
                <div className="text-xs text-slate-300 flex items-center flex-wrap gap-x-2.5 gap-y-1">
                  <span className="font-bold text-emerald-300">{latestDevice.deviceName}</span>
                  <span className="text-slate-500">·</span>
                  <span className="font-mono text-slate-300">v{latestDevice.appVersion}</span>
                  {latestDevice.simOperator && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span>{latestDevice.simOperator}</span>
                    </>
                  )}
                  {typeof latestDevice.batteryLevel === 'number' && (
                    <>
                      <span className="text-slate-500">·</span>
                      <span className="font-mono text-amber-300">{latestDevice.batteryLevel}% Battery</span>
                    </>
                  )}
                  <span className="text-slate-500">·</span>
                  <span className="font-mono text-slate-400">
                    Last sync: {new Date(latestDevice.lastSeenAt).toLocaleTimeString()}
                  </span>
                  {latestDevice.lastConnectNotifiedAt && (
                    <span className="text-emerald-300 font-semibold">
                      · ✓ Owner WhatsApp Notified
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-300 leading-relaxed">
                  පහත <span className="font-mono text-amber-300 font-bold">YHP...</span> Link Key එක Copy කර Android App එකේ <span className="font-semibold text-white">Link to your bot</span> තැන Paste කරන්න. සම්බන්ධ වූ වහාම මෙහි <span className="text-emerald-300 font-bold">CONNECTED</span> ලෙස පෙන්වා Bot Owner වෙත WhatsApp පණිවිඩයක් යවයි.
                </p>
              )}

              {/* Preview Direct Bridge Indicator */}
              {data?.tunnel && data.tunnel.status !== 'disabled' && (
                <div className="pt-1 flex items-center flex-wrap gap-2 text-[11px] font-mono">
                  <Globe
                    className={`w-3.5 h-3.5 shrink-0 ${
                      data.tunnel.active ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  />
                  {data.tunnel.active && data.tunnel.url ? (
                    <span className="text-emerald-300">
                      Preview Direct Bridge Active: <span className="text-white">{data.tunnel.url}</span>
                    </span>
                  ) : data.tunnel.status === 'starting' ? (
                    <span className="text-amber-300">
                      Preview Direct Bridge ආරම්භ වෙමින් පවතී... (තත්පර කිහිපයක් රැඳී සිටින්න)
                    </span>
                  ) : (
                    <span className="text-rose-300">
                      Preview Bridge Notice: {data.tunnel.error || 'Retrying...'}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestConnectAlert}
              disabled={isTestingConnect}
              className="px-3.5 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-400/50 text-xs font-bold text-emerald-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isTestingConnect ? 'Sending...' : 'Test Owner WA Alert'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 1. Download & Install YASHI HALLS Pay Android App */}
      <div className="rounded-3xl bg-[#0e1525] border border-amber-500/40 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Smartphone className="w-6 h-6 text-amber-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-black text-white tracking-tight">
                YASHI HALLS Pay Android App
              </h2>
              <div className="flex items-center flex-wrap gap-2 text-xs text-slate-400 font-mono tabular-nums">
                <span>{data?.apk?.packageName || 'com.yashihalls.pay'}</span>
                <span aria-hidden="true">·</span>
                <span>v{data?.apk?.version || '2.0.0'}</span>
                <span aria-hidden="true">·</span>
                <span>{formatBytesLabel(data?.apk?.sizeBytes || 0)}</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed pt-0.5">
                ඔබගේ Android දුරකථනයට ලැබෙන Bank / eZ Cash / FriMi SMS සහ Notification ස්වයංක්‍රීයව කියවා Business Bot වෙත එවන නිල App එක.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleBlobDownloadApk}
            disabled={isDownloadingApk}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>{isDownloadingApk ? 'Downloading...' : 'Download APK File'}</span>
          </button>
        </div>

        {/* 100% Reliable WhatsApp APK Delivery Bar */}
        <div className="p-3.5 rounded-2xl bg-[#08121b] border border-emerald-500/40 space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs text-emerald-300 font-bold">
              Business Bot එකෙන්ම APK සහ Key ලබාගන්න (Business Bot Only)
            </div>
            <div className="flex items-center gap-3 text-[11px] font-mono text-slate-300">
              <span>APK: <span className="text-emerald-300 font-bold">.payapk</span></span>
              <span>Key: <span className="text-amber-300 font-bold">.paykey</span></span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              value={waTargetPhone}
              onChange={(e) => setWaTargetPhone(e.target.value)}
              placeholder="WhatsApp අංකය (උදා: 0740712934 — හිස්ව තැබුවොත් Business Bot Owner වෙත යවයි)"
              className="flex-1 bg-[#0b1523] border border-[#22354f] rounded-xl px-3 py-2.5 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-emerald-400"
            />
            <button
              type="button"
              onClick={handleSendWaApk}
              disabled={isSendingWaApk}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <Send className="w-4 h-4 stroke-[2.5]" />
              <span>{isSendingWaApk ? 'Sending APK...' : 'Send APK to My WhatsApp'}</span>
            </button>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Business Bot WhatsApp chat එකේ <span className="font-mono text-emerald-300">.payapk</span> යැවූ විට APK එකත්, <span className="font-mono text-amber-300">.paykey</span> (හෝ <span className="font-mono text-amber-300">.payapp key</span>) යැවූ විට App Link Key එකත් කෙලින්ම එවනු ලැබේ!
          </p>
        </div>

        {/* 3-Step Install Guide */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-[#1e293b] text-xs">
          <div className="p-3 rounded-2xl bg-[#090f1d] border border-[#1b273b] space-y-1">
            <div className="font-bold text-amber-300">01. Get APK via .payapk</div>
            <p className="text-slate-400 leading-relaxed">
              Business Bot එකට <span className="text-emerald-300 font-mono">.payapk</span> යවා (හෝ ඉහත බටනය ඔබා) එන <span className="text-slate-200 font-mono">YashiHallsPay.apk</span> Install කරන්න.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[#090f1d] border border-[#1b273b] space-y-1">
            <div className="font-bold text-cyan-300">02. Link Key via .paykey</div>
            <p className="text-slate-400 leading-relaxed">
              Business Bot එකට <span className="text-amber-300 font-mono">.paykey</span> යවා එන <span className="text-slate-200 font-mono">YHP...</span> key එක App එකේ <span className="text-slate-200">Link to your bot</span> තැන Paste කර Link ඔබන්න.
            </p>
          </div>
          <div className="p-3 rounded-2xl bg-[#090f1d] border border-[#1b273b] space-y-1">
            <div className="font-bold text-emerald-300">03. Add Rules &amp; Allow</div>
            <p className="text-slate-400 leading-relaxed">
              App එකේ <span className="text-slate-200">Rules</span> ටැබ් එකෙන් Bank/eZ Cash rules Add කර Setup අවසර ලබා දෙන්න.
            </p>
          </div>
        </div>

        {/* Android 13/14/15 Notification Permission Restricted Settings Fix Guide */}
        <div className="p-3.5 rounded-2xl bg-rose-950/25 border border-rose-500/40 space-y-2 text-xs">
          <div className="flex items-center gap-2 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              &quot;Allow notification access&quot; Switch එක ON කරන්න බැරිද? (Android 13/14/15 Restricted Settings Fix)
            </span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            Play Store එකෙන් පිටත Install කරන Apps සඳහා Android ආරක්ෂක පද්ධතිය Notification Access අවහිර කරයි. එය සක්‍රීය කිරීමට පහත පියවර 4 අනුගමනය කරන්න:
          </p>
          <ol className="list-decimal list-inside space-y-1 text-slate-200 leading-relaxed pl-1">
            <li>
              දුරකථනයේ <span className="font-bold text-white">Settings &rarr; Apps &rarr; See all apps &rarr; YASHI HALLS Pay</span> වෙත යන්න (හෝ App Icon එක තදින් ඔබාගෙන <span className="font-bold text-white">App info</span> ඔබන්න).
            </li>
            <li>
              ඉහළ දකුණු කෙළවරේ ඇති <span className="font-bold text-amber-300">තිත් 3 (⋮)</span> මෙනුව ඔබන්න.
            </li>
            <li>
              එහි ඇති <span className="font-bold text-emerald-300">&quot;Allow restricted settings&quot;</span> තෝරා ඔබේ Phone PIN / Fingerprint ලබා දෙන්න.
            </li>
            <li>
              දැන් නැවත <span className="font-bold text-white">YASHI HALLS Pay App</span> එක විවෘත කර <span className="font-bold text-cyan-300">Allow notification access</span> Switch එක ON කරන්න!
            </li>
          </ol>
        </div>
      </div>

      {/* 2. Summary Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-[#0d1424] border border-[#1d2b44]">
          <div className="text-[11px] text-slate-400 font-semibold">Total Synced LKR</div>
          <div className="text-lg font-black text-emerald-400 font-mono tabular-nums mt-0.5">
            Rs. {(data?.stats?.totalPaidLkr || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-[#0d1424] border border-[#1d2b44]">
          <div className="text-[11px] text-slate-400 font-semibold">Auto-Matched Orders</div>
          <div className="text-lg font-black text-cyan-300 font-mono tabular-nums mt-0.5">
            {data?.stats?.matchedCount || 0}
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-[#0d1424] border border-[#1d2b44]">
          <div className="text-[11px] text-slate-400 font-semibold">Pending Orders</div>
          <div className="text-lg font-black text-amber-300 font-mono tabular-nums mt-0.5">
            {data?.stats?.pendingOrdersCount || 0}
          </div>
        </div>
        <div className="p-3.5 rounded-2xl bg-[#0d1424] border border-[#1d2b44]">
          <div className="text-[11px] text-slate-400 font-semibold">Connected Phones</div>
          <div className="text-lg font-black text-white font-mono tabular-nums mt-0.5">
            {data?.stats?.activeDevicesCount || 0} Active
          </div>
        </div>
      </div>

      {/* 3. Bot <-> App API Connection Credentials */}
      <div className="rounded-3xl bg-[#0d1424] border border-cyan-500/30 p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#1c2940]">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">
              App &harr; Business Bot API Credentials
            </h3>
          </div>
          <span className="text-[11px] font-mono text-cyan-300">Bearer Auth</span>
        </div>

        <div className="space-y-3">
          {/* 1-Paste Bot Link Key (YHP....) */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-amber-300">
              One-Tap Bot Connect Key (.paykey මඟින් WhatsApp වෙතද ගෙන්වා ගත හැක)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={showSecret ? (data?.linkKey || secretKey) : (data?.linkKey ? `${data.linkKey.slice(0, 12)}••••••••••••••••${data.linkKey.slice(-6)}` : maskedSecret)}
                className="flex-1 bg-[#080d18] border border-amber-500/45 rounded-xl px-3 py-2.5 text-xs font-mono text-amber-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => copyText('linkKey', data?.linkKey || secretKey, 'Bot Connect Key')}
                disabled={!(data?.linkKey || secretKey)}
                className="px-3.5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-xs font-black text-slate-950 flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {copiedField === 'linkKey' ? <Check className="w-3.5 h-3.5 text-slate-950" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'linkKey' ? 'Copied' : 'Copy Link Key'}</span>
              </button>
            </div>
          </div>

          {/* Server URL (Advanced Reference) */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">
              Business Bot Server URL {data?.tunnel?.active ? '(Live Preview Direct Bridge)' : ''}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={activeOrigin}
                className="flex-1 bg-[#080d18] border border-[#22314d] rounded-xl px-3 py-2.5 text-xs font-mono text-cyan-300 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => copyText('origin', activeOrigin, 'Server URL')}
                className="px-3.5 py-2.5 rounded-xl bg-[#16233a] hover:bg-[#1f3152] border border-[#2a3f66] text-xs font-bold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                {copiedField === 'origin' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'origin' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          {/* Pay Secret Key */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">
              2. Bot Pay Secret Key (App එකේ &quot;Pay Secret Key&quot; තැනට දමන්න)
            </label>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="flex-1 min-w-[200px] relative">
                <input
                  type="text"
                  readOnly
                  value={showSecret ? secretKey : maskedSecret}
                  className="w-full bg-[#080d18] border border-amber-500/40 rounded-xl px-3 py-2.5 pr-10 text-xs font-mono text-amber-300 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  aria-label="Toggle secret visibility"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-1 cursor-pointer"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="button"
                onClick={() => copyText('secret', secretKey, 'Pay Secret Key')}
                disabled={!secretKey}
                className="px-3.5 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/50 text-xs font-bold text-amber-200 flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {copiedField === 'secret' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedField === 'secret' ? 'Copied' : 'Copy Key'}</span>
              </button>

              {confirmRotate ? (
                <button
                  type="button"
                  onClick={handleRotateSecret}
                  disabled={isRotating}
                  className="px-3.5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRotating ? 'animate-spin' : ''}`} />
                  <span>Confirm Rotate</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmRotate(true);
                    setTimeout(() => setConfirmRotate(false), 4000);
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-[#16233a] hover:bg-[#1f3152] border border-[#2a3f66] text-xs font-semibold text-slate-300 flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rotate</span>
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
            <span>Webhook Endpoint: <span className="font-mono text-slate-300">{webhookUrl}</span></span>
          </div>
        </div>

        {/* Connected Devices List */}
        <div className="pt-3 border-t border-[#1c2940] space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-emerald-400" />
              <span>Paired Android Devices ({data?.devices?.length || 0})</span>
            </div>
            <button
              type="button"
              onClick={handleTestConnectAlert}
              disabled={isTestingConnect}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-[11px] font-bold text-emerald-300 flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <Send className="w-3 h-3" />
              <span>{isTestingConnect ? 'Sending...' : 'Test Owner WA Connect Alert'}</span>
            </button>
          </div>
          {!data?.devices || data.devices.length === 0 ? (
            <div className="p-3 rounded-xl bg-[#080d18] border border-[#1b273b] text-xs text-slate-400">
              තවම Android දුරකථනයක් සම්බන්ධ කර නැත. APK එක Install කර ඉහත <span className="font-mono text-amber-300">YHP...</span> Link Key එක Paste කර &quot;Link&quot; ඔබන්න — සම්බන්ධ වූ වහාම Bot Owner වෙත WhatsApp පණිවිඩයක් ලැබේ!
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {data.devices.map((dev) => {
                const isRecent = Date.now() - new Date(dev.lastSeenAt).getTime() < 1000 * 60 * 15;
                return (
                  <div
                    key={dev.deviceId}
                    className="p-3 rounded-xl bg-[#080d18] border border-[#1f2e48] flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-white truncate">{dev.deviceName}</div>
                      <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                        v{dev.appVersion}{dev.simOperator ? ` · ${dev.simOperator}` : ''}
                      </div>
                      {dev.lastConnectNotifiedAt && (
                        <div className="text-[10px] text-emerald-400/90 mt-0.5">
                          ✓ Owner WA notified
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0 space-y-0.5 font-mono tabular-nums">
                      <div className={`text-[11px] font-bold ${isRecent ? 'text-emerald-400' : 'text-slate-400'}`}>
                        {isRecent ? 'ONLINE' : 'IDLE'}
                      </div>
                      {typeof dev.batteryLevel === 'number' && (
                        <div className="text-[10px] text-slate-400 flex items-center justify-end gap-1">
                          <BatteryCharging className="w-3 h-3 text-amber-400" />
                          <span>{dev.batteryLevel}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 4. Gateway Settings & Quick Simulator */}
      <form
        onSubmit={handleSaveConfig}
        className="rounded-3xl bg-[#0d1424] border border-[#1d2b44] p-5 space-y-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-[#1c2940]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Auto-Verification &amp; WhatsApp Alerts</h3>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
          {[
            { label: 'Enable YASHI HALLS Pay Gateway', val: enabled, set: setEnabled },
            { label: 'Auto-Match Pending Customer Orders', val: autoMatchOrders, set: setAutoMatchOrders },
            { label: 'Send Owner Alert on WhatsApp', val: notifyOwnerOnPayment, set: setNotifyOwnerOnPayment },
            { label: 'Send Auto-Receipt to Customer', val: notifyCustomerOnMatch, set: setNotifyCustomerOnMatch },
          ].map((item) => (
            <label
              key={item.label}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-[#080d18] border border-[#1c2940] cursor-pointer"
            >
              <span className="text-slate-200 font-semibold">{item.label}</span>
              <input
                type="checkbox"
                checked={item.val}
                onChange={(e) => item.set(e.target.checked)}
                className="w-4 h-4 accent-amber-400 cursor-pointer"
              />
            </label>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-3 space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">
              Bank / Wallet Details Shown in Business Bot Order Cards
            </label>
            <textarea
              rows={2}
              value={bankDetailsText}
              onChange={(e) => setBankDetailsText(e.target.value)}
              placeholder="e.g. Commercial Bank: 8001234567 • eZ Cash: 0740712934"
              className="w-full bg-[#080d18] border border-[#22314d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">Min Alert (LKR)</label>
            <input
              type="number"
              min={0}
              value={minAmountLkr}
              onChange={(e) => setMinAmountLkr(e.target.value)}
              className="w-full bg-[#080d18] border border-[#22314d] rounded-xl px-3 py-2 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-slate-400">USD &rarr; LKR Rate</label>
            <input
              type="number"
              min={1}
              value={lkrPerUsdRate}
              onChange={(e) => setLkrPerUsdRate(e.target.value)}
              className="w-full bg-[#080d18] border border-[#22314d] rounded-xl px-3 py-2 text-xs font-mono tabular-nums text-white focus:outline-none focus:border-cyan-400"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Settings'}</span>
            </button>
          </div>
        </div>

        {/* Test Webhook Pipeline */}
        <div className="pt-3 border-t border-[#1c2940] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-xs text-slate-400 whitespace-nowrap">Test LKR:</span>
            <input
              type="number"
              min={1}
              value={testAmount}
              onChange={(e) => setTestAmount(e.target.value)}
              className="w-28 bg-[#080d18] border border-[#22314d] rounded-xl px-3 py-2 text-xs font-mono tabular-nums text-emerald-300 focus:outline-none"
            />
            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Simulate Commercial Bank credit SMS
            </span>
          </div>
          <button
            type="button"
            onClick={handleSendTestAlert}
            disabled={isTesting}
            className="px-4 py-2 rounded-xl bg-[#16233a] hover:bg-[#1f3152] border border-cyan-500/40 text-cyan-300 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{isTesting ? 'Sending...' : 'Send Test Payment Alert'}</span>
          </button>
        </div>
      </form>

      {/* 5. Live Payment Feed & Tracked Orders */}
      <div className="rounded-3xl bg-[#0d1424] border border-[#1d2b44] p-5 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-[#080d18] border border-[#1c2940]">
            <button
              type="button"
              onClick={() => setLedgerTab('events')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                ledgerTab === 'events'
                  ? 'bg-cyan-500/20 text-cyan-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Bank Payment Feed ({data?.events?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => setLedgerTab('orders')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                ledgerTab === 'orders'
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Customer Orders ({data?.orders?.length || 0})
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="py-8 text-center text-xs text-slate-400">Loading payment records...</div>
        ) : ledgerTab === 'events' ? (
          !data?.events || data.events.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400">
              No incoming bank or wallet payment alerts yet. Install the APK or send a Test Alert above.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {data.events.map((ev) => (
                <div
                  key={ev.id}
                  className="p-3 rounded-2xl bg-[#080d18] border border-[#1b273b] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white">{ev.bank}</span>
                      <span aria-hidden="true" className="text-slate-600">&middot;</span>
                      <span className="font-mono text-slate-400 uppercase">{ev.source}</span>
                      <span aria-hidden="true" className="text-slate-600">&middot;</span>
                      <span className="font-mono text-slate-400">Ref: {ev.reference}</span>
                      {ev.matchedOrderId && (
                        <>
                          <span aria-hidden="true" className="text-slate-600">&middot;</span>
                          <span className="font-mono font-bold text-emerald-400">
                            Matched {ev.matchedOrderId}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{ev.rawMessage}</div>
                  </div>
                  <div className="text-left sm:text-right shrink-0 font-mono tabular-nums">
                    <div className="text-sm font-black text-emerald-400">
                      LKR {Number(ev.amountLkr || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : !data?.orders || data.orders.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-400">
            When customers click Buy in your Business Bot, tracked orders appear here automatically for matching.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {data.orders.map((ord) => (
              <div
                key={ord.id}
                className="p-3 rounded-2xl bg-[#080d18] border border-[#1b273b] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-amber-300">{ord.id}</span>
                    <span aria-hidden="true" className="text-slate-600">&middot;</span>
                    <span className="font-bold text-white truncate">{ord.productName}</span>
                    {ord.packageDays && (
                      <>
                        <span aria-hidden="true" className="text-slate-600">&middot;</span>
                        <span className="text-slate-300">{ord.packageDays}</span>
                      </>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                    +{ord.customerNumber} &middot; {ord.priceDisplay} (LKR {ord.amountLkr.toLocaleString()})
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`text-[11px] font-mono font-bold uppercase ${
                      ord.status === 'paid'
                        ? 'text-emerald-400'
                        : ord.status === 'cancelled'
                        ? 'text-rose-400'
                        : 'text-amber-300'
                    }`}
                  >
                    {ord.status === 'paid' ? 'PAID' : ord.status === 'cancelled' ? 'CANCELLED' : 'PENDING'}
                  </span>
                  {ord.status === 'pending_payment' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleOrderStatusChange(ord.id, 'paid')}
                        className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Mark Paid</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOrderStatusChange(ord.id, 'cancelled')}
                        className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/35 text-rose-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        title="Cancel Order"
                      >
                        <XCircle className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
