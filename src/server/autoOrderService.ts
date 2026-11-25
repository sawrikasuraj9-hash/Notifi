/**
 * YASHI HALLS — Automatic Order Management & FFGlory API Delivery Engine
 *
 * Responsibilities:
 * - Persists all Auto Orders, Product->FFGlory Mappings, Used Transaction IDs, API Errors, and Admin Audit Logs
 * - Encrypts server-stored FFGlory API credentials at rest using AES-256-GCM (never returned to frontend/logs)
 * - Enforces the 8-state order lifecycle:
 *     PENDING_PAYMENT | PAYMENT_DETECTED | PAYMENT_VERIFIED | WAITING_DELIVERY
 *     DELIVERED | DELIVERY_FAILED | MANUAL_REVIEW | CANCELLED
 * - Integrates with existing Android Permission App (YASHI HALLS Pay) webhook events without modifying its protocol
 * - Prevents duplicate payments, duplicate API requests, and double deliveries via persistent + in-flight locks
 * - Supports safe TEST MODE simulation before switching to LIVE MODE
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ffgloryClient,
  FFGloryApiError,
  FFGloryCredentials,
  FFGloryAccountInfo,
  FFGloryPricingResponse,
  type FFGloryLaunchProgressEvent,
  maskSecretDisplay,
  redactFFGlorySecrets,
} from './ffgloryClient';
import type { BusinessPayEvent } from './businessPayService';
import { extractPaymentReceiptWithAI, type ReceiptOcrData } from './receiptOcrService';
import {
  renderGuildConfigCardPng,
  renderProcessingCardPng,
  renderSuccessCardPng,
  renderLiveGloryCardPng,
} from './guildCardRenderer';
import {
  generatePaymentProcessingHtml,
  generateGuildLaunchFormHtml,
  generateGroupLaunchingHtml,
  generateClanGroupMapHtml,
} from './htmlAppHelper';

export type AutoOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_DETECTED'
  | 'PAYMENT_VERIFIED'
  | 'WAITING_DELIVERY'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'MANUAL_REVIEW'
  | 'CANCELLED';

export type DeliveryActionType = 'COUPON' | 'CLAN_GROUP' | 'MANUAL';
export type OperatingMode = 'TEST' | 'LIVE';
export type OrderServiceType = 'GUILD_SERVICE' | 'PANEL_SERVICE' | 'STORE_PRODUCT';
export type GuildBotQuantity = 4 | 8 | 12 | 16;

export interface GuildTierPricing {
  bots4: number;
  bots8: number;
  bots12: number;
  bots16: number;
}

export interface PaymentAccountConfig {
  bankName: string;
  accountName: string;
  accountNumber: string;
  branchName?: string;
  instructions: string;
}

export type ProcessingStage =
  | 'PAYMENT_VERIFIED'
  | 'GUILD_DETAILS_VERIFIED'
  | 'CONNECTING_FFGLORY'
  | 'LAUNCH_REQUEST_SUBMITTED'
  | 'WAITING_API_RESPONSE'
  | 'LAUNCHED'
  | 'FAILED';

export interface AutoOrderReceiptRecord {
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

export interface ReceiptHistoryEntry {
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

export interface OrderGuildConfig {
  regionId: string;
  regionName: string;
  clanId: string;
  submittedVia: 'WEB_CARD' | 'WHATSAPP_COPY' | 'WHATSAPP_NATIVE' | 'ADMIN';
  submittedAt: string;
}

export interface OrderLiveGlorySnapshot {
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
  rawGlory?: any;
  rawClanInfo?: any;
}

export interface ProductDeliveryMapping {
  productId: string;
  packageId?: string; // empty/undefined = applies to all packages of this product
  enabled: boolean;
  actionType: DeliveryActionType;
  basicCredits?: number;
  premiumCredits?: number;
  region?: string;
  priceLkrOverride?: number;
  updatedAt: string;
}

export interface AutoOrderPaymentDetails {
  eventId?: string;
  source: 'sms' | 'notification' | 'test' | 'admin_manual';
  bank: string;
  amountLkr: number;
  transactionId: string;
  sender?: string;
  paidAt: string;
  rawMessage?: string;
  relatedOrderIdInMessage?: string;
  verifiedBy: 'AUTO_GATEWAY' | 'RECEIPT_AND_BANK' | 'ADMIN_MANUAL' | 'TEST_SIMULATOR';
}

export interface AutoOrderDeliveryDetails {
  provider: 'FFGLORY';
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
  groupIds?: string[];
  botCount?: number;
  region?: string;
  clanId?: string;
  rawResponse?: any;
  errorMessage?: string;
  errorCode?: number;
  recoveredFromExistingGroup?: boolean;
}

export interface AutoOrder {
  id: string;
  tenantId: string;
  mode: OperatingMode;
  serviceType?: OrderServiceType;
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
  processingStage?: ProcessingStage;
  receipt?: AutoOrderReceiptRecord;
  guildConfig?: OrderGuildConfig;
  payment?: AutoOrderPaymentDetails;
  delivery?: AutoOrderDeliveryDetails;
  liveGlory?: OrderLiveGlorySnapshot;
  whatsappDelivered?: boolean;
  whatsappDeliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorLogEntry {
  id: string;
  timestamp: string;
  endpoint: string;
  statusCode: number;
  message: string;
  orderId?: string;
}

export interface AutoOrderAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  orderId?: string;
  details: string;
}

interface EncryptedSecretBlob {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface AutoOrderSettings {
  ffgloryEnabled: boolean;
  operatingMode: OperatingMode;
  autoDeliverOnVerifiedPayment: boolean;
  supportContact: string;
  guildFlowEnabled: boolean;
  welcomeOnFirstMessage: boolean;
  guildPricing: GuildTierPricing;
  paymentAccount: PaymentAccountConfig;
  publicPortalBaseUrl?: string;
  encryptedApiKey?: EncryptedSecretBlob;
  encryptedMasterKey?: EncryptedSecretBlob;
  lastConnectionStatus: 'CONNECTED' | 'ERROR' | 'UNCONFIGURED';
  lastConnectionCheckedAt?: string;
  lastConnectionError?: string;
  cachedBalance?: FFGloryAccountInfo;
  cachedActiveGroupsCount?: number;
  cachedPricing?: FFGloryPricingResponse;
  cachedPricingAt?: string;
}

export interface AutoOrderDbState {
  tenantId: string;
  settings: AutoOrderSettings;
  mappings: ProductDeliveryMapping[];
  orders: AutoOrder[];
  usedTransactionIds: Record<string, { orderId: string; usedAt: string; amountLkr: number; bank: string }>;
  usedReceiptHashes: Record<string, { orderId: string; usedAt: string; customerNumber: string }>;
  receiptHistory: ReceiptHistoryEntry[];
  unmatchedBankAlerts: BusinessPayEvent[];
  apiErrors: ApiErrorLogEntry[];
  auditLogs: AutoOrderAuditEntry[];
  updatedAt: string;
}

export interface WhatsAppDeliveryDispatcher {
  sendMessage: (targetJid: string, text: string) => Promise<boolean>;
  sendInteractiveCard?: (
    targetJid: string,
    opts: {
      image?: Buffer | null;
      title?: string;
      text: string;
      footer?: string;
      buttons: Array<{ id: string; text: string }>;
      urls?: Array<{ displayText: string; url: string }>;
    }
  ) => Promise<boolean>;
  sendHtmlAppCard?: (
    targetJid: string,
    htmlMarkup: string,
    opts: { title: string; height: number }
  ) => Promise<string | null>;
  editHtmlAppCard?: (
    targetJid: string,
    messageId: string,
    htmlMarkup: string,
    opts: { title: string; height: number }
  ) => Promise<boolean>;
  getConnectedBotJid?: () => string | null;
  getOwnerJid: () => string | null;
  getStoreName: () => string;
}

// In-flight mutex locks to strictly prevent duplicate API calls / double deliveries
const inFlightDeliveryLocks = new Set<string>();
const inFlightWebhookLocks = new Set<string>();
const liveGloryCooldownMap = new Map<string, number>();
// Track live "CLAN · GROUP MAP" HTML App message IDs for smooth in-place live updates
const liveGloryCardMsgMap = new Map<string, string>();
const liveGloryAutoSyncTimers = new Map<string, NodeJS.Timeout>();

// Runtime auto-detected public origin for WhatsApp Interactive Web Card URLs
let detectedRuntimeBaseUrl = '';

export function registerPublicPortalBaseUrl(originUrl: string) {
  const clean = String(originUrl || '').trim().replace(/\/+$/, '');
  if (clean && /^https?:\/\//i.test(clean) && !clean.includes('localhost') && !clean.includes('127.0.0.1')) {
    detectedRuntimeBaseUrl = clean;
  }
}

export function resolvePublicPortalBaseUrl(tenantId?: string): string {
  if (tenantId) {
    const custom = String(getAutoOrderState(tenantId).settings.publicPortalBaseUrl || '').trim().replace(/\/+$/, '');
    if (custom && /^https?:\/\//i.test(custom)) return custom;
  }
  const envUrl = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (envUrl && /^https?:\/\//i.test(envUrl)) return envUrl;
  if (detectedRuntimeBaseUrl) return detectedRuntimeBaseUrl;
  return '';
}

export function buildOrderPortalUrl(tenantId: string, order: AutoOrder): string {
  const base = resolvePublicPortalBaseUrl(tenantId);
  if (!base || !order.portalToken) return '';
  return `${base}/guild-portal?order=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.portalToken)}`;
}

function sanitizeTenantId(tenantId: string): string {
  const clean = String(tenantId || 'primary__business').replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'primary__business';
}

function getDbFilePath(tenantId: string): string {
  const safeId = sanitizeTenantId(tenantId);
  return path.resolve(process.cwd(), 'data', 'sessions', safeId, 'auto_orders_db.json');
}

function getVaultKey(): Buffer {
  const envSecret = process.env.AUTO_ORDER_VAULT_SECRET || process.env.SESSION_SECRET || '';
  if (envSecret.trim().length >= 16) {
    return crypto.createHash('sha256').update(envSecret.trim()).digest();
  }
  const keyFile = path.resolve(process.cwd(), 'data', 'sessions', '.auto_order_vault.key');
  try {
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (/^[a-f0-9]{64}$/i.test(hex)) {
        return Buffer.from(hex, 'hex');
      }
    }
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    const fresh = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, fresh.toString('hex'), { mode: 0o600 });
    return fresh;
  } catch {
    return crypto.createHash('sha256').update(process.cwd() + ':yashi-auto-order-vault').digest();
  }
}

function encryptSecret(plaintext: string): EncryptedSecretBlob | undefined {
  const clean = String(plaintext || '').trim();
  if (!clean) return undefined;
  const key = getVaultKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
  };
}

function decryptSecret(blob?: EncryptedSecretBlob): string {
  if (!blob || !blob.iv || !blob.tag || !blob.ciphertext) return '';
  try {
    const key = getVaultKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const dec = Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return dec.toString('utf8').trim();
  } catch {
    return '';
  }
}

const DEFAULT_GUILD_PRICING: GuildTierPricing = {
  bots4: 650,
  bots8: 1300,
  bots12: 1950,
  bots16: 2600,
};

const DEFAULT_PAYMENT_ACCOUNT: PaymentAccountConfig = {
  bankName: 'NSB (National Savings Bank)',
  accountName: 'A.M.Y.N Alahakoon',
  accountNumber: '100156103618',
  branchName: 'eZ Cash: 074 386 5934',
  instructions:
    'NSB (100156103618 - A.M.Y.N Alahakoon) හෝ Dialog eZ Cash (074 386 5934) වෙත නිවැරදි මුදල ගෙවා Payment Receipt (Photo / PDF) එක මෙතනට එවන්න.',
};

function createInitialState(tenantId: string): AutoOrderDbState {
  const safeId = sanitizeTenantId(tenantId);
  return {
    tenantId: safeId,
    settings: {
      ffgloryEnabled: true,
      operatingMode: 'LIVE',
      autoDeliverOnVerifiedPayment: true,
      supportContact: '0740712934',
      guildFlowEnabled: true,
      welcomeOnFirstMessage: true,
      guildPricing: { ...DEFAULT_GUILD_PRICING },
      paymentAccount: { ...DEFAULT_PAYMENT_ACCOUNT },
      lastConnectionStatus: 'UNCONFIGURED',
    },
    mappings: [],
    orders: [],
    usedTransactionIds: {},
    usedReceiptHashes: {},
    receiptHistory: [],
    unmatchedBankAlerts: [],
    apiErrors: [],
    auditLogs: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getAutoOrderState(tenantId: string): AutoOrderDbState {
  const safeId = sanitizeTenantId(tenantId);
  const filePath = getDbFilePath(safeId);
  if (fs.existsSync(filePath)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const base = createInitialState(safeId);
      const parsedPricing = parsed?.settings?.guildPricing || {};
      const parsedAccount = parsed?.settings?.paymentAccount || {};
      const isPlaceholderAccount =
        !parsedAccount.accountNumber ||
        parsedAccount.accountNumber === 'Configure in Admin Dashboard' ||
        parsedAccount.bankName === 'Commercial Bank / Sampath Bank';
      const resolvedPaymentAccount: PaymentAccountConfig = isPlaceholderAccount
        ? { ...DEFAULT_PAYMENT_ACCOUNT }
        : { ...DEFAULT_PAYMENT_ACCOUNT, ...parsedAccount };
      return {
        tenantId: safeId,
        settings: {
          ...base.settings,
          ...(parsed?.settings || {}),
          operatingMode: parsed?.settings?.operatingMode === 'TEST' ? 'TEST' : 'LIVE',
          ffgloryEnabled: parsed?.settings?.ffgloryEnabled !== false,
          autoDeliverOnVerifiedPayment: parsed?.settings?.autoDeliverOnVerifiedPayment !== false,
          guildFlowEnabled: parsed?.settings?.guildFlowEnabled !== false,
          welcomeOnFirstMessage: parsed?.settings?.welcomeOnFirstMessage !== false,
          guildPricing: {
            bots4: Number(parsedPricing.bots4) > 0 ? Number(parsedPricing.bots4) : DEFAULT_GUILD_PRICING.bots4,
            bots8: Number(parsedPricing.bots8) > 0 ? Number(parsedPricing.bots8) : DEFAULT_GUILD_PRICING.bots8,
            bots12: Number(parsedPricing.bots12) > 0 ? Number(parsedPricing.bots12) : DEFAULT_GUILD_PRICING.bots12,
            bots16: Number(parsedPricing.bots16) > 0 ? Number(parsedPricing.bots16) : DEFAULT_GUILD_PRICING.bots16,
          },
          paymentAccount: resolvedPaymentAccount,
        },
        mappings: Array.isArray(parsed?.mappings) ? parsed.mappings : [],
        orders: Array.isArray(parsed?.orders) ? parsed.orders.slice(0, 500) : [],
        usedTransactionIds:
          parsed?.usedTransactionIds && typeof parsed.usedTransactionIds === 'object'
            ? parsed.usedTransactionIds
            : {},
        usedReceiptHashes:
          parsed?.usedReceiptHashes && typeof parsed.usedReceiptHashes === 'object'
            ? parsed.usedReceiptHashes
            : {},
        receiptHistory: Array.isArray(parsed?.receiptHistory) ? parsed.receiptHistory.slice(0, 300) : [],
        unmatchedBankAlerts: Array.isArray(parsed?.unmatchedBankAlerts)
          ? parsed.unmatchedBankAlerts.slice(0, 100)
          : [],
        apiErrors: Array.isArray(parsed?.apiErrors) ? parsed.apiErrors.slice(0, 100) : [],
        auditLogs: Array.isArray(parsed?.auditLogs) ? parsed.auditLogs.slice(0, 300) : [],
        updatedAt: parsed?.updatedAt || new Date().toISOString(),
      };
    } catch {
      // fall through
    }
  }
  const fresh = createInitialState(safeId);
  saveAutoOrderState(fresh);
  return fresh;
}

export function saveAutoOrderState(state: AutoOrderDbState): AutoOrderDbState {
  const filePath = getDbFilePath(state.tenantId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const normalized: AutoOrderDbState = {
    ...state,
    orders: state.orders.slice(0, 500),
    receiptHistory: (state.receiptHistory || []).slice(0, 300),
    unmatchedBankAlerts: (state.unmatchedBankAlerts || []).slice(0, 100),
    apiErrors: state.apiErrors.slice(0, 100),
    auditLogs: state.auditLogs.slice(0, 300),
    updatedAt: new Date().toISOString(),
  };
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tmpPath, filePath);
  return normalized;
}

/**
 * Resolves FFGlory credentials strictly on the server.
 * Priority: Encrypted Server Vault > Environment Variables (FFGLORY_API_KEY / FFGLORY_MASTER_KEY)
 */
export function resolveFFGloryCredentials(tenantId: string): {
  creds: FFGloryCredentials;
  apiKeySource: 'vault' | 'env' | 'none';
  masterKeySource: 'vault' | 'env' | 'none';
} {
  const state = getAutoOrderState(tenantId);
  const vaultApiKey = decryptSecret(state.settings.encryptedApiKey);
  const vaultMasterKey = decryptSecret(state.settings.encryptedMasterKey);
  const envApiKey = String(process.env.FFGLORY_API_KEY || '').trim();
  const envMasterKey = String(process.env.FFGLORY_MASTER_KEY || '').trim();

  const apiKey = vaultApiKey || envApiKey;
  const masterKey = vaultMasterKey || envMasterKey;

  return {
    creds: { apiKey, masterKey },
    apiKeySource: vaultApiKey ? 'vault' : envApiKey ? 'env' : 'none',
    masterKeySource: vaultMasterKey ? 'vault' : envMasterKey ? 'env' : 'none',
  };
}

/**
 * Returns a browser-safe view of API settings (NEVER returns plaintext secrets).
 */
export function getSafePublicSettings(tenantId: string) {
  const state = getAutoOrderState(tenantId);
  const { creds, apiKeySource, masterKeySource } = resolveFFGloryCredentials(tenantId);
  return {
    ffgloryEnabled: state.settings.ffgloryEnabled,
    operatingMode: state.settings.operatingMode,
    autoDeliverOnVerifiedPayment: state.settings.autoDeliverOnVerifiedPayment,
    supportContact: state.settings.supportContact || '0740712934',
    guildFlowEnabled: state.settings.guildFlowEnabled !== false,
    welcomeOnFirstMessage: state.settings.welcomeOnFirstMessage !== false,
    guildPricing: state.settings.guildPricing || { ...DEFAULT_GUILD_PRICING },
    paymentAccount: state.settings.paymentAccount || { ...DEFAULT_PAYMENT_ACCOUNT },
    publicPortalBaseUrl: state.settings.publicPortalBaseUrl || resolvePublicPortalBaseUrl(tenantId) || '',
    hasApiKey: Boolean(creds.apiKey),
    apiKeyMasked: creds.apiKey ? maskSecretDisplay(creds.apiKey) : '',
    apiKeySource,
    hasMasterKey: Boolean(creds.masterKey),
    masterKeyMasked: creds.masterKey ? maskSecretDisplay(creds.masterKey) : '',
    masterKeySource,
    lastConnectionStatus: state.settings.lastConnectionStatus,
    lastConnectionCheckedAt: state.settings.lastConnectionCheckedAt || null,
    lastConnectionError: state.settings.lastConnectionError || null,
    cachedBalance: state.settings.cachedBalance || null,
    cachedActiveGroupsCount: state.settings.cachedActiveGroupsCount ?? null,
    cachedPricing: state.settings.cachedPricing || null,
    cachedPricingAt: state.settings.cachedPricingAt || null,
  };
}

export function appendAuditLog(
  state: AutoOrderDbState,
  actor: string,
  action: string,
  details: string,
  orderId?: string
) {
  const { creds } = resolveFFGloryCredentials(state.tenantId);
  state.auditLogs.unshift({
    id: `aud-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    actor: String(actor || 'system').slice(0, 80),
    action: String(action || 'ACTION').slice(0, 60),
    orderId,
    details: redactFFGlorySecrets(String(details || ''), creds).slice(0, 500),
  });
}

export function appendApiError(
  state: AutoOrderDbState,
  endpoint: string,
  statusCode: number,
  message: string,
  orderId?: string
) {
  const { creds } = resolveFFGloryCredentials(state.tenantId);
  state.apiErrors.unshift({
    id: `err-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date().toISOString(),
    endpoint: String(endpoint || '/api').slice(0, 120),
    statusCode: Number(statusCode) || 500,
    message: redactFFGlorySecrets(String(message || 'API error'), creds).slice(0, 500),
    orderId,
  });
}

export function updateAutoOrderSettings(
  tenantId: string,
  actor: string,
  updates: {
    ffgloryEnabled?: boolean;
    operatingMode?: OperatingMode;
    autoDeliverOnVerifiedPayment?: boolean;
    supportContact?: string;
    apiKey?: string;
    masterKey?: string;
    clearApiKey?: boolean;
    clearMasterKey?: boolean;
  }
) {
  const state = getAutoOrderState(tenantId);
  const changedFields: string[] = [];

  if (typeof updates.ffgloryEnabled === 'boolean') {
    state.settings.ffgloryEnabled = updates.ffgloryEnabled;
    changedFields.push(`enabled=${updates.ffgloryEnabled}`);
  }
  if (updates.operatingMode === 'TEST' || updates.operatingMode === 'LIVE') {
    state.settings.operatingMode = updates.operatingMode;
    changedFields.push(`mode=${updates.operatingMode}`);
  }
  if (typeof updates.autoDeliverOnVerifiedPayment === 'boolean') {
    state.settings.autoDeliverOnVerifiedPayment = updates.autoDeliverOnVerifiedPayment;
    changedFields.push(`autoDeliver=${updates.autoDeliverOnVerifiedPayment}`);
  }
  if (typeof updates.supportContact === 'string') {
    state.settings.supportContact = updates.supportContact.trim().slice(0, 40);
    changedFields.push('supportContact');
  }
  if (updates.clearApiKey) {
    delete state.settings.encryptedApiKey;
    changedFields.push('apiKey=cleared');
  } else if (typeof updates.apiKey === 'string' && updates.apiKey.trim().length > 0) {
    state.settings.encryptedApiKey = encryptSecret(updates.apiKey.trim());
    changedFields.push('apiKey=updated');
  }
  if (updates.clearMasterKey) {
    delete state.settings.encryptedMasterKey;
    changedFields.push('masterKey=cleared');
  } else if (typeof updates.masterKey === 'string' && updates.masterKey.trim().length > 0) {
    state.settings.encryptedMasterKey = encryptSecret(updates.masterKey.trim());
    changedFields.push('masterKey=updated');
  }

  appendAuditLog(
    state,
    actor,
    'UPDATE_API_SETTINGS',
    `Updated FFGlory settings (${changedFields.join(', ') || 'no changes'})`
  );
  saveAutoOrderState(state);
  return getSafePublicSettings(tenantId);
}

export function updateGuildFlowSettings(
  tenantId: string,
  actor: string,
  updates: {
    guildFlowEnabled?: boolean;
    welcomeOnFirstMessage?: boolean;
    guildPricing?: Partial<GuildTierPricing>;
    paymentAccount?: Partial<PaymentAccountConfig>;
    publicPortalBaseUrl?: string;
  }
) {
  const state = getAutoOrderState(tenantId);
  const changed: string[] = [];

  if (typeof updates.guildFlowEnabled === 'boolean') {
    state.settings.guildFlowEnabled = updates.guildFlowEnabled;
    changed.push(`guildFlow=${updates.guildFlowEnabled}`);
  }
  if (typeof updates.welcomeOnFirstMessage === 'boolean') {
    state.settings.welcomeOnFirstMessage = updates.welcomeOnFirstMessage;
    changed.push(`welcome=${updates.welcomeOnFirstMessage}`);
  }
  if (updates.guildPricing) {
    const gp = updates.guildPricing;
    if (gp.bots4 !== undefined && Number(gp.bots4) > 0) state.settings.guildPricing.bots4 = Math.round(Number(gp.bots4));
    if (gp.bots8 !== undefined && Number(gp.bots8) > 0) state.settings.guildPricing.bots8 = Math.round(Number(gp.bots8));
    if (gp.bots12 !== undefined && Number(gp.bots12) > 0) state.settings.guildPricing.bots12 = Math.round(Number(gp.bots12));
    if (gp.bots16 !== undefined && Number(gp.bots16) > 0) state.settings.guildPricing.bots16 = Math.round(Number(gp.bots16));
    changed.push('guildPricing');
  }
  if (updates.paymentAccount) {
    const pa = updates.paymentAccount;
    if (typeof pa.bankName === 'string') state.settings.paymentAccount.bankName = pa.bankName.trim().slice(0, 80);
    if (typeof pa.accountName === 'string') state.settings.paymentAccount.accountName = pa.accountName.trim().slice(0, 80);
    if (typeof pa.accountNumber === 'string') state.settings.paymentAccount.accountNumber = pa.accountNumber.trim().slice(0, 60);
    if (typeof pa.branchName === 'string') state.settings.paymentAccount.branchName = pa.branchName.trim().slice(0, 60);
    if (typeof pa.instructions === 'string') state.settings.paymentAccount.instructions = pa.instructions.trim().slice(0, 400);
    changed.push('paymentAccount');
  }
  if (typeof updates.publicPortalBaseUrl === 'string') {
    const trimmed = updates.publicPortalBaseUrl.trim().replace(/\/+$/, '');
    if (!trimmed || /^https?:\/\//i.test(trimmed)) {
      state.settings.publicPortalBaseUrl = trimmed;
      changed.push('publicPortalBaseUrl');
    }
  }

  appendAuditLog(
    state,
    actor,
    'UPDATE_GUILD_SETTINGS',
    `Updated Guild Flow / Pricing / Payment settings (${changed.join(', ') || 'no changes'})`
  );
  saveAutoOrderState(state);
  return getSafePublicSettings(tenantId);
}

export function getGuildPriceForQuantity(tenantId: string, qty: GuildBotQuantity): number {
  const p = getAutoOrderState(tenantId).settings.guildPricing || DEFAULT_GUILD_PRICING;
  switch (qty) {
    case 4: return p.bots4;
    case 8: return p.bots8;
    case 12: return p.bots12;
    case 16: return p.bots16;
    default: return p.bots4;
  }
}

export function createGuildServiceOrder(
  tenantId: string,
  input: {
    customerJid: string;
    customerNumber: string;
    customerName?: string;
    botQuantity: GuildBotQuantity;
    modeOverride?: OperatingMode;
  }
): AutoOrder {
  const state = getAutoOrderState(tenantId);
  const qty: GuildBotQuantity =
    input.botQuantity === 8 || input.botQuantity === 12 || input.botQuantity === 16
      ? input.botQuantity
      : 4;
  const amountLkr = getGuildPriceForQuantity(tenantId, qty);
  const now = new Date().toISOString();
  const id = generateUniqueOrderId(state.orders);
  const portalToken = crypto.randomBytes(24).toString('hex');

  const order: AutoOrder = {
    id,
    tenantId: state.tenantId,
    mode: input.modeOverride || state.settings.operatingMode,
    serviceType: 'GUILD_SERVICE',
    botQuantity: qty,
    portalToken,
    customerJid: String(input.customerJid || '').slice(0, 120),
    customerNumber: String(input.customerNumber || '').replace(/[^0-9+]/g, '').slice(0, 24),
    customerName: String(input.customerName || input.customerNumber || 'Customer').trim().slice(0, 80),
    productId: `guild-service-${qty}-bots`,
    productName: `GUILD SERVICE (${qty} BOTS)`,
    packageDays: `${qty} Glory Bots`,
    priceDisplay: `LKR ${amountLkr.toLocaleString('en-US')}`,
    amountLkr,
    deliveryAction: 'CLAN_GROUP',
    deliveryParams: {},
    status: 'PENDING_PAYMENT',
    statusReason: 'Awaiting Bank Payment & Receipt Upload.',
    createdAt: now,
    updatedAt: now,
  };

  state.orders.unshift(order);
  appendAuditLog(
    state,
    'whatsapp_bot',
    'GUILD_ORDER_CREATED',
    `New Guild Order ${order.id} (${qty} BOTS · LKR ${amountLkr}) for +${order.customerNumber} [${order.mode}]`,
    order.id
  );
  saveAutoOrderState(state);
  return order;
}

export function getActiveCustomerPendingOrder(tenantId: string, customerJidOrNumber: string): AutoOrder | null {
  const state = getAutoOrderState(tenantId);
  const digits = String(customerJidOrNumber || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  const found = state.orders.find((o) => {
    if (o.status !== 'PENDING_PAYMENT' && o.status !== 'PAYMENT_DETECTED') return false;
    const t = new Date(o.createdAt).getTime();
    if (!Number.isFinite(t) || t < cutoffMs) return false;
    const oDigits = String(o.customerNumber || o.customerJid || '').replace(/\D/g, '');
    return o.customerJid === customerJidOrNumber || (digits.length >= 8 && oDigits.endsWith(digits.slice(-9)));
  });
  return found || null;
}

export function getActiveCustomerAwaitingGuildConfigOrder(tenantId: string, customerJidOrNumber: string): AutoOrder | null {
  const state = getAutoOrderState(tenantId);
  const digits = String(customerJidOrNumber || '').split('@')[0].split(':')[0].replace(/\D/g, '');
  const found = state.orders.find((o) => {
    if (o.serviceType !== 'GUILD_SERVICE') return false;
    if (o.status !== 'PAYMENT_VERIFIED') return false;
    if (o.guildConfig?.clanId && o.guildConfig?.regionId) return false;
    const oDigits = String(o.customerNumber || o.customerJid || '').replace(/\D/g, '');
    return o.customerJid === customerJidOrNumber || (digits.length >= 8 && oDigits.endsWith(digits.slice(-9)));
  });
  return found || null;
}

/** Securely resolves a stored receipt file strictly within the tenant's receipts directory */
export function resolveStoredReceiptFilePath(tenantId: string, storedFileName: string): string | null {
  const safeTenant = sanitizeTenantId(tenantId);
  const baseDir = path.resolve(process.cwd(), 'data', 'sessions', safeTenant, 'receipts');
  const cleanName = path.basename(String(storedFileName || ''));
  if (!cleanName || cleanName.includes('..') || !/^[a-zA-Z0-9._-]+$/.test(cleanName)) {
    return null;
  }
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    return null;
  }
  return fs.existsSync(resolved) ? resolved : null;
}

function saveReceiptFileOnServer(
  tenantId: string,
  orderId: string,
  fileBuffer: Buffer,
  mimeType: string
): string {
  const safeTenant = sanitizeTenantId(tenantId);
  const dir = path.resolve(process.cwd(), 'data', 'sessions', safeTenant, 'receipts');
  fs.mkdirSync(dir, { recursive: true });
  const ext =
    mimeType.includes('pdf')
      ? 'pdf'
      : mimeType.includes('png')
      ? 'png'
      : mimeType.includes('webp')
      ? 'webp'
      : 'jpg';
  const safeOrder = orderId.replace(/[^a-zA-Z0-9_-]/g, '');
  const fileName = `${safeOrder}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const target = path.resolve(dir, fileName);
  if (!target.startsWith(dir + path.sep)) {
    throw new Error('Invalid receipt storage path.');
  }
  fs.writeFileSync(target, fileBuffer);
  return fileName;
}

/**
 * Sends Phase 5 Interactive "Launch New Group" HTML App Card (Searchable Region Dropdown +
 * Clan ID Input + 1-Tap Copy Button) so customer can enter Clan Details and paste directly in chat!
 */
export async function sendPhase5GuildConfigCard(
  tenantId: string,
  order: AutoOrder,
  dispatcher?: WhatsAppDeliveryDispatcher
): Promise<boolean> {
  if (!dispatcher || !order.customerJid) return false;

  await ensureFreshFFGloryData(tenantId, { balanceTtlMs: 60000, pricingTtlMs: 300000 }).catch(() => {});
  const state = getAutoOrderState(tenantId);
  const enabledRegions = (state.settings.cachedPricing?.regions || []).filter((r) => r.enabled !== false);
  const portalUrl = buildOrderPortalUrl(tenantId, order);
  const brandName = dispatcher.getStoreName() || 'YASHI HALLS';

  // 1. Primary: Send Interactive In-Chat "Launch New Group" HTML App Card (Region Search Dropdown + Clan ID Input + Copy Button!)
  if (dispatcher.sendHtmlAppCard) {
    const guildFormHtml = generateGuildLaunchFormHtml({
      brandName,
      orderId: order.id,
      botQuantity: order.botQuantity || 4,
      amountLkr: order.amountLkr,
      regions: enabledRegions.map((r) => ({
        id: r.id,
        name: r.region_name || r.id.toUpperCase(),
        code: r.region_code,
      })),
      defaultRegionId: 'sg',
      height: 540,
    });

    const htmlMsgId = await dispatcher
      .sendHtmlAppCard(order.customerJid, guildFormHtml, {
        title: `⚡ LAUNCH NEW GROUP • ${order.id}`,
        height: 540,
      })
      .catch(() => null);

    if (htmlMsgId) {
      const guideText = [
        `✅ *PAYMENT VERIFIED!*  |  🧾 *Order:* \`${order.id}\` (${order.botQuantity || 4} BOTS)`,
        ``,
        `👇 ඉහත *Launch New Group* කාඩ්පතේ ඔයාගේ *Clan Region* එක Select කරලා *Clan ID* එක ඇතුලත් කර, යට ඇති *Copy Button* එකෙන් Copy කර *නැවත මෙම Chat එකට Paste කර එවන්න.*`,
        ``,
        `📌 _Copy Button එක වැඩ නැත්නම් මෙහෙම Reply කරන්නත් පුළුවන්:_`,
        `\`Region: sg\``,
        `\`Clan ID: 123456789\``,
      ].join('\n');
      await dispatcher.sendMessage(order.customerJid, guideText).catch(() => false);
      return true;
    }
  }

  // 2. Fallback: Static PNG + Interactive Buttons if HTML App card is unavailable
  let cardPng: Buffer | null = null;
  try {
    cardPng = await renderGuildConfigCardPng({
      brandName,
      orderId: order.id,
      botQuantity: order.botQuantity || 4,
      amountLkr: order.amountLkr,
      regionsPreview: enabledRegions.map((r) => r.region_name || r.id.toUpperCase()),
    });
  } catch {
    cardPng = null;
  }

  const regionButtons = enabledRegions.slice(0, 5).map((r) => ({
    id: `guild_reg:${order.id}:${r.id}`,
    text: `🌍 ${r.region_name || r.id.toUpperCase()}`,
  }));

  const bodyLines = [
    `✅ *PAYMENT VERIFIED!* (LKR ${order.amountLkr.toLocaleString('en-US')})`,
    `🧾 *Order ID:* ${order.id}`,
    `🤖 *Selected Package:* ${order.botQuantity || 4} BOTS`,
    ``,
    `⚙️ *LAUNCH NEW GROUP — GUILD SETUP*`,
    `ඔයාගේ Clan එකේ Region එක සහ Clan ID එක පහත ආකාරයට Chat එකට එවන්න:`,
    ``,
    `\`Order ID: ${order.id}\``,
    `\`Region: ${enabledRegions[0]?.id || 'bd'}\``,
    `\`Clan ID: 123456789\``,
  ];

  if (dispatcher.sendInteractiveCard) {
    return dispatcher.sendInteractiveCard(order.customerJid, {
      image: cardPng,
      title: 'LAUNCH NEW GROUP',
      text: bodyLines.join('\n'),
      footer: `${brandName} • Phase 5 Guild Setup`,
      buttons: regionButtons,
      urls: portalUrl ? [{ displayText: '⚙️ OPEN CONFIGURATION CARD', url: portalUrl }] : [],
    });
  }

  return dispatcher.sendMessage(
    order.customerJid,
    [...bodyLines, portalUrl ? `\n🔗 *Open Configuration Card:* ${portalUrl}` : ''].filter(Boolean).join('\n')
  );
}

/**
 * PHASE 4 — Customer Payment Receipt Upload (Image/PDF) -> SHA-256 Hash Check -> AI Vision OCR
 * -> Cross-Verification against Real Bank Notification/SMS from Existing Android Permission App
 */
export async function processCustomerReceiptUpload(
  tenantId: string,
  params: {
    orderId: string;
    fileBuffer: Buffer;
    fileName: string;
    mimeType: string;
  },
  dispatcher?: WhatsAppDeliveryDispatcher
): Promise<{
  status: AutoOrderReceiptRecord['verificationStatus'];
  order: AutoOrder | null;
  customerReplyText: string;
}> {
  const safeTenant = sanitizeTenantId(tenantId);
  const state = getAutoOrderState(safeTenant);
  const order = state.orders.find((o) => o.id === params.orderId) || null;
  if (!order) {
    return {
      status: 'MANUAL_REVIEW',
      order: null,
      customerReplyText: '⚠️ Active pending order not found. Please start a new order by typing *menu* or *guild*.',
    };
  }

  if (order.status === 'PAYMENT_VERIFIED' || order.status === 'WAITING_DELIVERY' || order.status === 'DELIVERED') {
    return {
      status: 'VERIFIED',
      order,
      customerReplyText: `✅ Payment for Order *${order.id}* is already verified.`,
    };
  }

  const fileHash = crypto.createHash('sha256').update(params.fileBuffer).digest('hex');
  const storedFileName = saveReceiptFileOnServer(safeTenant, order.id, params.fileBuffer, params.mimeType);
  const nowIso = new Date().toISOString();

  // 1. STRICT DUPLICATE RECEIPT FILE HASH CHECK
  const existingHashUse = state.usedReceiptHashes[fileHash];
  if (existingHashUse && existingHashUse.orderId !== order.id) {
    const reason = `Duplicate receipt file detected (already submitted for order ${existingHashUse.orderId}).`;
    state.receiptHistory.unshift({
      id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      orderId: order.id,
      customerNumber: order.customerNumber,
      customerName: order.customerName,
      expectedAmountLkr: order.amountLkr,
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      status: 'REJECTED_DUPLICATE_HASH',
      reason,
      uploadedAt: nowIso,
    });
    order.receipt = {
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      uploadedAt: nowIso,
      ocrStatus: 'SKIPPED',
      verificationStatus: 'REJECTED_DUPLICATE_HASH',
      verificationNote: reason,
    };
    order.statusReason = reason;
    order.updatedAt = nowIso;
    appendAuditLog(state, 'receipt_guard', 'DUPLICATE_RECEIPT_HASH_REJECTED', reason, order.id);
    saveAutoOrderState(state);
    return {
      status: 'REJECTED_DUPLICATE_HASH',
      order,
      customerReplyText: `❌ *DUPLICATE RECEIPT REJECTED*\n\n🧾 Order: *${order.id}*\nමෙම Payment Receipt එක කලින් වෙනත් Order එකකට භාවිතා කර ඇත. කරුණාකර නව ගෙවීමක සත්‍ය Receipt එකක් Upload කරන්න.`,
    };
  }

  // 2. RUN AI VISION / OCR ON IMAGE OR PDF
  const ocrRes = await extractPaymentReceiptWithAI(params.fileBuffer, params.mimeType);
  const ocrData = ocrRes.success ? ocrRes.data : undefined;

  // 3. CHECK DUPLICATE TRANSACTION REFERENCE ID FROM OCR
  const ocrRef = String(ocrData?.transactionRefId || '').trim().toUpperCase();
  if (ocrRef.length >= 4) {
    const dupEntry = Object.entries(state.usedTransactionIds).find(
      ([k, v]) => (k.endsWith(`::${ocrRef}`) || k.includes(ocrRef)) && v.orderId !== order.id
    );
    if (dupEntry) {
      const reason = `Duplicate Transaction Reference ID (${ocrRef}) — already used for order ${dupEntry[1].orderId}.`;
      state.receiptHistory.unshift({
        id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        orderId: order.id,
        customerNumber: order.customerNumber,
        customerName: order.customerName,
        expectedAmountLkr: order.amountLkr,
        fileHash,
        fileName: params.fileName,
        mimeType: params.mimeType,
        storedFileName,
        status: 'REJECTED_DUPLICATE_REF',
        reason,
        ocrData,
        uploadedAt: nowIso,
      });
      order.receipt = {
        fileHash,
        fileName: params.fileName,
        mimeType: params.mimeType,
        storedFileName,
        uploadedAt: nowIso,
        ocrStatus: 'PARSED',
        ocrData,
        verificationStatus: 'REJECTED_DUPLICATE_REF',
        verificationNote: reason,
      };
      order.statusReason = reason;
      order.updatedAt = nowIso;
      appendAuditLog(state, 'receipt_guard', 'DUPLICATE_RECEIPT_REF_REJECTED', reason, order.id);
      saveAutoOrderState(state);
      return {
        status: 'REJECTED_DUPLICATE_REF',
        order,
        customerReplyText: `❌ *DUPLICATE TRANSACTION ID REJECTED*\n\n🧾 Order: *${order.id}*\n🔖 Ref ID: \`${ocrRef}\`\nමෙම Transaction Reference ID එක කලින් භාවිතා කර ඇත. නව ගෙවීමක සත්‍ය Receipt එකක් එවන්න.`,
      };
    }
  }

  // 4. CHECK AMOUNT MISMATCH FROM OCR
  if (ocrData && ocrData.amountLkr > 0 && Math.abs(ocrData.amountLkr - order.amountLkr) > 1.01) {
    const reason = `Receipt amount mismatch: expected LKR ${order.amountLkr}, receipt shows LKR ${ocrData.amountLkr}.`;
    state.receiptHistory.unshift({
      id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      orderId: order.id,
      customerNumber: order.customerNumber,
      customerName: order.customerName,
      expectedAmountLkr: order.amountLkr,
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      status: 'REJECTED_AMOUNT_MISMATCH',
      reason,
      ocrData,
      uploadedAt: nowIso,
    });
    order.receipt = {
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      uploadedAt: nowIso,
      ocrStatus: 'PARSED',
      ocrData,
      verificationStatus: 'REJECTED_AMOUNT_MISMATCH',
      verificationNote: reason,
    };
    order.statusReason = reason;
    order.updatedAt = nowIso;
    appendAuditLog(state, 'receipt_guard', 'RECEIPT_AMOUNT_MISMATCH', reason, order.id);
    saveAutoOrderState(state);

    // Also notify connected bot's number with Confirm / Reject buttons in case owner wants to override or reject
    await sendOwnerPaymentApprovalCard(dispatcher, order, {
      receiptImageBuffer: params.mimeType.startsWith('image/') ? params.fileBuffer : null,
      ocrData,
      ocrRef,
      statusTag: 'AMOUNT MISMATCH REVIEW',
      note: reason,
    });

    return {
      status: 'REJECTED_AMOUNT_MISMATCH',
      order,
      customerReplyText: `❌ *AMOUNT MISMATCH DETECTED*\n\n🧾 Order: *${order.id}*\n💰 අවශ්‍ය මුදල: *LKR ${order.amountLkr.toLocaleString('en-US')}*\n📄 Receipt එකේ මුදල: *LKR ${ocrData.amountLkr.toLocaleString('en-US')}*\n\nකරුණාකර නිවැරදි මුදල ගෙවා සත්‍ය Receipt එක Upload කරන්න.`,
    };
  }

  // 5. CROSS-MATCH AGAINST REAL BANK SMS/NOTIFICATION FROM EXISTING ANDROID PERMISSION APP
  const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
  const matchedAlertIdx = state.unmatchedBankAlerts.findIndex((ev) => {
    if (ev.status === 'ignored' || !Number.isFinite(ev.amountLkr) || ev.amountLkr <= 0) return false;
    const evTime = new Date(ev.timestamp || 0).getTime();
    if (Number.isFinite(evTime) && evTime < cutoff48h) return false;
    if (Math.abs(ev.amountLkr - order.amountLkr) > 1.01) return false;
    const txnKey = normalizeTxnKey(ev.reference || ev.id, ev.bank);
    if (state.usedTransactionIds[txnKey]) return false;
    return true;
  });

  if (matchedAlertIdx >= 0) {
    const bankAlert = state.unmatchedBankAlerts[matchedAlertIdx];
    // Date/Time sanity check: if OCR parsed a clear date and it differs by > 18 hours from bank alert -> MANUAL_REVIEW
    let dateMismatch = false;
    if (ocrData?.paymentDateTime) {
      const parsedOcrMs = Date.parse(ocrData.paymentDateTime.replace(/\//g, '-'));
      const alertMs = Date.parse(bankAlert.timestamp || '');
      if (Number.isFinite(parsedOcrMs) && Number.isFinite(alertMs)) {
        const diffHours = Math.abs(alertMs - parsedOcrMs) / (1000 * 60 * 60);
        if (diffHours > 18) {
          dateMismatch = true;
        }
      }
    }

    if (dateMismatch) {
      const reason = `Receipt date/time (${ocrData?.paymentDateTime}) differs significantly from Bank Alert (${bankAlert.timestamp}). Routed to Manual Review.`;
      order.status = 'MANUAL_REVIEW';
      order.statusReason = reason;
      order.receipt = {
        fileHash,
        fileName: params.fileName,
        mimeType: params.mimeType,
        storedFileName,
        uploadedAt: nowIso,
        ocrStatus: ocrRes.success ? 'PARSED' : 'FAILED',
        ocrError: ocrRes.error,
        ocrData,
        verificationStatus: 'MANUAL_REVIEW',
        verificationNote: reason,
      };
      order.updatedAt = nowIso;
      state.receiptHistory.unshift({
        id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
        orderId: order.id,
        customerNumber: order.customerNumber,
        customerName: order.customerName,
        expectedAmountLkr: order.amountLkr,
        fileHash,
        fileName: params.fileName,
        mimeType: params.mimeType,
        storedFileName,
        status: 'MANUAL_REVIEW',
        reason,
        ocrData,
        uploadedAt: nowIso,
      });
      appendAuditLog(state, 'receipt_guard', 'RECEIPT_DATE_MISMATCH_REVIEW', reason, order.id);
      saveAutoOrderState(state);
      return {
        status: 'MANUAL_REVIEW',
        order,
        customerReplyText: `⏳ *MANUAL VERIFICATION REQUIRED*\n\n🧾 Order: *${order.id}*\nඔබගේ Receipt එකේ දිනය/වේලාව පරීක්ෂා කිරීම සඳහා Admin Approval වෙත යොමු කර ඇත. තහවුරු වූ වහාම දැනුම් දෙනු ඇත.`,
      };
    }

    // BOTH RECEIPT & REAL BANK NOTIFICATION MATCHED -> PAYMENT_VERIFIED!
    state.unmatchedBankAlerts.splice(matchedAlertIdx, 1);
    const finalRef = ocrRef || bankAlert.reference || bankAlert.id;
    const txnKey = normalizeTxnKey(bankAlert.reference || bankAlert.id, bankAlert.bank);
    state.usedTransactionIds[txnKey] = {
      orderId: order.id,
      usedAt: nowIso,
      amountLkr: bankAlert.amountLkr,
      bank: bankAlert.bank,
    };
    if (ocrRef && ocrRef !== String(bankAlert.reference || '').toUpperCase()) {
      const ocrTxnKey = normalizeTxnKey(ocrRef, ocrData?.bankName || bankAlert.bank);
      state.usedTransactionIds[ocrTxnKey] = {
        orderId: order.id,
        usedAt: nowIso,
        amountLkr: bankAlert.amountLkr,
        bank: ocrData?.bankName || bankAlert.bank,
      };
    }
    state.usedReceiptHashes[fileHash] = {
      orderId: order.id,
      usedAt: nowIso,
      customerNumber: order.customerNumber,
    };

    const verifyNote = `Cross-verified Receipt (Ref: ${finalRef}) with Bank Alert (${bankAlert.bank}, LKR ${bankAlert.amountLkr}).`;
    order.status = 'PAYMENT_VERIFIED';
    order.processingStage = 'PAYMENT_VERIFIED';
    order.statusReason = verifyNote;
    order.payment = {
      eventId: bankAlert.id,
      source: bankAlert.source,
      bank: bankAlert.bank,
      amountLkr: bankAlert.amountLkr,
      transactionId: finalRef,
      sender: ocrData?.senderName || bankAlert.sender,
      paidAt: bankAlert.timestamp || nowIso,
      rawMessage: bankAlert.rawMessage,
      relatedOrderIdInMessage: ocrData?.remarkOrderId || order.id,
      verifiedBy: 'RECEIPT_AND_BANK',
    };
    order.receipt = {
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      uploadedAt: nowIso,
      ocrStatus: ocrRes.success ? 'PARSED' : 'FAILED',
      ocrError: ocrRes.error,
      ocrData,
      verificationStatus: 'VERIFIED',
      verificationNote: verifyNote,
    };
    order.updatedAt = nowIso;

    state.receiptHistory.unshift({
      id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
      orderId: order.id,
      customerNumber: order.customerNumber,
      customerName: order.customerName,
      expectedAmountLkr: order.amountLkr,
      fileHash,
      fileName: params.fileName,
      mimeType: params.mimeType,
      storedFileName,
      status: 'VERIFIED',
      reason: verifyNote,
      ocrData,
      uploadedAt: nowIso,
    });

    appendAuditLog(state, 'receipt_guard', 'PAYMENT_VERIFIED_RECEIPT_AND_BANK', verifyNote, order.id);
    saveAutoOrderState(state);

    // If GUILD_SERVICE -> Trigger Phase 5 Interactive Guild Configuration Card!
    if (order.serviceType === 'GUILD_SERVICE' && !order.guildConfig?.clanId) {
      await sendPhase5GuildConfigCard(safeTenant, order, dispatcher);
      return {
        status: 'VERIFIED',
        order,
        customerReplyText: '', // Phase 5 Card already sent!
      };
    }

    // Otherwise execute standard auto delivery if configured
    if (order.deliveryAction !== 'MANUAL' && state.settings.autoDeliverOnVerifiedPayment && state.settings.ffgloryEnabled) {
      await executeAutoOrderDelivery(safeTenant, order.id, { actor: 'receipt_and_bank_verifier', dispatcher });
      return { status: 'VERIFIED', order, customerReplyText: '' };
    }

    return {
      status: 'VERIFIED',
      order,
      customerReplyText: `✅ *PAYMENT VERIFIED!*\n🧾 Order: *${order.id}*\n💰 Amount: LKR ${bankAlert.amountLkr}\n🔖 Ref: \`${finalRef}\``,
    };
  }

  // 6. NO BANK NOTIFICATION CONFIRMED YET -> NEVER AUTO-APPROVE!
  // Hold as PAYMENT_DETECTED (or MANUAL_REVIEW if OCR failed / suspicious) until Android Pay App confirms money received
  const isUnclear = !ocrRes.success || (ocrData && !ocrData.isPaymentReceipt);
  const holdStatus: AutoOrderReceiptRecord['verificationStatus'] = isUnclear
    ? 'MANUAL_REVIEW'
    : 'AWAITING_BANK_CONFIRMATION';
  const holdReason = isUnclear
    ? `Receipt uploaded (${ocrRes.error || 'Unclear image/PDF'}). Awaiting Bank Notification or Admin Manual Review.`
    : `Receipt parsed (Ref: ${ocrRef || 'N/A'}, LKR ${ocrData?.amountLkr || order.amountLkr}, ${ocrData?.bankName || 'Bank'}). Waiting for real-time Bank Credit Notification from Android Permission App.`;

  order.status = isUnclear ? 'MANUAL_REVIEW' : 'PAYMENT_DETECTED';
  order.statusReason = holdReason;
  order.receipt = {
    fileHash,
    fileName: params.fileName,
    mimeType: params.mimeType,
    storedFileName,
    uploadedAt: nowIso,
    ocrStatus: ocrRes.success ? 'PARSED' : 'FAILED',
    ocrError: ocrRes.error,
    ocrData,
    verificationStatus: holdStatus,
    verificationNote: holdReason,
  };
  order.updatedAt = nowIso;

  state.receiptHistory.unshift({
    id: `rcp-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`,
    orderId: order.id,
    customerNumber: order.customerNumber,
    customerName: order.customerName,
    expectedAmountLkr: order.amountLkr,
    fileHash,
    fileName: params.fileName,
    mimeType: params.mimeType,
    storedFileName,
    status: holdStatus,
    reason: holdReason,
    ocrData,
    uploadedAt: nowIso,
  });

  appendAuditLog(state, 'receipt_guard', 'RECEIPT_RECEIVED_AWAITING_BANK', holdReason, order.id);
  saveAutoOrderState(state);

  // Send Payment Details + Receipt Photo + Native Confirm / Reject Buttons to the Connected Bot's Number
  await sendOwnerPaymentApprovalCard(dispatcher, order, {
    receiptImageBuffer: params.mimeType.startsWith('image/') ? params.fileBuffer : null,
    ocrData,
    ocrRef,
    statusTag: isUnclear ? 'MANUAL APPROVAL NEEDED' : 'PAYMENT APPROVAL REQUEST',
    note: holdReason,
  });

  return {
    status: holdStatus,
    order,
    customerReplyText: [
      `📄 *RECEIPT RECEIVED — VERIFYING PAYMENT*`,
      `🧾 *Order ID:* ${order.id}`,
      ocrData?.bankName ? `🏦 *Detected Bank:* ${ocrData.bankName}` : '',
      ocrRef ? `🔖 *Reference ID:* \`${ocrRef}\`` : '',
      ocrData?.amountLkr ? `💰 *Receipt Amount:* LKR ${ocrData.amountLkr.toLocaleString('en-US')}` : '',
      ``,
      `⏳ අපගේ Bank Notification පද්ධතියෙන් හෝ Admin මඟින් මුදල් ලැබුණු බව තහවුරු වූ වහාම ඔබගේ *GLORY BOT CONFIGURATION* කාඩ්පත ස්වයංක්‍රීයව එවනු ලැබේ.`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * Sends a rich Payment Approval Card with the customer's receipt photo, full payment details,
 * and 2 Native WhatsApp Interactive Buttons (✅ Confirm Payment / ❌ Reject Payment) directly
 * to the connected bot's own paired WhatsApp number (falling back to configured owner number).
 */
async function sendOwnerPaymentApprovalCard(
  dispatcher: WhatsAppDeliveryDispatcher | undefined,
  order: AutoOrder,
  details: {
    receiptImageBuffer?: Buffer | null;
    ocrData?: ReceiptOcrData;
    ocrRef?: string;
    statusTag: string;
    note: string;
  }
): Promise<void> {
  if (!dispatcher) return;
  const targetJid = dispatcher.getConnectedBotJid?.() || dispatcher.getOwnerJid?.();
  if (!targetJid) return;

  const brandName = dispatcher.getStoreName() || 'YASHI HALLS';
  const pkgLabel = order.botQuantity ? `${order.botQuantity} BOTS` : order.packageDays || order.productName;
  const detectedAmt =
    details.ocrData?.amountLkr && details.ocrData.amountLkr > 0
      ? `LKR ${details.ocrData.amountLkr.toLocaleString('en-US')}`
      : 'Not auto-read (check photo)';

  const approvalText = [
    `🔔 *${details.statusTag}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🧾 *Order ID:* ${order.id}`,
    `👤 *Customer:* ${order.customerName} (+${order.customerNumber})`,
    `📦 *Package:* ${pkgLabel} (${order.productName})`,
    `💰 *Expected Amount:* LKR ${order.amountLkr.toLocaleString('en-US')}`,
    `📄 *Receipt Amount:* ${detectedAmt}`,
    details.ocrData?.bankName ? `🏦 *Bank / Method:* ${details.ocrData.bankName}` : '',
    details.ocrRef ? `🔖 *Reference ID:* \`${details.ocrRef}\`` : '',
    details.ocrData?.paymentDateTime ? `🕒 *Receipt Time:* ${details.ocrData.paymentDateTime}` : '',
    `📌 *Status:* ${details.note}`,
    ``,
    `👇 *Tap Confirm or Reject below* _(or reply \`confirm ${order.id}\` / \`reject ${order.id}\`)_`,
  ]
    .filter(Boolean)
    .join('\n');

  if (dispatcher.sendInteractiveCard) {
    await dispatcher
      .sendInteractiveCard(targetJid, {
        image: details.receiptImageBuffer || null,
        title: `APPROVE PAYMENT • ${order.id}`,
        text: approvalText,
        footer: `${brandName} • Owner Payment Approval`,
        buttons: [
          { id: `yh_admin_confirm:${order.id}`, text: '✅ Confirm Payment' },
          { id: `yh_admin_reject:${order.id}`, text: '❌ Reject Payment' },
        ],
      })
      .catch(() => false);
  } else {
    await dispatcher.sendMessage(targetJid, approvalText).catch(() => false);
  }
}

/**
 * PHASE 5 & 6 — Validates Guild Region against LIVE FFGlory /api/pricing and Guild ID,
 * saves to DB, sends Phase 7 Processing Card, and executes FFGlory Launch.
 */
export async function submitGuildConfiguration(
  tenantId: string,
  orderId: string,
  input: {
    regionId: string;
    clanId: string;
    submittedVia: OrderGuildConfig['submittedVia'];
    actor?: string;
  },
  dispatcher?: WhatsAppDeliveryDispatcher
): Promise<{ success: boolean; order: AutoOrder | null; message: string }> {
  const safeTenant = sanitizeTenantId(tenantId);
  const cleanClanId = String(input.clanId || '').replace(/\s+/g, '').trim();
  const rawRegion = String(input.regionId || '').trim().toLowerCase();

  if (!/^\d{5,18}$/.test(cleanClanId)) {
    return {
      success: false,
      order: null,
      message: 'Invalid Guild / Clan ID. Please enter numeric digits only (5–18 digits).',
    };
  }

  // Strictly validate Region ID against LIVE FFGlory GET /api/pricing (NEVER guess Region IDs)
  await ensureFreshFFGloryData(safeTenant, { balanceTtlMs: 60000, pricingTtlMs: 300000 }).catch(() => {});
  const state = getAutoOrderState(safeTenant);
  const pricingRegions = state.settings.cachedPricing?.regions || [];
  if (pricingRegions.length === 0) {
    const freshPrice = await refreshFFGloryPricing(safeTenant);
    if (!freshPrice.success || !freshPrice.pricing?.regions?.length) {
      return {
        success: false,
        order: null,
        message: 'Unable to verify official FFGlory regions right now. Please try again in a moment.',
      };
    }
  }

  const latestState = getAutoOrderState(safeTenant);
  const allRegions = latestState.settings.cachedPricing?.regions || [];
  const matchedRegion = allRegions.find(
    (r) =>
      r.enabled !== false &&
      (r.id.toLowerCase() === rawRegion ||
        r.region_code.toLowerCase() === rawRegion ||
        r.region_name.toLowerCase() === rawRegion ||
        r.region_name.toLowerCase().includes(rawRegion))
  );

  if (!matchedRegion) {
    const validList = allRegions
      .filter((r) => r.enabled !== false)
      .map((r) => `${r.region_name} (${r.id})`)
      .join(', ');
    return {
      success: false,
      order: null,
      message: `Invalid or disabled FFGlory region "${input.regionId}". Supported live regions: ${validList || 'none'}.`,
    };
  }

  const order = latestState.orders.find((o) => o.id === orderId) || null;
  if (!order) {
    return { success: false, order: null, message: 'Order not found.' };
  }
  if (order.status === 'DELIVERED') {
    return { success: false, order, message: 'This order has already been launched and delivered.' };
  }
  if (order.status === 'WAITING_DELIVERY') {
    return { success: false, order, message: 'Your Glory Bots are currently launching. Please wait.' };
  }
  if (order.status !== 'PAYMENT_VERIFIED' && order.status !== 'DELIVERY_FAILED') {
    return {
      success: false,
      order,
      message: `Payment must be verified before launching Glory Bots (current status: ${order.status}).`,
    };
  }

  const nowIso = new Date().toISOString();
  order.guildConfig = {
    regionId: matchedRegion.id,
    regionName: matchedRegion.region_name,
    clanId: cleanClanId,
    submittedVia: input.submittedVia,
    submittedAt: nowIso,
  };
  order.deliveryAction = 'CLAN_GROUP';
  order.deliveryParams = {
    region: matchedRegion.id,
    clan_id: cleanClanId,
  };
  order.processingStage = 'GUILD_DETAILS_VERIFIED';
  order.statusReason = `Guild details verified (${matchedRegion.region_name} · Clan ${cleanClanId}). Initiating launch...`;
  order.updatedAt = nowIso;

  appendAuditLog(
    latestState,
    input.actor || input.submittedVia,
    'GUILD_DETAILS_SUBMITTED',
    `Submitted Guild Config for ${order.id}: Region=${matchedRegion.id} (${matchedRegion.region_name}), ClanID=${cleanClanId} via ${input.submittedVia}`,
    order.id
  );
  saveAutoOrderState(latestState);

  // Check BEFORE sending the animated "Launching Group" card whether FFGlory API credentials exist.
  // Never show fake launching animation when FFGlory API keys are missing!
  const { creds: preflightCreds } = resolveFFGloryCredentials(safeTenant);
  const hasRealFFGloryCreds = Boolean(preflightCreds.apiKey && preflightCreds.masterKey && latestState.settings.ffgloryEnabled);

  // Send PHASE 7 Live Streaming "Launching your group" HTML App Card (Video 1 UI) BEFORE hitting FFGlory API
  let launchHtmlCardMsgId: string | null = null;
  const launchStartedAt = Date.now();
  const requestedBots = Number(order.botQuantity || 4);
  let lastReportedGenerated = 0;
  let lastReportedRequested = requestedBots;
  const brandName = dispatcher?.getStoreName() || 'YASHI HALLS';

  if (dispatcher && order.customerJid && hasRealFFGloryCreds) {
    if (dispatcher.sendHtmlAppCard) {
      const launchingHtml = generateGroupLaunchingHtml({
        brandName,
        orderId: order.id,
        regionId: matchedRegion.id,
        regionName: matchedRegion.region_name || matchedRegion.id,
        clanId: cleanClanId,
        botQuantity: requestedBots,
        amountLkr: order.amountLkr,
        generatedCount: 0,
        requestedCount: requestedBots,
        elapsedSeconds: 0,
        stage: 'ACCOUNTS',
        height: 545,
      });
      launchHtmlCardMsgId = await dispatcher
        .sendHtmlAppCard(order.customerJid, launchingHtml, {
          title: `⚡ LAUNCHING GROUP • ${order.id}`,
          height: 545,
        })
        .catch(() => null);
    }

    if (!launchHtmlCardMsgId) {
      const portalUrl = buildOrderPortalUrl(safeTenant, order);
      let procPng: Buffer | null = null;
      try {
        procPng = await renderProcessingCardPng({
          brandName,
          orderId: order.id,
          clanId: cleanClanId,
          regionLabel: matchedRegion.region_name || matchedRegion.id,
          botQuantity: requestedBots,
          stageIndex: 3,
          currentStatusText: 'Connecting to FFGlory & submitting launch request',
        });
      } catch {
        procPng = null;
      }

      const procText = [
        `⚡ *YOUR GLORY BOTS ARE LAUNCHING*`,
        `━━━━━━━━━━━━━━━━━━━━`,
        `🧾 *Order ID:* ${order.id}`,
        `🛡️ *Guild ID:* ${cleanClanId}`,
        `🌍 *Region:* ${matchedRegion.region_name} (${matchedRegion.id.toUpperCase()})`,
        `🤖 *Selected Quantity:* ${requestedBots} BOTS`,
        ``,
        `✅ 1. Payment Verified`,
        `✅ 2. Guild Details Verified`,
        `🔄 3. Connecting to FFGlory`,
        `⏳ 4. Launch Request Submitted`,
        `⏳ 5. Waiting for API Response`,
      ].join('\n');

      if (dispatcher.sendInteractiveCard) {
        await dispatcher
          .sendInteractiveCard(order.customerJid, {
            image: procPng,
            title: 'YOUR GLORY BOTS ARE LAUNCHING',
            text: procText,
            footer: `${brandName} • Real-Time Launch Status`,
            buttons: [],
            urls: portalUrl ? [{ displayText: '📡 WATCH LIVE STATUS', url: portalUrl }] : [],
          })
          .catch(() => false);
      } else {
        await dispatcher.sendMessage(order.customerJid, procText).catch(() => false);
      }
    }
  }

  // Real-time SSE progress handler: updates "Accounts generated: 1/4 -> 2/4 -> 3/4 -> 4/4" in-place
  let lastProgressEditMs = 0;
  const handleLaunchProgress = async (ev: FFGloryLaunchProgressEvent) => {
    if (!launchHtmlCardMsgId || !dispatcher?.editHtmlAppCard || !order.customerJid) return;
    const reqCount = Math.max(1, Number(ev.requested || requestedBots));
    const genCount = Math.max(0, Math.min(reqCount, Number(ev.generated || 0)));
    const now = Date.now();
    const isImportantChange =
      ev.event === 'done' ||
      genCount !== lastReportedGenerated ||
      reqCount !== lastReportedRequested;
    if (!isImportantChange && now - lastProgressEditMs < 1500) return;

    lastProgressEditMs = now;
    lastReportedGenerated = genCount;
    lastReportedRequested = reqCount;

    const elapsedSec = Math.max(0, Math.floor((now - launchStartedAt) / 1000));
    const progressHtml = generateGroupLaunchingHtml({
      brandName,
      orderId: order.id,
      regionId: matchedRegion.id,
      regionName: matchedRegion.region_name || matchedRegion.id,
      clanId: cleanClanId,
      botQuantity: requestedBots,
      amountLkr: order.amountLkr,
      generatedCount: ev.event === 'done' ? reqCount : genCount,
      requestedCount: reqCount,
      elapsedSeconds: elapsedSec,
      etaSeconds: ev.etaSeconds,
      stage: ev.event === 'done' ? 'READY' : 'ACCOUNTS',
      groupId: ev.groupId,
      height: 545,
    });

    await dispatcher
      .editHtmlAppCard(order.customerJid, launchHtmlCardMsgId, progressHtml, {
        title:
          ev.event === 'done'
            ? `✓ GROUP READY • ${order.id}`
            : `⚡ LAUNCHING (${genCount}/${reqCount}) • ${order.id}`,
        height: 545,
      })
      .catch(() => false);
  };

  // Execute PHASE 6 FFGlory Launch + PHASE 8 Live Clan · Group Map Card
  const deliveryResult = await executeAutoOrderDelivery(safeTenant, order.id, {
    actor: input.actor || input.submittedVia,
    allowRetry: order.status === 'DELIVERY_FAILED',
    dispatcher,
    onLaunchProgress: handleLaunchProgress,
  });

  // Finalize the "Launching your group" HTML App card in-place with READY or FAILED state
  if (launchHtmlCardMsgId && dispatcher?.editHtmlAppCard && order.customerJid) {
    const finalElapsed = Math.max(1, Math.floor((Date.now() - launchStartedAt) / 1000));
    const finalBotCount = Math.max(
      1,
      Number(deliveryResult.order?.delivery?.botCount || lastReportedRequested || requestedBots)
    );
    const finalHtml = generateGroupLaunchingHtml({
      brandName,
      orderId: order.id,
      regionId: matchedRegion.id,
      regionName: matchedRegion.region_name || matchedRegion.id,
      clanId: cleanClanId,
      botQuantity: requestedBots,
      amountLkr: order.amountLkr,
      generatedCount: deliveryResult.success ? finalBotCount : lastReportedGenerated,
      requestedCount: finalBotCount,
      elapsedSeconds: finalElapsed,
      stage: deliveryResult.success ? 'READY' : 'FAILED',
      groupId: deliveryResult.order?.delivery?.groupId,
      statusNote: deliveryResult.success
        ? undefined
        : deliveryResult.message || 'Launch failed — Admin has been notified to assist.',
      height: 545,
    });
    await dispatcher
      .editHtmlAppCard(order.customerJid, launchHtmlCardMsgId, finalHtml, {
        title: deliveryResult.success
          ? `✓ GROUP READY • ${order.id}`
          : `⚠️ LAUNCH NOTICE • ${order.id}`,
        height: 545,
      })
      .catch(() => false);
  }

  return deliveryResult;
}

/**
 * PHASE 8 — Fetches Live Glory & Clan Info from FFGlory API with strict rate-limit cooldown
 */
export async function fetchOrderLiveGlory(
  tenantId: string,
  orderId: string,
  options: { force?: boolean } = {}
): Promise<{
  success: boolean;
  liveGlory?: OrderLiveGlorySnapshot;
  cooldownRemainingSec?: number;
  message: string;
}> {
  const safeTenant = sanitizeTenantId(tenantId);
  const state = getAutoOrderState(safeTenant);
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) {
    return { success: false, message: 'Order not found.' };
  }
  if (!order.delivery?.groupId) {
    return { success: false, message: 'No FFGlory Group ID exists for this order yet.' };
  }

  const cooldownKey = `${safeTenant}:${orderId}`;
  const minIntervalMs = options.force ? 8000 : 20000;
  const lastAt = liveGloryCooldownMap.get(cooldownKey) || 0;
  const elapsed = Date.now() - lastAt;
  if (elapsed < minIntervalMs && order.liveGlory) {
    const remaining = Math.ceil((minIntervalMs - elapsed) / 1000);
    return {
      success: true,
      liveGlory: order.liveGlory,
      cooldownRemainingSec: remaining,
      message: `Showing recent live data (rate-limit cooldown: ${remaining}s).`,
    };
  }

  liveGloryCooldownMap.set(cooldownKey, Date.now());

  // In TEST MODE, never fabricate fake live glory numbers — clearly indicate Test Mode status
  if (order.delivery.mode === 'TEST' || order.mode === 'TEST') {
    const testSnap: OrderLiveGlorySnapshot = {
      currentGlory: 'N/A (Test Mode)',
      clanName: `Test Clan ${order.delivery.clanId || order.guildConfig?.clanId || ''}`.trim(),
      clanLevel: 'Test',
      memberCount: undefined,
      groupStatus: 'simulated_running',
      lastUpdatedAt: new Date().toISOString(),
      errors: ['Order was launched in TEST MODE. Switch to LIVE MODE to query real FFGlory live glory stats.'],
    };
    order.liveGlory = testSnap;
    order.updatedAt = new Date().toISOString();
    saveAutoOrderState(state);
    return {
      success: true,
      liveGlory: testSnap,
      message: 'Test Mode order — switch to LIVE MODE for real FFGlory glory telemetry.',
    };
  }

  const { creds } = resolveFFGloryCredentials(safeTenant);
  if (!creds.apiKey || !creds.masterKey) {
    return { success: false, message: 'FFGlory API credentials are not configured on the server.' };
  }

  try {
    const telemetry = await ffgloryClient.getLiveGroupTelemetry(creds, order.delivery.groupId);
    const snap: OrderLiveGlorySnapshot = {
      currentGlory: telemetry.currentGlory,
      clanName: telemetry.clanName,
      clanLevel: telemetry.clanLevel,
      memberCount: telemetry.memberCount,
      groupStatus: telemetry.groupStatus,
      runningCount: telemetry.runningCount,
      containerCount: telemetry.containerCount,
      uptime: telemetry.uptime,
      lastUpdatedAt: new Date().toISOString(),
      errors: telemetry.errors.length > 0 ? telemetry.errors : undefined,
      rawGlory: telemetry.rawGlory,
      rawClanInfo: telemetry.rawClanInfo,
    };

    const freshState = getAutoOrderState(safeTenant);
    const freshOrder = freshState.orders.find((o) => o.id === orderId);
    if (freshOrder) {
      freshOrder.liveGlory = snap;
      freshOrder.updatedAt = new Date().toISOString();
      saveAutoOrderState(freshState);
    }

    return {
      success: true,
      liveGlory: snap,
      message: 'Live Glory data refreshed from FFGlory API.',
    };
  } catch (err: any) {
    return {
      success: false,
      liveGlory: order.liveGlory,
      message: err?.message || 'Failed to refresh live glory from FFGlory API.',
    };
  }
}

/**
 * Constant-time public portal token verification across all tenant databases
 */
export function findOrderByPortalToken(
  orderId: string,
  token: string
): { tenantId: string; order: AutoOrder } | null {
  const cleanId = String(orderId || '').trim().toUpperCase();
  const cleanToken = String(token || '').trim();
  if (!cleanId || cleanToken.length < 16) return null;

  const sessionsRoot = path.resolve(process.cwd(), 'data', 'sessions');
  if (!fs.existsSync(sessionsRoot)) return null;

  const tokenBuf = Buffer.from(cleanToken, 'utf8');
  const entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dbPath = path.resolve(sessionsRoot, entry.name, 'auto_orders_db.json');
    if (!fs.existsSync(dbPath)) continue;
    try {
      const state = getAutoOrderState(entry.name);
      const order = state.orders.find((o) => o.id === cleanId);
      if (order && order.portalToken) {
        const expectedBuf = Buffer.from(order.portalToken, 'utf8');
        if (expectedBuf.length === tokenBuf.length && crypto.timingSafeEqual(expectedBuf, tokenBuf)) {
          return { tenantId: entry.name, order };
        }
      }
    } catch {
      // continue scanning
    }
  }
  return null;
}

/** Build Video-2 "CLAN · GROUP MAP" HTML App Card from Order + Live FFGlory Telemetry */
function buildClanGroupMapHtmlFromOrder(
  order: AutoOrder,
  g: OrderLiveGlorySnapshot | undefined,
  brandName: string
): string {
  const rawInfo: any = g?.rawClanInfo || {};
  const decoded: any = rawInfo?.decoded || {};
  const clanGloryObj: any = rawInfo?.clan_glory || {};
  const leaderboardObj: any = rawInfo?.leaderboard || {};
  const weekObj: any = rawInfo?.week || {};
  const rawGlory: any = g?.rawGlory || {};

  const clanId = String(
    decoded?.clan_id || order.delivery?.clanId || order.guildConfig?.clanId || '—'
  );
  const groupId = String(order.delivery?.groupId || rawGlory?.group_id || '—');
  const clanName = String(
    decoded?.clan_name || g?.clanName || `CLAN ${clanId}`
  );
  const regionCode = String(
    decoded?.region ||
      leaderboardObj?.region ||
      order.delivery?.region ||
      order.guildConfig?.regionId ||
      'sg'
  ).toUpperCase();
  const clanLevel = decoded?.clan_level ?? g?.clanLevel ?? '—';

  const clanTotalGlory = Number(
    clanGloryObj?.total_glory ?? leaderboardObj?.total_glory ?? 0
  );
  const weeklyGlory = Number(
    clanGloryObj?.weekly_glory ?? leaderboardObj?.weekly_glory ?? 0
  );
  const rawGroupGlory =
    rawGlory?.total_glory !== undefined
      ? Number(rawGlory.total_glory)
      : typeof g?.currentGlory === 'number'
        ? g.currentGlory
        : Number(String(g?.currentGlory || '0').replace(/[^0-9.-]/g, '')) || 0;

  const memberNum = decoded?.member_num ?? g?.memberCount;
  const capacity = decoded?.capacity ?? (memberNum !== undefined ? 50 : undefined);
  const captainId = decoded?.captain_id;

  const totalBots = Number(
    g?.containerCount || order.delivery?.botCount || order.botQuantity || 4
  );
  const runningBots = Number(
    g?.runningCount !== undefined
      ? g.runningCount
      : String(g?.groupStatus || 'running').toLowerCase() === 'running'
        ? totalBots
        : 0
  );

  let updatedText = 'Just now';
  try {
    const dt = g?.lastUpdatedAt ? new Date(g.lastUpdatedAt) : new Date();
    updatedText = dt.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: 'Asia/Colombo',
    });
  } catch {
    updatedText = new Date().toLocaleTimeString('en-GB');
  }

  const clanSlogan = typeof decoded?.slogan === 'string' ? decoded.slogan.trim() : '';
  const season = clanGloryObj?.season ?? rawInfo?.season;
  const weekLabel = weekObj?.week;
  const rawDetails = Array.isArray(rawGlory?.details) ? rawGlory.details : [];
  const botAccounts = rawDetails.map((item: any) => ({
    accountId: item?.account_id !== undefined ? String(item.account_id) : undefined,
    nickname: item?.nickname ? String(item.nickname) : undefined,
    glory: Number(item?.glory || 0),
    level: item?.level,
    creditScore: item?.credit_score,
  }));

  return generateClanGroupMapHtml({
    brandName,
    orderId: order.id,
    groupId,
    clanId,
    clanName,
    clanSlogan,
    regionCode,
    clanLevel,
    season,
    weekLabel,
    clanTotalGlory,
    weeklyGlory,
    groupGlory: rawGroupGlory,
    memberNum,
    capacity,
    captainId,
    weekEndsAt: weekObj?.ends_at,
    inTop100: Boolean(leaderboardObj?.in_top),
    leaderboardRank:
      typeof leaderboardObj?.rank === 'number' ? leaderboardObj.rank : undefined,
    cutoffWeeklyGlory:
      typeof leaderboardObj?.cutoff_weekly_glory === 'number'
        ? leaderboardObj.cutoff_weekly_glory
        : undefined,
    runningBots,
    totalBots,
    runningGroups:
      String(g?.groupStatus || 'running').toLowerCase() === 'running'
        ? Math.max(1, order.delivery?.groupIds?.length || 1)
        : 0,
    totalGroups: Math.max(1, order.delivery?.groupIds?.length || 1),
    groupStatus: g?.groupStatus || 'running',
    uptime: g?.uptime || 'Live',
    lastUpdatedText: updatedText,
    refreshIntervalSec: 15,
    botAccounts,
    height: 685,
  });
}

const LIVE_GLORY_CARD_HEIGHT = 685;
const LIVE_GLORY_SYNC_INTERVAL_MS = 15_000;
const LIVE_GLORY_MAX_TICKS = 2160; // ~9 hours max per live group session

/** Clear any active background live auto-sync timer for an order */
function clearLiveGloryAutoSync(key: string) {
  const existing = liveGloryAutoSyncTimers.get(key);
  if (existing) {
    clearInterval(existing);
  }
  liveGloryAutoSyncTimers.delete(key);
}

/**
 * Continuously refreshes FFGlory telemetry and edits the in-chat "CLAN · GROUP MAP"
 * HTML App card in-place every 15 seconds while the bot group is actively running.
 */
function scheduleLiveGloryAutoSync(
  tenantId: string,
  orderId: string,
  dispatcher: WhatsAppDeliveryDispatcher
) {
  const safeTenant = sanitizeTenantId(tenantId);
  const key = `${safeTenant}:${orderId}`;
  clearLiveGloryAutoSync(key);

  if (!dispatcher.editHtmlAppCard) return;

  let inFlight = false;
  let tickCount = 0;
  let consecutiveEditFailures = 0;

  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    tickCount += 1;

    void (async () => {
      try {
        if (tickCount > LIVE_GLORY_MAX_TICKS) {
          clearLiveGloryAutoSync(key);
          return;
        }

        const msgId = liveGloryCardMsgMap.get(key);
        if (!msgId || !dispatcher.editHtmlAppCard) {
          clearLiveGloryAutoSync(key);
          return;
        }

        const res = await fetchOrderLiveGlory(safeTenant, orderId, { force: true });
        const state = getAutoOrderState(safeTenant);
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || !order.customerJid) {
          clearLiveGloryAutoSync(key);
          return;
        }

        const brandName = dispatcher.getStoreName() || 'YASHI HALLS';
        const mapHtml = buildClanGroupMapHtmlFromOrder(order, res.liveGlory, brandName);
        const edited = await dispatcher
          .editHtmlAppCard(order.customerJid, msgId, mapHtml, {
            title: `📊 CLAN · GROUP MAP • ${order.id}`,
            height: LIVE_GLORY_CARD_HEIGHT,
          })
          .catch(() => false);

        if (edited) {
          consecutiveEditFailures = 0;
        } else {
          consecutiveEditFailures += 1;
          if (consecutiveEditFailures >= 10) {
            clearLiveGloryAutoSync(key);
            return;
          }
        }

        const st = String(res.liveGlory?.groupStatus || '').toLowerCase();
        const isTerminal =
          st === 'stopped' ||
          st === 'completed' ||
          st === 'ended' ||
          st === 'expired' ||
          st === 'failed' ||
          st === 'error' ||
          st === 'cancelled' ||
          st === 'inactive';
        if (isTerminal) {
          clearLiveGloryAutoSync(key);
        }
      } catch {
        // Non-fatal transient background sync error; keep trying on next 15s tick
      } finally {
        inFlight = false;
      }
    })();
  }, LIVE_GLORY_SYNC_INTERVAL_MS);

  if (typeof timer.unref === 'function') timer.unref();
  liveGloryAutoSyncTimers.set(key, timer);
}

/**
 * Helper to render, send, or update-in-place the elongated "CLAN · GROUP MAP"
 * Live Glory HTML App Card in WhatsApp (card-only, auto-updated every 15s).
 */
export async function sendLiveGloryCardToWhatsApp(
  tenantId: string,
  orderId: string,
  dispatcher?: WhatsAppDeliveryDispatcher,
  opts: { isInitialLaunch?: boolean; force?: boolean } = {}
): Promise<{ success: boolean; message: string; sent?: boolean }> {
  if (!dispatcher) return { success: false, message: 'WhatsApp dispatcher unavailable.', sent: false };
  const safeTenant = sanitizeTenantId(tenantId);
  const res = await fetchOrderLiveGlory(safeTenant, orderId, {
    force: Boolean(opts.isInitialLaunch || opts.force),
  });
  const state = getAutoOrderState(safeTenant);
  const order = state.orders.find((o) => o.id === orderId);
  if (!order || !order.customerJid) {
    return { success: false, message: res.message, sent: false };
  }

  const brandName = dispatcher.getStoreName() || 'YASHI HALLS';
  const g = res.liveGlory;
  const portalUrl = buildOrderPortalUrl(safeTenant, order);
  const cardKey = `${safeTenant}:${order.id}`;

  // Primary Path: Matte-Dark + Gold "CLAN · GROUP MAP" In-Chat HTML App Card ONLY (no extra button message below)
  if (dispatcher.sendHtmlAppCard) {
    const mapHtml = buildClanGroupMapHtmlFromOrder(order, g, brandName);
    const existingMsgId = liveGloryCardMsgMap.get(cardKey);

    // If we already have the live card in chat, edit it smoothly in-place
    if (!opts.isInitialLaunch && existingMsgId && dispatcher.editHtmlAppCard) {
      const edited = await dispatcher
        .editHtmlAppCard(order.customerJid, existingMsgId, mapHtml, {
          title: `📊 CLAN · GROUP MAP • ${order.id}`,
          height: LIVE_GLORY_CARD_HEIGHT,
        })
        .catch(() => false);
      if (edited) {
        return { success: res.success, message: res.message, sent: true };
      }
    }

    const newMsgId = await dispatcher
      .sendHtmlAppCard(order.customerJid, mapHtml, {
        title: `📊 CLAN · GROUP MAP • ${order.id}`,
        height: LIVE_GLORY_CARD_HEIGHT,
      })
      .catch(() => null);

    if (newMsgId) {
      liveGloryCardMsgMap.set(cardKey, newMsgId);

      // Start continuous 15-second background live auto-sync updates on LIVE orders
      if (order.delivery?.mode !== 'TEST' && order.mode !== 'TEST') {
        scheduleLiveGloryAutoSync(safeTenant, order.id, dispatcher);
      }

      return { success: res.success, message: res.message, sent: true };
    }
  }

  // Fallback Path: PNG + Native Interactive Card if HTML App renderer is unavailable
  const updatedStr = g?.lastUpdatedAt
    ? new Date(g.lastUpdatedAt).toLocaleString('en-GB')
    : new Date().toLocaleString('en-GB');

  let cardPng: Buffer | null = null;
  try {
    cardPng = await renderLiveGloryCardPng({
      brandName,
      orderId: order.id,
      groupId: order.delivery?.groupId || 'N/A',
      clanId: order.delivery?.clanId || order.guildConfig?.clanId || 'N/A',
      currentGlory: g?.currentGlory !== undefined ? String(g.currentGlory) : 'Pending Data',
      clanName: g?.clanName || 'Loading / Unavailable',
      clanLevel: g?.clanLevel !== undefined ? String(g.clanLevel) : 'N/A',
      memberCount: g?.memberCount !== undefined ? String(g.memberCount) : undefined,
      groupStatus: g?.groupStatus || 'unknown',
      lastUpdated: updatedStr,
    });
  } catch {
    cardPng = null;
  }

  const textLines = [
    `📊 *LIVE GLORY MONITOR — ${order.id}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🔥 *Current Glory:* ${g?.currentGlory !== undefined ? g.currentGlory : 'Unavailable yet'}`,
    `🛡️ *Clan Name:* ${g?.clanName || 'N/A'}`,
    `⭐ *Clan Level:* ${g?.clanLevel !== undefined ? g.clanLevel : 'N/A'}`,
    g?.memberCount !== undefined ? `👥 *Member Count:* ${g.memberCount}` : '',
    `📡 *Group Status:* ${(g?.groupStatus || 'unknown').toUpperCase()}`,
    `🆔 *Group ID:* \`${order.delivery?.groupId || 'N/A'}\``,
    `🕒 *Last Updated:* ${updatedStr}`,
    res.cooldownRemainingSec ? `\n⏳ _Rate-limit protection active (${res.cooldownRemainingSec}s cooldown)._` : '',
  ]
    .filter(Boolean)
    .join('\n');

  let sentFallback = false;
  if (dispatcher.sendInteractiveCard) {
    sentFallback = await dispatcher
      .sendInteractiveCard(order.customerJid, {
        image: cardPng,
        title: 'LIVE GLORY DATA',
        text: textLines,
        footer: `${brandName} • Real-Time FFGlory Data`,
        buttons: [{ id: `guild_live_glory:${order.id}`, text: '🔄 REFRESH LIVE GLORY' }],
        urls: portalUrl ? [{ displayText: '🌐 OPEN LIVE GLORY CARD', url: portalUrl }] : [],
      })
      .catch(() => false);
  } else {
    sentFallback = await dispatcher.sendMessage(order.customerJid, textLines).catch(() => false);
  }

  return { success: res.success, message: res.message, sent: sentFallback };
}

export function upsertProductMapping(
  tenantId: string,
  actor: string,
  input: {
    productId: string;
    packageId?: string;
    enabled: boolean;
    actionType: DeliveryActionType;
    basicCredits?: number;
    premiumCredits?: number;
    region?: string;
    priceLkrOverride?: number;
  }
): ProductDeliveryMapping[] {
  const state = getAutoOrderState(tenantId);
  const productId = String(input.productId || '').trim();
  const packageId = input.packageId ? String(input.packageId).trim() : undefined;
  if (!productId) throw new Error('productId is required');

  const actionType: DeliveryActionType =
    input.actionType === 'COUPON' || input.actionType === 'CLAN_GROUP' ? input.actionType : 'MANUAL';

  const mapping: ProductDeliveryMapping = {
    productId,
    packageId: packageId || undefined,
    enabled: Boolean(input.enabled),
    actionType,
    basicCredits:
      actionType === 'COUPON'
        ? Math.max(0, Math.min(100, Math.floor(Number(input.basicCredits) || 0)))
        : undefined,
    premiumCredits:
      actionType === 'COUPON'
        ? Math.max(0, Math.min(20, Math.floor(Number(input.premiumCredits) || 0)))
        : undefined,
    region:
      actionType === 'CLAN_GROUP'
        ? String(input.region || 'bd').trim().toLowerCase().slice(0, 16)
        : undefined,
    priceLkrOverride:
      input.priceLkrOverride !== undefined && Number(input.priceLkrOverride) > 0
        ? Math.round(Number(input.priceLkrOverride) * 100) / 100
        : undefined,
    updatedAt: new Date().toISOString(),
  };

  const idx = state.mappings.findIndex(
    (m) => m.productId === productId && (m.packageId || '') === (packageId || '')
  );
  if (idx >= 0) {
    state.mappings[idx] = mapping;
  } else {
    state.mappings.unshift(mapping);
  }

  appendAuditLog(
    state,
    actor,
    'UPDATE_PRODUCT_MAPPING',
    `Mapped product ${productId}${packageId ? ` (pkg ${packageId})` : ''} -> ${actionType} (enabled=${mapping.enabled})`
  );
  saveAutoOrderState(state);
  return state.mappings;
}

export function deleteProductMapping(
  tenantId: string,
  actor: string,
  productId: string,
  packageId?: string
): ProductDeliveryMapping[] {
  const state = getAutoOrderState(tenantId);
  state.mappings = state.mappings.filter(
    (m) => !(m.productId === productId && (m.packageId || '') === (packageId || ''))
  );
  appendAuditLog(
    state,
    actor,
    'DELETE_PRODUCT_MAPPING',
    `Removed FFGlory delivery mapping for product ${productId}${packageId ? ` (pkg ${packageId})` : ''}`
  );
  saveAutoOrderState(state);
  return state.mappings;
}

export function findProductMapping(
  tenantId: string,
  productId: string,
  packageId?: string
): ProductDeliveryMapping | null {
  const state = getAutoOrderState(tenantId);
  if (packageId) {
    const exact = state.mappings.find(
      (m) => m.enabled && m.productId === productId && m.packageId === packageId
    );
    if (exact) return exact;
  }
  const fallback = state.mappings.find(
    (m) => m.enabled && m.productId === productId && !m.packageId
  );
  return fallback || null;
}

export function generateUniqueOrderId(existingOrders: AutoOrder[]): string {
  const existing = new Set(existingOrders.map((o) => o.id));
  for (let i = 0; i < 20; i++) {
    const suffix = Math.floor(100000 + Math.random() * 900000);
    const candidate = `YH-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `YH-${Date.now().toString().slice(-6)}`;
}

export function createAutoOrder(
  tenantId: string,
  input: {
    orderId?: string;
    customerJid: string;
    customerNumber: string;
    customerName?: string;
    productId: string;
    productName: string;
    packageId?: string;
    packageDays?: string;
    priceDisplay: string;
    amountLkr: number;
    clanId?: string;
    regionOverride?: string;
    modeOverride?: OperatingMode;
  }
): AutoOrder {
  const state = getAutoOrderState(tenantId);
  const mapping = findProductMapping(tenantId, input.productId, input.packageId);

  const deliveryAction: DeliveryActionType = mapping ? mapping.actionType : 'MANUAL';
  const resolvedAmount =
    mapping?.priceLkrOverride && mapping.priceLkrOverride > 0
      ? mapping.priceLkrOverride
      : Math.round((Number(input.amountLkr) || 0) * 100) / 100;

  const deliveryParams: AutoOrder['deliveryParams'] = {};
  if (deliveryAction === 'COUPON' && mapping) {
    deliveryParams.basic_credits = mapping.basicCredits || 0;
    deliveryParams.premium_credits = mapping.premiumCredits || 0;
  } else if (deliveryAction === 'CLAN_GROUP' && mapping) {
    deliveryParams.region = (input.regionOverride || mapping.region || 'bd').trim().toLowerCase();
    if (input.clanId) {
      deliveryParams.clan_id = String(input.clanId).trim();
    }
  }

  const now = new Date().toISOString();
  const candidateId = input.orderId ? String(input.orderId).trim().toUpperCase() : '';
  const id =
    candidateId && !state.orders.some((o) => o.id === candidateId)
      ? candidateId
      : generateUniqueOrderId(state.orders);

  const order: AutoOrder = {
    id,
    tenantId: state.tenantId,
    mode: input.modeOverride || state.settings.operatingMode,
    customerJid: String(input.customerJid || '').slice(0, 120),
    customerNumber: String(input.customerNumber || '').replace(/[^0-9+]/g, '').slice(0, 24),
    customerName: String(input.customerName || input.customerNumber || 'Customer').trim().slice(0, 80),
    productId: String(input.productId || '').slice(0, 80),
    productName: String(input.productName || 'Order').trim().slice(0, 120),
    packageId: input.packageId ? String(input.packageId).slice(0, 80) : undefined,
    packageDays: input.packageDays ? String(input.packageDays).slice(0, 60) : undefined,
    priceDisplay: String(input.priceDisplay || `LKR ${resolvedAmount}`).slice(0, 50),
    amountLkr: resolvedAmount,
    deliveryAction,
    deliveryParams,
    status: 'PENDING_PAYMENT',
    createdAt: now,
    updatedAt: now,
  };

  state.orders.unshift(order);
  appendAuditLog(
    state,
    'whatsapp_bot',
    'ORDER_CREATED',
    `New order ${order.id} for "${order.productName}" (LKR ${order.amountLkr}) via ${deliveryAction} [${order.mode}]`,
    order.id
  );
  saveAutoOrderState(state);
  return order;
}

function normalizeTxnKey(transactionId: string, bank: string): string {
  const cleanRef = String(transactionId || '').trim().toUpperCase();
  const cleanBank = String(bank || 'BANK').trim().toUpperCase().replace(/\s+/g, '_');
  return `${cleanBank}::${cleanRef}`;
}

export function buildWhatsAppDeliveryMessage(
  order: AutoOrder,
  storeName: string,
  supportContact: string
): string {
  const isTest = order.delivery?.mode === 'TEST' || order.mode === 'TEST';
  const lines: string[] = [
    isTest ? `🧪 *[TEST MODE] ORDER DELIVERED*` : `✅ *ORDER DELIVERED SUCCESSFULLY!*`,
    `━━━━━━━━━━━━━━━━━━━━━━━━`,
    `👤 *Customer Name:* ${order.customerName}`,
    `🧾 *Order ID:* ${order.id}`,
    `🛍️ *Product:* ${order.productName}${order.packageDays ? ` (${order.packageDays})` : ''}`,
    `💳 *Transaction Status:* PAYMENT VERIFIED & DELIVERED`,
  ];

  if (order.payment?.transactionId) {
    lines.push(`🔖 *Payment Ref:* ${order.payment.transactionId} (${order.payment.bank})`);
  }

  lines.push(``);

  if (order.delivery?.actionType === 'COUPON' && order.delivery.couponCode) {
    lines.push(`🎟️ *YOUR FFGLORY COUPON DETAILS:*`);
    lines.push(`🔑 *Coupon Code:* \`${order.delivery.couponCode}\``);
    if ((order.delivery.basicCredits || 0) > 0) {
      lines.push(`⚡ *Basic Credits:* ${order.delivery.basicCredits}`);
    }
    if ((order.delivery.premiumCredits || 0) > 0) {
      lines.push(`👑 *Premium Credits:* ${order.delivery.premiumCredits}`);
    }
    lines.push(`📌 Redeem your code inside FFGlory Panel → Coupons → Redeem.`);
  } else if (order.delivery?.actionType === 'CLAN_GROUP' && order.delivery.groupId) {
    lines.push(`🔥 *FFGLORY CLAN GROUP LAUNCHED:*`);
    lines.push(`🆔 *Group ID:* \`${order.delivery.groupId}\``);
    if (order.delivery.clanId) lines.push(`🛡️ *Clan ID:* ${order.delivery.clanId}`);
    if (order.delivery.region) lines.push(`🌍 *Region:* ${order.delivery.region.toUpperCase()}`);
    if (order.delivery.botCount) lines.push(`🤖 *Active Bots:* ${order.delivery.botCount}`);
    lines.push(`⚡ Your Clan Glory farming group is now active!`);
  } else {
    lines.push(`📦 *Delivery Status:* Confirmed and queued for fulfillment.`);
  }

  lines.push(``);
  if (supportContact) {
    const digits = supportContact.replace(/\D/g, '');
    lines.push(
      digits.length >= 8
        ? `📞 *Support Contact:* https://wa.me/${digits.startsWith('0') ? '94' + digits.slice(1) : digits}`
        : `📞 *Support Contact:* ${supportContact}`
    );
  }
  lines.push(`_${storeName || 'YASHI HALLS'} Auto Delivery System_`);

  return lines.join('\n');
}

/**
 * Executes FFGlory API delivery safely with strict duplicate-delivery & idempotency locking.
 * ONLY runs when order.status === 'PAYMENT_VERIFIED' or (allowRetry && order.status === 'DELIVERY_FAILED').
 */
export async function executeAutoOrderDelivery(
  tenantId: string,
  orderId: string,
  options: {
    actor?: string;
    allowRetry?: boolean;
    isAdminSimulation?: boolean;
    dispatcher?: WhatsAppDeliveryDispatcher;
    onLaunchProgress?: (ev: FFGloryLaunchProgressEvent) => void | Promise<void>;
  } = {}
): Promise<{ success: boolean; order: AutoOrder | null; message: string }> {
  const safeTenant = sanitizeTenantId(tenantId);
  const lockKey = `${safeTenant}:${orderId}`;

  if (inFlightDeliveryLocks.has(lockKey)) {
    const current = getAutoOrderState(safeTenant).orders.find((o) => o.id === orderId) || null;
    return {
      success: false,
      order: current,
      message: 'Delivery is already in progress for this order (duplicate request blocked).',
    };
  }

  inFlightDeliveryLocks.add(lockKey);
  try {
    const state = getAutoOrderState(safeTenant);
    const idx = state.orders.findIndex((o) => o.id === orderId);
    if (idx === -1) {
      return { success: false, order: null, message: 'Order not found.' };
    }

    const order = state.orders[idx];

    // Hard idempotency check: NEVER deliver a REAL LIVE order twice.
    // Allow admin retry ONLY if a previous order was mistakenly simulated in TEST mode.
    const wasSimulatedTestDelivery =
      order.status === 'DELIVERED' &&
      (order.delivery?.mode === 'TEST' || String(order.delivery?.groupId || '').startsWith('test_grp_'));
    if (order.status === 'DELIVERED' && !(options.allowRetry && wasSimulatedTestDelivery)) {
      return {
        success: false,
        order,
        message: 'Order has already been delivered. Duplicate delivery blocked.',
      };
    }
    if (order.status === 'WAITING_DELIVERY') {
      return {
        success: false,
        order,
        message: 'Order is currently awaiting delivery response.',
      };
    }
    if (order.status === 'CANCELLED') {
      return {
        success: false,
        order,
        message: 'Cannot deliver a cancelled order.',
      };
    }
    if (
      order.status !== 'PAYMENT_VERIFIED' &&
      !(options.allowRetry && (order.status === 'DELIVERY_FAILED' || wasSimulatedTestDelivery))
    ) {
      return {
        success: false,
        order,
        message: `Order must be PAYMENT_VERIFIED before delivery (current status: ${order.status}).`,
      };
    }

    if (order.deliveryAction === 'MANUAL') {
      order.statusReason = 'Payment verified — Manual fulfillment product (no FFGlory API mapping).';
      order.updatedAt = new Date().toISOString();
      saveAutoOrderState(state);
      return {
        success: true,
        order,
        message: 'Payment verified. Product is set to Manual delivery.',
      };
    }

    if (!state.settings.ffgloryEnabled) {
      order.status = 'DELIVERY_FAILED';
      order.statusReason = 'FFGlory API delivery is currently disabled in API Settings.';
      order.updatedAt = new Date().toISOString();
      saveAutoOrderState(state);
      return {
        success: false,
        order,
        message: 'FFGlory API is disabled in settings.',
      };
    }

    // CRITICAL SAFETY: Real customer orders MUST NEVER run in fake simulated TEST mode!
    // Simulated TEST responses are strictly restricted to the Admin Test Simulator (isAdminSimulation=true).
    const isAdminSim = Boolean(options.isAdminSimulation || order.payment?.verifiedBy === 'TEST_SIMULATOR');
    const runMode: OperatingMode = isAdminSim && state.settings.operatingMode === 'TEST' ? 'TEST' : 'LIVE';
    const prevAttempts = order.delivery?.attemptCount || 0;
    const endpoint =
      order.deliveryAction === 'COUPON'
        ? '/api/client/create-coupon'
        : '/api/client/auto-clan-group';

    const couponPayload = {
      basic_credits: Math.max(0, Number(order.deliveryParams.basic_credits) || 0),
      premium_credits: Math.max(0, Number(order.deliveryParams.premium_credits) || 0),
    };
    const groupPayload = {
      region: String(order.deliveryParams.region || '').trim().toLowerCase(),
      clan_id: String(order.deliveryParams.clan_id || '').trim(),
    };
    const requestPayload: Record<string, any> =
      order.deliveryAction === 'COUPON' ? couponPayload : groupPayload;

    // Validate required parameters BEFORE hitting API
    if (
      order.deliveryAction === 'COUPON' &&
      couponPayload.basic_credits + couponPayload.premium_credits < 1
    ) {
      order.status = 'DELIVERY_FAILED';
      order.statusReason = 'Coupon mapping has 0 basic and 0 premium credits configured.';
      order.updatedAt = new Date().toISOString();
      saveAutoOrderState(state);
      return { success: false, order, message: order.statusReason };
    }
    if (
      order.deliveryAction === 'CLAN_GROUP' &&
      (!groupPayload.region || !groupPayload.clan_id)
    ) {
      order.status = 'MANUAL_REVIEW';
      order.statusReason = 'Missing Clan ID or Region for FFGlory Clan Group launch.';
      order.updatedAt = new Date().toISOString();
      saveAutoOrderState(state);
      return { success: false, order, message: order.statusReason };
    }

    // Lock status to WAITING_DELIVERY and persist BEFORE external call
    order.status = 'WAITING_DELIVERY';
    order.mode = runMode;
    order.processingStage = 'CONNECTING_FFGLORY';
    order.statusReason = `Connecting to FFGlory (${endpoint}, ${runMode} mode)...`;
    order.delivery = {
      provider: 'FFGLORY',
      mode: runMode,
      actionType: order.deliveryAction,
      endpoint,
      requestPayload,
      attemptCount: prevAttempts + 1,
      attemptedAt: new Date().toISOString(),
      success: false,
    };
    order.updatedAt = new Date().toISOString();
    appendAuditLog(
      state,
      options.actor || 'auto_delivery_engine',
      'DELIVERY_STARTED',
      `Attempt #${prevAttempts + 1} calling ${endpoint} in ${runMode} mode`,
      order.id
    );
    saveAutoOrderState(state);

    let apiResponse: any = null;
    let recoveredFromExistingGroup = false;
    try {
      if (runMode === 'TEST') {
        // Safe Test Mode: simulate realistic FFGlory response without spending credits
        await new Promise((r) => setTimeout(r, 350));
        if (order.deliveryAction === 'COUPON') {
          const seg = () => crypto.randomBytes(2).toString('hex').toUpperCase();
          apiResponse = {
            success: true,
            simulated: true,
            coupon: {
              code: `TEST-${seg()}-${seg()}`,
              basic_credits: couponPayload.basic_credits,
              premium_credits: couponPayload.premium_credits,
              status: 'active',
              created_at: new Date().toISOString(),
            },
          };
        } else {
          // Simulate realistic SSE account progress steps in TEST MODE
          const simReq = Number(order.botQuantity || 4);
          if (options.onLaunchProgress) {
            for (let step = 1; step <= simReq; step++) {
              await new Promise((r) => setTimeout(r, 320));
              await Promise.resolve(
                options.onLaunchProgress({
                  event: 'progress',
                  generated: step,
                  requested: simReq,
                  etaSeconds: Math.max(0, (simReq - step) * 2),
                  region: groupPayload.region,
                })
              ).catch(() => {});
            }
          }
          const simGroupId = `test_grp_${crypto.randomBytes(3).toString('hex')}`;
          if (options.onLaunchProgress) {
            await Promise.resolve(
              options.onLaunchProgress({
                event: 'done',
                generated: simReq,
                requested: simReq,
                etaSeconds: 0,
                region: groupPayload.region,
                groupId: simGroupId,
              })
            ).catch(() => {});
          }
          apiResponse = {
            success: true,
            simulated: true,
            group_id: simGroupId,
            bot_count: simReq,
            region: groupPayload.region,
            clan_id: groupPayload.clan_id,
          };
        }
      } else {
        // LIVE MODE — Real FFGlory API call (https://ffglory.pro)
        const { creds } = resolveFFGloryCredentials(safeTenant);
        if (!creds.apiKey || !creds.masterKey) {
          throw new FFGloryApiError(
            'FFGlory API Key or Master Key (x-api-key) is NOT configured on the server. Go to Auto Order Management → Connect FFGlory API and save your keys, then click Retry Delivery.',
            401,
            endpoint
          );
        }

        // PHASE 10 SAFETY: Before retrying a previously timed-out/failed LIVE CLAN_GROUP launch,
        // query GET /api/client/my-groups to verify if the group was ALREADY created on FFGlory!
        if (order.deliveryAction === 'CLAN_GROUP' && prevAttempts > 0 && !wasSimulatedTestDelivery) {
          try {
            const existingGroups = await ffgloryClient.getMyGroups(creds);
            const orderCreatedMs = Date.parse(order.createdAt || '') || 0;
            const alreadyCreated = existingGroups.find((g) => {
              const sameClan = String(g.clan_id || '').trim() === groupPayload.clan_id;
              const sameRegion = String(g.region || '').trim().toLowerCase() === groupPayload.region;
              const isRunning = String(g.status || '').toLowerCase() === 'running';
              const createdMs = g.created_at ? Date.parse(g.created_at) : 0;
              const recentEnough = !createdMs || createdMs >= orderCreatedMs - 5 * 60 * 1000;
              return sameClan && sameRegion && (isRunning || recentEnough);
            });
            if (alreadyCreated && alreadyCreated.group_id) {
              recoveredFromExistingGroup = true;
              apiResponse = {
                success: true,
                group_id: alreadyCreated.group_id,
                group_ids: [alreadyCreated.group_id],
                bot_count: alreadyCreated.running_count || alreadyCreated.container_count || 4,
                status: alreadyCreated.status,
                recovered_via_my_groups: true,
              };
            }
          } catch {
            // Continue with normal launch if my-groups precheck fails transiently
          }
        }

        if (!apiResponse) {
          // Update real stage to LAUNCH_REQUEST_SUBMITTED / WAITING_API_RESPONSE
          const midState = getAutoOrderState(safeTenant);
          const midOrder = midState.orders.find((o) => o.id === orderId);
          if (midOrder) {
            midOrder.processingStage = 'WAITING_API_RESPONSE';
            midOrder.statusReason = `Launch request submitted to https://ffglory.pro${endpoint}. Waiting for FFGlory response...`;
            midOrder.updatedAt = new Date().toISOString();
            saveAutoOrderState(midState);
          }

          if (order.deliveryAction === 'COUPON') {
            apiResponse = await ffgloryClient.createCoupon(creds, couponPayload);
          } else {
            // 1 FFGlory auto-clan-group = 4 bots (1 credit). Launch multiple groups for 8 / 12 / 16 bots!
            const totalRequestedBots = Math.max(4, Number(order.botQuantity || 4));
            const groupsNeeded = Math.max(1, Math.min(4, Math.ceil(totalRequestedBots / 4)));
            const launchedGroupIds: string[] = [];
            let totalBotCount = 0;
            let lastGroupRes: any = null;

            for (let gIdx = 0; gIdx < groupsNeeded; gIdx++) {
              if (gIdx > 0) {
                // Brief spacing between consecutive group launches to avoid 409 conflict
                await new Promise((r) => setTimeout(r, 2500));
              }

              const launchSingleGroup = async () =>
                ffgloryClient.launchAutoClanGroup(
                  creds,
                  groupPayload,
                  options.onLaunchProgress
                    ? async (ev) => {
                        const completedBefore = gIdx * 4;
                        const stepGen = Math.min(4, Number(ev.generated || 0));
                        await options.onLaunchProgress!({
                          ...ev,
                          event: ev.event === 'done' && gIdx < groupsNeeded - 1 ? 'progress' : ev.event,
                          generated: Math.min(totalRequestedBots, completedBefore + stepGen),
                          requested: totalRequestedBots,
                        });
                      }
                    : undefined
                );

              let groupRes: any;
              try {
                groupRes = await launchSingleGroup();
              } catch (launchErr: any) {
                if (
                  gIdx > 0 &&
                  launchErr instanceof FFGloryApiError &&
                  (launchErr.statusCode === 409 || launchErr.statusCode === 429)
                ) {
                  await new Promise((r) => setTimeout(r, 4000));
                  groupRes = await launchSingleGroup();
                } else if (gIdx > 0 && launchedGroupIds.length > 0) {
                  // Partial multi-group launch: preserve already-launched group IDs in error context
                  launchErr.message = `${launchErr.message} (${launchedGroupIds.length}/${groupsNeeded} groups already launched: ${launchedGroupIds.join(', ')})`;
                  throw launchErr;
                } else {
                  throw launchErr;
                }
              }

              const gid = String(groupRes?.group_id || groupRes?.groupId || '').trim();
              if (!groupRes?.success || !gid) {
                throw new FFGloryApiError(
                  groupRes?.message || groupRes?.error || `FFGlory did not return a valid group_id for group #${gIdx + 1}.`,
                  502,
                  endpoint,
                  groupRes
                );
              }

              launchedGroupIds.push(gid);
              totalBotCount += Number(groupRes?.bot_count || 4);
              lastGroupRes = groupRes;
            }

            apiResponse = {
              ...(lastGroupRes || {}),
              success: true,
              group_id: launchedGroupIds[0],
              group_ids: launchedGroupIds,
              bot_count: totalBotCount || totalRequestedBots,
              groups_launched: launchedGroupIds.length,
            };
          }
        }
      }

      // Strictly verify response.success AND required delivery payload before marking DELIVERED
      const isCouponValid =
        order.deliveryAction === 'COUPON' &&
        apiResponse?.success === true &&
        typeof apiResponse?.coupon?.code === 'string' &&
        apiResponse.coupon.code.trim().length > 0;

      const isGroupValid =
        order.deliveryAction === 'CLAN_GROUP' &&
        apiResponse?.success === true &&
        typeof apiResponse?.group_id === 'string' &&
        apiResponse.group_id.trim().length > 0;

      if (!isCouponValid && !isGroupValid) {
        throw new FFGloryApiError(
          'FFGlory API returned an incomplete response without required delivery data.',
          502,
          endpoint,
          apiResponse
        );
      }

      // Reload state fresh so concurrent updates aren't clobbered
      const freshState = getAutoOrderState(safeTenant);
      const freshIdx = freshState.orders.findIndex((o) => o.id === orderId);
      if (freshIdx === -1) {
        return { success: false, order: null, message: 'Order disappeared during delivery.' };
      }

      const deliveredOrder = freshState.orders[freshIdx];
      deliveredOrder.status = 'DELIVERED';
      deliveredOrder.mode = runMode;
      deliveredOrder.processingStage = 'LAUNCHED';
      deliveredOrder.statusReason = recoveredFromExistingGroup
        ? 'Recovered existing active FFGlory group via /api/client/my-groups (prevented duplicate charge).'
        : runMode === 'TEST'
        ? 'Delivered successfully in TEST MODE (Admin Simulation).'
        : `Delivered live via https://ffglory.pro (${Array.isArray(apiResponse.group_ids) ? apiResponse.group_ids.length : 1} group).`;
      deliveredOrder.delivery = {
        ...deliveredOrder.delivery!,
        mode: runMode,
        success: true,
        completedAt: new Date().toISOString(),
        couponCode: isCouponValid ? apiResponse.coupon.code : undefined,
        basicCredits: isCouponValid ? apiResponse.coupon.basic_credits : undefined,
        premiumCredits: isCouponValid ? apiResponse.coupon.premium_credits : undefined,
        groupId: isGroupValid ? apiResponse.group_id : undefined,
        groupIds: isGroupValid
          ? Array.isArray(apiResponse.group_ids) && apiResponse.group_ids.length > 0
            ? apiResponse.group_ids
            : [apiResponse.group_id]
          : undefined,
        botCount: isGroupValid ? Number(apiResponse.bot_count || 4) : undefined,
        region: isGroupValid ? requestPayload.region : undefined,
        clanId: isGroupValid ? requestPayload.clan_id : undefined,
        rawResponse: apiResponse,
        recoveredFromExistingGroup,
        errorMessage: undefined,
        errorCode: undefined,
      };
      deliveredOrder.updatedAt = new Date().toISOString();

      appendAuditLog(
        freshState,
        options.actor || 'auto_delivery_engine',
        'ORDER_DELIVERED',
        isCouponValid
          ? `Delivered FFGlory Coupon (${runMode}) for order ${deliveredOrder.id}`
          : `Launched FFGlory Clan Group ${apiResponse.group_id} (${runMode}${recoveredFromExistingGroup ? ', recovered' : ''}) for clan ${requestPayload.clan_id}`,
        deliveredOrder.id
      );

      // Persist delivered order state BEFORE fetching live glory telemetry so groupId is saved
      saveAutoOrderState(freshState);

      // Dispatch Automatic WhatsApp Delivery via existing Business Bot connection
      if (options.dispatcher && deliveredOrder.customerJid) {
        let sent = false;
        const brandName = options.dispatcher.getStoreName() || 'YASHI HALLS';

        // PHASE 8 — Video-2 Live "CLAN · GROUP MAP" HTML App Card (fetches real live Clan & Glory data)
        if (isGroupValid) {
          // Give FFGlory ~2.5s on LIVE mode to join the clan & populate real clan info/glory telemetry
          if (runMode === 'LIVE' && !recoveredFromExistingGroup) {
            await new Promise((r) => setTimeout(r, 2500));
            // Warm live telemetry; if clan_name is not ready yet, wait 2.5s and retry once
            const warmRes = await fetchOrderLiveGlory(safeTenant, deliveredOrder.id, { force: true }).catch(() => null);
            if (!warmRes?.liveGlory?.clanName) {
              await new Promise((r) => setTimeout(r, 2500));
            }
          }

          const liveCardRes = await sendLiveGloryCardToWhatsApp(
            safeTenant,
            deliveredOrder.id,
            options.dispatcher,
            { isInitialLaunch: true, force: true }
          ).catch(() => ({ success: false, message: 'Failed to dispatch live card', sent: false }));

          sent = Boolean(liveCardRes.sent);

          // Fallback to PNG success card only if both HTML App and fallback live card failed
          if (!sent && options.dispatcher.sendInteractiveCard) {
            const portalUrl = buildOrderPortalUrl(safeTenant, deliveredOrder);
            const regionDisplay =
              deliveredOrder.guildConfig?.regionName || String(requestPayload.region || '').toUpperCase();
            const launchTimeStr = new Date().toLocaleString('en-GB');
            let successPng: Buffer | null = null;
            try {
              successPng = await renderSuccessCardPng({
                brandName,
                orderId: deliveredOrder.id,
                groupId: apiResponse.group_id,
                clanId: requestPayload.clan_id,
                regionLabel: regionDisplay,
                actualBotCount: Number(apiResponse.bot_count || 4),
                launchTime: launchTimeStr,
                groupStatus: String(apiResponse.status || 'running'),
                isTestMode: runMode === 'TEST',
              });
            } catch {
              successPng = null;
            }

            const successText = [
              runMode === 'TEST'
                ? `🧪 *[TEST MODE] GLORY BOTS SUCCESSFULLY LAUNCHED!*`
                : `✅ *GLORY BOTS SUCCESSFULLY LAUNCHED!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `🧾 *Order ID:* ${deliveredOrder.id}`,
              `🆔 *Group ID:* \`${apiResponse.group_id}\``,
              `🛡️ *Guild ID:* ${requestPayload.clan_id}`,
              `🌍 *Region:* ${regionDisplay}`,
              `🤖 *Actual Bot Count:* ${Number(apiResponse.bot_count || 4)} Bots`,
              `🕒 *Launch Time:* ${launchTimeStr}`,
              `📡 *Group Status:* ${String(apiResponse.status || 'RUNNING').toUpperCase()}`,
              ``,
              `👇 Tap *🔄 REFRESH LIVE GLORY* below anytime to check real-time Clan Glory & Clan Info!`,
            ].join('\n');

            sent = await options.dispatcher
              .sendInteractiveCard(deliveredOrder.customerJid, {
                image: successPng,
                title: 'GLORY BOTS SUCCESSFULLY LAUNCHED!',
                text: successText,
                footer: `${brandName} • Live Glory Auto Delivery`,
                buttons: [{ id: `guild_live_glory:${deliveredOrder.id}`, text: '🔄 REFRESH LIVE GLORY' }],
                urls: portalUrl ? [{ displayText: '🌐 OPEN LIVE GLORY CARD', url: portalUrl }] : [],
              })
              .catch(() => false);
          }
        }

        if (!sent) {
          const waText = buildWhatsAppDeliveryMessage(
            deliveredOrder,
            brandName,
            freshState.settings.supportContact
          );
          sent = await options.dispatcher
            .sendMessage(deliveredOrder.customerJid, waText)
            .catch(() => false);
        }

        // Reload fresh state so liveGlory written by sendLiveGloryCardToWhatsApp is preserved!
        const postSendState = getAutoOrderState(safeTenant);
        const postSendOrder = postSendState.orders.find((o) => o.id === orderId);
        if (postSendOrder) {
          postSendOrder.whatsappDelivered = sent;
          if (sent) {
            postSendOrder.whatsappDeliveredAt = new Date().toISOString();
          }
          saveAutoOrderState(postSendState);
        }

        // Notify Owner with delivery summary
        const ownerJid = options.dispatcher.getOwnerJid();
        if (ownerJid && ownerJid !== deliveredOrder.customerJid) {
          const ownerNote = [
            runMode === 'TEST'
              ? `🧪 *[TEST MODE] AUTO ORDER DELIVERED*`
              : `🚀 *AUTO ORDER DELIVERED (FFGLORY)*`,
            `🧾 *Order:* ${deliveredOrder.id}`,
            `👤 *Customer:* ${deliveredOrder.customerName} (+${deliveredOrder.customerNumber})`,
            `🛍️ *Product:* ${deliveredOrder.productName}`,
            `💰 *Paid:* LKR ${deliveredOrder.amountLkr}`,
            isCouponValid
              ? `🎟️ *Coupon:* \`${apiResponse.coupon.code}\``
              : `🔥 *Group ID:* \`${apiResponse.group_id}\` (Clan: ${requestPayload.clan_id})`,
            sent
              ? `📲 *WhatsApp Delivery:* Sent to customer`
              : `⚠️ *WhatsApp Delivery:* Bot offline — send manually`,
          ].join('\n');
          await options.dispatcher.sendMessage(ownerJid, ownerNote).catch(() => false);
        }
      }

      // Refresh cached balance in background on LIVE delivery
      if (runMode === 'LIVE') {
        void refreshFFGloryBalance(safeTenant).catch(() => {});
      }

      return {
        success: true,
        order: deliveredOrder,
        message: `Order ${deliveredOrder.id} delivered successfully (${runMode} mode).`,
      };
    } catch (err: any) {
      const statusCode = err instanceof FFGloryApiError ? err.statusCode : 500;
      const { creds } = resolveFFGloryCredentials(safeTenant);
      const safeErrorMsg = redactFFGlorySecrets(
        err?.message || 'FFGlory delivery request failed',
        creds
      );

      const errState = getAutoOrderState(safeTenant);
      const errIdx = errState.orders.findIndex((o) => o.id === orderId);
      if (errIdx >= 0) {
        const failedOrder = errState.orders[errIdx];
        failedOrder.status = 'DELIVERY_FAILED';
        failedOrder.processingStage = 'FAILED';
        failedOrder.statusReason = safeErrorMsg;
        failedOrder.delivery = {
          ...failedOrder.delivery!,
          success: false,
          errorMessage: safeErrorMsg,
          errorCode: statusCode,
          rawResponse: err instanceof FFGloryApiError ? err.responseBody : undefined,
        };
        failedOrder.updatedAt = new Date().toISOString();

        appendApiError(errState, endpoint, statusCode, safeErrorMsg, failedOrder.id);
        appendAuditLog(
          errState,
          options.actor || 'auto_delivery_engine',
          'DELIVERY_FAILED',
          `FFGlory delivery failed (HTTP ${statusCode}): ${safeErrorMsg}`,
          failedOrder.id
        );
        saveAutoOrderState(errState);

        // Notify owner immediately AND inform customer honestly (never fake a launch!)
        if (options.dispatcher) {
          const ownerJid = options.dispatcher.getOwnerJid();
          if (ownerJid) {
            const alertMsg = [
              `⚠️ *AUTO DELIVERY FAILED — ACTION REQUIRED*`,
              `🧾 *Order ID:* ${failedOrder.id}`,
              `👤 *Customer:* ${failedOrder.customerName} (+${failedOrder.customerNumber})`,
              `🛍️ *Product:* ${failedOrder.productName}`,
              failedOrder.guildConfig?.clanId
                ? `🛡️ *Clan ID:* ${failedOrder.guildConfig.clanId} (${failedOrder.guildConfig.regionName})`
                : '',
              `💰 *Payment:* VERIFIED (LKR ${failedOrder.amountLkr})`,
              `❌ *FFGlory API Error (HTTP ${statusCode}):* ${safeErrorMsg}`,
              ``,
              `👉 Dashboard → *Auto Order Management* වෙත ගොස් FFGlory API Key & x-api-key සම්බන්ධ කර *Retry Failed Delivery* ඔබන්න.`,
            ]
              .filter(Boolean)
              .join('\n');
            await options.dispatcher.sendMessage(ownerJid, alertMsg).catch(() => false);
          }

          if (failedOrder.customerJid && failedOrder.customerJid !== ownerJid) {
            const custNotice = [
              `✅ *ඔබගේ Guild විස්තර සාර්ථකව ලැබුණි!*`,
              `━━━━━━━━━━━━━━━━━━━━`,
              `🧾 *Order ID:* ${failedOrder.id}`,
              failedOrder.guildConfig?.clanId ? `🛡️ *Guild ID:* ${failedOrder.guildConfig.clanId}` : '',
              failedOrder.guildConfig?.regionName ? `🌍 *Region:* ${failedOrder.guildConfig.regionName}` : '',
              ``,
              `⏳ FFGlory Server සම්බන්ධතාවය තාවකාලිකව ප්‍රමාද වී ඇත. අපගේ Admin කණ්ඩායම වෙත දැන්වීම් යවා ඇති අතර සුළු මොහොතකින් ඔබේ Glory Bots සක්‍රීය කරනු ඇත.`,
            ]
              .filter(Boolean)
              .join('\n');
            await options.dispatcher.sendMessage(failedOrder.customerJid, custNotice).catch(() => false);
          }
        }

        return {
          success: false,
          order: failedOrder,
          message: safeErrorMsg,
        };
      }

      return { success: false, order: null, message: safeErrorMsg };
    }
  } finally {
    inFlightDeliveryLocks.delete(lockKey);
  }
}

/**
 * Matches a trusted incoming payment event from the existing Android Permission App (YASHI HALLS Pay)
 * against PENDING_PAYMENT auto orders with strict anti-duplicate & exact-amount validation.
 */
export async function processGatewayPaymentForAutoOrders(
  tenantId: string,
  event: BusinessPayEvent,
  dispatcher?: WhatsAppDeliveryDispatcher,
  options: { targetOrderId?: string; verifiedBy?: AutoOrderPaymentDetails['verifiedBy'] } = {}
): Promise<{
  outcome: 'VERIFIED_AND_DELIVERED' | 'VERIFIED_PENDING_DELIVERY' | 'MANUAL_REVIEW' | 'DUPLICATE_BLOCKED' | 'UNMATCHED' | 'IGNORED';
  order?: AutoOrder;
  message: string;
}> {
  const safeTenant = sanitizeTenantId(tenantId);

  // Never treat ignored/zero-amount notifications as payment proof
  if (event.status === 'ignored' || !Number.isFinite(event.amountLkr) || event.amountLkr <= 0) {
    return { outcome: 'IGNORED', message: 'Payment event ignored (not a valid bank credit confirmation).' };
  }

  const txnKey = normalizeTxnKey(event.reference || event.id, event.bank);
  const webhookLock = `${safeTenant}:${txnKey}`;
  if (inFlightWebhookLocks.has(webhookLock)) {
    return { outcome: 'DUPLICATE_BLOCKED', message: 'Duplicate concurrent payment event blocked.' };
  }

  inFlightWebhookLocks.add(webhookLock);
  try {
    const state = getAutoOrderState(safeTenant);

    // 1. Strict duplicate Transaction ID protection
    if (state.usedTransactionIds[txnKey]) {
      const existingUse = state.usedTransactionIds[txnKey];
      appendAuditLog(
        state,
        'payment_matcher',
        'DUPLICATE_PAYMENT_BLOCKED',
        `Blocked reused Transaction ID ${event.reference} (${event.bank}) — already used for order ${existingUse.orderId}`,
        existingUse.orderId
      );
      saveAutoOrderState(state);
      return {
        outcome: 'DUPLICATE_BLOCKED',
        message: `Transaction ID ${event.reference} was already used for order ${existingUse.orderId}.`,
      };
    }

    const nowMs = Date.now();
    const cutoffMs = nowMs - 24 * 60 * 60 * 1000;
    const rawMsg = String(event.rawMessage || '');
    const explicitOrderIdMatch = rawMsg.match(/\bYH-\d{3,8}\b/i);
    const mentionedOrderId = (options.targetOrderId || explicitOrderIdMatch?.[0] || '').toUpperCase() || undefined;

    const pendingOrders = state.orders.filter((o) => {
      if (o.status !== 'PENDING_PAYMENT' && o.status !== 'PAYMENT_DETECTED') return false;
      const t = new Date(o.createdAt).getTime();
      return Number.isFinite(t) && t >= cutoffMs;
    });

    let matchedOrder: AutoOrder | undefined;
    let manualReviewReason: string | null = null;

    // 2. Match Priority A: Explicit Order ID found in payment remark or simulator
    if (mentionedOrderId) {
      const candidate = pendingOrders.find((o) => o.id === mentionedOrderId);
      if (candidate) {
        if (candidate.amountLkr > 0 && Math.abs(candidate.amountLkr - event.amountLkr) <= 1.01) {
          matchedOrder = candidate;
        } else {
          // Order ID matched, but amount did not match -> route to MANUAL_REVIEW!
          candidate.status = 'MANUAL_REVIEW';
          candidate.statusReason = `Amount mismatch: expected LKR ${candidate.amountLkr}, received LKR ${event.amountLkr} (${event.bank}, Ref ${event.reference}).`;
          candidate.payment = {
            eventId: event.id,
            source: event.source,
            bank: event.bank,
            amountLkr: event.amountLkr,
            transactionId: event.reference,
            sender: event.sender,
            paidAt: event.timestamp || new Date().toISOString(),
            rawMessage: rawMsg.slice(0, 500),
            relatedOrderIdInMessage: mentionedOrderId,
            verifiedBy: options.verifiedBy || (event.source === 'test' ? 'TEST_SIMULATOR' : 'AUTO_GATEWAY'),
          };
          candidate.updatedAt = new Date().toISOString();
          appendAuditLog(state, 'payment_matcher', 'FLAGGED_MANUAL_REVIEW', candidate.statusReason, candidate.id);
          saveAutoOrderState(state);
          return {
            outcome: 'MANUAL_REVIEW',
            order: candidate,
            message: candidate.statusReason,
          };
        }
      }
    }

    // 3. Match Priority B: Exact amount match among active PENDING_PAYMENT / PAYMENT_DETECTED orders
    if (!matchedOrder) {
      const exactMatches = pendingOrders.filter(
        (o) => o.amountLkr > 0 && Math.abs(o.amountLkr - event.amountLkr) <= 1.01
      );
      if (exactMatches.length === 1) {
        matchedOrder = exactMatches[0];
      } else if (exactMatches.length > 1) {
        // Prefer an order that ALREADY uploaded a matching receipt with matching Ref ID!
        const receiptMatch = exactMatches.find((o) => {
          const rRef = String(o.receipt?.ocrData?.transactionRefId || '').trim().toUpperCase();
          return rRef && (String(event.reference || '').toUpperCase().includes(rRef) || rawMsg.toUpperCase().includes(rRef));
        });
        if (receiptMatch) {
          matchedOrder = receiptMatch;
        } else {
          const newest = exactMatches[0];
          manualReviewReason = `Multiple pending orders (${exactMatches.map((o) => o.id).join(', ')}) match LKR ${event.amountLkr}. Sent to Admin Approval.`;
          newest.status = 'MANUAL_REVIEW';
          newest.statusReason = manualReviewReason;
          newest.payment = {
            eventId: event.id,
            source: event.source,
            bank: event.bank,
            amountLkr: event.amountLkr,
            transactionId: event.reference,
            sender: event.sender,
            paidAt: event.timestamp || new Date().toISOString(),
            rawMessage: rawMsg.slice(0, 500),
            verifiedBy: options.verifiedBy || (event.source === 'test' ? 'TEST_SIMULATOR' : 'AUTO_GATEWAY'),
          };
          newest.updatedAt = new Date().toISOString();
          appendAuditLog(state, 'payment_matcher', 'AMBIGUOUS_PAYMENT_REVIEW', manualReviewReason, newest.id);
          saveAutoOrderState(state);
          return {
            outcome: 'MANUAL_REVIEW',
            order: newest,
            message: manualReviewReason,
          };
        }
      }
    }

    if (!matchedOrder) {
      // Save real bank alert in unmatched buffer so a customer receipt uploaded shortly after can cross-verify immediately!
      state.unmatchedBankAlerts.unshift(event);
      saveAutoOrderState(state);
      return {
        outcome: 'UNMATCHED',
        message: `No pending auto-order matched LKR ${event.amountLkr} (${event.bank}). Buffered for receipt cross-verification.`,
      };
    }

    // 4. All checks passed: PAYMENT_DETECTED -> PAYMENT_VERIFIED & record used Transaction ID + Receipt Hash
    matchedOrder.status = 'PAYMENT_DETECTED';
    matchedOrder.payment = {
      eventId: event.id,
      source: event.source,
      bank: event.bank,
      amountLkr: event.amountLkr,
      transactionId: event.reference,
      sender: event.sender,
      paidAt: event.timestamp || new Date().toISOString(),
      rawMessage: rawMsg.slice(0, 500),
      relatedOrderIdInMessage: mentionedOrderId,
      verifiedBy: matchedOrder.receipt
        ? 'RECEIPT_AND_BANK'
        : options.verifiedBy || (event.source === 'test' ? 'TEST_SIMULATOR' : 'AUTO_GATEWAY'),
    };

    // Lock Transaction ID permanently
    state.usedTransactionIds[txnKey] = {
      orderId: matchedOrder.id,
      usedAt: new Date().toISOString(),
      amountLkr: event.amountLkr,
      bank: event.bank,
    };
    if (matchedOrder.receipt?.fileHash) {
      state.usedReceiptHashes[matchedOrder.receipt.fileHash] = {
        orderId: matchedOrder.id,
        usedAt: new Date().toISOString(),
        customerNumber: matchedOrder.customerNumber,
      };
      matchedOrder.receipt.verificationStatus = 'VERIFIED';
      matchedOrder.receipt.verificationNote = `Cross-verified with ${event.bank} alert (Ref: ${event.reference}).`;
    }

    matchedOrder.status = 'PAYMENT_VERIFIED';
    matchedOrder.processingStage = 'PAYMENT_VERIFIED';
    matchedOrder.statusReason = `Verified via ${event.bank} (${event.source.toUpperCase()}) Ref: ${event.reference}`;
    matchedOrder.updatedAt = new Date().toISOString();

    appendAuditLog(
      state,
      'payment_matcher',
      'PAYMENT_VERIFIED',
      `Matched & verified LKR ${event.amountLkr} from ${event.bank} (Ref: ${event.reference}) for order ${matchedOrder.id}`,
      matchedOrder.id
    );
    saveAutoOrderState(state);

    // 5A. GUILD SERVICE FLOW: If Guild Details (Region & Clan ID) are not yet provided, send PHASE 5 Configuration Card!
    if (matchedOrder.serviceType === 'GUILD_SERVICE' && !matchedOrder.guildConfig?.clanId) {
      await sendPhase5GuildConfigCard(safeTenant, matchedOrder, dispatcher);
      return {
        outcome: 'VERIFIED_PENDING_DELIVERY',
        order: matchedOrder,
        message: `Payment verified for Guild Order ${matchedOrder.id}. Sent Phase 5 Interactive Guild Configuration Card.`,
      };
    }

    // 5B. Trigger FFGlory Automatic Delivery if mapped & enabled
    if (
      matchedOrder.deliveryAction !== 'MANUAL' &&
      state.settings.autoDeliverOnVerifiedPayment &&
      state.settings.ffgloryEnabled
    ) {
      const deliveryResult = await executeAutoOrderDelivery(safeTenant, matchedOrder.id, {
        actor: options.verifiedBy === 'TEST_SIMULATOR' ? 'admin_test_simulator' : 'auto_payment_webhook',
        isAdminSimulation: options.verifiedBy === 'TEST_SIMULATOR',
        dispatcher,
      });
      return {
        outcome: deliveryResult.success ? 'VERIFIED_AND_DELIVERED' : 'VERIFIED_PENDING_DELIVERY',
        order: deliveryResult.order || matchedOrder,
        message: deliveryResult.message,
      };
    }

    return {
      outcome: 'VERIFIED_PENDING_DELIVERY',
      order: matchedOrder,
      message: `Payment verified for order ${matchedOrder.id}.`,
    };
  } finally {
    inFlightWebhookLocks.delete(webhookLock);
  }
}

/**
 * Admin manually approves a pending or manual-review payment and triggers FFGlory delivery.
 */
export async function adminApproveOrderPayment(
  tenantId: string,
  orderId: string,
  actor: string,
  dispatcher?: WhatsAppDeliveryDispatcher,
  options: { transactionId?: string; bank?: string; clanId?: string } = {}
): Promise<{ success: boolean; order: AutoOrder | null; message: string }> {
  const state = getAutoOrderState(tenantId);
  const idx = state.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return { success: false, order: null, message: 'Order not found.' };

  const order = state.orders[idx];
  if (order.status === 'DELIVERED') {
    return { success: false, order, message: 'Order is already delivered.' };
  }
  if (order.status === 'WAITING_DELIVERY') {
    return { success: false, order, message: 'Delivery is currently in progress.' };
  }

  if (options.clanId && options.clanId.trim()) {
    order.deliveryParams.clan_id = options.clanId.trim();
  }

  const txnRef =
    (options.transactionId && options.transactionId.trim()) ||
    order.payment?.transactionId ||
    `ADMIN-${Date.now().toString().slice(-6)}`;
  const bankName = (options.bank && options.bank.trim()) || order.payment?.bank || 'Admin Approved';

  const txnKey = normalizeTxnKey(txnRef, bankName);
  if (state.usedTransactionIds[txnKey] && state.usedTransactionIds[txnKey].orderId !== order.id) {
    return {
      success: false,
      order,
      message: `Transaction ID ${txnRef} is already used by order ${state.usedTransactionIds[txnKey].orderId}.`,
    };
  }

  state.usedTransactionIds[txnKey] = {
    orderId: order.id,
    usedAt: new Date().toISOString(),
    amountLkr: order.amountLkr,
    bank: bankName,
  };

  order.payment = {
    source: order.payment?.source || 'admin_manual',
    bank: bankName,
    amountLkr: order.payment?.amountLkr || order.amountLkr,
    transactionId: txnRef,
    sender: order.payment?.sender || actor,
    paidAt: order.payment?.paidAt || new Date().toISOString(),
    rawMessage: order.payment?.rawMessage || `Approved manually by ${actor}`,
    verifiedBy: 'ADMIN_MANUAL',
  };
  order.status = 'PAYMENT_VERIFIED';
  order.processingStage = 'PAYMENT_VERIFIED';
  order.statusReason = `Payment manually approved by ${actor}`;
  if (order.receipt) {
    order.receipt.verificationStatus = 'VERIFIED';
    order.receipt.verificationNote = `Manually approved by ${actor}`;
    if (order.receipt.fileHash) {
      state.usedReceiptHashes[order.receipt.fileHash] = {
        orderId: order.id,
        usedAt: new Date().toISOString(),
        customerNumber: order.customerNumber,
      };
    }
  }
  order.updatedAt = new Date().toISOString();

  appendAuditLog(
    state,
    actor,
    'ADMIN_APPROVE_PAYMENT',
    `Approved payment for order ${order.id} (LKR ${order.amountLkr}, Ref: ${txnRef})`,
    order.id
  );
  saveAutoOrderState(state);

  // If Guild Service order without Guild Details yet -> send Phase 5 Interactive Guild Configuration Card!
  if (order.serviceType === 'GUILD_SERVICE' && !order.guildConfig?.clanId && !order.deliveryParams?.clan_id) {
    await sendPhase5GuildConfigCard(tenantId, order, dispatcher);
    return {
      success: true,
      order,
      message: `Order ${order.id} approved! Sent Phase 5 Interactive Guild Configuration Card to customer.`,
    };
  }

  if (order.deliveryAction !== 'MANUAL' && state.settings.ffgloryEnabled) {
    return executeAutoOrderDelivery(tenantId, order.id, { actor, dispatcher });
  }

  if (dispatcher && order.customerJid) {
    const waText = buildWhatsAppDeliveryMessage(
      order,
      dispatcher.getStoreName(),
      state.settings.supportContact
    );
    await dispatcher.sendMessage(order.customerJid, waText).catch(() => false);
  }

  return { success: true, order, message: `Order ${order.id} payment verified.` };
}

export function adminRejectOrCancelOrder(
  tenantId: string,
  orderId: string,
  actor: string,
  action: 'REJECT' | 'CANCEL',
  reason?: string
): { success: boolean; order: AutoOrder | null; message: string } {
  const state = getAutoOrderState(tenantId);
  const idx = state.orders.findIndex((o) => o.id === orderId);
  if (idx === -1) return { success: false, order: null, message: 'Order not found.' };

  const order = state.orders[idx];
  if (order.status === 'DELIVERED') {
    return { success: false, order, message: 'Cannot cancel or reject an already delivered order.' };
  }

  order.status = 'CANCELLED';
  order.statusReason =
    (reason && reason.trim()) ||
    (action === 'REJECT' ? `Payment rejected by ${actor}` : `Order cancelled by ${actor}`);
  order.updatedAt = new Date().toISOString();

  appendAuditLog(
    state,
    actor,
    action === 'REJECT' ? 'ADMIN_REJECT_PAYMENT' : 'ADMIN_CANCEL_ORDER',
    `${order.statusReason} (Order ${order.id})`,
    order.id
  );
  saveAutoOrderState(state);
  return { success: true, order, message: `Order ${order.id} marked as CANCELLED.` };
}

/**
 * Tests FFGlory API connection and caches live account balance (GET /api/auth/me).
 */
export async function refreshFFGloryBalance(tenantId: string): Promise<{
  success: boolean;
  account?: FFGloryAccountInfo;
  error?: string;
}> {
  const state = getAutoOrderState(tenantId);
  const { creds } = resolveFFGloryCredentials(tenantId);

  if (!creds.apiKey || !creds.masterKey) {
    state.settings.lastConnectionStatus = 'UNCONFIGURED';
    state.settings.lastConnectionCheckedAt = new Date().toISOString();
    state.settings.lastConnectionError = 'API Key and x-api-key Master Key are required.';
    saveAutoOrderState(state);
    return { success: false, error: state.settings.lastConnectionError };
  }

  try {
    const [account, groupsResult] = await Promise.all([
      ffgloryClient.getMe(creds),
      ffgloryClient.getMyGroups(creds).catch(() => null),
    ]);
    state.settings.cachedBalance = account;
    if (Array.isArray(groupsResult)) {
      state.settings.cachedActiveGroupsCount = groupsResult.filter(
        (g) => String(g?.status || '').toLowerCase() === 'running'
      ).length;
    }
    state.settings.lastConnectionStatus = 'CONNECTED';
    state.settings.lastConnectionCheckedAt = new Date().toISOString();
    state.settings.lastConnectionError = undefined;
    saveAutoOrderState(state);
    return { success: true, account };
  } catch (err: any) {
    const statusCode = err instanceof FFGloryApiError ? err.statusCode : 500;
    const safeMsg = redactFFGlorySecrets(err?.message || 'Connection test failed', creds);
    state.settings.lastConnectionStatus = 'ERROR';
    state.settings.lastConnectionCheckedAt = new Date().toISOString();
    state.settings.lastConnectionError = safeMsg;
    appendApiError(state, '/api/auth/me', statusCode, safeMsg);
    saveAutoOrderState(state);
    return { success: false, error: safeMsg };
  }
}

/**
 * Ensures live FFGlory balance & pricing are fresh (smart server TTL so UI stays live without rate-limiting).
 */
export async function ensureFreshFFGloryData(
  tenantId: string,
  options: { force?: boolean; balanceTtlMs?: number; pricingTtlMs?: number } = {}
): Promise<void> {
  const { force = false, balanceTtlMs = 15000, pricingTtlMs = 300000 } = options;
  const state = getAutoOrderState(tenantId);
  const { creds } = resolveFFGloryCredentials(tenantId);
  const now = Date.now();

  const tasks: Array<Promise<any>> = [];

  if (creds.apiKey && creds.masterKey) {
    const lastBalMs = state.settings.lastConnectionCheckedAt
      ? new Date(state.settings.lastConnectionCheckedAt).getTime()
      : 0;
    if (force || !state.settings.cachedBalance || now - lastBalMs >= balanceTtlMs) {
      tasks.push(refreshFFGloryBalance(tenantId).catch(() => null));
    }
  }

  const lastPriceMs = state.settings.cachedPricingAt
    ? new Date(state.settings.cachedPricingAt).getTime()
    : 0;
  if (force || !state.settings.cachedPricing || now - lastPriceMs >= pricingTtlMs) {
    tasks.push(refreshFFGloryPricing(tenantId).catch(() => null));
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

/**
 * Loads live regions and credit pricing from GET /api/pricing and caches it.
 */
export async function refreshFFGloryPricing(tenantId: string): Promise<{
  success: boolean;
  pricing?: FFGloryPricingResponse;
  error?: string;
}> {
  const state = getAutoOrderState(tenantId);
  try {
    const pricing = await ffgloryClient.getPricing();
    state.settings.cachedPricing = pricing;
    state.settings.cachedPricingAt = new Date().toISOString();
    saveAutoOrderState(state);
    return { success: true, pricing };
  } catch (err: any) {
    const statusCode = err instanceof FFGloryApiError ? err.statusCode : 500;
    const safeMsg = err?.message || 'Failed to load FFGlory pricing';
    appendApiError(state, '/api/pricing', statusCode, safeMsg);
    saveAutoOrderState(state);
    return { success: false, error: safeMsg };
  }
}

export function getAutoOrderDashboardSummary(tenantId: string) {
  const state = getAutoOrderState(tenantId);
  const orders = state.orders;

  const totalOrders = orders.length;
  const pendingPayments = orders.filter(
    (o) => o.status === 'PENDING_PAYMENT' || o.status === 'PAYMENT_DETECTED' || o.status === 'MANUAL_REVIEW'
  ).length;
  const verifiedPayments = orders.filter(
    (o) =>
      o.status === 'PAYMENT_VERIFIED' ||
      o.status === 'WAITING_DELIVERY' ||
      o.status === 'DELIVERED' ||
      o.status === 'DELIVERY_FAILED'
  ).length;
  const deliveredOrders = orders.filter((o) => o.status === 'DELIVERED').length;
  const failedOrders = orders.filter((o) => o.status === 'DELIVERY_FAILED').length;
  const totalSalesLkr = orders
    .filter((o) => o.status === 'DELIVERED' || o.status === 'PAYMENT_VERIFIED' || o.status === 'WAITING_DELIVERY')
    .reduce((sum, o) => sum + (Number(o.payment?.amountLkr || o.amountLkr) || 0), 0);

  const safeSettings = getSafePublicSettings(tenantId);

  // Aggregate Customer History grouped by WhatsApp number
  const customerMap = new Map<
    string,
    {
      customerNumber: string;
      customerName: string;
      totalOrders: number;
      deliveredOrders: number;
      totalSpentLkr: number;
      lastOrderAt: string;
      lastOrderId: string;
    }
  >();

  for (const o of orders) {
    const key = o.customerNumber || o.customerJid || 'unknown';
    const existing = customerMap.get(key);
    const isPaid =
      o.status === 'DELIVERED' || o.status === 'PAYMENT_VERIFIED' || o.status === 'WAITING_DELIVERY';
    const spent = isPaid ? Number(o.payment?.amountLkr || o.amountLkr) || 0 : 0;
    if (!existing) {
      customerMap.set(key, {
        customerNumber: key,
        customerName: o.customerName || key,
        totalOrders: 1,
        deliveredOrders: o.status === 'DELIVERED' ? 1 : 0,
        totalSpentLkr: spent,
        lastOrderAt: o.createdAt,
        lastOrderId: o.id,
      });
    } else {
      existing.totalOrders += 1;
      if (o.status === 'DELIVERED') existing.deliveredOrders += 1;
      existing.totalSpentLkr += spent;
      if (o.createdAt > existing.lastOrderAt) {
        existing.lastOrderAt = o.createdAt;
        existing.lastOrderId = o.id;
      }
    }
  }

  const duplicateReceiptsBlocked = (state.receiptHistory || []).filter(
    (r) => r.status === 'REJECTED_DUPLICATE_HASH' || r.status === 'REJECTED_DUPLICATE_REF'
  ).length;

  return {
    tenantId: state.tenantId,
    stats: {
      totalOrders,
      pendingPayments,
      verifiedPayments,
      deliveredOrders,
      failedOrders,
      totalSalesLkr: Math.round(totalSalesLkr * 100) / 100,
      basicCredits: safeSettings.cachedBalance?.basic_credits ?? null,
      premiumCredits: safeSettings.cachedBalance?.premium_credits ?? null,
      maxGroups: safeSettings.cachedBalance?.max_groups ?? null,
      activeGroupsCount: safeSettings.cachedActiveGroupsCount ?? null,
      apiConnectionStatus: safeSettings.lastConnectionStatus,
      duplicateReceiptsBlocked,
      guildOrdersCount: orders.filter((o) => o.serviceType === 'GUILD_SERVICE').length,
      totalReceiptsCount: (state.receiptHistory || []).length,
    },
    settings: safeSettings,
    mappings: state.mappings,
    orders: state.orders,
    receiptHistory: (state.receiptHistory || []).slice(0, 150),
    customerHistory: Array.from(customerMap.values()).sort((a, b) => b.totalSpentLkr - a.totalSpentLkr),
    apiErrors: state.apiErrors.slice(0, 50),
    auditLogs: state.auditLogs.slice(0, 100),
  };
}
