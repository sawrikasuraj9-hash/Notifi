import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getActivePayTunnelUrl, isPreviewAuthGatedOrigin } from './payTunnelService';

export interface BusinessPayConfig {
  enabled: boolean;
  webhookSecret: string;
  autoMatchOrders: boolean;
  notifyOwnerOnPayment: boolean;
  notifyCustomerOnMatch: boolean;
  bankDetailsText: string;
  minAmountLkr: number;
  lkrPerUsdRate: number;
}

export interface BusinessPayEvent {
  id: string;
  source: 'sms' | 'notification' | 'test';
  sender: string;
  bank: string;
  appPackage?: string;
  rawMessage: string;
  amountLkr: number;
  balanceLkr?: number;
  reference: string;
  status: 'matched' | 'unmatched' | 'ignored';
  matchedOrderId?: string;
  deviceId?: string;
  deviceName?: string;
  timestamp: string;
  receivedAt?: string;
}

export interface BusinessPayOrder {
  id: string;
  customerJid: string;
  customerNumber: string;
  productId: string;
  productName: string;
  packageDays?: string;
  priceDisplay: string;
  amountLkr: number;
  status: 'pending_payment' | 'paid' | 'cancelled';
  matchedEventId?: string;
  matchedRef?: string;
  matchedBank?: string;
  paidAt?: string;
  createdAt: string;
}

export interface BusinessPayDevice {
  deviceId: string;
  deviceName: string;
  appVersion: string;
  batteryLevel?: number;
  simOperator?: string;
  firstConnectedAt?: string;
  lastConnectNotifiedAt?: string;
  lastSeenAt: string;
}

export interface BusinessPayState {
  tenantId: string;
  secretKey: string;
  publicOrigin?: string;
  lastServerOrigin?: string;
  config: BusinessPayConfig;
  events: BusinessPayEvent[];
  orders: BusinessPayOrder[];
  devices: BusinessPayDevice[];
  updatedAt: string;
}

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');
const APK_DIR = path.resolve(process.cwd(), 'data', 'apk');

let cachedApkHash: { path: string; mtimeMs: number; size: number; sha256: string } | null = null;

function sanitizeTenant(tenantId: string): string {
  const clean = String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'default';
}

export function normalizeServerOrigin(rawOrigin?: string): string {
  const trimmed = String(rawOrigin || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0';
    if (!isLocal && parsed.protocol === 'http:') {
      parsed.protocol = 'https:';
    }
    return parsed.origin;
  } catch {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
}

function getPayFilePath(tenantId: string): string {
  const dir = path.resolve(SESSIONS_DIR, sanitizeTenant(tenantId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir, 'business_pay_db.json');
}

function generateSecretKey(): string {
  return `YHPAY-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
}

function createDefaultPayState(tenantId: string): BusinessPayState {
  const secret = generateSecretKey();
  const envOrigin = normalizeServerOrigin(process.env.APP_URL || process.env.PUBLIC_APP_URL || '');
  return {
    tenantId: sanitizeTenant(tenantId),
    secretKey: secret,
    publicOrigin: envOrigin,
    lastServerOrigin: envOrigin,
    config: {
      enabled: true,
      webhookSecret: secret,
      autoMatchOrders: true,
      notifyOwnerOnPayment: true,
      notifyCustomerOnMatch: true,
      bankDetailsText: 'Bank details will be provided by the store owner.',
      minAmountLkr: 50,
      lkrPerUsdRate: 300,
    },
    events: [],
    orders: [],
    devices: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getBusinessPayState(tenantId: string): BusinessPayState {
  const filePath = getPayFilePath(tenantId);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const def = createDefaultPayState(tenantId);
      const resolvedSecret = String(
        parsed?.config?.webhookSecret || parsed?.secretKey || def.secretKey
      ).trim();
      const resolvedOrigin = normalizeServerOrigin(
        parsed?.lastServerOrigin || parsed?.publicOrigin || process.env.APP_URL || ''
      );

      const state: BusinessPayState = {
        ...def,
        ...parsed,
        tenantId: sanitizeTenant(tenantId),
        secretKey: resolvedSecret,
        publicOrigin: resolvedOrigin,
        lastServerOrigin: resolvedOrigin,
        config: {
          ...def.config,
          ...(parsed.config || {}),
          webhookSecret: resolvedSecret,
        },
        events: Array.isArray(parsed.events) ? parsed.events : [],
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
        devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      };

      // Self-heal legacy DBs missing webhookSecret or using http:// for non-localhost
      if (
        parsed?.config?.webhookSecret !== resolvedSecret ||
        parsed?.lastServerOrigin !== resolvedOrigin ||
        parsed?.publicOrigin !== resolvedOrigin
      ) {
        saveBusinessPayState(state);
      }
      return state;
    }
  } catch {
    // fallback
  }
  const initial = createDefaultPayState(tenantId);
  saveBusinessPayState(initial);
  return initial;
}

export function saveBusinessPayState(state: BusinessPayState): BusinessPayState {
  const filePath = getPayFilePath(state.tenantId);
  const syncedSecret = state.config.webhookSecret || state.secretKey || generateSecretKey();
  state.secretKey = syncedSecret;
  state.config.webhookSecret = syncedSecret;
  const syncedOrigin = normalizeServerOrigin(state.lastServerOrigin || state.publicOrigin || process.env.APP_URL || '');
  state.publicOrigin = syncedOrigin;
  state.lastServerOrigin = syncedOrigin;
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state;
}

export function setBusinessPayOrigin(tenantId: string, origin: string): void {
  const normalized = normalizeServerOrigin(origin);
  if (!normalized) return;
  const state = getBusinessPayState(tenantId);
  if (state.lastServerOrigin !== normalized || state.publicOrigin !== normalized) {
    state.publicOrigin = normalized;
    state.lastServerOrigin = normalized;
    saveBusinessPayState(state);
  }
}

export function updateBusinessPayConfig(
  tenantId: string,
  updates: Partial<BusinessPayConfig>
): BusinessPayState {
  const state = getBusinessPayState(tenantId);
  if (typeof updates.enabled === 'boolean') state.config.enabled = updates.enabled;
  if (typeof updates.autoMatchOrders === 'boolean') state.config.autoMatchOrders = updates.autoMatchOrders;
  if (typeof updates.notifyOwnerOnPayment === 'boolean') state.config.notifyOwnerOnPayment = updates.notifyOwnerOnPayment;
  if (typeof updates.notifyCustomerOnMatch === 'boolean') state.config.notifyCustomerOnMatch = updates.notifyCustomerOnMatch;
  if (typeof updates.bankDetailsText === 'string') state.config.bankDetailsText = updates.bankDetailsText;
  if (typeof updates.minAmountLkr === 'number' && Number.isFinite(updates.minAmountLkr)) {
    state.config.minAmountLkr = Math.max(0, updates.minAmountLkr);
  }
  if (typeof updates.lkrPerUsdRate === 'number' && Number.isFinite(updates.lkrPerUsdRate) && updates.lkrPerUsdRate > 0) {
    state.config.lkrPerUsdRate = updates.lkrPerUsdRate;
  }
  return saveBusinessPayState(state);
}

export function rotateBusinessPaySecret(tenantId: string): BusinessPayState {
  const state = getBusinessPayState(tenantId);
  const nextSecret = generateSecretKey();
  state.secretKey = nextSecret;
  state.config.webhookSecret = nextSecret;
  // Reset notification flag so re-linking with the new key triggers a fresh WhatsApp confirmation
  state.devices = state.devices.map((d) => ({ ...d, lastConnectNotifiedAt: undefined }));
  return saveBusinessPayState(state);
}

function extractSecretFromPossibleLinkKey(rawSecret: string): string {
  const trimmed = String(rawSecret || '').trim();
  if (trimmed.startsWith('YHP.') || trimmed.startsWith('YHP_')) {
    try {
      const jsonStr = Buffer.from(trimmed.slice(4).trim(), 'base64url').toString('utf8');
      const obj = JSON.parse(jsonStr);
      if (obj && typeof obj.k === 'string' && obj.k.trim()) {
        return obj.k.trim();
      }
    } catch {
      // fall through
    }
  }
  return trimmed;
}

export function resolveTenantByPaySecret(
  secret: string,
  preferredTenant?: string
): BusinessPayState | null {
  const cleanSecret = extractSecretFromPossibleLinkKey(secret);
  if (!cleanSecret) return null;

  if (preferredTenant) {
    const candidate = getBusinessPayState(preferredTenant);
    if (candidate.secretKey === cleanSecret || candidate.config.webhookSecret === cleanSecret) {
      return candidate;
    }
  }

  try {
    if (!fs.existsSync(SESSIONS_DIR)) return null;
    for (const entry of fs.readdirSync(SESSIONS_DIR)) {
      const dbPath = path.resolve(SESSIONS_DIR, entry, 'business_pay_db.json');
      if (fs.existsSync(dbPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
          if (
            parsed &&
            (parsed.secretKey === cleanSecret || parsed.config?.webhookSecret === cleanSecret)
          ) {
            return getBusinessPayState(parsed.tenantId || entry);
          }
        } catch {
          // ignore malformed file
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export interface TouchPayDeviceResult {
  device: BusinessPayDevice;
  isFirstConnect: boolean;
  isReconnect: boolean;
  shouldNotifyOwner: boolean;
}

export function touchPayDevice(
  state: BusinessPayState,
  info: {
    deviceId?: string;
    deviceName?: string;
    appVersion?: string;
    batteryLevel?: number;
    simOperator?: string;
    forceNotify?: boolean;
  }
): TouchPayDeviceResult {
  const deviceId = String(info.deviceId || 'android-pay-device').trim();
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const existing = state.devices.find((d) => d.deviceId === deviceId);

  if (existing) {
    const prevLastSeenMs = existing.lastSeenAt ? new Date(existing.lastSeenAt).getTime() : 0;
    const wasIdle = !prevLastSeenMs || nowMs - prevLastSeenMs > 1000 * 60 * 10; // > 10 min offline
    const neverNotified = !existing.lastConnectNotifiedAt;

    if (info.deviceName) existing.deviceName = info.deviceName;
    if (info.appVersion) existing.appVersion = info.appVersion;
    if (typeof info.batteryLevel === 'number' && Number.isFinite(info.batteryLevel)) {
      existing.batteryLevel = info.batteryLevel;
    }
    if (info.simOperator) existing.simOperator = info.simOperator;
    if (!existing.firstConnectedAt) existing.firstConnectedAt = now;
    existing.lastSeenAt = now;

    return {
      device: existing,
      isFirstConnect: false,
      isReconnect: wasIdle,
      shouldNotifyOwner: Boolean(info.forceNotify) || neverNotified || wasIdle,
    };
  }

  const created: BusinessPayDevice = {
    deviceId,
    deviceName: info.deviceName || 'Android Device',
    appVersion: info.appVersion || '2.0.0',
    batteryLevel: typeof info.batteryLevel === 'number' ? info.batteryLevel : undefined,
    simOperator: info.simOperator,
    firstConnectedAt: now,
    lastSeenAt: now,
  };
  state.devices.unshift(created);
  if (state.devices.length > 20) state.devices = state.devices.slice(0, 20);

  return {
    device: created,
    isFirstConnect: true,
    isReconnect: false,
    shouldNotifyOwner: true,
  };
}

export function estimateAmountLkr(priceText: string, lkrPerUsdRate = 300): number {
  const raw = String(priceText || '').trim();
  if (!raw) return 0;
  const numMatch = raw.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!numMatch) return 0;
  const val = parseFloat(numMatch[1]);
  if (!Number.isFinite(val) || val <= 0) return 0;
  if (/(\$|usd)/i.test(raw) && !/(lkr|rs|රු)/i.test(raw)) {
    return Math.round(val * (lkrPerUsdRate || 300));
  }
  return Math.round(val);
}

export function createBusinessPayOrder(
  tenantId: string,
  input: {
    customerJid: string;
    customerNumber: string;
    productId: string;
    productName: string;
    packageDays?: string;
    priceDisplay: string;
    amountLkr?: number;
  }
): BusinessPayOrder {
  const state = getBusinessPayState(tenantId);
  const amount =
    typeof input.amountLkr === 'number' && input.amountLkr > 0
      ? Math.round(input.amountLkr)
      : estimateAmountLkr(input.priceDisplay, state.config.lkrPerUsdRate);

  const order: BusinessPayOrder = {
    id: `YH-${Math.floor(100000 + Math.random() * 900000)}`,
    customerJid: input.customerJid,
    customerNumber: input.customerNumber,
    productId: input.productId,
    productName: input.productName,
    packageDays: input.packageDays,
    priceDisplay: input.priceDisplay,
    amountLkr: amount,
    status: 'pending_payment',
    createdAt: new Date().toISOString(),
  };

  state.orders.unshift(order);
  if (state.orders.length > 300) state.orders = state.orders.slice(0, 300);
  saveBusinessPayState(state);
  return order;
}

export function updateBusinessPayOrderStatus(
  tenantId: string,
  orderId: string,
  status: 'pending_payment' | 'paid' | 'cancelled'
): BusinessPayOrder | null {
  const state = getBusinessPayState(tenantId);
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return null;
  order.status = status;
  if (status === 'paid' && !order.paidAt) {
    order.paidAt = new Date().toISOString();
  }
  saveBusinessPayState(state);
  return order;
}

function detectBankName(sender: string, rawMessage: string): string {
  const hay = `${sender} ${rawMessage}`.toLowerCase();
  if (hay.includes('combank') || hay.includes('commercial')) return 'Commercial Bank';
  if (hay.includes('sampath') || hay.includes('vishwa')) return 'Sampath Bank';
  if (hay.includes('boc') || hay.includes('bank of ceylon')) return 'BOC';
  if (hay.includes('hnb') || hay.includes('hatton')) return 'HNB';
  if (hay.includes('peoples') || hay.includes("people's")) return "People's Bank";
  if (hay.includes('nsb')) return 'NSB';
  if (hay.includes('seylan')) return 'Seylan Bank';
  if (hay.includes('ndb')) return 'NDB Bank';
  if (hay.includes('dfcc')) return 'DFCC Bank';
  if (hay.includes('frimi')) return 'FriMi';
  if (hay.includes('ezcash') || hay.includes('ez cash')) return 'eZ Cash';
  if (hay.includes('mcash')) return 'mCash';
  if (hay.includes('genie')) return 'Genie';
  return sender || 'Bank Alert';
}

function parseAmountFromText(rawMessage: string): number {
  const match = rawMessage.match(/(?:LKR|RS\.?|රු\.?)\s*([0-9,]+(?:\.\d{1,2})?)/i);
  if (!match) return 0;
  const parsed = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseReferenceFromText(rawMessage: string): string {
  const match = rawMessage.match(/(?:REF|TXN|TRN|ID|NO)[:.\s#-]*([A-Z0-9-]{4,24})/i);
  if (match) return match[1].toUpperCase();
  return `PAY${Date.now().toString().slice(-8)}`;
}

export function ingestPayWebhookEvent(
  state: BusinessPayState,
  payload: {
    source: 'sms' | 'notification' | 'test';
    sender?: string;
    appPackage?: string;
    rawMessage: string;
    amountLkr?: number;
    balanceLkr?: number;
    reference?: string;
    deviceId?: string;
    deviceName?: string;
    appVersion?: string;
    batteryLevel?: number;
    simOperator?: string;
  }
): { event: BusinessPayEvent; matchedOrder?: BusinessPayOrder; duplicate: boolean } {
  touchPayDevice(state, {
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    appVersion: payload.appVersion,
    batteryLevel: payload.batteryLevel,
    simOperator: payload.simOperator,
  });

  const rawMessage = String(payload.rawMessage || '').trim();
  const sender = String(payload.sender || 'Bank').trim();
  const bank = detectBankName(sender, rawMessage);
  const amountLkr =
    typeof payload.amountLkr === 'number' && Number.isFinite(payload.amountLkr) && payload.amountLkr > 0
      ? payload.amountLkr
      : parseAmountFromText(rawMessage);
  const reference = String(payload.reference || parseReferenceFromText(rawMessage)).trim();

  // Deduplicate exact message/ref within 10 minutes
  const recentDup = state.events.find((e) => {
    const evTime = new Date(e.timestamp || e.receivedAt || 0).getTime();
    return (
      (e.reference === reference && e.amountLkr === amountLkr && Date.now() - evTime < 10 * 60 * 1000) ||
      (e.rawMessage === rawMessage && Date.now() - evTime < 60 * 1000)
    );
  });
  if (recentDup && payload.source !== 'test') {
    saveBusinessPayState(state);
    const linked = recentDup.matchedOrderId
      ? state.orders.find((o) => o.id === recentDup.matchedOrderId)
      : undefined;
    return { event: recentDup, matchedOrder: linked, duplicate: true };
  }

  const isDebitOnly =
    /\b(debited|withdrawn|paid to|spent|purchase)\b/i.test(rawMessage) &&
    !/\b(credited|received|deposited|incoming)\b/i.test(rawMessage);

  const ignored =
    payload.source !== 'test' &&
    (isDebitOnly || amountLkr <= 0 || amountLkr < (state.config.minAmountLkr || 0));

  let matchedOrder: BusinessPayOrder | undefined = undefined;
  if (!ignored && state.config.autoMatchOrders) {
    const explicitOrderMatch = rawMessage.match(/\bYH-\d{3,8}\b/i);
    if (explicitOrderMatch) {
      matchedOrder = state.orders.find(
        (o) => o.status === 'pending_payment' && o.id.toUpperCase() === explicitOrderMatch[0].toUpperCase()
      );
    }
    if (!matchedOrder) {
      matchedOrder = state.orders.find(
        (o) =>
          o.status === 'pending_payment' &&
          o.amountLkr > 0 &&
          Math.abs(o.amountLkr - amountLkr) <= 1
      );
    }
  }

  const nowIso = new Date().toISOString();
  const event: BusinessPayEvent = {
    id: `pay_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    source: payload.source,
    sender,
    bank,
    appPackage: payload.appPackage,
    rawMessage,
    amountLkr,
    balanceLkr: payload.balanceLkr,
    reference,
    status: ignored ? 'ignored' : matchedOrder ? 'matched' : 'unmatched',
    matchedOrderId: matchedOrder?.id,
    deviceId: payload.deviceId,
    deviceName: payload.deviceName,
    timestamp: nowIso,
    receivedAt: nowIso,
  };

  if (matchedOrder) {
    matchedOrder.status = 'paid';
    matchedOrder.matchedEventId = event.id;
    matchedOrder.matchedRef = event.reference;
    matchedOrder.matchedBank = event.bank;
    matchedOrder.paidAt = nowIso;
  }

  state.events.unshift(event);
  if (state.events.length > 300) state.events = state.events.slice(0, 300);
  saveBusinessPayState(state);

  return { event, matchedOrder, duplicate: false };
}

export function getApkBinaryPath(): string {
  const candidates = [
    path.resolve(APK_DIR, 'YashiHallsPay-v2.0.0.apk'),
    path.resolve(APK_DIR, 'YashiHallsPay-v1.0.0.apk'),
    path.resolve(APK_DIR, 'YashiHallsPay.apk'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[1];
}

export function getApkBinaryInfo(): {
  available: boolean;
  filename: string;
  fileName: string;
  version: string;
  packageName: string;
  sizeBytes: number;
  sizeFormatted: string;
  sha256: string;
  downloadUrl: string;
} {
  const apkPath = getApkBinaryPath();
  if (fs.existsSync(apkPath)) {
    const stat = fs.statSync(apkPath);
    let sha256 = '';
    if (
      cachedApkHash &&
      cachedApkHash.path === apkPath &&
      cachedApkHash.mtimeMs === stat.mtimeMs &&
      cachedApkHash.size === stat.size
    ) {
      sha256 = cachedApkHash.sha256;
    } else {
      sha256 = crypto.createHash('sha256').update(fs.readFileSync(apkPath)).digest('hex');
      cachedApkHash = { path: apkPath, mtimeMs: stat.mtimeMs, size: stat.size, sha256 };
    }
    const mb = (stat.size / (1024 * 1024)).toFixed(2);
    const fname = path.basename(apkPath);
    return {
      available: true,
      filename: fname,
      fileName: fname,
      version: '2.0.0',
      packageName: 'com.yashihalls.pay',
      sizeBytes: stat.size,
      sizeFormatted: `${mb} MB`,
      sha256,
      downloadUrl: '/api/business/pay/apk/download',
    };
  }
  return {
    available: false,
    filename: 'YashiHallsPay-v1.0.0.apk',
    fileName: 'YashiHallsPay-v1.0.0.apk',
    version: '2.0.0',
    packageName: 'com.yashihalls.pay',
    sizeBytes: 0,
    sizeFormatted: '0 MB',
    sha256: '',
    downloadUrl: '/api/business/pay/apk/download',
  };
}

export function resolveEffectivePayOrigin(tenantId: string, originOverride?: string): string {
  const state = getBusinessPayState(tenantId);
  const candidate = normalizeServerOrigin(
    originOverride ||
      state.lastServerOrigin ||
      state.publicOrigin ||
      process.env.APP_URL ||
      process.env.PUBLIC_APP_URL ||
      ''
  );
  const activeTunnel = getActivePayTunnelUrl();
  if (activeTunnel && isPreviewAuthGatedOrigin(candidate)) {
    return normalizeServerOrigin(activeTunnel);
  }
  return candidate || normalizeServerOrigin(activeTunnel || '');
}

/**
 * Generates the exact 1-paste Link Key parsed by Android PayConfigStore.parseBotLinkKey():
 *   "YHP." + Base64URL(JSON.stringify({ u: "<https-server-origin>", k: "<webhook-secret>" }))
 */
export function buildBotLinkKey(tenantId: string, originOverride?: string): string {
  const state = getBusinessPayState(tenantId);
  const cleanOrigin = resolveEffectivePayOrigin(tenantId, originOverride);
  const secret = state.config.webhookSecret || state.secretKey;
  const payload = JSON.stringify({
    u: cleanOrigin,
    k: secret,
  });
  return `YHP.${Buffer.from(payload, 'utf8').toString('base64url')}`;
}
