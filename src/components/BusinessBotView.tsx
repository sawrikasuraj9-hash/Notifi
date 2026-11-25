import React, { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../firebase';
import {
  ArrowLeft,
  Briefcase,
  Link as LinkIcon,
  QrCode,
  Phone,
  ShieldCheck,
  Copy,
  Check,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  Trash2,
  Radio,
  Sliders,
  Terminal,
  Play,
  Square,
  Save,
  ChevronDown,
  ChevronUp,
  Store,
  Plus,
  Edit3,
  Image as ImageIcon,
  Upload,
  PackageCheck,
  PackageX,
  Tag,
  X,
  Smartphone,
  Flame,
  Calendar,
  Monitor,
  Download,
  KeyRound,
  Send,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { ServerBotState, ServerBotLog } from '../types';
import { soundFX } from '../utils/sound';
import { normalizeWhatsAppNumber } from '../utils/phone';
import { BusinessPayPanel } from './BusinessPayPanel';
import { AutoOrderManagementView } from './AutoOrderManagementView';
import { downloadPayApkViaBlob, sendPayApkToWhatsApp } from '../utils/apkDownload';

type BusinessPlatform = 'android' | 'ios' | 'pc' | 'android_ios' | 'glory_bot';

interface BusinessPricePackage {
  id: string;
  days: string;
  price: string;
}

interface BusinessProduct {
  id: string;
  name: string;
  category: string;
  platform: BusinessPlatform;
  price: string;
  command?: string;
  packages?: BusinessPricePackage[];
  subtitle: string;
  description: string;
  logoUrl: string;
  inStock: boolean;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface BusinessStoreData {
  storeName: string;
  mainLogoUrl: string;
  welcomeText: string;
  panelButtonText: string;
  gloryButtonText: string;
  orderInstructions: string;
  categories: string[];
  products: BusinessProduct[];
  updatedAt: string;
}

const PLATFORM_LABELS: Record<BusinessPlatform, string> = {
  android: 'Android',
  ios: 'iOS',
  pc: 'PC / Emulator',
  android_ios: 'Android + iOS',
  glory_bot: 'Free Fire Glory Bot',
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.readAsDataURL(file);
  });
}

export const BusinessBotView: React.FC = () => {
  const { effectiveUserId, setActiveTab, addToast } = useApp();

  // Completely isolated tenant ID for the separate Business Bot
  const businessBotUserId = `${effectiveUserId}__business`;

  const [sectionTab, setSectionTab] = useState<'store' | 'connect' | 'pay' | 'auto-orders'>(() => {
    try {
      const init = sessionStorage.getItem('yashi_biz_initial_tab');
      if (init === 'pay' || init === 'auto-orders') {
        sessionStorage.removeItem('yashi_biz_initial_tab');
        return init;
      }
    } catch {}
    return 'store';
  });
  const [autoOrderInitialSubTab, setAutoOrderInitialSubTab] = useState<'orders' | 'guild'>('orders');
  const [botState, setBotState] = useState<ServerBotState | null>(null);
  const [logs, setLogs] = useState<ServerBotLog[]>([]);
  const [mode, setMode] = useState<'pairCode' | 'qrCode'>('pairCode');
  const [countryCode, setCountryCode] = useState('94');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingQr, setIsLoadingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [localPairCode, setLocalPairCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(120);
  const [showLogs, setShowLogs] = useState(false);

  // Quick Business Bot Config state
  const [bizBotName, setBizBotName] = useState('YASHI BUSINESS');
  const [bizPrefix, setBizPrefix] = useState('.');
  const [bizMode, setBizMode] = useState<'public' | 'private'>('public');
  const [bizOwnerNumber, setBizOwnerNumber] = useState('');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isSendingWaApk, setIsSendingWaApk] = useState(false);
  const [isDownloadingApk, setIsDownloadingApk] = useState(false);
  const [ffLiveBalance, setFfLiveBalance] = useState<{
    connected: boolean;
    username?: string;
    basicCredits: number | null;
    premiumCredits: number | null;
    activeGroupsCount: number | null;
    maxGroups: number | null;
    mode?: string;
  } | null>(null);

  const handleHeaderSendWaApk = async () => {
    if (isSendingWaApk) return;
    soundFX.playClick();
    setIsSendingWaApk(true);
    try {
      const result = await sendPayApkToWhatsApp(businessBotUserId);
      if (result.success) {
        soundFX.playSuccess();
        addToast(result.message, 'success');
      } else {
        addToast(result.message, 'error');
      }
    } catch {
      addToast('WhatsApp වෙත APK එක යැවීමේදී දෝෂයක් ඇති විය.', 'error');
    } finally {
      setIsSendingWaApk(false);
    }
  };

  const handleHeaderDownloadApk = async () => {
    if (isDownloadingApk) return;
    soundFX.playClick();
    setIsDownloadingApk(true);
    try {
      await downloadPayApkViaBlob();
      soundFX.playSuccess();
      addToast('YashiHallsPay-v1.0.0.apk ඩවුන්ලෝඩ් විය — Tap කර Install කරන්න!', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Browser Download අවහිර විය. Send APK (WA) භාවිතා කරන්න.', 'error');
    } finally {
      setIsDownloadingApk(false);
    }
  };

  // Business Store & Product Catalog state
  const [store, setStore] = useState<BusinessStoreData | null>(null);
  const [storeNameInput, setStoreNameInput] = useState('YASHI BUSINESS STORE');
  const [mainLogoInput, setMainLogoInput] = useState('');
  const [welcomeTextInput, setWelcomeTextInput] = useState('');
  const [panelBtnInput, setPanelBtnInput] = useState('📱 මොබයිල් පැනල්');
  const [gloryBtnInput, setGloryBtnInput] = useState('🔥 Free Fire Glory Bot');
  const [orderInstrInput, setOrderInstrInput] = useState('');
  const [isSavingStore, setIsSavingStore] = useState(false);
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('ALL');
  const [selectedPlatformFilter, setSelectedPlatformFilter] = useState<string>('ALL');

  // Inline quick price / days edit
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState('');
  const [packagesDraft, setPackagesDraft] = useState<BusinessPricePackage[]>([]);

  // Confirm delete product
  const [confirmDeleteProdId, setConfirmDeleteProdId] = useState<string | null>(null);

  // Add / Edit Product Modal
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<BusinessProduct | null>(null);
  const [prodName, setProdName] = useState('');
  const [prodCategory, setProdCategory] = useState('ANDROID+ IOS WEBMODE');
  const [prodCustomCategory, setProdCustomCategory] = useState('');
  const [prodPlatform, setProdPlatform] = useState<BusinessPlatform>('android');
  const [prodPrice, setProdPrice] = useState('$0.10');
  const [prodCommand, setProdCommand] = useState('');
  const [prodPackages, setProdPackages] = useState<BusinessPricePackage[]>([]);
  const [prodSubtitle, setProdSubtitle] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodLogoUrl, setProdLogoUrl] = useState('');
  const [prodLogoBase64, setProdLogoBase64] = useState('');
  const [prodInStock, setProdInStock] = useState(true);
  const [isSubmittingProduct, setIsSubmittingProduct] = useState(false);

  const configSyncedRef = useRef(false);
  const storeSyncedRef = useRef(false);
  const isQrRequestedRef = useRef(false);
  const autoQrTriggeredRef = useRef(false);
  const wasOnlineRef = useRef(false);
  const codeResultRef = useRef<HTMLDivElement | null>(null);

  const getBizHeaders = useCallback(
    (extra: Record<string, string> = {}) => ({
      'x-user-id': businessBotUserId,
      ...extra,
    }),
    [businessBotUserId]
  );

  const fetchBusinessStore = useCallback(async () => {
    try {
      const res = await authFetch('/api/business-store', { headers: getBizHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          const d: BusinessStoreData = json.data;
          setStore(d);
          if (!storeSyncedRef.current) {
            storeSyncedRef.current = true;
            setStoreNameInput(d.storeName);
            setMainLogoInput(d.mainLogoUrl || '');
            setWelcomeTextInput(d.welcomeText);
            setPanelBtnInput(d.panelButtonText);
            setGloryBtnInput(d.gloryButtonText);
            setOrderInstrInput(d.orderInstructions);
          }
        }
      }
    } catch {
      // ignore
    }
  }, [getBizHeaders]);

  const refreshBusinessStatus = useCallback(async () => {
    try {
      const res = await authFetch('/api/bot/status', {
        headers: getBizHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          const data: ServerBotState = json.data;
          setBotState(data);

          if (!configSyncedRef.current && data.config) {
            configSyncedRef.current = true;
            setBizBotName(data.config.botName || 'YASHI BUSINESS');
            setBizPrefix(data.config.prefix || '.');
            setBizMode(data.config.mode || 'public');
            setBizOwnerNumber(data.config.ownerNumber || '');
          }

          if (data.pairingCode && data.pairingCode !== 'PENDING') {
            setLocalPairCode(data.pairingCode);
          } else if (data.isOnline || data.connectionStatus !== 'connecting') {
            setLocalPairCode(null);
          }
          if (data.qrCodeDataUrl) {
            setQrError(null);
            setIsLoadingQr(false);
          }

          if (data.isOnline && !wasOnlineRef.current) {
            wasOnlineRef.current = true;
            soundFX.playSuccess();
            addToast('💼 Business WhatsApp Bot Connected Successfully!', 'success');
          } else if (!data.isOnline) {
            wasOnlineRef.current = false;
          }
        }
      }
    } catch {
      // ignore transient network errors
    }
  }, [getBizHeaders, addToast]);

  const fetchBusinessLogs = useCallback(async () => {
    try {
      const res = await authFetch('/api/bot/logs', {
        headers: getBizHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setLogs(json.data);
        }
      }
    } catch {
      // ignore
    }
  }, [getBizHeaders]);

  const fetchLiveFFGloryCredits = useCallback(async () => {
    try {
      const res = await authFetch('/api/auto-orders/dashboard', { headers: getBizHeaders() });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data?.stats) {
          setFfLiveBalance({
            connected: json.data.stats.apiConnectionStatus === 'CONNECTED',
            username: json.data.settings?.cachedBalance?.username,
            basicCredits: json.data.stats.basicCredits ?? null,
            premiumCredits: json.data.stats.premiumCredits ?? null,
            activeGroupsCount: json.data.stats.activeGroupsCount ?? null,
            maxGroups: json.data.stats.maxGroups ?? null,
            mode: json.data.settings?.operatingMode,
          });
        }
      }
    } catch {
      // ignore transient errors
    }
  }, [getBizHeaders]);

  // Initial load + polling + sidebar pay & auto-orders deep-link listener
  useEffect(() => {
    fetchBusinessStore();
    fetchLiveFFGloryCredits();
    const creditTimer = setInterval(fetchLiveFFGloryCredits, 20000);
    const onOpenPay = () => {
      try {
        sessionStorage.removeItem('yashi_biz_initial_tab');
      } catch {}
      setSectionTab('pay');
    };
    const onOpenAutoOrders = () => {
      try {
        sessionStorage.removeItem('yashi_biz_initial_tab');
      } catch {}
      setSectionTab('auto-orders');
    };
    window.addEventListener('yashi:open-biz-pay', onOpenPay);
    window.addEventListener('yashi:open-biz-auto-orders', onOpenAutoOrders);
    return () => {
      clearInterval(creditTimer);
      window.removeEventListener('yashi:open-biz-pay', onOpenPay);
      window.removeEventListener('yashi:open-biz-auto-orders', onOpenAutoOrders);
    };
  }, [fetchBusinessStore, fetchLiveFFGloryCredits]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await refreshBusinessStatus();
        await fetchBusinessLogs();
      } finally {
        inFlight = false;
      }
    };

    poll();
    const interval = setInterval(poll, 1800);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refreshBusinessStatus, fetchBusinessLogs]);

  const rawPairCode = botState?.pairingCode || localPairCode;
  const activePairCode = rawPairCode && rawPairCode !== 'PENDING' ? rawPairCode : null;

  useEffect(() => {
    if (activePairCode && codeResultRef.current) {
      codeResultRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activePairCode]);

  useEffect(() => {
    if (activePairCode) {
      setSecondsRemaining(120);
      const timer = setInterval(() => {
        setSecondsRemaining((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activePairCode]);

  const requestQrCode = useCallback(
    async (forceNew = false) => {
      if (isQrRequestedRef.current) return;
      isQrRequestedRef.current = true;
      setIsLoadingQr(true);
      setQrError(null);
      try {
        const res = await authFetch('/api/bot/pair/qr', {
          method: 'POST',
          headers: getBizHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ userId: businessBotUserId, forceNew }),
        });
        let data: any = null;
        if (res.headers.get('content-type')?.includes('application/json')) {
          try {
            data = await res.json();
          } catch {}
        }

        if (res.status === 401) {
          const msg = data?.message || 'සෙෂන් කල් ඉකුත් වී ඇත — කරුණාකර නැවත Sign In වන්න.';
          setQrError(msg);
          addToast(msg, 'error');
          return;
        }

        if (data?.success && data?.alreadyConnected) {
          await refreshBusinessStatus();
          return;
        }

        if (data?.success && data?.qr) {
          setLocalPairCode(null);
          setBotState((prev) =>
            prev
              ? { ...prev, pairingCode: null, qrCodeDataUrl: data.qr, connectionStatus: 'qr_ready' }
              : ({ pairingCode: null, qrCodeDataUrl: data.qr, connectionStatus: 'qr_ready' } as ServerBotState)
          );
          setQrError(null);
          soundFX.playSuccess();
          return;
        }

        if (!res.ok || (data && data.success === false)) {
          const msg = data?.message || 'Business QR කෝඩ් එක ලබාගැනීමට නොහැකි විය. නැවත උත්සාහ කරන්න.';
          setQrError(msg);
          addToast(msg, 'error');
          return;
        }

        await refreshBusinessStatus();
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 700));
          const sRes = await authFetch('/api/bot/status', { headers: getBizHeaders() });
          if (sRes.status === 401) {
            setQrError('Session expired. Please sign in again.');
            return;
          }
          if (sRes.ok) {
            const sJson = await sRes.json();
            if (sJson.data?.qrCodeDataUrl) {
              setBotState(sJson.data);
              setQrError(null);
              soundFX.playSuccess();
              return;
            }
          }
        }
        setQrError('WhatsApp QR කෝඩ් එක ලැබීමට ප්‍රමාද විය. Refresh QR ඔබන්න.');
      } catch (err: any) {
        const msg = err?.message || 'Network error while generating Business QR code.';
        setQrError(msg);
        await refreshBusinessStatus();
      } finally {
        setIsLoadingQr(false);
        isQrRequestedRef.current = false;
      }
    },
    [getBizHeaders, businessBotUserId, refreshBusinessStatus, addToast]
  );

  // Trigger QR generation ONCE when entering connect/qrCode after initial status loads (never wipe live/connecting sessions)
  useEffect(() => {
    if (sectionTab !== 'connect' || mode !== 'qrCode') {
      autoQrTriggeredRef.current = false;
      setQrError(null);
      return;
    }
    if (!botState) return;
    if (botState.isOnline) return;
    if (botState.connectionStatus === 'connecting' || botState.connectionStatus === 'reconnecting') return;
    if (botState.qrCodeDataUrl) return;
    if (autoQrTriggeredRef.current) return;

    autoQrTriggeredRef.current = true;
    void requestQrCode(false);
  }, [sectionTab, mode, botState, requestQrCode]);

  // --- Store & Product Handlers ---
  const handleMainLogoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsDataUrl(file);
      const res = await authFetch('/api/business-store/settings', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          mainLogoBase64: base64,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        setMainLogoInput(data.data.mainLogoUrl || '');
        soundFX.playSuccess();
        addToast('🖼️ Main Store Logo uploaded & saved!', 'success');
      } else {
        addToast(data.message || 'Logo upload failed', 'error');
      }
    } catch {
      addToast('Failed to upload main logo', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setIsSavingStore(true);
    try {
      const res = await authFetch('/api/business-store/settings', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          storeName: storeNameInput.trim() || 'YASHI BUSINESS STORE',
          mainLogoUrl: mainLogoInput.trim(),
          welcomeText: welcomeTextInput,
          panelButtonText: panelBtnInput.trim() || '📱 මොබයිල් පැනල්',
          gloryButtonText: gloryBtnInput.trim() || '🔥 Free Fire Glory Bot',
          orderInstructions: orderInstrInput.trim(),
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        soundFX.playSuccess();
        addToast('✅ Store settings & welcome flow updated!', 'success');
      } else {
        addToast(data.message || 'Failed to save store settings', 'error');
      }
    } catch {
      addToast('Error saving store settings', 'error');
    } finally {
      setIsSavingStore(false);
    }
  };

  const createPkgId = () => `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const openAddProductModal = () => {
    soundFX.playClick();
    setEditingProduct(null);
    setProdName('');
    setProdCategory(store?.categories?.[0] || 'FF APK MOD NON ROOT');
    setProdCustomCategory('');
    setProdPlatform('android');
    setProdPrice('$0.50');
    setProdCommand('');
    setProdPackages([
      { id: createPkgId(), days: '1 Day', price: '$0.50' },
      { id: createPkgId(), days: '7 Days', price: '$2.00' },
      { id: createPkgId(), days: '30 Days', price: '$5.00' },
    ]);
    setProdSubtitle('');
    setProdDescription('');
    setProdLogoUrl('');
    setProdLogoBase64('');
    setProdInStock(true);
    setProductModalOpen(true);
  };

  const openEditProductModal = (prod: BusinessProduct) => {
    soundFX.playClick();
    setEditingProduct(prod);
    setProdName(prod.name);
    setProdCategory(prod.category);
    setProdCustomCategory('');
    setProdPlatform(prod.platform);
    setProdPrice(prod.price);
    setProdCommand(prod.command || '');
    setProdPackages(
      Array.isArray(prod.packages)
        ? prod.packages.map((pk) => ({ ...pk }))
        : []
    );
    setProdSubtitle(prod.subtitle || '');
    setProdDescription(prod.description || '');
    setProdLogoUrl(prod.logoUrl || '');
    setProdLogoBase64('');
    setProdInStock(prod.inStock);
    setProductModalOpen(true);
  };

  const handleModalLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsDataUrl(file);
      setProdLogoBase64(base64);
      setProdLogoUrl(base64);
      soundFX.playClick();
    } catch {
      addToast('Could not read image file', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleSubmitProductModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prodName.trim()) {
      addToast('Product name is required', 'error');
      return;
    }
    const finalCategory = (
      prodCategory === '__custom__' ? prodCustomCategory : prodCategory
    )
      .trim()
      .toUpperCase() || 'OTHER';

    const cleanPackages = prodPackages
      .map((pk) => ({
        id: pk.id || createPkgId(),
        days: pk.days.trim(),
        price: pk.price.trim(),
      }))
      .filter((pk) => pk.days && pk.price);

    setIsSubmittingProduct(true);
    soundFX.playClick();
    try {
      const endpoint = editingProduct
        ? `/api/business-store/products/${editingProduct.id}`
        : '/api/business-store/products';
      const method = editingProduct ? 'PUT' : 'POST';

      const payload: Record<string, any> = {
        userId: businessBotUserId,
        name: prodName.trim(),
        category: finalCategory,
        platform: prodPlatform,
        price: cleanPackages.length > 0 ? cleanPackages[0].price : prodPrice.trim() || '$0.00',
        command: prodCommand.trim(),
        packages: cleanPackages,
        subtitle: prodSubtitle.trim(),
        description: prodDescription.trim(),
        inStock: prodInStock,
      };
      if (prodLogoBase64) {
        payload.logoBase64 = prodLogoBase64;
      } else {
        payload.logoUrl = prodLogoUrl.trim();
      }

      const res = await authFetch(endpoint, {
        method,
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        setProductModalOpen(false);
        soundFX.playSuccess();
        addToast(
          editingProduct
            ? `✅ Updated "${prodName.trim()}"`
            : `🎉 Added "${prodName.trim()}" to ${finalCategory}!`,
          'success'
        );
      } else {
        addToast(data.message || 'Failed to save product', 'error');
      }
    } catch {
      addToast('Network error saving product', 'error');
    } finally {
      setIsSubmittingProduct(false);
    }
  };

  const handleToggleStock = async (prod: BusinessProduct) => {
    soundFX.playClick();
    try {
      const res = await authFetch(`/api/business-store/products/${prod.id}`, {
        method: 'PUT',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          inStock: !prod.inStock,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        addToast(
          !prod.inStock
            ? `🟢 "${prod.name}" marked IN STOCK`
            : `🔴 "${prod.name}" marked OUT OF STOCK`,
          'info'
        );
      }
    } catch {
      addToast('Failed to update stock status', 'error');
    }
  };

  const handleSaveInlinePrice = async (prod: BusinessProduct) => {
    const cleanPackages = packagesDraft
      .map((pk) => ({
        id: pk.id || createPkgId(),
        days: pk.days.trim(),
        price: pk.price.trim(),
      }))
      .filter((pk) => pk.days && pk.price);
    const cleanFallback = priceDraft.trim();

    if (cleanPackages.length === 0 && !cleanFallback) {
      setEditingPriceId(null);
      return;
    }

    soundFX.playClick();
    try {
      const res = await authFetch(`/api/business-store/products/${prod.id}`, {
        method: 'PUT',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          price: cleanFallback || cleanPackages[0]?.price || prod.price,
          packages: cleanPackages,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        soundFX.playSuccess();
        addToast(
          cleanPackages.length > 0
            ? `📅 Saved ${cleanPackages.length} day packages for "${prod.name}"`
            : `💰 Price updated for "${prod.name}": ${cleanFallback}`,
          'success'
        );
      }
    } catch {
      addToast('Failed to update price packages', 'error');
    } finally {
      setEditingPriceId(null);
    }
  };

  const handleQuickProductLogoUpload = async (
    prod: BusinessProduct,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsDataUrl(file);
      const res = await authFetch(`/api/business-store/products/${prod.id}`, {
        method: 'PUT',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          logoBase64: base64,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        soundFX.playSuccess();
        addToast(`🖼️ Logo updated for "${prod.name}"`, 'success');
      }
    } catch {
      addToast('Failed to upload product logo', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleDeleteProduct = async (prod: BusinessProduct) => {
    soundFX.playClick();
    try {
      const res = await authFetch(`/api/business-store/products/${prod.id}`, {
        method: 'DELETE',
        headers: getBizHeaders(),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setStore(data.data);
        setConfirmDeleteProdId(null);
        addToast(`🗑️ Removed "${prod.name}"`, 'info');
      }
    } catch {
      addToast('Failed to delete product', 'error');
    }
  };

  // --- Bot Connection Handlers ---
  const handleGeneratePairCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCC = countryCode.replace(/\D/g, '') || '94';
    if (!phoneNumber.trim()) {
      addToast('Please enter your Business WhatsApp phone number', 'error');
      return;
    }
    const fullPhone = normalizeWhatsAppNumber(phoneNumber, cleanCC);
    if (!fullPhone || fullPhone.length < 9) {
      addToast('Please enter a valid phone number (e.g. 0740712934)', 'error');
      return;
    }

    soundFX.playClick();
    setIsGenerating(true);
    setLocalPairCode(null);
    setBotState((prev) =>
      prev ? { ...prev, pairingCode: null, qrCodeDataUrl: null, connectionStatus: 'connecting' } : prev
    );

    try {
      const res = await authFetch('/api/bot/pair/code', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ phoneNumber: fullPhone, userId: businessBotUserId }),
      });

      let data: any = null;
      if (res.headers.get('content-type')?.includes('application/json')) {
        try {
          data = await res.json();
        } catch {}
      }

      if (res.status === 401) {
        addToast(data?.message || 'සෙෂන් කල් ඉකුත් වී ඇත — කරුණාකර නැවත Sign In වන්න.', 'error');
        return;
      }

      if (data?.success && data?.code && data.code !== 'PENDING') {
        setLocalPairCode(data.code);
        soundFX.playSuccess();
        addToast(`💼 Business Bot Pairing Code ready: ${data.code}`, 'success');
        await refreshBusinessStatus();
      } else if (!res.ok || (data && data.success === false)) {
        addToast(
          data?.message || 'කෝඩ් එක ලබාගැනීමට නොහැකි විය. කරුණාකර නැවත උත්සාහ කරන්න.',
          'error'
        );
      } else {
        addToast('Connecting Business Bot to WhatsApp gateway...', 'info');
        let found = false;
        for (let i = 0; i < 15; i++) {
          await new Promise((r) => setTimeout(r, 800));
          const sRes = await authFetch('/api/bot/status', { headers: getBizHeaders() });
          if (sRes.status === 401) break;
          if (sRes.ok) {
            const sJson = await sRes.json();
            const liveCode = sJson.data?.pairingCode;
            if (sJson.success && liveCode && liveCode !== 'PENDING') {
              setBotState(sJson.data);
              setLocalPairCode(liveCode);
              soundFX.playSuccess();
              addToast(`💼 Business Bot Pairing Code ready: ${liveCode}`, 'success');
              found = true;
              break;
            }
          }
        }
        if (!found) {
          addToast('කෝඩ් එක ලබාගැනීමට නොහැකි විය. කරුණාකර නැවත උත්සාහ කරන්න.', 'error');
        }
      }
    } catch (err: any) {
      addToast(err?.message || 'Pairing failed. Please try again.', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (!activePairCode) return;
    const cleanCode = activePairCode.replace(/[^A-Za-z0-9]/g, '');
    soundFX.playClick();
    navigator.clipboard.writeText(cleanCode);
    setCopied(true);
    addToast(`Business Pairing code (${cleanCode}) copied!`, 'success');
    setTimeout(() => setCopied(false), 2500);
  };

  const handleClearSession = async () => {
    soundFX.playClick();
    addToast('Disconnecting Business Bot & wiping session...', 'info');
    try {
      await authFetch('/api/bot/clear-session', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: businessBotUserId }),
      });
      setLocalPairCode(null);
      await refreshBusinessStatus();
      addToast('Business Bot session cleared. Ready to pair a number.', 'info');
    } catch {
      addToast('Failed to clear session', 'error');
    }
  };

  const handleRestartBot = async () => {
    soundFX.playClick();
    addToast('Restarting Business Bot Engine...', 'info');
    try {
      const res = await authFetch('/api/bot/restart', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: businessBotUserId }),
      });
      const data = await res.json();
      await refreshBusinessStatus();
      if (data.success) {
        soundFX.playSuccess();
        addToast('Business Bot restarted successfully!', 'success');
      }
    } catch {
      addToast('Restart failed', 'error');
    }
  };

  const handleStartStop = async (action: 'start' | 'stop') => {
    soundFX.playClick();
    try {
      const res = await authFetch(`/api/bot/${action}`, {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: businessBotUserId }),
      });
      const data = await res.json();
      await refreshBusinessStatus();
      addToast(
        data.message || (action === 'start' ? 'Business Bot started' : 'Business Bot stopped'),
        data.success ? 'success' : 'info'
      );
    } catch {
      addToast(`Failed to ${action} Business Bot`, 'error');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setIsSavingConfig(true);
    try {
      const res = await authFetch('/api/bot/config', {
        method: 'POST',
        headers: getBizHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: businessBotUserId,
          botName: bizBotName.trim() || 'YASHI BUSINESS',
          prefix: bizPrefix.trim() || '.',
          mode: bizMode,
          ownerNumber: bizOwnerNumber.trim() || botState?.config?.ownerNumber || '',
          plan: 'business',
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast('Business Bot settings saved!', 'success');
        await refreshBusinessStatus();
      } else {
        addToast(data.message || 'Failed to save settings', 'error');
      }
    } catch {
      addToast('Failed to save settings', 'error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const isOnline = Boolean(botState?.isOnline);
  const isRunning = Boolean(botState && botState.connectionStatus !== 'disconnected');

  // Group filtered products by category (strict platform filter)
  const allCategories = store?.categories || [];
  const filteredProducts = (store?.products || []).filter((p) => {
    const catOk = selectedCategoryFilter === 'ALL' || p.category === selectedCategoryFilter;
    const platOk = selectedPlatformFilter === 'ALL' || p.platform === selectedPlatformFilter;
    return catOk && platOk;
  });

  const orderedCategoriesToDisplay = Array.from(
    new Set([...allCategories, ...filteredProducts.map((p) => p.category)])
  ).filter((cat) => filteredProducts.some((p) => p.category === cat));

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-5 pb-28">
      {/* Top Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            soundFX.playClick();
            setActiveTab('dashboard');
          }}
          className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors p-1 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Home</span>
        </button>

        <div
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono border ${
            isOnline
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
              : 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-300'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              isOnline ? 'bg-emerald-400' : 'bg-fuchsia-400'
            } animate-ping`}
          />
          <span>{isOnline ? 'BUSINESS BOT ONLINE' : 'SEPARATE BUSINESS BOT'}</span>
        </div>
      </div>

      {/* Hero Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-gradient-to-br from-[#121226] via-[#0e1525] to-[#111822] border border-fuchsia-500/30 shadow-[0_0_30px_rgba(217,70,239,0.12)]">
        <div className="flex items-center gap-3.5">
          <div className="w-14 h-14 rounded-2xl border-2 border-fuchsia-400/50 overflow-hidden flex items-center justify-center bg-[#0c1120] shrink-0 shadow-[0_0_20px_rgba(217,70,239,0.25)]">
            {store?.mainLogoUrl ? (
              <img
                src={store.mainLogoUrl}
                alt="Store Logo"
                className="w-full h-full object-cover"
              />
            ) : (
              <Briefcase className="w-7 h-7 text-fuchsia-400" />
            )}
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight flex items-center gap-2 flex-wrap">
              <span>{store?.storeName || 'BUSINESS BOT'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-300 border border-fuchsia-500/40 font-mono">
                STORE
              </span>
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Panels &amp; Free Fire Glory Bot Store • කාඩ් මෙනු, මිල ගණන්, Logo සහ Out of Stock පාලනය
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={handleHeaderSendWaApk}
            disabled={isSendingWaApk}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{isSendingWaApk ? 'Sending...' : 'Send APK (WA)'}</span>
          </button>

          <button
            type="button"
            onClick={handleHeaderDownloadApk}
            disabled={isDownloadingApk}
            className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>{isDownloadingApk ? 'Saving...' : 'Pay APK'}</span>
          </button>

          <button
            type="button"
            onClick={openAddProductModal}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:from-fuchsia-400 hover:to-pink-400 text-white font-black text-xs uppercase tracking-wider shadow-[0_0_20px_rgba(217,70,239,0.4)] cursor-pointer transition-all shrink-0 whitespace-nowrap"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Live FFGlory Credit Summary Strip */}
      {ffLiveBalance && (
        <div className="rounded-2xl bg-[#0c1322] border border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3 flex-wrap font-mono tabular-nums">
            <span className="text-slate-400 font-sans font-semibold">FFGlory API:</span>
            {ffLiveBalance.connected ? (
              <>
                <span className="text-sky-400 font-bold">
                  Basic: {ffLiveBalance.basicCredits ?? 0}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-amber-300 font-bold">
                  Premium: {ffLiveBalance.premiumCredits ?? 0}
                </span>
                <span className="text-slate-600">·</span>
                <span className="text-emerald-400">
                  Groups: {ffLiveBalance.activeGroupsCount ?? 0}/{ffLiveBalance.maxGroups ?? 0}
                </span>
                {ffLiveBalance.mode && (
                  <>
                    <span className="text-slate-600">·</span>
                    <span className={ffLiveBalance.mode === 'LIVE' ? 'text-emerald-300' : 'text-amber-300'}>
                      {ffLiveBalance.mode}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-amber-400 font-sans">Not connected yet — add API key to view live credits</span>
            )}
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setAutoOrderInitialSubTab('guild');
                setSectionTab('auto-orders');
              }}
              className="px-2.5 py-1 rounded-lg bg-purple-600/25 hover:bg-purple-600/40 border border-purple-400/40 text-xs font-bold text-purple-200 transition-colors cursor-pointer whitespace-nowrap"
            >
              ⚔️ Glory Bot Prices →
            </button>

            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setAutoOrderInitialSubTab('orders');
                setSectionTab('auto-orders');
              }}
              className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer whitespace-nowrap"
            >
              {ffLiveBalance.connected ? 'Manage Auto Orders →' : 'Connect FFGlory API →'}
            </button>
          </div>
        </div>
      )}

      {/* Main Sub-navigation Segmented Control */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 rounded-2xl bg-[#0c121e] border border-[#1e2a3c]">
        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSectionTab('store');
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            sectionTab === 'store'
              ? 'bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white shadow-lg'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Store className="w-4 h-4 shrink-0" />
          <span className="truncate">Store ({store?.products?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSectionTab('auto-orders');
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            sectionTab === 'auto-orders'
              ? 'bg-gradient-to-r from-emerald-500 to-teal-500 text-slate-950 font-black shadow-lg'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Flame className="w-4 h-4 shrink-0" />
          <span className="truncate">Auto Orders</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSectionTab('connect');
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            sectionTab === 'connect'
              ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-black shadow-lg'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <LinkIcon className="w-4 h-4 shrink-0" />
          <span className="truncate">Bot Connect</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSectionTab('pay');
          }}
          className={`py-2.5 px-2 sm:px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
            sectionTab === 'pay'
              ? 'bg-amber-400 text-slate-950 font-black shadow-lg'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <KeyRound className="w-4 h-4 shrink-0" />
          <span className="truncate">Pay App &amp; API</span>
        </button>
      </div>

      {sectionTab === 'auto-orders' ? (
        <AutoOrderManagementView
          tenantId={businessBotUserId}
          onToast={addToast}
          initialSubTab={autoOrderInitialSubTab}
        />
      ) : sectionTab === 'pay' ? (
        <BusinessPayPanel businessBotUserId={businessBotUserId} onToast={addToast} />
      ) : sectionTab === 'store' ? (
        <div className="space-y-5">
          {/* WhatsApp Customer Auto-Flow Summary */}
          <div className="rounded-3xl bg-[#0e1524] border border-cyan-500/25 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-cyan-300 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>WhatsApp Customer Flow (සක්‍රියයි)</span>
              </span>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                AUTO BUTTONS + CARDS
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-300">
              <div className="p-2.5 rounded-xl bg-[#131d2f] border border-[#1f2e47]">
                <span className="text-fuchsia-400 font-bold block mb-0.5">1. First Message</span>
                <span>ප්‍රධාන Logo + &quot;{panelBtnInput}&quot; &amp; &quot;{gloryBtnInput}&quot; Buttons 2</span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#131d2f] border border-[#1f2e47]">
                <span className="text-cyan-400 font-bold block mb-0.5">2. Tap Panel</span>
                <span>🤖 Android (Android Only) හෝ 🍎 iOS (iOS Only) තෝරන්න අහනවා</span>
              </div>
              <div className="p-2.5 rounded-xl bg-[#131d2f] border border-[#1f2e47]">
                <span className="text-emerald-400 font-bold block mb-0.5">3. Select Platform &amp; Days</span>
                <span>Category Cards + Days Key Prices + Stock + Buy කරන්න පුළුවන්</span>
              </div>
            </div>
          </div>

          {/* Main Logo & Welcome Flow Settings Card */}
          <form
            onSubmit={handleSaveStoreSettings}
            className="rounded-3xl bg-[#101726]/95 border border-[#22304a] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[#1d2a40] pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-fuchsia-400" />
                <h2 className="text-sm font-bold text-white">
                  Main Store Logo &amp; Welcome Message (ප්‍රධාන ලෝගෝ එක)
                </h2>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3.5 rounded-2xl bg-[#0a101d] border border-[#1d2940]">
              <div className="w-20 h-20 rounded-2xl bg-[#141c2e] border border-fuchsia-500/40 overflow-hidden flex items-center justify-center shrink-0">
                {mainLogoInput ? (
                  <img
                    src={mainLogoInput}
                    alt="Main Store Logo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-8 h-8 text-slate-500" />
                )}
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-400/50 text-fuchsia-200 text-xs font-bold cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Main Logo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleMainLogoFileUpload}
                      className="hidden"
                    />
                  </label>
                  <span className="text-[11px] text-slate-400">
                    හෝ පහතින් Image URL එකක් දමන්න:
                  </span>
                </div>
                <input
                  type="text"
                  value={mainLogoInput}
                  onChange={(e) => setMainLogoInput(e.target.value)}
                  placeholder="https://... (Main Logo Image URL)"
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-fuchsia-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Store Name</label>
                <input
                  type="text"
                  value={storeNameInput}
                  onChange={(e) => setStoreNameInput(e.target.value)}
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Button 1 Label</label>
                <input
                  type="text"
                  value={panelBtnInput}
                  onChange={(e) => setPanelBtnInput(e.target.value)}
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Button 2 Label</label>
                <input
                  type="text"
                  value={gloryBtnInput}
                  onChange={(e) => setGloryBtnInput(e.target.value)}
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  Welcome Message Text
                </label>
                <textarea
                  rows={3}
                  value={welcomeTextInput}
                  onChange={(e) => setWelcomeTextInput(e.target.value)}
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  Order / Payment Instructions (Buy එබූ විට යවන පණිවිඩය)
                </label>
                <textarea
                  rows={3}
                  value={orderInstrInput}
                  onChange={(e) => setOrderInstrInput(e.target.value)}
                  className="w-full bg-[#131b2c] border border-[#24324c] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingStore}
              className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-fuchsia-500/20 to-cyan-500/20 hover:from-fuchsia-500/30 hover:to-cyan-500/30 border border-fuchsia-400/50 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-fuchsia-300" />
              <span>{isSavingStore ? 'Saving...' : 'Save Logo & Welcome Settings'}</span>
            </button>
          </form>

          {/* Category & Platform Filter Bar (Inspired by Screenshots) */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Tag className="w-4 h-4 text-fuchsia-400" />
                <span>Products &amp; Categories ({filteredProducts.length})</span>
              </h2>

              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { id: 'ALL', label: 'All' },
                  { id: 'android', label: '🤖 Android' },
                  { id: 'ios', label: '🍎 iOS' },
                  { id: 'pc', label: '💻 PC' },
                  { id: 'android_ios', label: '📱 Android + iOS' },
                  { id: 'glory_bot', label: '🔥 Glory Bot' },
                ].map((pf) => (
                  <button
                    key={pf.id}
                    type="button"
                    onClick={() => {
                      soundFX.playClick();
                      setSelectedPlatformFilter(pf.id);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border ${
                      selectedPlatformFilter === pf.id
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
                        : 'bg-[#111827] border-[#1f2c42] text-slate-400 hover:text-white'
                    }`}
                  >
                    {pf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Horizontal Scrollable Category Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  soundFX.playClick();
                  setSelectedCategoryFilter('ALL');
                }}
                className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold uppercase whitespace-nowrap cursor-pointer border transition-all ${
                  selectedCategoryFilter === 'ALL'
                    ? 'bg-fuchsia-500 text-white border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.5)]'
                    : 'bg-[#101726] text-slate-300 border-[#22304a] hover:border-fuchsia-400/50'
                }`}
              >
                ALL ({store?.products?.length || 0})
              </button>
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    soundFX.playClick();
                    setSelectedCategoryFilter(cat);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold uppercase whitespace-nowrap cursor-pointer border transition-all ${
                    selectedCategoryFilter === cat
                      ? 'bg-fuchsia-500 text-white border-fuchsia-400 shadow-[0_0_12px_rgba(217,70,239,0.5)]'
                      : 'bg-[#101726] text-slate-300 border-[#22304a] hover:border-fuchsia-400/50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Categorized Product Cards Grid */}
          {orderedCategoriesToDisplay.length === 0 ? (
            <div className="p-10 rounded-3xl bg-[#101726] border border-[#22304a] text-center space-y-3">
              <Store className="w-10 h-10 text-fuchsia-400/60 mx-auto" />
              <div className="text-sm font-bold text-white">No products in this filter</div>
              <button
                type="button"
                onClick={openAddProductModal}
                className="px-4 py-2 rounded-xl bg-fuchsia-500 text-white text-xs font-bold cursor-pointer"
              >
                + Add Product
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {orderedCategoriesToDisplay.map((categoryName) => {
                const items = filteredProducts.filter((p) => p.category === categoryName);
                return (
                  <div key={categoryName} className="space-y-3">
                    {/* Category Header Divider matching Screenshot */}
                    <div className="flex items-center gap-3">
                      <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent via-fuchsia-500/50 to-fuchsia-500/20" />
                      <span className="text-xs font-black tracking-widest uppercase text-slate-200">
                        {categoryName}
                      </span>
                      <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent via-fuchsia-500/50 to-fuchsia-500/20" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      {items.map((prod) => (
                        <div
                          key={prod.id}
                          className={`rounded-2xl bg-[#0d1322] border p-3.5 space-y-3 transition-all shadow-lg ${
                            prod.inStock
                              ? 'border-[#252d47] hover:border-fuchsia-500/60'
                              : 'border-rose-500/40 bg-[#140e18]'
                          }`}
                        >
                          {/* Top Row: Platform + Title + Verified + Stock Badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-8 h-8 rounded-xl bg-[#161e33] border border-[#273352] flex items-center justify-center shrink-0">
                                {prod.platform === 'glory_bot' ? (
                                  <Flame className="w-4 h-4 text-amber-400" />
                                ) : prod.platform === 'pc' ? (
                                  <Monitor className="w-4 h-4 text-cyan-400" />
                                ) : (
                                  <Smartphone className="w-4 h-4 text-fuchsia-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-xs sm:text-sm font-extrabold text-white truncate">
                                  {prod.name}
                                </h3>
                                <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                                  <span className="text-emerald-400 font-semibold">
                                    ✓ Verified
                                  </span>
                                  <span className="text-slate-500">•</span>
                                  <span className="text-slate-400">
                                    {PLATFORM_LABELS[prod.platform] || prod.platform}
                                  </span>
                                  {prod.command && (
                                    <>
                                      <span className="text-slate-500">•</span>
                                      <span className="px-1.5 py-0.2 rounded bg-cyan-500/15 border border-cyan-500/35 text-cyan-300 font-mono font-bold">
                                        {prod.command}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            <span
                              className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-mono font-black uppercase border ${
                                prod.inStock
                                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/35'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/50'
                              }`}
                            >
                              {prod.inStock ? 'IN STOCK' : 'OUT OF STOCK'}
                            </span>
                          </div>

                          {/* Product Logo / Banner Preview + Quick Upload */}
                          <div className="relative h-32 rounded-xl overflow-hidden bg-[#131a2c] border border-[#222c46] flex items-center justify-center group">
                            {prod.logoUrl ? (
                              <img
                                src={prod.logoUrl}
                                alt={prod.name}
                                className={`w-full h-full object-cover ${
                                  !prod.inStock ? 'opacity-45 grayscale-[40%]' : ''
                                }`}
                              />
                            ) : (
                              <div className="flex flex-col items-center justify-center text-slate-500 space-y-1">
                                <ImageIcon className="w-7 h-7 opacity-40" />
                                <span className="text-[10px]">No Logo Added</span>
                              </div>
                            )}

                            {!prod.inStock && (
                              <div className="absolute inset-0 bg-black/45 flex items-center justify-center pointer-events-none">
                                <span className="px-3 py-1 rounded-lg bg-rose-600/90 text-white text-[11px] font-black uppercase tracking-widest shadow-lg">
                                  OUT OF STOCK
                                </span>
                              </div>
                            )}

                            <label className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-black/75 hover:bg-fuchsia-600 text-white text-[10px] font-bold border border-white/20 cursor-pointer transition-colors backdrop-blur-sm">
                              <Upload className="w-3 h-3" />
                              <span>{prod.logoUrl ? 'Change Logo' : 'Add Logo'}</span>
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleQuickProductLogoUpload(prod, e)}
                                className="hidden"
                              />
                            </label>
                          </div>

                          {/* Subtitle */}
                          {prod.subtitle && (
                            <div className="inline-block px-2 py-0.5 rounded-md bg-[#161f34] border border-[#25314d] text-[10px] text-slate-300 font-medium">
                              {prod.subtitle}
                            </div>
                          )}

                          {/* Days & Price Packages Section with Inline Multi-Day Editor */}
                          <div className="pt-2 border-t border-[#1b2339] space-y-2">
                            {editingPriceId === prod.id ? (
                              <div className="p-2.5 rounded-xl bg-[#0a101d] border border-cyan-500/40 space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-cyan-300 uppercase flex items-center gap-1">
                                    <Calendar className="w-3 h-3" />
                                    <span>Days &amp; Key Prices</span>
                                  </span>
                                  <div className="flex items-center gap-1">
                                    {['1 Day', '7 Days', '30 Days'].map((preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() =>
                                          setPackagesDraft((prev) => [
                                            ...prev,
                                            { id: createPkgId(), days: preset, price: prod.price || '$0.50' },
                                          ])
                                        }
                                        className="px-1.5 py-0.5 rounded bg-fuchsia-500/15 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-[9px] font-bold text-fuchsia-200 cursor-pointer"
                                      >
                                        +{preset}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {packagesDraft.length === 0 ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={priceDraft}
                                      onChange={(e) => setPriceDraft(e.target.value)}
                                      placeholder="Price (e.g. $0.50)"
                                      className="flex-1 bg-[#162036] border border-emerald-400/60 rounded-lg px-2 py-1 text-xs font-mono font-bold text-emerald-300 focus:outline-none"
                                    />
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPackagesDraft([
                                          { id: createPkgId(), days: '1 Day', price: priceDraft || prod.price || '$0.50' },
                                        ])
                                      }
                                      className="px-2 py-1 rounded-lg bg-fuchsia-500/20 border border-fuchsia-400/50 text-fuchsia-200 text-[10px] font-bold cursor-pointer"
                                    >
                                      + Add Days
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {packagesDraft.map((pk, idx) => (
                                      <div key={pk.id || idx} className="flex items-center gap-1.5">
                                        <input
                                          type="text"
                                          value={pk.days}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setPackagesDraft((prev) =>
                                              prev.map((item, i) => (i === idx ? { ...item, days: val } : item))
                                            );
                                          }}
                                          placeholder="Days (e.g. 7 Days)"
                                          className="w-24 bg-[#162036] border border-[#2a3a5e] rounded-lg px-2 py-1 text-[11px] text-white focus:outline-none focus:border-cyan-400"
                                        />
                                        <input
                                          type="text"
                                          value={pk.price}
                                          onChange={(e) => {
                                            const val = e.target.value;
                                            setPackagesDraft((prev) =>
                                              prev.map((item, i) => (i === idx ? { ...item, price: val } : item))
                                            );
                                          }}
                                          placeholder="Price ($2.00)"
                                          className="flex-1 min-w-0 bg-[#162036] border border-emerald-500/40 rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                                        />
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setPackagesDraft((prev) => prev.filter((_, i) => i !== idx))
                                          }
                                          className="p-1 rounded-lg text-rose-400 hover:bg-rose-500/20 cursor-pointer"
                                          title="Remove row"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                <div className="flex items-center justify-between gap-1.5 pt-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPackagesDraft((prev) => [
                                        ...prev,
                                        { id: createPkgId(), days: '', price: '' },
                                      ])
                                    }
                                    className="px-2 py-1 rounded-lg bg-[#162036] hover:bg-[#1e2c48] border border-[#2b3b5e] text-slate-300 text-[10px] font-bold cursor-pointer"
                                  >
                                    + Custom Row
                                  </button>
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setEditingPriceId(null)}
                                      className="px-2 py-1 text-slate-400 hover:text-white text-[10px] cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveInlinePrice(prod)}
                                      className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-[10px] font-black cursor-pointer"
                                    >
                                      Save Prices
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {Array.isArray(prod.packages) && prod.packages.length > 0 ? (
                                  <div className="flex flex-wrap gap-1.5">
                                    {prod.packages.map((pk) => (
                                      <div
                                        key={pk.id}
                                        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#131d33] border border-[#243252] text-[10px]"
                                      >
                                        <span className="text-slate-300 font-semibold">{pk.days}:</span>
                                        <span className="text-emerald-400 font-mono font-black">{pk.price}</span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-sm font-black text-emerald-400 font-mono block">
                                    {prod.price}
                                  </span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => {
                                    soundFX.playClick();
                                    setEditingPriceId(prod.id);
                                    setPriceDraft(prod.price);
                                    setPackagesDraft(
                                      Array.isArray(prod.packages)
                                        ? prod.packages.map((pk) => ({ ...pk }))
                                        : []
                                    );
                                  }}
                                  className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 underline font-semibold cursor-pointer"
                                >
                                  <Calendar className="w-3 h-3" />
                                  <span>
                                    {Array.isArray(prod.packages) && prod.packages.length > 0
                                      ? 'Edit Days & Prices'
                                      : '+ Add Days & Prices'}
                                  </span>
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Product Action Bar: Stock Toggle, Edit, Delete */}
                          <div className="grid grid-cols-3 gap-1.5 pt-1">
                            <button
                              type="button"
                              onClick={() => handleToggleStock(prod)}
                              className={`py-2 px-2 rounded-xl text-[10px] font-bold flex items-center justify-center gap-1 border cursor-pointer transition-colors ${
                                prod.inStock
                                  ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-300'
                                  : 'bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/40 text-emerald-300'
                              }`}
                            >
                              {prod.inStock ? (
                                <>
                                  <PackageX className="w-3 h-3" />
                                  <span>Set OOS</span>
                                </>
                              ) : (
                                <>
                                  <PackageCheck className="w-3 h-3" />
                                  <span>Restock</span>
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => openEditProductModal(prod)}
                              className="py-2 px-2 rounded-xl bg-[#182238] hover:bg-[#22304d] border border-[#2a3859] text-slate-200 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                            >
                              <Edit3 className="w-3 h-3 text-cyan-400" />
                              <span>Edit</span>
                            </button>

                            {confirmDeleteProdId === prod.id ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteProduct(prod)}
                                className="py-2 px-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-black cursor-pointer"
                              >
                                Confirm
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  soundFX.playClick();
                                  setConfirmDeleteProdId(prod.id);
                                  setTimeout(() => {
                                    setConfirmDeleteProdId((prev) =>
                                      prev === prod.id ? null : prev
                                    );
                                  }, 4000);
                                }}
                                className="py-2 px-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/35 text-rose-300 text-[10px] font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                                <span>Remove</span>
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* CONNECT & BOT SETTINGS TAB */
        <div className="space-y-5 max-w-xl mx-auto">
          {isOnline ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-3xl bg-gradient-to-br from-emerald-950/40 via-[#111822] to-[#121c27] border-2 border-emerald-500/50 p-5 sm:p-6 shadow-[0_0_35px_rgba(16,185,129,0.25)] space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2 flex-wrap">
                      <span>Business Bot Connected!</span>
                      <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-mono font-bold border border-amber-400/30">
                        BIZ SLOT
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400 font-mono">
                      Linked number: +{botState?.pairedNumber || 'Active'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-mono text-emerald-400 font-bold">ONLINE</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2.5 p-3 rounded-2xl bg-[#141e2a] border border-[#223345] text-xs">
                <div>
                  <span className="text-slate-400 block mb-0.5">Latency</span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {botState?.lastPingMs ?? 0}ms
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Uptime</span>
                  <span className="font-mono text-white font-bold">
                    {Math.floor((botState?.uptimeSeconds || 0) / 60)}m{' '}
                    {(botState?.uptimeSeconds || 0) % 60}s
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Messages</span>
                  <span className="font-mono text-cyan-300 font-bold">
                    {botState?.totalMessagesReceived || 0}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleRestartBot}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-[#182635] hover:bg-[#203448] border border-cyan-500/30 text-cyan-300 font-bold text-xs uppercase flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Restart</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleStartStop(isRunning ? 'stop' : 'start')}
                  className={`flex-1 py-2.5 px-3 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2 transition-colors cursor-pointer border ${
                    isRunning
                      ? 'bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/40 text-amber-300'
                      : 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/40 text-emerald-300'
                  }`}
                >
                  {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  <span>{isRunning ? 'Stop Bot' : 'Start Bot'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearSession}
                  className="py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-400 font-bold text-xs uppercase flex items-center gap-2 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Disconnect</span>
                </button>
              </div>
            </motion.div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => {
                    soundFX.playClick();
                    setMode('pairCode');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    mode === 'pairCode'
                      ? 'bg-[#101b26] border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                      : 'bg-[#111822] border-[#223345] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <LinkIcon
                      className={`w-4 h-4 ${
                        mode === 'pairCode' ? 'text-amber-400' : 'text-slate-400'
                      }`}
                    />
                    <span
                      className={`text-sm font-bold ${
                        mode === 'pairCode' ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      Pair Code
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">8-Digit business link</div>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="button"
                  onClick={() => {
                    soundFX.playClick();
                    setMode('qrCode');
                  }}
                  className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    mode === 'qrCode'
                      ? 'bg-[#101b26] border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.2)]'
                      : 'bg-[#111822] border-[#223345] text-slate-400 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <QrCode
                      className={`w-4 h-4 ${
                        mode === 'qrCode' ? 'text-amber-400' : 'text-slate-400'
                      }`}
                    />
                    <span
                      className={`text-sm font-bold ${
                        mode === 'qrCode' ? 'text-white' : 'text-slate-300'
                      }`}
                    >
                      QR Code
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">Direct camera scan</div>
                </motion.button>
              </div>

              {mode === 'pairCode' ? (
                <div className="rounded-3xl bg-[#111822]/95 backdrop-blur-md border border-[#223345] p-5 sm:p-6 shadow-xl space-y-4">
                  <form onSubmit={handleGeneratePairCode} className="space-y-4">
                    <div className="flex items-center gap-2 text-amber-400 text-sm font-bold">
                      <Phone className="w-4 h-4" />
                      <span>Business WhatsApp Number</span>
                    </div>

                    <div className="flex gap-2.5">
                      <div className="flex items-center gap-1.5 bg-[#15202c] border border-[#25374b] rounded-2xl px-3.5 py-3 text-sm text-white font-mono shrink-0">
                        <span className="text-slate-400">+</span>
                        <input
                          type="text"
                          value={countryCode}
                          onChange={(e) => setCountryCode(e.target.value.replace(/\D/g, ''))}
                          className="w-10 bg-transparent text-white font-mono focus:outline-none"
                          placeholder="94"
                        />
                      </div>

                      <input
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="Enter business WhatsApp number (e.g. 0740712934)"
                        className="flex-1 bg-[#15202c] border border-[#25374b] rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 font-mono focus:outline-none focus:border-amber-400 shadow-inner"
                        required
                      />
                    </div>

                    <div className="p-3.5 rounded-2xl bg-[#152332]/80 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-100">
                      <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>
                        ඔබගේ ව්‍යාපාරික WhatsApp අංකය ඇතුළත් කර පහත බටනය මඟින් වෙනම Business Bot Pairing Code එක ලබාගන්න.
                      </span>
                    </div>

                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={isGenerating}
                      className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-amber-400 via-orange-400 to-cyan-400 hover:from-amber-300 hover:to-cyan-300 text-slate-950 font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-[0_0_25px_rgba(245,158,11,0.35)] flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                    >
                      {isGenerating ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                          <span>Requesting Business Pairing Code...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-slate-950" />
                          <span>Connect Business Bot (කෝඩ් එක ගන්න)</span>
                        </>
                      )}
                    </motion.button>
                  </form>

                  <AnimatePresence>
                    {activePairCode && (
                      <motion.div
                        ref={codeResultRef}
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="pt-4 border-t border-[#1f2e40] space-y-4"
                      >
                        <div className="p-5 rounded-3xl bg-gradient-to-br from-amber-950/40 via-[#111c27] to-[#121c27] border-2 border-amber-400 text-center space-y-3.5 shadow-[0_0_35px_rgba(245,158,11,0.25)]">
                          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-[11px] font-mono uppercase tracking-wider text-emerald-300 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Business WhatsApp Pairing Code</span>
                          </div>

                          <div className="text-3xl sm:text-4xl md:text-5xl font-black font-mono tracking-widest text-amber-300 selection:bg-amber-500/30 py-1">
                            {activePairCode}
                          </div>

                          <div className="p-3.5 rounded-2xl bg-[#0c141d] border border-amber-500/30 text-xs text-slate-300 font-mono space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-slate-400">WhatsApp Code:</span>
                              <span className="text-emerald-400 font-bold tracking-widest text-lg">
                                {activePairCode.replace(/[^A-Za-z0-9]/g, '')}
                              </span>
                            </div>
                            {botState?.pairingPhone && (
                              <div className="flex items-center justify-between border-t border-slate-800 pt-2">
                                <span className="text-slate-400">Linked Number:</span>
                                <span className="text-amber-300 font-bold">+{botState.pairingPhone}</span>
                              </div>
                            )}
                            <p className="text-[11px] text-slate-400 text-left font-sans leading-relaxed">
                              ඉහත අංකයම ඇති WhatsApp ගිණුමේ Linked Devices &gt; Link with phone number instead තුළ මෙම කෝඩ් එක ඇතුළත් කරන්න. &quot;Couldn&apos;t link device&quot; පෙන්වුවහොත්{' '}
                              <button
                                type="button"
                                onClick={() => {
                                  soundFX.playClick();
                                  setMode('qrCode');
                                }}
                                className="text-amber-300 underline font-semibold cursor-pointer"
                              >
                                QR Code
                              </button>{' '}
                              මඟින් සම්බන්ධ කරන්න.
                            </p>
                          </div>

                          <div className="text-xs text-slate-400 font-mono flex items-center justify-center gap-2">
                            <span>Expires in:</span>
                            <span
                              className={`font-bold ${
                                secondsRemaining <= 20
                                  ? 'text-rose-400 animate-pulse'
                                  : 'text-amber-400'
                              }`}
                            >
                              {secondsRemaining}s
                            </span>
                          </div>

                          <div className="pt-1 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5">
                            <motion.button
                              whileHover={{ scale: 1.03 }}
                              whileTap={{ scale: 0.97 }}
                              type="button"
                              onClick={handleCopyCode}
                              className={`flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl font-black text-xs sm:text-sm uppercase tracking-wider transition-all shadow-lg cursor-pointer ${
                                copied
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'bg-gradient-to-r from-amber-400 to-cyan-400 text-slate-950'
                              }`}
                            >
                              {copied ? (
                                <Check className="w-4 h-4 stroke-[3]" />
                              ) : (
                                <Copy className="w-4 h-4" />
                              )}
                              <span>
                                {copied
                                  ? 'Copied! (කොපි විය!)'
                                  : `Copy Code (${activePairCode.replace(/[^A-Za-z0-9]/g, '')})`}
                              </span>
                            </motion.button>

                            <button
                              type="button"
                              onClick={handleClearSession}
                              className="inline-flex items-center justify-center gap-1.5 px-4 py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 font-semibold text-xs border border-rose-500/30 cursor-pointer transition-all"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Reset</span>
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ) : (
                <div className="rounded-3xl bg-[#111822]/95 backdrop-blur-md border border-[#223345] p-6 text-center space-y-4 shadow-xl">
                  <h3 className="text-base font-bold text-white">
                    Scan QR Code for Business Bot
                  </h3>
                  <p className="text-xs text-slate-400">
                    Open your Business WhatsApp &gt; Linked Devices &gt; Link a Device and scan below:
                  </p>

                  <div className="relative inline-block p-4 rounded-3xl bg-white shadow-2xl mx-auto border-4 border-amber-400/40">
                    {botState?.qrCodeDataUrl ? (
                      <div className="relative">
                        <img
                          src={botState.qrCodeDataUrl}
                          alt="Business Bot QR Code"
                          className="w-56 h-56 object-contain rounded-xl"
                        />
                        <motion.div
                          animate={{ y: [-90, 90] }}
                          transition={{
                            duration: 1.6,
                            repeat: Infinity,
                            repeatType: 'reverse',
                            ease: 'easeInOut',
                          }}
                          className="absolute left-0 right-0 h-1 bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,1)]"
                        />
                      </div>
                    ) : (
                      <div className="w-56 h-56 bg-slate-950 p-4 rounded-xl flex flex-col items-center justify-center text-center space-y-2.5">
                        <QrCode className="w-11 h-11 text-amber-400/40" />
                        {isLoadingQr ? (
                          <>
                            <div className="flex items-center gap-1.5 text-amber-300 text-xs font-mono font-bold">
                              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
                              <span>Generating QR...</span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-tight">
                              Connecting to WhatsApp Gateway
                            </p>
                          </>
                        ) : qrError ? (
                          <>
                            <p className="text-[11px] text-rose-300 font-semibold leading-snug">
                              {qrError}
                            </p>
                            <button
                              type="button"
                              onClick={() => requestQrCode(true)}
                              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              ⚡ Retry QR
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="text-[11px] text-slate-400 leading-tight">
                              Tap below to load a fresh Business QR Code
                            </p>
                            <button
                              type="button"
                              onClick={() => requestQrCode(true)}
                              className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 text-[11px] font-bold transition-all cursor-pointer"
                            >
                              ⚡ Generate QR
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {botState?.qrCodeDataUrl && (
                    <div className="p-3 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-[#111e1f] to-[#142323] border border-emerald-500/40 text-emerald-300 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span className="font-bold text-white text-xs">
                          Waiting for camera scan...
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400">
                        <Radio className="w-3 h-3 animate-pulse" />
                        <span>READY</span>
                      </div>
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      disabled={isLoadingQr}
                      onClick={() => {
                        soundFX.playSuccess();
                        addToast('Generating fresh Business Bot QR code...', 'info');
                        requestQrCode(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-bold border border-amber-500/40 transition-all cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isLoadingQr ? 'animate-spin' : ''}`} />
                      <span>{isLoadingQr ? 'Generating QR...' : 'Refresh QR Code'}</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Business Bot Quick Settings Card */}
          <form
            onSubmit={handleSaveConfig}
            className="rounded-3xl bg-[#111822]/95 border border-[#223345] p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[#1b2b3d] pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">Business Bot Settings</h3>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                ISOLATED ENGINE
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  Business Bot Name
                </label>
                <input
                  type="text"
                  value={bizBotName}
                  onChange={(e) => setBizBotName(e.target.value)}
                  placeholder="YASHI BUSINESS"
                  className="w-full bg-[#15202c] border border-[#25374b] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Command Prefix</label>
                <input
                  type="text"
                  value={bizPrefix}
                  onChange={(e) => setBizPrefix(e.target.value)}
                  placeholder="."
                  className="w-full bg-[#15202c] border border-[#25374b] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">
                  Owner WhatsApp Number (Order Link)
                </label>
                <input
                  type="text"
                  value={bizOwnerNumber}
                  onChange={(e) => setBizOwnerNumber(e.target.value)}
                  placeholder="94740712934"
                  className="w-full bg-[#15202c] border border-[#25374b] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-400">Mode</label>
                <select
                  value={bizMode}
                  onChange={(e) => setBizMode(e.target.value as 'public' | 'private')}
                  className="w-full bg-[#15202c] border border-[#25374b] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="public">Public (සියලු දෙනාට)</option>
                  <option value="private">Private (Owner පමණි)</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSavingConfig}
              className="w-full py-2.5 px-4 rounded-xl bg-[#182635] hover:bg-[#203448] border border-amber-500/40 text-amber-300 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingConfig ? 'Saving...' : 'Save Business Bot Settings'}</span>
            </button>
          </form>

          {/* Collapsible Live Business Bot Logs */}
          <div className="rounded-3xl bg-[#111822]/95 border border-[#223345] overflow-hidden">
            <button
              type="button"
              onClick={() => {
                soundFX.playClick();
                setShowLogs((v) => !v);
              }}
              className="w-full px-5 py-3.5 flex items-center justify-between text-xs font-bold text-slate-200 hover:bg-[#15202e] transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Business Bot Live Logs ({logs.length})</span>
              </div>
              {showLogs ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showLogs && (
              <div className="px-4 pb-4 max-h-60 overflow-y-auto font-mono text-[11px] space-y-1 bg-[#070d16] border-t border-[#1b2b3d] pt-3">
                {logs.length === 0 ? (
                  <div className="text-slate-500 text-center py-4">No logs recorded yet.</div>
                ) : (
                  logs.slice(-40).map((log) => (
                    <div key={log.id} className="text-slate-300 leading-snug break-words">
                      <span className="text-slate-500">[{log.timestamp}]</span>{' '}
                      <span
                        className={
                          log.level === 'ERROR'
                            ? 'text-rose-400'
                            : log.level === 'WARN'
                            ? 'text-amber-400'
                            : log.level === 'CMD'
                            ? 'text-cyan-400'
                            : 'text-emerald-400'
                        }
                      >
                        [{log.level}]
                      </span>{' '}
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ADD / EDIT PRODUCT MODAL */}
      <AnimatePresence>
        {productModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-lg rounded-3xl bg-[#0e1524] border border-fuchsia-500/40 p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#1d2a42]">
                <h3 className="text-base font-black text-white">
                  {editingProduct ? `Edit Product: ${editingProduct.name}` : 'Add New Business Product'}
                </h3>
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-[#1a243b] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSubmitProductModal} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Product Name *</label>
                  <input
                    type="text"
                    required
                    value={prodName}
                    onChange={(e) => setProdName(e.target.value)}
                    placeholder="e.g. Phanthom Android+ iOS"
                    className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Category</label>
                    <select
                      value={prodCategory}
                      onChange={(e) => setProdCategory(e.target.value)}
                      className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                    >
                      {allCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__custom__">+ New Category...</option>
                    </select>
                    {prodCategory === '__custom__' && (
                      <input
                        type="text"
                        value={prodCustomCategory}
                        onChange={(e) => setProdCustomCategory(e.target.value)}
                        placeholder="NEW CATEGORY NAME"
                        className="mt-1.5 w-full bg-[#151e31] border border-fuchsia-400/60 rounded-xl px-3 py-2 text-xs text-white uppercase focus:outline-none"
                      />
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Platform</label>
                    <select
                      value={prodPlatform}
                      onChange={(e) => setProdPlatform(e.target.value as BusinessPlatform)}
                      className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                    >
                      <option value="android">🤖 Android Only</option>
                      <option value="ios">🍎 iOS Only</option>
                      <option value="pc">💻 PC / Emulator</option>
                      <option value="android_ios">📱 Android + iOS (WebMode)</option>
                      <option value="glory_bot">🔥 Free Fire Glory Bot</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Panel Command (UI Card එකෙන් Copy කර ගහන Command එක)
                  </label>
                  <input
                    type="text"
                    value={prodCommand}
                    onChange={(e) => setProdCommand(e.target.value)}
                    placeholder="Auto (උදා: .balamod, .phanthom, .gbox)"
                    className="w-full bg-[#151e31] border border-cyan-500/40 rounded-xl px-3 py-2 text-xs font-mono text-cyan-300 focus:outline-none focus:border-cyan-400"
                  />
                </div>

                {/* Days + Price Key Packages Editor */}
                <div className="p-3.5 rounded-2xl bg-[#0a101d] border border-cyan-500/30 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>Key Days &amp; Prices (දවස් ගණන සහ මිල)</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setProdPackages((prev) => [
                          ...prev,
                          { id: createPkgId(), days: '', price: '' },
                        ])
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-400/50 text-fuchsia-200 text-[10px] font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Day Row</span>
                    </button>
                  </div>

                  {/* Quick Day Presets */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-400">Quick add:</span>
                    {['1 Day', '3 Days', '7 Days', '15 Days', '30 Days'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setProdPackages((prev) => [
                            ...prev,
                            { id: createPkgId(), days: preset, price: prodPrice || '$0.50' },
                          ])
                        }
                        className="px-2 py-0.5 rounded-md bg-[#151e31] hover:bg-[#1e2a45] border border-[#273657] text-[10px] text-slate-200 font-semibold cursor-pointer"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>

                  {prodPackages.length > 0 ? (
                    <div className="space-y-2">
                      {prodPackages.map((pk, idx) => (
                        <div key={pk.id || idx} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={pk.days}
                            onChange={(e) => {
                              const val = e.target.value;
                              setProdPackages((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, days: val } : item))
                              );
                            }}
                            placeholder="Days (e.g. 7 Days)"
                            className="col-span-5 bg-[#151e31] border border-[#263452] rounded-xl px-2.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-400"
                          />
                          <input
                            type="text"
                            value={pk.price}
                            onChange={(e) => {
                              const val = e.target.value;
                              setProdPackages((prev) =>
                                prev.map((item, i) => (i === idx ? { ...item, price: val } : item))
                              );
                            }}
                            placeholder="Price (e.g. $2.00 / Rs.500)"
                            className="col-span-6 bg-[#151e31] border border-emerald-500/40 rounded-xl px-2.5 py-2 text-xs font-mono font-bold text-emerald-300 focus:outline-none focus:border-emerald-400"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setProdPackages((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="col-span-1 flex items-center justify-center p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 cursor-pointer"
                            title="Remove day package"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[11px] text-slate-400 py-1">
                      දවස් අනුව මිල ගණන් දැමීමට ඉහත &quot;+ 1 Day&quot; / &quot;Add Day Row&quot; ඔබන්න, නැතිනම් පහත Single Price එක භාවිතා කරන්න.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">
                      {prodPackages.length > 0 ? 'Fallback / Base Price' : 'Price *'}
                    </label>
                    <input
                      type="text"
                      required={prodPackages.length === 0}
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      placeholder="e.g. $0.50 or LKR 500"
                      className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2.5 text-xs font-mono text-emerald-300 focus:outline-none focus:border-fuchsia-400"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-300">Stock Status</label>
                    <button
                      type="button"
                      onClick={() => setProdInStock((v) => !v)}
                      className={`w-full py-2.5 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-2 cursor-pointer ${
                        prodInStock
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                          : 'bg-rose-500/20 border-rose-500/50 text-rose-300'
                      }`}
                    >
                      {prodInStock ? (
                        <>
                          <PackageCheck className="w-4 h-4" />
                          <span>IN STOCK</span>
                        </>
                      ) : (
                        <>
                          <PackageX className="w-4 h-4" />
                          <span>OUT OF STOCK</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Subtitle / Support Tag
                  </label>
                  <input
                    type="text"
                    value={prodSubtitle}
                    onChange={(e) => setProdSubtitle(e.target.value)}
                    placeholder="e.g. Android Non Root Support"
                    className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-300">Description</label>
                  <textarea
                    rows={2}
                    value={prodDescription}
                    onChange={(e) => setProdDescription(e.target.value)}
                    placeholder="Short product features..."
                    className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                  />
                </div>

                {/* Product Logo / Banner Upload */}
                <div className="p-3 rounded-2xl bg-[#0a101d] border border-[#1d2940] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">
                      Product Logo / Banner
                    </span>
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-400/50 text-fuchsia-200 text-[11px] font-bold cursor-pointer">
                      <Upload className="w-3 h-3" />
                      <span>Upload Image</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleModalLogoFile}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {prodLogoUrl && (
                    <div className="h-28 rounded-xl overflow-hidden border border-[#24324c] bg-[#131b2c]">
                      <img
                        src={prodLogoUrl}
                        alt="Product preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <input
                    type="text"
                    value={prodLogoBase64 ? '' : prodLogoUrl}
                    onChange={(e) => {
                      setProdLogoBase64('');
                      setProdLogoUrl(e.target.value);
                    }}
                    placeholder="Or paste logo image URL (https://...)"
                    className="w-full bg-[#151e31] border border-[#263452] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-400"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1d2a42]">
                  <button
                    type="button"
                    onClick={() => setProductModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white hover:bg-[#192238] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingProduct}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-500 hover:from-fuchsia-400 hover:to-pink-400 text-white font-black text-xs uppercase tracking-wider cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingProduct
                      ? 'Saving...'
                      : editingProduct
                      ? 'Update Product'
                      : 'Add Product'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
