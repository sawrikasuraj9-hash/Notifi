import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { authFetch } from '../firebase';
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldCheck,
  KeyRound,
  Settings as SettingsIcon,
  Layers,
  Activity,
  Search,
  Eye,
  RotateCcw,
  Ban,
  Check,
  X,
  FlaskConical,
  Radio,
  Globe,
  Coins,
  Ticket,
  Flame,
  FileText,
  Server,
  Bell,
  Copy,
  Save,
  Trash2,
  Shield,
  Trophy,
  Users,
  Receipt,
  Send,
  CreditCard,
  Sparkles,
} from 'lucide-react';
import { soundFX } from '../utils/sound';
import { GuildConfigPortal } from './GuildConfigPortal';

export type AutoOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_DETECTED'
  | 'PAYMENT_VERIFIED'
  | 'WAITING_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'MANUAL_REVIEW'
  | 'CANCELLED';

type DeliveryActionType = 'COUPON' | 'CLAN_GROUP' | 'MANUAL';
type OperatingMode = 'TEST' | 'LIVE';
type GuildBotQuantity = 4 | 8 | 12 | 16;

interface GuildTierPricing {
  bots4: number;
  bots8: number;
  bots12: number;
  bots16: number;
}

interface PaymentAccountConfig {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName?: string;
  instructions: string;
}

interface ReceiptOcrData {
  isPaymentReceipt: boolean;
  transactionRefId?: string;
  amountLkr?: number;
  paymentDateTime?: string;
  bankName?: string;
  senderName?: string;
  recipientAccount?: string;
  remarkOrderId?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  notes?: string;
}

interface AutoOrderReceiptRecord {
  fileHash: string;
  fileName: string;
  mimeType: string;
  storedFileName: string;
  uploadedAt: string;
  ocrStatus: 'PARSED' | 'FAILED' | 'SKIPPED';
  ocrError?: string;
  ocrData?: ReceiptOcrData;
  verificationStatus:
    | 'VERIFIED'
    | 'AWAITING_BANK_CONFIRMATION'
    | 'REJECTED_DUPLICATE_HASH'
    | 'REJECTED_DUPLICATE_REF'
    | 'REJECTED_AMOUNT_MISMATCH'
    | 'MANUAL_REVIEW';
  verificationNote: string;
}

interface ReceiptHistoryEntry {
  id: string;
  orderId: string;
  customerNumber: string;
  customerName: string;
  expectedAmountLkr: number;
  fileHash: string;
  fileName: string;
  mimeType: string;
  storedFileName: string;
  status: AutoOrderReceiptRecord['verificationStatus'];
  reason: string;
  ocrData?: ReceiptOcrData;
  uploadedAt: string;
}

interface CustomerHistoryEntry {
  customerNumber: string;
  customerName: string;
  totalOrders: number;
  deliveredOrders: number;
  totalSpentLkr: number;
  lastOrderAt: string;
  lastOrderId: string;
}

interface OrderGuildConfig {
  regionId: string;
  regionName: string;
  clanId: string;
  submittedVia: 'WEB_CARD' | 'WHATSAPP_COPY' | 'WHATSAPP_NATIVE' | 'ADMIN';
  submittedAt: string;
}

interface OrderLiveGlorySnapshot {
  currentGlory?: number | string;
  clanName?: string;
  clanLevel?: number | string;
  memberCount?: number | string;
  groupStatus: string;
  runningCount?: number;
  containerCount?: number;
  uptime?: string;
  lastUpdatedAt: string;
  errors?: string[];
}

interface AutoOrder {
  id: string;
  tenantId: string;
  mode: OperatingMode;
  serviceType?: 'GUILD_SERVICE' | 'PANEL_SERVICE' | 'STORE_PRODUCT';
  botQuantity?: GuildBotQuantity;
  portalToken?: string;
  customerJid: string;
  customerNumber: string;
  customerName: string;
  productId: string;
  productName: string;
  packageId?: string;
  packageDays?: string;
  priceDisplay: string;
  amountLkr: number;
  deliveryAction: DeliveryActionType;
  deliveryParams: {
    basic_credits?: number;
    premium_credits?: number;
    region?: string;
    clan_id?: string;
  };
  status: AutoOrderStatus;
  statusReason?: string;
  processingStage?: string;
  receipt?: AutoOrderReceiptRecord;
  guildConfig?: OrderGuildConfig;
  payment?: {
    eventId?: string;
    source: string;
    bank: string;
    amountLkr: number;
    transactionId: string;
    sender?: string;
    paidAt: string;
    rawMessage?: string;
    relatedOrderIdInMessage?: string;
    verifiedBy: string;
  };
  delivery?: {
    provider: string;
    mode: OperatingMode;
    actionType: DeliveryActionType;
    endpoint: string;
    requestPayload: Record<string, any>;
    attemptCount: number;
    attemptedAt: string;
    completedAt?: string;
    success: boolean;
    couponCode?: string;
    basicCredits?: number;
    premiumCredits?: number;
    groupId?: string;
    botCount?: number;
    region?: string;
    clanId?: string;
    rawResponse?: any;
    errorMessage?: string;
    errorCode?: number;
    recoveredFromExistingGroup?: boolean;
  };
  liveGlory?: OrderLiveGlorySnapshot;
  whatsappDelivered?: boolean;
  whatsappDeliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProductDeliveryMapping {
  productId: string;
  packageId?: string;
  enabled: boolean;
  actionType: DeliveryActionType;
  basicCredits?: number;
  premiumCredits?: number;
  region?: string;
  priceLkrOverride?: number;
  updatedAt: string;
}

interface StoreProductSummary {
  id: string;
  name: string;
  category: string;
  platform: string;
  price: string;
  packages: Array<{ id: string; days: string; price: string }>;
  inStock: boolean;
}

interface FFGloryRegion {
  id: string;
  region_name: string;
  region_code: string;
  tier: string;
  enabled: boolean;
}

interface DashboardPayload {
  tenantId: string;
  botOnline: boolean;
  stats: {
    totalOrders: number;
    pendingPayments: number;
    verifiedPayments: number;
    deliveredOrders: number;
    failedOrders: number;
    totalSalesLkr: number;
    basicCredits: number | null;
    premiumCredits: number | null;
    maxGroups: number | null;
    activeGroupsCount: number | null;
    apiConnectionStatus: 'CONNECTED' | 'ERROR' | 'UNCONFIGURED';
    duplicateReceiptsBlocked?: number;
    guildOrdersCount?: number;
    totalReceiptsCount?: number;
  };
  settings: {
    ffgloryEnabled: boolean;
    operatingMode: OperatingMode;
    autoDeliverOnVerifiedPayment: boolean;
    supportContact: string;
    guildFlowEnabled?: boolean;
    welcomeOnFirstMessage?: boolean;
    guildPricing?: GuildTierPricing;
    paymentAccount?: PaymentAccountConfig;
    publicPortalBaseUrl?: string;
    hasApiKey: boolean;
    apiKeyMasked: string;
    apiKeySource: 'vault' | 'env' | 'none';
    hasMasterKey: boolean;
    masterKeyMasked: string;
    masterKeySource: 'vault' | 'env' | 'none';
    lastConnectionStatus: 'CONNECTED' | 'ERROR' | 'UNCONFIGURED';
    lastConnectionCheckedAt: string | null;
    lastConnectionError: string | null;
    cachedBalance: {
      username: string;
      role: string;
      basic_credits: number;
      premium_credits: number;
      max_groups: number;
    } | null;
    cachedActiveGroupsCount: number | null;
    cachedPricing: {
      basic_credit_usd: number;
      premium_credit_usd: number;
      regions: FFGloryRegion[];
    } | null;
    cachedPricingAt: string | null;
  };
  mappings: ProductDeliveryMapping[];
  orders: AutoOrder[];
  receiptHistory?: ReceiptHistoryEntry[];
  customerHistory?: CustomerHistoryEntry[];
  products: StoreProductSummary[];
  apiErrors: Array<{
    id: string;
    timestamp: string;
    endpoint: string;
    statusCode: number;
    message: string;
    orderId?: string;
  }>;
  auditLogs: Array<{
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    orderId?: string;
    details: string;
  }>;
}

type AutoOrderSubTab =
  | 'orders'
  | 'guild'
  | 'receipts'
  | 'glory'
  | 'customers'
  | 'mapping'
  | 'ffglory'
  | 'settings';

interface AutoOrderManagementViewProps {
  tenantId: string;
  onToast: (message: string, type?: 'success' | 'info' | 'error') => void;
  initialSubTab?: AutoOrderSubTab;
}

const ALL_STATUSES: Array<'ALL' | AutoOrderStatus> = [
  'ALL',
  'PENDING_PAYMENT',
  'PAYMENT_DETECTED',
  'PAYMENT_VERIFIED',
  'WAITING_DELIVERY',
  'DELIVERED',
  'DELIVERY_FAILED',
  'MANUAL_REVIEW',
  'CANCELLED',
];

function getStatusVisual(status: AutoOrderStatus): {
  label: string;
  textClass: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case 'DELIVERED':
      return {
        label: 'DELIVERED',
        textClass: 'text-emerald-400',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />,
      };
    case 'PAYMENT_VERIFIED':
      return {
        label: 'PAYMENT VERIFIED',
        textClass: 'text-cyan-400',
        icon: <ShieldCheck className="w-3.5 h-3.5 text-cyan-400 shrink-0" />,
      };
    case 'WAITING_DELIVERY':
      return {
        label: 'WAITING DELIVERY',
        textClass: 'text-sky-400',
        icon: <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />,
      };
    case 'PAYMENT_DETECTED':
      return {
        label: 'PAYMENT DETECTED',
        textClass: 'text-indigo-300',
        icon: <Activity className="w-3.5 h-3.5 text-indigo-300 shrink-0" />,
      };
    case 'PENDING_PAYMENT':
      return {
        label: 'PENDING PAYMENT',
        textClass: 'text-amber-400',
        icon: <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />,
      };
    case 'MANUAL_REVIEW':
      return {
        label: 'MANUAL REVIEW',
        textClass: 'text-orange-400',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0" />,
      };
    case 'DELIVERY_FAILED':
      return {
        label: 'DELIVERY FAILED',
        textClass: 'text-rose-400',
        icon: <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />,
      };
    case 'CANCELLED':
    default:
      return {
        label: 'CANCELLED',
        textClass: 'text-slate-400',
        icon: <Ban className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
      };
  }
}

export const AutoOrderManagementView: React.FC<AutoOrderManagementViewProps> = ({
  tenantId,
  onToast,
  initialSubTab,
}) => {
  const [subTab, setSubTab] = useState<AutoOrderSubTab>(initialSubTab || 'orders');
  useEffect(() => {
    if (initialSubTab) {
      setSubTab(initialSubTab);
    }
  }, [initialSubTab]);
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Orders filter & inspection modal
  const [statusFilter, setStatusFilter] = useState<'ALL' | AutoOrderStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<AutoOrder | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [approveClanIdDraft, setApproveClanIdDraft] = useState('');

  // Guild Service Pricing, Payment Account & Welcome Flow settings
  const [guildFlowEnabled, setGuildFlowEnabled] = useState(true);
  const [welcomeOnFirstMessage, setWelcomeOnFirstMessage] = useState(true);
  const [bots4Price, setBots4Price] = useState('650');
  const [bots8Price, setBots8Price] = useState('1300');
  const [bots12Price, setBots12Price] = useState('1950');
  const [bots16Price, setBots16Price] = useState('2600');
  const [bankName, setBankName] = useState('NSB (National Savings Bank)');
  const [accountName, setAccountName] = useState('A.M.Y.N Alahakoon');
  const [accountNumber, setAccountNumber] = useState('100156103618');
  const [branchName, setBranchName] = useState('eZ Cash: 074 386 5934');
  const [paymentInstructions, setPaymentInstructions] = useState(
    'NSB (100156103618 - A.M.Y.N Alahakoon) හෝ Dialog eZ Cash (074 386 5934) වෙත නිවැරදි මුදල ගෙවා Payment Receipt (Photo / PDF) එක මෙතනට එවන්න.'
  );
  const [publicPortalBaseUrl, setPublicPortalBaseUrl] = useState('');
  const [savingGuildSettings, setSavingGuildSettings] = useState(false);

  // Guild Flow Test Simulator & Inline Portal Preview (no window.open!)
  const [simGuildQty, setSimGuildQty] = useState<GuildBotQuantity>(4);
  const [simGuildPhone, setSimGuildPhone] = useState('');
  const [runningGuildSim, setRunningGuildSim] = useState(false);
  const [lastGuildSim, setLastGuildSim] = useState<{
    orderId: string;
    token: string;
    portalUrl: string;
  } | null>(null);
  const [portalPreview, setPortalPreview] = useState<{ orderId: string; token: string } | null>(null);

  // Receipt File Viewer Modal & Live Glory Refresh states
  const [receiptPreview, setReceiptPreview] = useState<{
    fileName: string;
    mimeType: string;
    objectUrl: string;
    orderId: string;
    meta?: string;
  } | null>(null);
  const [loadingReceiptFile, setLoadingReceiptFile] = useState<string | null>(null);
  const [refreshingGloryId, setRefreshingGloryId] = useState<string | null>(null);
  const [sendingGuildConfigId, setSendingGuildConfigId] = useState<string | null>(null);

  // API Settings state
  const [settingsSynced, setSettingsSynced] = useState(false);
  const [ffgloryEnabled, setFfgloryEnabled] = useState(true);
  const [operatingMode, setOperatingMode] = useState<OperatingMode>('LIVE');
  const [autoDeliver, setAutoDeliver] = useState(true);
  const [supportContact, setSupportContact] = useState('0740712934');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [masterKeyInput, setMasterKeyInput] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingConn, setTestingConn] = useState(false);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [loadingPricing, setLoadingPricing] = useState(false);

  // Test Simulator state
  const [simAction, setSimAction] = useState<'COUPON' | 'CLAN_GROUP'>('COUPON');
  const [simAmount, setSimAmount] = useState('1500');
  const [simBasic, setSimBasic] = useState('1');
  const [simPremium, setSimPremium] = useState('0');
  const [simRegion, setSimRegion] = useState('bd');
  const [simClanId, setSimClanId] = useState('123456789');
  const [simPhone, setSimPhone] = useState('');
  const [simSendWa, setSimSendWa] = useState(false);
  const [runningSim, setRunningSim] = useState(false);

  // Product Mapping editor state
  const [mappingProductId, setMappingProductId] = useState('');
  const [mappingPackageId, setMappingPackageId] = useState('');
  const [mappingActionType, setMappingActionType] = useState<DeliveryActionType>('COUPON');
  const [mappingBasic, setMappingBasic] = useState('1');
  const [mappingPremium, setMappingPremium] = useState('0');
  const [mappingRegion, setMappingRegion] = useState('bd');
  const [mappingPriceLkr, setMappingPriceLkr] = useState('');
  const [savingMapping, setSavingMapping] = useState(false);

  // FFGlory Live Panel Data
  const [liveData, setLiveData] = useState<{
    groups: any[];
    coupons: any[];
    transactions: any[];
    notifications: any[];
    errors: string[];
  } | null>(null);
  const [loadingLiveData, setLoadingLiveData] = useState(false);
  const [liveSubTab, setLiveSubTab] = useState<'groups' | 'coupons' | 'transactions' | 'notifications'>('groups');

  const headersWithTenant = useCallback(
    (extra: Record<string, string> = {}) => ({
      'x-user-id': tenantId,
      ...extra,
    }),
    [tenantId]
  );

  const fetchDashboard = useCallback(
    async (silent = false, force = false) => {
      if (!silent) setRefreshing(true);
      try {
        const res = await authFetch(`/api/auto-orders/dashboard${force ? '?force=true' : ''}`, {
          headers: headersWithTenant(),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            const payload: DashboardPayload = json.data;
            setData(payload);
            setSelectedOrder((prev) =>
              prev ? payload.orders.find((o) => o.id === prev.id) || prev : null
            );
            if (!settingsSynced && payload.settings) {
              setSettingsSynced(true);
              setFfgloryEnabled(payload.settings.ffgloryEnabled);
              setOperatingMode(payload.settings.operatingMode);
              setAutoDeliver(payload.settings.autoDeliverOnVerifiedPayment);
              setSupportContact(payload.settings.supportContact || '0740712934');
              setGuildFlowEnabled(payload.settings.guildFlowEnabled !== false);
              setWelcomeOnFirstMessage(payload.settings.welcomeOnFirstMessage !== false);
              if (payload.settings.guildPricing) {
                setBots4Price(String(payload.settings.guildPricing.bots4 ?? 650));
                setBots8Price(String(payload.settings.guildPricing.bots8 ?? 1300));
                setBots12Price(String(payload.settings.guildPricing.bots12 ?? 1950));
                setBots16Price(String(payload.settings.guildPricing.bots16 ?? 2600));
              }
              if (payload.settings.paymentAccount) {
                setBankName(payload.settings.paymentAccount.bankName || 'Commercial Bank');
                setAccountName(payload.settings.paymentAccount.accountName || 'YASHI HALLS');
                setAccountNumber(payload.settings.paymentAccount.accountNumber || '');
                setBranchName(payload.settings.paymentAccount.branchName || '');
                setPaymentInstructions(
                  payload.settings.paymentAccount.instructions ||
                    'Transfer the exact LKR amount and upload your payment slip (Image or PDF) directly in this chat.'
                );
              }
              setPublicPortalBaseUrl(payload.settings.publicPortalBaseUrl || '');
            }
            if (!mappingProductId && payload.products.length > 0) {
              setMappingProductId(payload.products[0].id);
            }
          }
        }
      } catch {
        // ignore transient poll errors
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [headersWithTenant, settingsSynced, mappingProductId]
  );

  useEffect(() => {
    fetchDashboard(true, false);
    const timer = setInterval(() => fetchDashboard(true, false), 15000);
    return () => clearInterval(timer);
  }, [fetchDashboard]);

  const filteredOrders = useMemo(() => {
    const list = data?.orders || [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((o) => {
      const statusOk = statusFilter === 'ALL' || o.status === statusFilter;
      if (!statusOk) return false;
      if (!q) return true;
      return (
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        o.customerNumber.toLowerCase().includes(q) ||
        o.productName.toLowerCase().includes(q) ||
        (o.payment?.transactionId || '').toLowerCase().includes(q) ||
        (o.delivery?.couponCode || '').toLowerCase().includes(q) ||
        (o.delivery?.groupId || '').toLowerCase().includes(q)
      );
    });
  }, [data?.orders, statusFilter, searchQuery]);

  const handleSaveSettings = async (e: React.FormEvent, forceLiveMode = false) => {
    e.preventDefault();
    soundFX.playClick();
    setSavingSettings(true);
    try {
      const nextMode: OperatingMode = forceLiveMode ? 'LIVE' : operatingMode;
      const res = await authFetch('/api/auto-orders/settings', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: tenantId,
          ffgloryEnabled: forceLiveMode ? true : ffgloryEnabled,
          operatingMode: nextMode,
          autoDeliverOnVerifiedPayment: autoDeliver,
          supportContact,
          ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
          ...(masterKeyInput.trim() ? { masterKey: masterKeyInput.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        if (forceLiveMode) {
          setOperatingMode('LIVE');
          setFfgloryEnabled(true);
        }
        setApiKeyInput('');
        setMasterKeyInput('');
        onToast(
          json.message || 'FFGlory API settings saved securely.',
          json.connectionSuccess === false ? 'error' : 'success'
        );
        await fetchDashboard(true);
      } else {
        onToast(json.message || 'Failed to save API settings', 'error');
      }
    } catch {
      onToast('Network error while saving settings', 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleTestConnection = async () => {
    soundFX.playClick();
    setTestingConn(true);
    try {
      const res = await authFetch('/api/auto-orders/test-connection', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: tenantId }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'FFGlory API Connected!', 'success');
      } else {
        onToast(json.message || 'Connection test failed', 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast('Connection test failed', 'error');
    } finally {
      setTestingConn(false);
    }
  };

  const handleCheckBalance = async () => {
    soundFX.playClick();
    setCheckingBalance(true);
    try {
      const res = await authFetch('/api/auto-orders/balance', {
        headers: headersWithTenant(),
      });
      const json = await res.json();
      if (json.success && json.data) {
        soundFX.playSuccess();
        onToast(
          `Balance synced: ${json.data.basic_credits} Basic / ${json.data.premium_credits} Premium`,
          'success'
        );
      } else {
        onToast(json.message || 'Balance check failed', 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast('Balance check failed', 'error');
    } finally {
      setCheckingBalance(false);
    }
  };

  const handleLoadPricing = async () => {
    soundFX.playClick();
    setLoadingPricing(true);
    try {
      const res = await authFetch('/api/auto-orders/pricing', {
        headers: headersWithTenant(),
      });
      const json = await res.json();
      if (json.success && json.data) {
        soundFX.playSuccess();
        onToast(
          `Loaded ${json.data.regions?.length || 0} FFGlory regions (Basic $${json.data.basic_credit_usd}, Premium $${json.data.premium_credit_usd})`,
          'success'
        );
      } else {
        onToast(json.message || 'Failed to load pricing', 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast('Failed to fetch pricing', 'error');
    } finally {
      setLoadingPricing(false);
    }
  };

  const handleFetchLiveFFGloryData = async (includeNotifications = false) => {
    soundFX.playClick();
    setLoadingLiveData(true);
    try {
      const url = `/api/auto-orders/ffglory/live-data${includeNotifications ? '?includeNotifications=true' : ''}`;
      const res = await authFetch(url, { headers: headersWithTenant() });
      const json = await res.json();
      if (json.success && json.data) {
        setLiveData((prev) => ({
          groups: json.data.groups || [],
          coupons: json.data.coupons || [],
          transactions: json.data.transactions || [],
          notifications: includeNotifications
            ? json.data.notifications || []
            : prev?.notifications || [],
          errors: json.data.errors || [],
        }));
        if (json.data.errors?.length) {
          onToast(`Loaded with warnings: ${json.data.errors[0]}`, 'info');
        } else {
          soundFX.playSuccess();
          onToast(
            includeNotifications
              ? `Fetched ${json.data.notifications?.length || 0} notifications from FFGlory.`
              : 'Synced live FFGlory groups, coupons & transactions.',
            'success'
          );
        }
      } else {
        onToast(json.message || 'Failed to load FFGlory live data', 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast('Network error loading FFGlory live data', 'error');
    } finally {
      setLoadingLiveData(false);
    }
  };

  const handleOrderAction = async (
    order: AutoOrder,
    action: 'approve' | 'reject' | 'cancel' | 'retry'
  ) => {
    soundFX.playClick();
    setBusyOrderId(order.id);
    try {
      const bodyPayload: Record<string, any> = { userId: tenantId };
      if (action === 'approve' && approveClanIdDraft.trim()) {
        bodyPayload.clanId = approveClanIdDraft.trim();
      }
      const res = await authFetch(`/api/auto-orders/orders/${order.id}/${action}`, {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(bodyPayload),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || `Order ${order.id} updated.`, 'success');
        setApproveClanIdDraft('');
      } else {
        onToast(json.message || `Failed to ${action} order`, 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast(`Network error during ${action}`, 'error');
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mappingProductId) {
      onToast('Select a product first.', 'error');
      return;
    }
    soundFX.playClick();
    setSavingMapping(true);
    try {
      const res = await authFetch('/api/auto-orders/mappings', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: tenantId,
          productId: mappingProductId,
          packageId: mappingPackageId || undefined,
          enabled: true,
          actionType: mappingActionType,
          basicCredits: mappingActionType === 'COUPON' ? Number(mappingBasic) || 0 : undefined,
          premiumCredits: mappingActionType === 'COUPON' ? Number(mappingPremium) || 0 : undefined,
          region: mappingActionType === 'CLAN_GROUP' ? mappingRegion : undefined,
          priceLkrOverride: mappingPriceLkr ? Number(mappingPriceLkr) : undefined,
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast('Product → FFGlory API mapping saved!', 'success');
        await fetchDashboard(true);
      } else {
        onToast(json.message || 'Failed to save mapping', 'error');
      }
    } catch {
      onToast('Network error saving mapping', 'error');
    } finally {
      setSavingMapping(false);
    }
  };

  const handleDeleteMapping = async (productId: string, packageId?: string) => {
    soundFX.playClick();
    try {
      const res = await authFetch('/api/auto-orders/mappings', {
        method: 'DELETE',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: tenantId, productId, packageId }),
      });
      const json = await res.json();
      if (json.success) {
        onToast('Product mapping removed.', 'info');
        await fetchDashboard(true);
      }
    } catch {
      onToast('Failed to delete mapping', 'error');
    }
  };

  const handleRunTestSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setRunningSim(true);
    try {
      const res = await authFetch('/api/auto-orders/simulate-test', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: tenantId,
          actionType: simAction,
          amountLkr: Number(simAmount) || 1500,
          basicCredits: Number(simBasic) || 0,
          premiumCredits: Number(simPremium) || 0,
          region: simRegion,
          clanId: simClanId,
          customerNumber: simPhone,
          sendWhatsApp: simSendWa,
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'Test Mode end-to-end delivery succeeded!', 'success');
        setSubTab('orders');
      } else {
        onToast(json.message || 'Simulation failed', 'error');
      }
      await fetchDashboard(true);
    } catch {
      onToast('Network error running simulation', 'error');
    } finally {
      setRunningSim(false);
    }
  };

  const handleSaveGuildSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setSavingGuildSettings(true);
    try {
      const res = await authFetch('/api/auto-orders/guild-settings', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: tenantId,
          guildFlowEnabled,
          welcomeOnFirstMessage,
          publicPortalBaseUrl: publicPortalBaseUrl.trim(),
          guildPricing: {
            bots4: Math.max(1, Number(bots4Price) || 650),
            bots8: Math.max(1, Number(bots8Price) || 1300),
            bots12: Math.max(1, Number(bots12Price) || 1950),
            bots16: Math.max(1, Number(bots16Price) || 2600),
          },
          paymentAccount: {
            bankName: bankName.trim() || 'Commercial Bank',
            accountName: accountName.trim() || 'YASHI HALLS',
            accountNumber: accountNumber.trim(),
            branchName: branchName.trim(),
            instructions: paymentInstructions.trim(),
          },
        }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'Guild Pricing & Payment Settings saved!', 'success');
        await fetchDashboard(true);
      } else {
        onToast(json.message || 'Failed to save Guild settings', 'error');
      }
    } catch {
      onToast('Network error saving Guild settings', 'error');
    } finally {
      setSavingGuildSettings(false);
    }
  };

  const handleSimulateGuildFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    setRunningGuildSim(true);
    try {
      const res = await authFetch('/api/auto-orders/simulate-guild-flow', {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          userId: tenantId,
          botQuantity: simGuildQty,
          customerNumber: simGuildPhone.trim() || '94700000000',
          customerName: 'Test Guild Customer',
        }),
      });
      const json = await res.json();
      if (json.success && json.data?.order?.id && json.data?.order?.portalToken) {
        soundFX.playSuccess();
        const createdOrderId = json.data.order.id;
        const createdToken = json.data.order.portalToken;
        const createdUrl =
          json.data.portalUrl ||
          `${window.location.origin}/guild-portal?order=${encodeURIComponent(createdOrderId)}&token=${encodeURIComponent(createdToken)}`;
        setLastGuildSim({ orderId: createdOrderId, token: createdToken, portalUrl: createdUrl });
        onToast(json.message || 'Test Guild Order ready! Opening interactive portal preview...', 'success');
        await fetchDashboard(true);
      } else {
        onToast(json.message || 'Failed to create Test Guild Order', 'error');
      }
    } catch {
      onToast('Network error running Guild simulation', 'error');
    } finally {
      setRunningGuildSim(false);
    }
  };

  const handleCloseReceiptViewer = useCallback(() => {
    setReceiptPreview((prev) => {
      if (prev?.objectUrl) {
        URL.revokeObjectURL(prev.objectUrl);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (receiptPreview?.objectUrl) {
        URL.revokeObjectURL(receiptPreview.objectUrl);
      }
    };
  }, [receiptPreview]);

  const handleOpenReceiptViewer = async (
    storedFileName: string,
    mimeType: string,
    orderId: string,
    meta?: string
  ) => {
    soundFX.playClick();
    setLoadingReceiptFile(storedFileName);
    try {
      const res = await authFetch(`/api/auto-orders/receipt-file/${encodeURIComponent(storedFileName)}`, {
        headers: headersWithTenant(),
      });
      if (!res.ok) {
        onToast('Unable to load receipt file from server.', 'error');
        return;
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      setReceiptPreview((prev) => {
        if (prev?.objectUrl) URL.revokeObjectURL(prev.objectUrl);
        return {
          fileName: storedFileName,
          mimeType: mimeType || blob.type || 'image/jpeg',
          objectUrl,
          orderId,
          meta,
        };
      });
    } catch {
      onToast('Network error loading receipt preview.', 'error');
    } finally {
      setLoadingReceiptFile(null);
    }
  };

  const handleRefreshOrderLiveGlory = async (orderId: string) => {
    soundFX.playClick();
    setRefreshingGloryId(orderId);
    try {
      const res = await authFetch(`/api/auto-orders/orders/${encodeURIComponent(orderId)}/live-glory`, {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: tenantId }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'Live Glory telemetry refreshed.', 'success');
        await fetchDashboard(true);
      } else {
        onToast(json.message || 'Failed to refresh Live Glory.', 'error');
      }
    } catch {
      onToast('Network error refreshing Live Glory.', 'error');
    } finally {
      setRefreshingGloryId(null);
    }
  };

  const handleResendGuildConfig = async (orderId: string) => {
    soundFX.playClick();
    setSendingGuildConfigId(orderId);
    try {
      const res = await authFetch(`/api/auto-orders/orders/${encodeURIComponent(orderId)}/send-guild-config`, {
        method: 'POST',
        headers: headersWithTenant({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId: tenantId }),
      });
      const json = await res.json();
      if (json.success) {
        soundFX.playSuccess();
        onToast(json.message || 'Guild Configuration Card sent to WhatsApp!', 'success');
      } else {
        onToast(json.message || 'Could not send via WhatsApp right now.', 'info');
      }
    } catch {
      onToast('Network error sending Guild Configuration Card.', 'error');
    } finally {
      setSendingGuildConfigId(null);
    }
  };

  const launchedGuildOrders = useMemo(
    () => (data?.orders || []).filter((o) => Boolean(o.delivery?.groupId)),
    [data?.orders]
  );

  const selectedMappingProduct = useMemo(
    () => (data?.products || []).find((p) => p.id === mappingProductId) || null,
    [data?.products, mappingProductId]
  );

  const availableRegions = useMemo<FFGloryRegion[]>(() => {
    const cached = data?.settings?.cachedPricing?.regions;
    if (Array.isArray(cached) && cached.length > 0) return cached;
    return [
      { id: 'bd', region_name: 'Bangladesh', region_code: 'BD', tier: 'basic', enabled: true },
      { id: 'me', region_name: 'Middle East', region_code: 'ME', tier: 'premium', enabled: true },
      { id: 'ind', region_name: 'India', region_code: 'IND', tier: 'basic', enabled: true },
      { id: 'sg', region_name: 'Singapore', region_code: 'SG', tier: 'basic', enabled: true },
    ];
  }, [data?.settings?.cachedPricing]);

  if (loading && !data) {
    return (
      <div className="rounded-2xl bg-[#0d1424] border border-slate-800 p-8 text-center space-y-3">
        <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin mx-auto" />
        <p className="text-sm text-slate-400">Loading Auto Order Management &amp; FFGlory API Console...</p>
      </div>
    );
  }

  const stats = data?.stats;
  const settings = data?.settings;
  const isLive = settings?.operatingMode === 'LIVE';

  return (
    <div className="space-y-5 text-slate-100">
      {/* Header Bar */}
      <div className="rounded-2xl bg-[#0d1424] border border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">
              Auto Order Management
            </h2>
            <span className="text-xs font-mono text-slate-500">·</span>
            <span
              className={`text-xs font-mono font-semibold ${
                isLive ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {isLive ? 'LIVE MODE (FFGlory API)' : 'TEST MODE (Safe Simulation)'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Automated WhatsApp ordering, YASHI HALLS Pay verification, and instant FFGlory Panel API delivery.
          </p>
          <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono pt-0.5 flex-wrap">
            <span>
              WhatsApp Bot:{' '}
              <strong className={data?.botOnline ? 'text-emerald-400' : 'text-amber-400'}>
                {data?.botOnline ? 'Online' : 'Offline'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              FFGlory API:{' '}
              <strong
                className={
                  stats?.apiConnectionStatus === 'CONNECTED'
                    ? 'text-emerald-400'
                    : stats?.apiConnectionStatus === 'ERROR'
                    ? 'text-rose-400'
                    : 'text-slate-300'
                }
              >
                {stats?.apiConnectionStatus || 'UNCONFIGURED'}
              </strong>
            </span>
            {settings?.cachedBalance?.username && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Account: <strong className="text-cyan-300">{settings.cachedBalance.username}</strong>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => {
              soundFX.playClick();
              setSubTab('guild');
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'guild'
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-purple-950/60 hover:bg-purple-900/70 border-purple-500/40 text-purple-200'
            }`}
          >
            <Shield className="w-3.5 h-3.5 text-purple-300" />
            <span>Glory Bot Prices</span>
          </button>

          <button
            type="button"
            onClick={handleCheckBalance}
            disabled={checkingBalance}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <Coins className="w-3.5 h-3.5 text-amber-400" />
            <span>{checkingBalance ? 'Syncing...' : 'Sync Balance'}</span>
          </button>

          <button
            type="button"
            onClick={() => fetchDashboard(false, true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>Refresh Live</span>
          </button>
        </div>
      </div>

      {/* Sub-Navigation Segmented Control (pinned right below header for instant mobile access) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 rounded-xl bg-[#0a101d] border border-slate-800">
        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('orders');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'orders'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Layers className="w-3.5 h-3.5 shrink-0" />
          <span>Orders ({data?.orders?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('guild');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'guild'
              ? 'bg-purple-950/70 text-purple-200 border border-purple-500/50'
              : 'text-slate-400 hover:text-purple-200'
          }`}
        >
          <Shield className="w-3.5 h-3.5 shrink-0 text-purple-400" />
          <span>Guild Pricing &amp; Pay</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('receipts');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'receipts'
              ? 'bg-purple-950/70 text-purple-200 border border-purple-500/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Receipt className="w-3.5 h-3.5 shrink-0 text-violet-400" />
          <span>Receipts ({data?.receiptHistory?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('glory');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'glory'
              ? 'bg-purple-950/70 text-purple-200 border border-purple-500/50'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Trophy className="w-3.5 h-3.5 shrink-0 text-amber-400" />
          <span>Live Glory ({launchedGuildOrders.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('customers');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'customers'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span>Customers ({data?.customerHistory?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('mapping');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'mapping'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Flame className="w-3.5 h-3.5 shrink-0" />
          <span>Product Mapping ({data?.mappings?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('ffglory');
            if (!liveData && settings?.hasApiKey && settings?.hasMasterKey) {
              void handleFetchLiveFFGloryData(false);
            }
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'ffglory'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Server className="w-3.5 h-3.5 shrink-0" />
          <span>FFGlory Panel</span>
        </button>

        <button
          type="button"
          onClick={() => {
            soundFX.playClick();
            setSubTab('settings');
          }}
          className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            subTab === 'settings'
              ? 'bg-slate-800 text-white border border-slate-700'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <SettingsIcon className="w-3.5 h-3.5 shrink-0" />
          <span>API Settings &amp; Test</span>
        </button>
      </div>

      {/* LIVE FFGLORY CREDITS & ACCOUNT TELEMETRY BAR (OR 1-STEP QUICK CONNECT) */}
      {settings?.hasApiKey && settings?.hasMasterKey ? (
        <div className="rounded-2xl bg-[#0b1322] border border-cyan-500/30 p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Coins className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-sm font-bold text-white">FFGlory Live Account Credits</h3>
              <span className="text-xs font-mono text-slate-500">·</span>
              <span className="text-xs font-mono text-cyan-300">
                {settings.cachedBalance?.username || 'Syncing...'}
              </span>
              {settings.lastConnectionCheckedAt && (
                <>
                  <span className="text-xs font-mono text-slate-500">·</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Synced {new Date(settings.lastConnectionCheckedAt).toLocaleTimeString()}
                  </span>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleCheckBalance}
              disabled={checkingBalance}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-semibold text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              <RefreshCw className={`w-3 h-3 ${checkingBalance ? 'animate-spin' : ''}`} />
              <span>{checkingBalance ? 'Updating Credits...' : 'Update Live Credits'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-[#080e1a] border border-slate-800 p-3.5 flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Live Basic Credits</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-sky-400 mt-1">
                  {stats?.basicCredits !== null && stats?.basicCredits !== undefined ? stats.basicCredits : '—'}
                </div>
              </div>
              {settings.cachedPricing && (
                <div className="text-[11px] font-mono text-slate-400 text-right">
                  ${settings.cachedPricing.basic_credit_usd}/credit
                </div>
              )}
            </div>

            <div className="rounded-xl bg-[#080e1a] border border-slate-800 p-3.5 flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Live Premium Credits</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-amber-300 mt-1">
                  {stats?.premiumCredits !== null && stats?.premiumCredits !== undefined ? stats.premiumCredits : '—'}
                </div>
              </div>
              {settings.cachedPricing && (
                <div className="text-[11px] font-mono text-slate-400 text-right">
                  ${settings.cachedPricing.premium_credit_usd}/credit
                </div>
              )}
            </div>

            <div className="rounded-xl bg-[#080e1a] border border-slate-800 p-3.5 flex items-baseline justify-between gap-3">
              <div>
                <div className="text-[11px] text-slate-400 font-medium">Active / Max Groups</div>
                <div className="text-2xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
                  {stats?.activeGroupsCount !== null && stats?.activeGroupsCount !== undefined
                    ? stats.activeGroupsCount
                    : '0'}
                  <span className="text-sm text-slate-500 font-normal">
                    {' '}/ {stats?.maxGroups ?? '—'}
                  </span>
                </div>
              </div>
              <div className="text-[11px] font-mono text-slate-400 text-right">
                {settings.cachedPricing?.regions?.filter((r) => r.enabled).length ?? 0} regions live
              </div>
            </div>
          </div>

          {settings.lastConnectionError && (
            <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
              Connection warning: {settings.lastConnectionError}
            </div>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => handleSaveSettings(e, true)}
          className="rounded-2xl bg-rose-950/25 border border-rose-500/50 p-4 sm:p-5 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-rose-400 shrink-0" />
                <span>⚠️ FFGlory API තවම Connect කර නැත — Connect FFGlory API (LIVE)</span>
              </h3>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                සැබෑ Customer Orders සඳහා <span className="font-mono text-cyan-300">https://ffglory.pro</span> වෙත කෝල් වී සැබෑ Clan Details සහ Glory Bots launch වීමට ඔබේ FFGlory <span className="font-mono text-amber-300">api_key</span> සහ{' '}
                <span className="font-mono text-amber-300">x-api-key</span> (Master Header Key) මෙහි ඇතුළත් කර <span className="font-bold text-white">Connect &amp; Go LIVE</span> ඔබන්න.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
            <input
              type="password"
              autoComplete="new-password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="FFGlory Account API Key (ak_...)"
              required
              className="sm:col-span-5 bg-[#080d18] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <input
              type="password"
              autoComplete="new-password"
              value={masterKeyInput}
              onChange={(e) => setMasterKeyInput(e.target.value)}
              placeholder="FFGlory Master Header Key (x-api-key)"
              required
              className="sm:col-span-4 bg-[#080d18] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              disabled={savingSettings}
              className="sm:col-span-3 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-black transition-colors whitespace-nowrap cursor-pointer disabled:opacity-60"
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{savingSettings ? 'Connecting...' : 'Connect & Go LIVE'}</span>
            </button>
          </div>
        </form>
      )}

      {/* KPI Metrics Grid (All 9 Required Metrics with Tabular Numerals) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">Total Orders</div>
          <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
            {stats?.totalOrders ?? 0}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">Pending Payments</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-400 mt-1">
            {stats?.pendingPayments ?? 0}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">Verified Payments</div>
          <div className="text-xl font-bold font-mono tabular-nums text-cyan-400 mt-1">
            {stats?.verifiedPayments ?? 0}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">Delivered Orders</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-400 mt-1">
            {stats?.deliveredOrders ?? 0}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">Failed Orders</div>
          <div className="text-xl font-bold font-mono tabular-nums text-rose-400 mt-1">
            {stats?.failedOrders ?? 0}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5 sm:col-span-2 lg:col-span-2">
          <div className="text-[11px] text-slate-400 font-medium">Total Verified Sales</div>
          <div className="text-xl font-bold font-mono tabular-nums text-white mt-1">
            LKR {(stats?.totalSalesLkr ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">FFGlory Basic Credits</div>
          <div className="text-xl font-bold font-mono tabular-nums text-sky-400 mt-1">
            {stats?.basicCredits !== null && stats?.basicCredits !== undefined ? stats.basicCredits : '—'}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">FFGlory Premium Credits</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-300 mt-1">
            {stats?.premiumCredits !== null && stats?.premiumCredits !== undefined ? stats.premiumCredits : '—'}
          </div>
        </div>

        <div className="rounded-xl bg-[#0d1424] border border-slate-800 p-3.5">
          <div className="text-[11px] text-slate-400 font-medium">API Connection</div>
          <div className="flex items-center gap-1.5 mt-1.5 text-sm font-mono font-bold">
            {stats?.apiConnectionStatus === 'CONNECTED' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-400">Connected</span>
              </>
            ) : stats?.apiConnectionStatus === 'ERROR' ? (
              <>
                <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span className="text-rose-400">Error</span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-slate-300">Not Set</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Sub-navigation moved directly beneath the header bar */}

      {/* TAB 1: ORDERS MANAGER */}
      {subTab === 'orders' && (
        <div className="rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search Order ID, WhatsApp number, product, Ref, Coupon..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#080d18] border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  {ALL_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {st === 'ALL' ? 'All Statuses' : st.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-300">No orders match the current filter.</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Orders placed via your WhatsApp Business Bot appear here automatically with live payment matching and FFGlory delivery status.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('settings')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer"
              >
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Run Test Mode Simulation</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] font-semibold text-slate-400 bg-[#0a101d]">
                    <th className="py-2.5 px-4">Order ID</th>
                    <th className="py-2.5 px-4">Customer</th>
                    <th className="py-2.5 px-4">Product &amp; Action</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 text-xs">
                  {filteredOrders.map((order) => {
                    const stVis = getStatusVisual(order.status);
                    const isBusy = busyOrderId === order.id;
                    const canApprove =
                      order.status === 'PENDING_PAYMENT' ||
                      order.status === 'PAYMENT_DETECTED' ||
                      order.status === 'MANUAL_REVIEW';
                    const isSimulatedTestDelivery =
                      order.status === 'DELIVERED' &&
                      (order.delivery?.mode === 'TEST' || String(order.delivery?.groupId || '').startsWith('test_grp_'));
                    const canRetry = order.status === 'DELIVERY_FAILED' || isSimulatedTestDelivery;
                    const canCancel =
                      order.status !== 'DELIVERED' && order.status !== 'CANCELLED' && order.status !== 'WAITING_DELIVERY';

                    return (
                      <tr key={order.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4 font-mono tabular-nums">
                          <div className="font-bold text-white">{order.id}</div>
                          <div className="text-[10px] text-slate-500">
                            {new Date(order.createdAt).toLocaleString()} · {order.mode}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-200 truncate max-w-[150px]">
                            {order.customerName}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            +{order.customerNumber}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="font-medium text-white truncate max-w-[200px]">
                            {order.productName}
                            {order.packageDays ? ` (${order.packageDays})` : ''}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            {order.deliveryAction}
                            {order.deliveryParams.clan_id ? ` · Clan ${order.deliveryParams.clan_id}` : ''}
                            {order.deliveryParams.region ? ` · ${order.deliveryParams.region.toUpperCase()}` : ''}
                            {order.delivery?.couponCode ? ` · ${order.delivery.couponCode}` : ''}
                            {order.delivery?.groupId ? ` · Grp ${order.delivery.groupId}` : ''}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <div className="font-semibold text-white">
                            LKR {Number(order.amountLkr || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                          {order.payment?.transactionId && (
                            <div className="text-[10px] text-slate-400">
                              Ref: {order.payment.transactionId}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <div className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold ${stVis.textClass}`}>
                            {stVis.icon}
                            <span>{stVis.label}</span>
                          </div>
                          {order.statusReason && (
                            <div className="text-[10px] text-slate-500 truncate max-w-[200px] mt-0.5">
                              {order.statusReason}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            <button
                              type="button"
                              onClick={() => {
                                soundFX.playClick();
                                setSelectedOrder(order);
                                setApproveClanIdDraft(order.deliveryParams.clan_id || '');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>View</span>
                            </button>

                            {canApprove && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleOrderAction(order, 'approve')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>Approve</span>
                              </button>
                            )}

                            {canRetry && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleOrderAction(order, 'retry')}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold cursor-pointer whitespace-nowrap disabled:opacity-50"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                <span>Retry</span>
                              </button>
                            )}

                            {canCancel && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => handleOrderAction(order, 'cancel')}
                                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/80 text-slate-300 hover:text-white text-[11px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-50"
                                title="Cancel Order"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 1B: GUILD PRICING, PAYMENT ACCOUNT & INTERACTIVE PORTAL TESTER */}
      {subTab === 'guild' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleSaveGuildSettings}
            className="lg:col-span-7 rounded-2xl bg-[#0e0a1a] border border-purple-500/30 p-5 space-y-5"
          >
            <div className="flex items-start justify-between gap-3 border-b border-purple-500/20 pb-3.5">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Shield className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>YASHI HALLS Guild Service Pricing &amp; Payment Card</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Configure Glory Bot tier prices (LKR), bank transfer details rendered on Phase 3 WhatsApp Payment Cards, and automated Welcome Card triggers.
                </p>
              </div>
            </div>

            {/* Interactive Flow Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between p-3 rounded-xl bg-[#07050f] border border-purple-500/25 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Interactive Guild Ordering</div>
                  <div className="text-[11px] text-slate-400">Enable Phase 1–8 UI Cards &amp; Buttons</div>
                </div>
                <input
                  type="checkbox"
                  checked={guildFlowEnabled}
                  onChange={(e) => setGuildFlowEnabled(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
              </label>

              <label className="flex items-center justify-between p-3 rounded-xl bg-[#07050f] border border-purple-500/25 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-white">Auto Welcome on First Message</div>
                  <div className="text-[11px] text-slate-400">Send GUILD / PANEL card on greeting</div>
                </div>
                <input
                  type="checkbox"
                  checked={welcomeOnFirstMessage}
                  onChange={(e) => setWelcomeOnFirstMessage(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
              </label>
            </div>

            {/* Bot Quantity Pricing Grid */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-purple-200">
                  Phase 2 Glory Bot Tier Pricing (LKR)
                </label>
                <span className="text-[11px] font-mono text-slate-400">Default: 650 / 1300 / 1950 / 2600</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: '4 BOTS', val: bots4Price, setter: setBots4Price },
                  { label: '8 BOTS', val: bots8Price, setter: setBots8Price },
                  { label: '12 BOTS', val: bots12Price, setter: setBots12Price },
                  { label: '16 BOTS', val: bots16Price, setter: setBots16Price },
                ].map((tier) => (
                  <div
                    key={tier.label}
                    className="rounded-xl bg-[#07050f] border border-purple-500/25 p-3 space-y-1.5"
                  >
                    <div className="text-[11px] font-mono font-bold text-purple-300">{tier.label}</div>
                    <div className="relative">
                      <span className="text-[10px] font-mono text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2">
                        LKR
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={tier.val}
                        onChange={(e) => tier.setter(e.target.value)}
                        className="w-full bg-[#120d22] border border-purple-500/30 rounded-lg pl-10 pr-2 py-1.5 text-xs font-mono font-bold text-white focus:outline-none focus:border-purple-400"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-400">
                Note: FFGlory&apos;s <span className="font-mono text-slate-300">POST /api/client/auto-clan-group</span> accepts{' '}
                <span className="font-mono text-slate-300">{'{ region, clan_id }'}</span> only. Customer&apos;s selected bot quantity is saved in Order DB &amp; priced automatically; actual FFGlory API <span className="font-mono text-slate-300">bot_count</span> is displayed transparently on the Success Card.
              </p>
            </div>

            {/* Bank Account Details (Phase 3 Payment Card) */}
            <div className="space-y-3 border-t border-purple-500/20 pt-4">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-purple-400 shrink-0" />
                <span className="text-xs font-bold text-white">Phase 3 Bank Transfer Payment Details</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. Commercial Bank"
                    className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Account Holder Name</label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="e.g. YASHI HALLS"
                    className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Account Number</label>
                  <input
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    placeholder="e.g. 8001234567"
                    className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-300 mb-1">Branch Name (Optional)</label>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder="e.g. Colombo Main"
                    className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">Payment Card Instructions</label>
                <textarea
                  rows={2}
                  value={paymentInstructions}
                  onChange={(e) => setPaymentInstructions(e.target.value)}
                  className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-400"
                />
              </div>

              <div>
                <label className="block text-[11px] text-slate-300 mb-1">
                  Public Portal Base URL (Optional — auto-detected if blank)
                </label>
                <input
                  type="url"
                  value={publicPortalBaseUrl}
                  onChange={(e) => setPublicPortalBaseUrl(e.target.value)}
                  placeholder="https://your-public-domain.com"
                  className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-purple-400"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={savingGuildSettings}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>{savingGuildSettings ? 'Saving Settings...' : 'Save Guild Pricing & Payment Settings'}</span>
            </button>
          </form>

          {/* Right Panel: Safe Test Mode Interactive Guild Portal Tester */}
          <div className="lg:col-span-5 space-y-4 self-start">
            <form
              onSubmit={handleSimulateGuildFlow}
              className="rounded-2xl bg-[#0e0a1a] border border-purple-500/30 p-5 space-y-4"
            >
              <div className="flex items-start justify-between gap-3 border-b border-purple-500/20 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>Interactive Guild Portal Tester</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Generate a payment-verified Test Guild Order and preview the live Dark Purple + Black Customer Configuration Card (Phases 5–8) directly inside the dashboard.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Select Test Bot Quantity
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {([4, 8, 12, 16] as GuildBotQuantity[]).map((qty) => (
                    <button
                      key={qty}
                      type="button"
                      onClick={() => setSimGuildQty(qty)}
                      className={`py-2 px-2 rounded-lg text-xs font-mono font-bold border transition-colors cursor-pointer ${
                        simGuildQty === qty
                          ? 'bg-purple-600/30 border-purple-400 text-white'
                          : 'bg-[#07050f] border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {qty} BOTS
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Test Customer WhatsApp Number (Optional)
                </label>
                <input
                  type="text"
                  value={simGuildPhone}
                  onChange={(e) => setSimGuildPhone(e.target.value)}
                  placeholder="e.g. 0740712934"
                  className="w-full bg-[#07050f] border border-purple-500/25 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500"
                />
              </div>

              <button
                type="submit"
                disabled={runningGuildSim || isLive}
                className="w-full py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
              >
                {isLive
                  ? 'Switch to TEST MODE in API Settings to Test'
                  : runningGuildSim
                  ? 'Creating Verified Test Order...'
                  : 'Create Test Guild Order & Portal'}
              </button>

              {lastGuildSim && (
                <div className="p-3.5 rounded-xl bg-[#07050f] border border-purple-500/40 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-purple-300">{lastGuildSim.orderId}</span>
                    <span className="text-emerald-400 font-semibold">Verified &amp; Ready</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setPortalPreview({ orderId: lastGuildSim.orderId, token: lastGuildSim.token })
                      }
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Open Interactive Guild Portal</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(lastGuildSim.portalUrl);
                        onToast('Customer Guild Portal URL copied!', 'success');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy URL</span>
                    </button>
                  </div>
                </div>
              )}
            </form>

            {/* Quick System Verification Summary */}
            <div className="rounded-2xl bg-[#0d1424] border border-slate-800 p-4 space-y-2 text-xs">
              <div className="font-bold text-white">Active Guild Order Safeguards</div>
              <ul className="space-y-1.5 text-slate-400">
                <li>• Phase 1–3 &amp; 5–8 PNG Cards dynamically rendered on server (Dark Purple + Black).</li>
                <li>• Phase 4 Receipt AI OCR + SHA-256 hash lock + Android Bank Notification cross-check.</li>
                <li>• Phase 5 Hybrid Web Card + Native WhatsApp quick-reply &amp; COPY DETAILS parser.</li>
                <li>• Phase 10 Timeout Safety checks FFGlory active groups before any retry launch.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TAB 1C: RECEIPTS & DUPLICATE HISTORY */}
      {subTab === 'receipts' && (
        <div className="rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white">Uploaded Payment Receipts &amp; Duplicate Protection</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Every customer image/PDF slip is SHA-256 hashed, parsed with Gemini Vision OCR, and cross-checked against real Android Bank Notifications.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-mono">
              <span className="text-slate-300">
                Total: <strong className="text-white">{stats?.totalReceiptsCount ?? data?.receiptHistory?.length ?? 0}</strong>
              </span>
              <span className="text-rose-400">
                Duplicates Blocked: <strong>{stats?.duplicateReceiptsBlocked ?? 0}</strong>
              </span>
            </div>
          </div>

          {!data?.receiptHistory?.length ? (
            <div className="p-10 text-center space-y-2">
              <Receipt className="w-7 h-7 text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-300">No payment receipts uploaded yet.</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                When customers send bank slip images or PDFs via WhatsApp during Phase 4, their OCR extraction, hash status, and viewable receipt file appear here automatically.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-[#0a101d]">
                    <th className="py-2.5 px-4">Order &amp; Time</th>
                    <th className="py-2.5 px-4">Customer</th>
                    <th className="py-2.5 px-4">AI OCR Extracted Details</th>
                    <th className="py-2.5 px-4">SHA-256 Hash</th>
                    <th className="py-2.5 px-4">Verification Status</th>
                    <th className="py-2.5 px-4 text-right">Receipt File</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {data.receiptHistory.map((r) => {
                    const isDup =
                      r.status === 'REJECTED_DUPLICATE_HASH' || r.status === 'REJECTED_DUPLICATE_REF';
                    const statusColor =
                      r.status === 'VERIFIED'
                        ? 'text-emerald-400'
                        : isDup || r.status === 'REJECTED_AMOUNT_MISMATCH'
                        ? 'text-rose-400'
                        : r.status === 'MANUAL_REVIEW'
                        ? 'text-orange-400'
                        : 'text-amber-300';
                    return (
                      <tr key={r.id} className="hover:bg-slate-800/30">
                        <td className="py-3 px-4 font-mono">
                          <div className="font-bold text-white">{r.orderId}</div>
                          <div className="text-[10px] text-slate-500">
                            {new Date(r.uploadedAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-200 font-medium">{r.customerName}</div>
                          <div className="text-[11px] font-mono text-slate-400">+{r.customerNumber}</div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] space-y-0.5">
                          <div className="text-white">
                            {r.ocrData?.bankName || 'Unknown Bank'} ·{' '}
                            {r.ocrData?.amountLkr !== undefined
                              ? `LKR ${r.ocrData.amountLkr}`
                              : `Expected LKR ${r.expectedAmountLkr}`}
                          </div>
                          <div className="text-slate-400">
                            Ref: {r.ocrData?.transactionRefId || '—'}
                            {r.ocrData?.paymentDateTime ? ` · ${r.ocrData.paymentDateTime}` : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                          {r.fileHash ? `${r.fileHash.slice(0, 12)}…` : '—'}
                        </td>
                        <td className="py-3 px-4">
                          <div className={`font-mono text-[11px] font-bold ${statusColor}`}>
                            {r.status.replace(/_/g, ' ')}
                          </div>
                          <div className="text-[11px] text-slate-400 max-w-[240px] truncate" title={r.reason}>
                            {r.reason}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={loadingReceiptFile === r.storedFileName}
                            onClick={() =>
                              handleOpenReceiptViewer(
                                r.storedFileName,
                                r.mimeType,
                                r.orderId,
                                `${r.customerName} · ${r.status.replace(/_/g, ' ')}`
                              )
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/40 text-purple-200 text-[11px] font-semibold cursor-pointer whitespace-nowrap disabled:opacity-60"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>
                              {loadingReceiptFile === r.storedFileName ? 'Loading...' : 'View Slip'}
                            </span>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 1D: LIVE GLORY MONITOR */}
      {subTab === 'glory' && (
        <div className="rounded-2xl bg-[#0e0a1a] border border-purple-500/30 overflow-hidden">
          <div className="p-4 border-b border-purple-500/20 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-400 shrink-0" />
                <span>Live Guild Glory &amp; Active Clan Group Monitor</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time telemetry fetched directly from FFGlory API (<span className="font-mono text-slate-300">get-glory</span> &amp; <span className="font-mono text-slate-300">get-clan-info</span>) with built-in rate-limit protection.
              </p>
            </div>
            <span className="text-xs font-mono text-purple-300">
              {launchedGuildOrders.length} launched group{launchedGuildOrders.length === 1 ? '' : 's'}
            </span>
          </div>

          {launchedGuildOrders.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Trophy className="w-7 h-7 text-purple-500/60 mx-auto" />
              <p className="text-sm font-medium text-slate-300">No Glory Bot groups launched yet.</p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Once a Guild order completes Phase 6 launch on FFGlory Panel, live glory points, clan level, member count, and group uptime appear here.
              </p>
              <button
                type="button"
                onClick={() => setSubTab('guild')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Open Guild Portal Tester</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-purple-500/15">
              {launchedGuildOrders.map((order) => {
                const glory = order.liveGlory;
                const isSyncing = refreshingGloryId === order.id;
                return (
                  <div
                    key={order.id}
                    className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-purple-950/20 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-bold text-white">{order.id}</span>
                        <span className="text-xs font-mono text-purple-300">
                          Group: {order.delivery?.groupId}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          · Clan: {order.delivery?.clanId || order.guildConfig?.clanId || '—'}
                        </span>
                        <span className="text-xs font-mono text-cyan-300">
                          · {(order.delivery?.region || order.guildConfig?.regionId || '—').toUpperCase()}
                        </span>
                        <span className="text-[11px] font-mono text-slate-500">· {order.mode}</span>
                      </div>
                      <div className="text-xs text-slate-300">
                        Customer: <span className="text-white font-medium">{order.customerName}</span> (+{order.customerNumber})
                        {' · '}Selected: <span className="font-mono text-purple-300">{order.botQuantity || 4} BOTS</span>
                        {' · '}API Bots: <span className="font-mono text-emerald-400">{order.delivery?.botCount ?? '—'}</span>
                      </div>
                      {glory ? (
                        <div className="flex items-center gap-4 flex-wrap pt-1 text-xs font-mono tabular-nums">
                          <span className="text-amber-300 font-bold">
                            Glory: {glory.currentGlory ?? '—'}
                          </span>
                          {glory.clanName && <span className="text-slate-200">Clan: {glory.clanName}</span>}
                          {glory.clanLevel !== undefined && (
                            <span className="text-slate-300">Lv.{glory.clanLevel}</span>
                          )}
                          {glory.memberCount !== undefined && (
                            <span className="text-slate-300">Members: {glory.memberCount}</span>
                          )}
                          <span className="text-emerald-400">Status: {glory.groupStatus}</span>
                          <span className="text-slate-500 text-[11px]">
                            Updated {new Date(glory.lastUpdatedAt).toLocaleTimeString()}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-500 pt-0.5">
                          Live glory not fetched yet — click Refresh Live Glory to query FFGlory API.
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                      <button
                        type="button"
                        disabled={isSyncing}
                        onClick={() => handleRefreshOrderLiveGlory(order.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                        <span>{isSyncing ? 'Fetching...' : 'Refresh Live Glory'}</span>
                      </button>

                      {order.portalToken && (
                        <button
                          type="button"
                          onClick={() =>
                            setPortalPreview({ orderId: order.id, token: order.portalToken! })
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Live Card</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 1E: CUSTOMER HISTORY */}
      {subTab === 'customers' && (
        <div className="rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white">Customer Order History</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Aggregated WhatsApp customer order counts, delivered totals, and verified LKR spend.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {data?.customerHistory?.length || 0} unique customer{(data?.customerHistory?.length || 0) === 1 ? '' : 's'}
            </span>
          </div>

          {!data?.customerHistory?.length ? (
            <div className="p-10 text-center text-xs text-slate-400">
              No customers recorded yet. Customers appear automatically as orders are placed via WhatsApp or Test Mode.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-[#0a101d]">
                    <th className="py-2.5 px-4">Customer</th>
                    <th className="py-2.5 px-4">WhatsApp Number</th>
                    <th className="py-2.5 px-4 text-right">Total Orders</th>
                    <th className="py-2.5 px-4 text-right">Delivered</th>
                    <th className="py-2.5 px-4 text-right">Total Verified Spend</th>
                    <th className="py-2.5 px-4 text-right">Last Order</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 font-mono tabular-nums">
                  {data.customerHistory.map((c) => (
                    <tr key={c.customerNumber} className="hover:bg-slate-800/30">
                      <td className="py-3 px-4 font-sans font-medium text-white">{c.customerName}</td>
                      <td className="py-3 px-4 text-slate-300">+{c.customerNumber}</td>
                      <td className="py-3 px-4 text-right text-slate-200">{c.totalOrders}</td>
                      <td className="py-3 px-4 text-right text-emerald-400">{c.deliveredOrders}</td>
                      <td className="py-3 px-4 text-right text-cyan-300 font-bold">
                        LKR {c.totalSpentLkr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-400">
                        <div>{c.lastOrderId}</div>
                        <div className="text-[10px] text-slate-500">
                          {new Date(c.lastOrderAt).toLocaleString()}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PRODUCT -> FFGLORY API MAPPING */}
      {subTab === 'mapping' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <form
            onSubmit={handleSaveMapping}
            className="lg:col-span-5 rounded-2xl bg-[#0d1424] border border-slate-800 p-5 space-y-4 self-start"
          >
            <div>
              <h3 className="text-sm font-bold text-white">Map Store Product to FFGlory API</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Link any WhatsApp Business Store product to automatically create a Coupon or launch a Clan Glory Group after payment verification.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Business Store Product</label>
                <select
                  value={mappingProductId}
                  onChange={(e) => {
                    setMappingProductId(e.target.value);
                    setMappingPackageId('');
                  }}
                  className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                >
                  {(data?.products || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.price})
                    </option>
                  ))}
                </select>
              </div>

              {selectedMappingProduct && selectedMappingProduct.packages.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Specific Package (Optional)
                  </label>
                  <select
                    value={mappingPackageId}
                    onChange={(e) => setMappingPackageId(e.target.value)}
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">All Packages (Product Default)</option>
                    {selectedMappingProduct.packages.map((pk) => (
                      <option key={pk.id} value={pk.id}>
                        {pk.days} — {pk.price}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">FFGlory API Action</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['COUPON', 'CLAN_GROUP', 'MANUAL'] as DeliveryActionType[]).map((act) => (
                    <button
                      key={act}
                      type="button"
                      onClick={() => setMappingActionType(act)}
                      className={`py-2 px-2 rounded-lg text-[11px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        mappingActionType === act
                          ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                          : 'bg-[#080d18] border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      {act === 'COUPON' ? 'Create Coupon' : act === 'CLAN_GROUP' ? 'Clan Group' : 'Manual'}
                    </button>
                  ))}
                </div>
              </div>

              {mappingActionType === 'COUPON' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Basic Credits (0–100)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={mappingBasic}
                      onChange={(e) => setMappingBasic(e.target.value)}
                      className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Premium Credits (0–20)</label>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={mappingPremium}
                      onChange={(e) => setMappingPremium(e.target.value)}
                      className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                </div>
              )}

              {mappingActionType === 'CLAN_GROUP' && (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    FFGlory Server Region
                  </label>
                  <select
                    value={mappingRegion}
                    onChange={(e) => setMappingRegion(e.target.value)}
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                  >
                    {availableRegions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.region_name} ({r.region_code}) — {r.tier.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    The WhatsApp Bot will automatically ask the customer for their Free Fire Clan ID before generating the order.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Exact LKR Amount Override (Optional)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={mappingPriceLkr}
                  onChange={(e) => setMappingPriceLkr(e.target.value)}
                  placeholder="Leave blank to use product price"
                  className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500"
                />
              </div>

              <button
                type="submit"
                disabled={savingMapping}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                <span>{savingMapping ? 'Saving Mapping...' : 'Save Product API Mapping'}</span>
              </button>
            </div>
          </form>

          <div className="lg:col-span-7 rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Active Product Delivery Mappings</h3>
              <span className="text-xs font-mono text-slate-400">
                {data?.mappings?.length || 0} configured
              </span>
            </div>

            {!data?.mappings?.length ? (
              <div className="p-8 text-center text-xs text-slate-400">
                No products are mapped to FFGlory API yet. Select a product on the left to enable automated Coupon or Clan Group delivery.
              </div>
            ) : (
              <div className="divide-y divide-slate-800">
                {data.mappings.map((m) => {
                  const prod = data.products.find((p) => p.id === m.productId);
                  const pkg = m.packageId ? prod?.packages.find((pk) => pk.id === m.packageId) : null;
                  return (
                    <div
                      key={`${m.productId}:${m.packageId || 'all'}`}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-slate-800/20"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-xs font-semibold text-white truncate">
                          {prod?.name || m.productId}
                          {pkg ? ` · ${pkg.days}` : ' · All Packages'}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {m.actionType === 'COUPON'
                            ? `POST /api/client/create-coupon · Basic: ${m.basicCredits || 0} / Premium: ${m.premiumCredits || 0}`
                            : m.actionType === 'CLAN_GROUP'
                            ? `POST /api/client/auto-clan-group · Region: ${(m.region || 'bd').toUpperCase()}`
                            : 'Manual Fulfillment'}
                          {m.priceLkrOverride ? ` · LKR ${m.priceLkrOverride}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteMapping(m.productId, m.packageId)}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                        title="Remove mapping"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: FFGLORY LIVE PANEL (Groups, Coupons, Transactions, Notifications) */}
      {subTab === 'ffglory' && (
        <div className="rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'groups', label: 'My Groups', icon: Flame },
                  { id: 'coupons', label: 'My Coupons', icon: Ticket },
                  { id: 'transactions', label: 'Transactions', icon: FileText },
                  { id: 'notifications', label: 'Notifications', icon: Bell },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setLiveSubTab(tab.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      liveSubTab === tab.id
                        ? 'bg-slate-800 text-white border border-slate-700'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={loadingLiveData}
                onClick={() => handleFetchLiveFFGloryData(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingLiveData ? 'animate-spin' : ''}`} />
                <span>Sync Live Data</span>
              </button>
              {liveSubTab === 'notifications' && (
                <button
                  type="button"
                  disabled={loadingLiveData}
                  onClick={() => handleFetchLiveFFGloryData(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <Bell className="w-3.5 h-3.5" />
                  <span>Fetch Notifications</span>
                </button>
              )}
            </div>
          </div>

          <div className="p-4">
            {!settings?.hasApiKey || !settings?.hasMasterKey ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-sm text-slate-300 font-medium">FFGlory API credentials are not configured yet.</p>
                <p className="text-xs text-slate-500">Open API Settings &amp; Test to securely save your API Key and x-api-key Master Key.</p>
              </div>
            ) : !liveData ? (
              <div className="py-8 text-center">
                <button
                  type="button"
                  onClick={() => handleFetchLiveFFGloryData(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white cursor-pointer"
                >
                  Load Live FFGlory Groups, Coupons &amp; Transactions
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                {liveSubTab === 'groups' && (
                  liveData.groups.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No active groups found on FFGlory Panel.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-3">Group ID</th>
                          <th className="py-2 px-3">Clan ID</th>
                          <th className="py-2 px-3">Region</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3 text-right">Bots</th>
                          <th className="py-2 px-3 text-right">Uptime</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {liveData.groups.map((g, i) => (
                          <tr key={g.group_id || i}>
                            <td className="py-2.5 px-3 text-white">{g.group_id}</td>
                            <td className="py-2.5 px-3 text-slate-300">{g.clan_id}</td>
                            <td className="py-2.5 px-3 text-cyan-300">{g.region}</td>
                            <td className="py-2.5 px-3 text-emerald-400">{g.status}</td>
                            <td className="py-2.5 px-3 text-right text-slate-300">
                              {g.running_count ?? 0}/{g.container_count ?? 0}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-400">{g.uptime || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}

                {liveSubTab === 'coupons' && (
                  liveData.coupons.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No created coupons found.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-3">Coupon Code</th>
                          <th className="py-2 px-3 text-right">Basic</th>
                          <th className="py-2 px-3 text-right">Premium</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3 text-right">Created</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {liveData.coupons.map((c, i) => (
                          <tr key={c.code || i}>
                            <td className="py-2.5 px-3 text-white font-bold">{c.code}</td>
                            <td className="py-2.5 px-3 text-right text-sky-400">{c.basic_credits}</td>
                            <td className="py-2.5 px-3 text-right text-amber-300">{c.premium_credits}</td>
                            <td className="py-2.5 px-3 text-slate-300">{c.status}</td>
                            <td className="py-2.5 px-3 text-right text-slate-400">
                              {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}

                {liveSubTab === 'transactions' && (
                  liveData.transactions.length === 0 ? (
                    <p className="text-xs text-slate-400 py-6 text-center">No FFGlory transactions found.</p>
                  ) : (
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-2 px-3">Transaction ID</th>
                          <th className="py-2 px-3">Order Ref</th>
                          <th className="py-2 px-3 text-right">Basic</th>
                          <th className="py-2 px-3 text-right">Premium</th>
                          <th className="py-2 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                        {liveData.transactions.map((t, i) => (
                          <tr key={t.id || i}>
                            <td className="py-2.5 px-3 text-white">{t.id}</td>
                            <td className="py-2.5 px-3 text-slate-400">{t.order_id || '—'}</td>
                            <td className="py-2.5 px-3 text-right text-sky-400">{t.basic_credits}</td>
                            <td className="py-2.5 px-3 text-right text-amber-300">{t.premium_credits}</td>
                            <td className="py-2.5 px-3 text-emerald-400">{t.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )
                )}

                {liveSubTab === 'notifications' && (
                  <div className="space-y-3">
                    <p className="text-[11px] text-amber-400/90">
                      Note: Per FFGlory API specification, GET /api/client/notifications clears notifications after reading. Click &quot;Fetch Notifications&quot; above when ready to pull new alerts.
                    </p>
                    {liveData.notifications.length === 0 ? (
                      <p className="text-xs text-slate-400 py-4 text-center">No unread notifications loaded.</p>
                    ) : (
                      <div className="space-y-2">
                        {liveData.notifications.map((n, i) => (
                          <div key={i} className="p-3 rounded-lg bg-[#080d18] border border-slate-800 text-xs">
                            <div className="font-semibold text-white">
                              [{n.type || 'info'}] {n.title || 'Notification'}
                            </div>
                            <p className="text-slate-400 mt-0.5">{n.message}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: API SETTINGS, REGIONS/PRICING, TEST SIMULATOR & ERROR/AUDIT LOGS */}
      {subTab === 'settings' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* API Configuration Form */}
            <form
              onSubmit={handleSaveSettings}
              className="lg:col-span-7 rounded-2xl bg-[#0d1424] border border-slate-800 p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">FFGlory Panel API Settings</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Endpoint locked to https://ffglory.pro · Keys encrypted on server &amp; never sent to browser.
                  </p>
                </div>
                <KeyRound className="w-5 h-5 text-cyan-400 shrink-0" />
              </div>

              {/* Operating Mode Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-300">Operating Mode</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setOperatingMode('TEST')}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      operatingMode === 'TEST'
                        ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                        : 'bg-[#080d18] border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5" />
                      <span>TEST MODE</span>
                    </div>
                    <p className="text-[11px] opacity-80 mt-0.5">
                      Verifies flow safely without spending real FFGlory credits.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setOperatingMode('LIVE')}
                    className={`p-3 rounded-xl border text-left transition-colors cursor-pointer ${
                      operatingMode === 'LIVE'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300'
                        : 'bg-[#080d18] border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <div className="text-xs font-bold flex items-center gap-1.5">
                      <Radio className="w-3.5 h-3.5" />
                      <span>LIVE MODE</span>
                    </div>
                    <p className="text-[11px] opacity-80 mt-0.5">
                      Calls real FFGlory API &amp; deducts real credits on verified payments.
                    </p>
                  </button>
                </div>
              </div>

              {/* Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="flex items-center justify-between p-3 rounded-xl bg-[#080d18] border border-slate-800 cursor-pointer">
                  <span className="text-xs font-medium text-slate-200">Enable FFGlory API</span>
                  <input
                    type="checkbox"
                    checked={ffgloryEnabled}
                    onChange={(e) => setFfgloryEnabled(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500"
                  />
                </label>

                <label className="flex items-center justify-between p-3 rounded-xl bg-[#080d18] border border-slate-800 cursor-pointer">
                  <span className="text-xs font-medium text-slate-200">Auto-Deliver on Verify</span>
                  <input
                    type="checkbox"
                    checked={autoDeliver}
                    onChange={(e) => setAutoDeliver(e.target.checked)}
                    className="w-4 h-4 accent-cyan-500"
                  />
                </label>
              </div>

              {/* Secure Secret Inputs */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-300">FFGlory Account API Key (api_key)</label>
                    <span className="text-[11px] font-mono text-slate-400">
                      {settings?.hasApiKey
                        ? `Stored (${settings.apiKeySource}): ${settings.apiKeyMasked}`
                        : 'Not configured'}
                    </span>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder={
                      settings?.hasApiKey
                        ? 'Leave blank to keep existing encrypted key'
                        : 'Enter ak_... key (saved encrypted on server)'
                    }
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-slate-300">FFGlory Master Header Key (x-api-key)</label>
                    <span className="text-[11px] font-mono text-slate-400">
                      {settings?.hasMasterKey
                        ? `Stored (${settings.masterKeySource}): ${settings.masterKeyMasked}`
                        : 'Not configured'}
                    </span>
                  </div>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={masterKeyInput}
                    onChange={(e) => setMasterKeyInput(e.target.value)}
                    placeholder={
                      settings?.hasMasterKey
                        ? 'Leave blank to keep existing encrypted master key'
                        : 'Enter x-api-key header value'
                    }
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Customer Support WhatsApp Contact (included in delivery messages)
                  </label>
                  <input
                    type="text"
                    value={supportContact}
                    onChange={(e) => setSupportContact(e.target.value)}
                    placeholder="0740712934"
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingSettings}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{savingSettings ? 'Saving...' : 'Save Secure Settings'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={testingConn}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{testingConn ? 'Testing...' : 'Test API Connection'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleLoadPricing}
                  disabled={loadingPricing}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-semibold text-white cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  <Globe className="w-3.5 h-3.5 text-sky-400" />
                  <span>{loadingPricing ? 'Loading...' : 'Load Regions & Pricing'}</span>
                </button>
              </div>

              {settings?.lastConnectionError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300">
                  Last connection error: {settings.lastConnectionError}
                </div>
              )}
            </form>

            {/* Test Mode End-to-End Simulator */}
            <form
              onSubmit={handleRunTestSimulation}
              className="lg:col-span-5 rounded-2xl bg-[#0d1424] border border-slate-800 p-5 space-y-4 self-start"
            >
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">Test Mode End-to-End Simulator</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Verify Order → Payment Matching → FFGlory Delivery → WhatsApp message before switching to LIVE MODE.
                  </p>
                </div>
                <FlaskConical className="w-5 h-5 text-amber-400 shrink-0" />
              </div>

              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSimAction('COUPON')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                      simAction === 'COUPON'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'bg-[#080d18] border-slate-800 text-slate-400'
                    }`}
                  >
                    Simulate Coupon
                  </button>
                  <button
                    type="button"
                    onClick={() => setSimAction('CLAN_GROUP')}
                    className={`py-2 px-3 rounded-lg text-xs font-semibold border cursor-pointer ${
                      simAction === 'CLAN_GROUP'
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300'
                        : 'bg-[#080d18] border-slate-800 text-slate-400'
                    }`}
                  >
                    Simulate Clan Group
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Simulated Payment Amount (LKR)</label>
                  <input
                    type="number"
                    min="1"
                    value={simAmount}
                    onChange={(e) => setSimAmount(e.target.value)}
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                  />
                </div>

                {simAction === 'COUPON' ? (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Basic Credits</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={simBasic}
                        onChange={(e) => setSimBasic(e.target.value)}
                        className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Premium Credits</label>
                      <input
                        type="number"
                        min="0"
                        max="20"
                        value={simPremium}
                        onChange={(e) => setSimPremium(e.target.value)}
                        className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Region</label>
                      <select
                        value={simRegion}
                        onChange={(e) => setSimRegion(e.target.value)}
                        className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        {availableRegions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.region_code} ({r.region_name})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-slate-300 mb-1">Test Clan ID</label>
                      <input
                        type="text"
                        value={simClanId}
                        onChange={(e) => setSimClanId(e.target.value)}
                        className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs text-slate-300 mb-1">
                    Optional WhatsApp Number (for test receipt)
                  </label>
                  <input
                    type="text"
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    placeholder="e.g. 0740712934"
                    className="w-full bg-[#080d18] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500"
                  />
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simSendWa}
                    onChange={(e) => setSimSendWa(e.target.checked)}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span>Also send [TEST MODE] delivery message via WhatsApp Bot</span>
                </label>

                <button
                  type="submit"
                  disabled={runningSim || isLive}
                  className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isLive
                    ? 'Switch to TEST MODE to Run Simulation'
                    : runningSim
                    ? 'Running Simulation...'
                    : 'Run Full Test Order + Delivery'}
                </button>
              </div>
            </form>
          </div>

          {/* Regions & Pricing Table */}
          {settings?.cachedPricing && (
            <div className="rounded-2xl bg-[#0d1424] border border-slate-800 overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">FFGlory Regions &amp; Current Pricing</h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Basic: ${settings.cachedPricing.basic_credit_usd}/credit · Premium: ${settings.cachedPricing.premium_credit_usd}/credit
                  </p>
                </div>
                {settings.cachedPricingAt && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Updated {new Date(settings.cachedPricingAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-[#0a101d]">
                      <th className="py-2 px-4">Region ID</th>
                      <th className="py-2 px-4">Region Name</th>
                      <th className="py-2 px-4">Code</th>
                      <th className="py-2 px-4">Tier</th>
                      <th className="py-2 px-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 font-mono">
                    {settings.cachedPricing.regions.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2.5 px-4 text-white">{r.id}</td>
                        <td className="py-2.5 px-4 font-sans text-slate-200">{r.region_name}</td>
                        <td className="py-2.5 px-4 text-cyan-300">{r.region_code}</td>
                        <td className="py-2.5 px-4 text-amber-300 uppercase">{r.tier}</td>
                        <td className="py-2.5 px-4 text-right">
                          <span className={r.enabled ? 'text-emerald-400' : 'text-rose-400'}>
                            {r.enabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* API Errors & Admin Audit Logs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="rounded-2xl bg-[#0d1424] border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">FFGlory API Error Log</h3>
                <span className="text-xs font-mono text-slate-400">{data?.apiErrors?.length || 0} entries</span>
              </div>
              {!data?.apiErrors?.length ? (
                <p className="text-xs text-slate-500 py-4 text-center">No API errors recorded.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {data.apiErrors.map((err) => (
                    <div key={err.id} className="p-2.5 rounded-lg bg-[#080d18] border border-slate-800 text-xs font-mono space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-rose-400 font-semibold">
                          HTTP {err.statusCode} · {err.endpoint}
                        </span>
                        <span className="text-slate-500">{new Date(err.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div className="text-slate-300 font-sans text-xs">{err.message}</div>
                      {err.orderId && <div className="text-[10px] text-slate-500">Order: {err.orderId}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl bg-[#0d1424] border border-slate-800 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Order &amp; Admin Audit Log</h3>
                <span className="text-xs font-mono text-slate-400">{data?.auditLogs?.length || 0} entries</span>
              </div>
              {!data?.auditLogs?.length ? (
                <p className="text-xs text-slate-500 py-4 text-center">No audit events logged yet.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {data.auditLogs.map((log) => (
                    <div key={log.id} className="p-2.5 rounded-lg bg-[#080d18] border border-slate-800 text-xs space-y-0.5">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-cyan-400 font-semibold">{log.action}</span>
                        <span className="text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                      </div>
                      <div className="text-slate-200">{log.details}</div>
                      <div className="text-[10px] text-slate-500 font-mono">
                        Actor: {log.actor}{log.orderId ? ` · Order: ${log.orderId}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ORDER DETAIL & API RESPONSE MODAL */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-[#0d1424] border border-slate-700 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white font-mono">
                  Order {selectedOrder.id}
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {selectedOrder.productName} · {selectedOrder.mode} MODE · Created {new Date(selectedOrder.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Summary Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800 space-y-1">
                <div className="text-slate-400 font-medium">Customer &amp; Product</div>
                <div className="text-white font-semibold">{selectedOrder.customerName}</div>
                <div className="font-mono text-slate-300">+{selectedOrder.customerNumber}</div>
                <div className="text-slate-300">
                  {selectedOrder.productName}
                  {selectedOrder.packageDays ? ` (${selectedOrder.packageDays})` : ''}
                </div>
                <div className="font-mono text-cyan-300">
                  LKR {selectedOrder.amountLkr.toLocaleString('en-US', { minimumFractionDigits: 2 })} ({selectedOrder.deliveryAction})
                </div>
              </div>

              <div className="p-3 rounded-xl bg-[#080d18] border border-slate-800 space-y-1">
                <div className="text-slate-400 font-medium">Payment Verification Details</div>
                {selectedOrder.payment ? (
                  <>
                    <div className="text-emerald-400 font-semibold">
                      {selectedOrder.payment.bank} ({selectedOrder.payment.source.toUpperCase()})
                    </div>
                    <div className="font-mono text-white">
                      Amount: LKR {selectedOrder.payment.amountLkr.toFixed(2)}
                    </div>
                    <div className="font-mono text-slate-300">
                      Txn ID: {selectedOrder.payment.transactionId}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Verified By: {selectedOrder.payment.verifiedBy} · {new Date(selectedOrder.payment.paidAt).toLocaleString()}
                    </div>
                  </>
                ) : (
                  <div className="text-amber-400">Awaiting verified bank payment confirmation.</div>
                )}
              </div>
            </div>

            {/* Uploaded Receipt OCR & View Slip Section */}
            {selectedOrder.receipt && (
              <div className="p-3.5 rounded-xl bg-[#0e0a1a] border border-purple-500/30 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-purple-200 flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-purple-400" />
                    <span>Uploaded Payment Slip ({selectedOrder.receipt.verificationStatus.replace(/_/g, ' ')})</span>
                  </div>
                  <button
                    type="button"
                    disabled={loadingReceiptFile === selectedOrder.receipt.storedFileName}
                    onClick={() =>
                      handleOpenReceiptViewer(
                        selectedOrder.receipt!.storedFileName,
                        selectedOrder.receipt!.mimeType,
                        selectedOrder.id,
                        selectedOrder.receipt!.verificationNote
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
                  >
                    <Eye className="w-3 h-3" />
                    <span>View Uploaded Slip</span>
                  </button>
                </div>
                <div className="text-slate-300">{selectedOrder.receipt.verificationNote}</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-slate-400 pt-1">
                  <div>Bank: <span className="text-white">{selectedOrder.receipt.ocrData?.bankName || '—'}</span></div>
                  <div>Amount: <span className="text-white">{selectedOrder.receipt.ocrData?.amountLkr !== undefined ? `LKR ${selectedOrder.receipt.ocrData.amountLkr}` : '—'}</span></div>
                  <div>Ref: <span className="text-white">{selectedOrder.receipt.ocrData?.transactionRefId || '—'}</span></div>
                  <div>Hash: <span className="text-slate-300">{selectedOrder.receipt.fileHash.slice(0, 10)}…</span></div>
                </div>
              </div>
            )}

            {/* Guild Configuration & Interactive Customer Portal Section */}
            {(selectedOrder.serviceType === 'GUILD_SERVICE' || selectedOrder.portalToken || selectedOrder.guildConfig) && (
              <div className="p-3.5 rounded-xl bg-[#0e0a1a] border border-purple-500/30 space-y-2.5 text-xs">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-semibold text-purple-200 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-purple-400" />
                    <span>Guild Configuration ({selectedOrder.botQuantity || 4} BOTS Selected)</span>
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedOrder.portalToken && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setPortalPreview({
                              orderId: selectedOrder.id,
                              token: selectedOrder.portalToken!,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Preview Portal</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const url = `${window.location.origin}/guild-portal?order=${encodeURIComponent(selectedOrder.id)}&token=${encodeURIComponent(selectedOrder.portalToken!)}`;
                            navigator.clipboard.writeText(url);
                            onToast('Customer Guild Portal URL copied!', 'success');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-semibold cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                          <span>Copy Link</span>
                        </button>
                      </>
                    )}
                    {selectedOrder.status === 'PAYMENT_VERIFIED' && (
                      <button
                        type="button"
                        disabled={sendingGuildConfigId === selectedOrder.id}
                        onClick={() => handleResendGuildConfig(selectedOrder.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold cursor-pointer disabled:opacity-60"
                      >
                        <Send className="w-3 h-3" />
                        <span>{sendingGuildConfigId === selectedOrder.id ? 'Sending...' : 'Resend Config Card'}</span>
                      </button>
                    )}
                  </div>
                </div>
                {selectedOrder.guildConfig ? (
                  <div className="font-mono text-[11px] text-slate-300">
                    Region: <span className="text-white">{selectedOrder.guildConfig.regionName} ({selectedOrder.guildConfig.regionId.toUpperCase()})</span>
                    {' · '}Guild ID: <span className="text-white">{selectedOrder.guildConfig.clanId}</span>
                    {' · '}Via: <span className="text-purple-300">{selectedOrder.guildConfig.submittedVia}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    Awaiting customer Region &amp; Guild ID submission via Interactive Web Card or WhatsApp quick-reply.
                  </div>
                )}
              </div>
            )}

            {/* Live Glory Section inside Order Detail Modal */}
            {selectedOrder.delivery?.groupId && (
              <div className="p-3.5 rounded-xl bg-[#0e0a1a] border border-purple-500/30 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-amber-300 flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" />
                    <span>Live Glory Telemetry</span>
                  </span>
                  <button
                    type="button"
                    disabled={refreshingGloryId === selectedOrder.id}
                    onClick={() => handleRefreshOrderLiveGlory(selectedOrder.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold cursor-pointer disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3 h-3 ${refreshingGloryId === selectedOrder.id ? 'animate-spin' : ''}`} />
                    <span>{refreshingGloryId === selectedOrder.id ? 'Syncing...' : 'Refresh Live Glory'}</span>
                  </button>
                </div>
                {selectedOrder.liveGlory ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                    <div>Glory: <strong className="text-amber-300">{selectedOrder.liveGlory.currentGlory ?? '—'}</strong></div>
                    <div>Clan: <strong className="text-white">{selectedOrder.liveGlory.clanName || '—'}</strong></div>
                    <div>Level: <strong className="text-white">{selectedOrder.liveGlory.clanLevel ?? '—'}</strong></div>
                    <div>Status: <strong className="text-emerald-400">{selectedOrder.liveGlory.groupStatus}</strong></div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">Click Refresh Live Glory to fetch live clan glory stats from FFGlory API.</div>
                )}
              </div>
            )}

            {/* Delivery Details */}
            {selectedOrder.delivery && (
              <div className="p-3.5 rounded-xl bg-[#080d18] border border-slate-800 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">
                    FFGlory Delivery Result ({selectedOrder.delivery.endpoint})
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Attempt #{selectedOrder.delivery.attemptCount}
                  </span>
                </div>

                {selectedOrder.delivery.couponCode && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/50">
                    <span className="font-mono font-bold text-emerald-300">
                      Coupon: {selectedOrder.delivery.couponCode}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(selectedOrder.delivery!.couponCode!);
                        onToast('Coupon code copied!', 'success');
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-xs text-white cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                )}

                {selectedOrder.delivery.groupId && (
                  <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/50 font-mono text-emerald-300">
                    Group ID: {selectedOrder.delivery.groupId} · Clan: {selectedOrder.delivery.clanId} · Region: {selectedOrder.delivery.region?.toUpperCase()} · Bots: {selectedOrder.delivery.botCount ?? 4}
                  </div>
                )}

                {selectedOrder.delivery.errorMessage && (
                  <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-800/50 text-rose-300">
                    Error (HTTP {selectedOrder.delivery.errorCode || 500}): {selectedOrder.delivery.errorMessage}
                  </div>
                )}

                {selectedOrder.delivery.rawResponse && (
                  <div>
                    <div className="text-[11px] text-slate-400 mb-1">Sanitized API Response</div>
                    <pre className="p-2.5 rounded-lg bg-black/50 border border-slate-800 text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40">
                      {JSON.stringify(selectedOrder.delivery.rawResponse, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Admin Actions inside Modal */}
            <div className="border-t border-slate-800 pt-3 space-y-3">
              {selectedOrder.deliveryAction === 'CLAN_GROUP' &&
                !selectedOrder.deliveryParams.clan_id &&
                selectedOrder.status !== 'DELIVERED' && (
                  <div>
                    <label className="block text-xs text-amber-300 mb-1">
                      Clan ID Required Before Approving Delivery
                    </label>
                    <input
                      type="text"
                      value={approveClanIdDraft}
                      onChange={(e) => setApproveClanIdDraft(e.target.value)}
                      placeholder="Enter Free Fire Clan ID (e.g. 123456789)"
                      className="w-full bg-[#080d18] border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white"
                    />
                  </div>
                )}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {(selectedOrder.status === 'PENDING_PAYMENT' ||
                  selectedOrder.status === 'PAYMENT_DETECTED' ||
                  selectedOrder.status === 'MANUAL_REVIEW') && (
                  <>
                    <button
                      type="button"
                      disabled={busyOrderId === selectedOrder.id}
                      onClick={() => handleOrderAction(selectedOrder, 'approve')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Approve Payment &amp; Deliver</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyOrderId === selectedOrder.id}
                      onClick={() => handleOrderAction(selectedOrder, 'reject')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject Payment</span>
                    </button>
                  </>
                )}

                {(selectedOrder.status === 'DELIVERY_FAILED' ||
                  (selectedOrder.status === 'DELIVERED' &&
                    (selectedOrder.delivery?.mode === 'TEST' ||
                      String(selectedOrder.delivery?.groupId || '').startsWith('test_grp_')))) && (
                  <button
                    type="button"
                    disabled={busyOrderId === selectedOrder.id}
                    onClick={() => handleOrderAction(selectedOrder, 'retry')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>
                      {selectedOrder.status === 'DELIVERED' ? 'Launch LIVE on FFGlory' : 'Retry Failed Delivery'}
                    </span>
                  </button>
                )}

                {selectedOrder.status !== 'DELIVERED' &&
                  selectedOrder.status !== 'CANCELLED' &&
                  selectedOrder.status !== 'WAITING_DELIVERY' && (
                    <button
                      type="button"
                      disabled={busyOrderId === selectedOrder.id}
                      onClick={() => handleOrderAction(selectedOrder, 'cancel')}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer disabled:opacity-50"
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Cancel Order</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* INLINE CUSTOMER GUILD PORTAL PREVIEW MODAL (ZERO window.open) */}
      {portalPreview && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-[#07050c]">
          <GuildConfigPortal
            orderId={portalPreview.orderId}
            token={portalPreview.token}
            onExitPreview={() => {
              setPortalPreview(null);
              void fetchDashboard(true);
            }}
          />
        </div>
      )}

      {/* UPLOADED RECEIPT SLIP VIEWER MODAL (IMAGE & PDF) */}
      {receiptPreview && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-[#0e0a1a] border border-purple-500/40 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-purple-500/20 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-bold text-white font-mono truncate">
                  Receipt Slip · {receiptPreview.orderId}
                </div>
                {receiptPreview.meta && (
                  <div className="text-xs text-slate-400 truncate">{receiptPreview.meta}</div>
                )}
              </div>
              <button
                type="button"
                onClick={handleCloseReceiptViewer}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-[#07050c] flex items-center justify-center min-h-[320px]">
              {receiptPreview.mimeType.includes('pdf') ? (
                <iframe
                  src={receiptPreview.objectUrl}
                  title={`Receipt PDF ${receiptPreview.orderId}`}
                  className="w-full h-[68vh] rounded-lg border border-slate-800 bg-white"
                />
              ) : (
                <img
                  src={receiptPreview.objectUrl}
                  alt={`Payment receipt for ${receiptPreview.orderId}`}
                  className="max-w-full max-h-[70vh] object-contain rounded-lg border border-purple-500/25"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
