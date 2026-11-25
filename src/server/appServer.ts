import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import {
  requireAuth,
  verifyAuthToken,
  verifyFirebaseIdToken,
  extractBearerToken,
  isMasterAdminEmail,
  resolveAuthorizedTenantId,
  getOwnerPasscodeStatus,
  claimFirstRunOwnerPasscode,
  verifyOwnerPasscodeLogin,
  checkPasscodeRateLimit,
  type AuthenticatedRequest,
} from './firebaseAuth';

// Runtime safeguard for whatsapp-rust-bridge package exports
try {
  const rustBridgePkg = 'node_modules/whatsapp-rust-bridge/package.json';
  if (fs.existsSync(rustBridgePkg)) {
    const raw = fs.readFileSync(rustBridgePkg, 'utf8');
    if (!raw.includes('"main"')) {
      const parsed = JSON.parse(raw);
      parsed.main = './dist/index.js';
      if (parsed.exports && parsed.exports['.']) {
        parsed.exports['.'].default = './dist/index.js';
        parsed.exports['.'].require = './dist/index.js';
      }
      fs.writeFileSync(rustBridgePkg, JSON.stringify(parsed, null, 2));
    }
  }
} catch (e) {}

import { botEngine, getBotEngine, autoBootAllRegisteredBots } from './botEngine';
import { askGemini } from './geminiService';
import { getPluginStatusList } from './pluginService';
import { adminStore } from './adminStore';
import { ensureYtDlpBinary, cleanStaleTempFiles } from './audioService';
import {
  saveAudioFile,
  deleteAudioFile,
  getAudioFileStream,
  validateAudioBuffer,
  formatBytes,
} from './voiceService';
import { normalizeWhatsAppNumber } from '../utils/phone';
import { gatewayService } from './gatewayService';
import {
  getBusinessStore,
  updateBusinessStoreSettings,
  addBusinessProduct,
  updateBusinessProduct,
  deleteBusinessProduct,
  saveBusinessAssetFromBase64,
} from './businessStore';
import {
  getBusinessPayState,
  updateBusinessPayConfig,
  rotateBusinessPaySecret,
  resolveTenantByPaySecret,
  updateBusinessPayOrderStatus,
  touchPayDevice,
  saveBusinessPayState,
  ingestPayWebhookEvent,
  getApkBinaryPath,
  getApkBinaryInfo,
  setBusinessPayOrigin,
  buildBotLinkKey,
  resolveEffectivePayOrigin,
} from './businessPayService';
import { initPayPreviewTunnel, getPayTunnelState, ensurePayPreviewTunnel } from './payTunnelService';
import {
  getAutoOrderDashboardSummary,
  updateAutoOrderSettings,
  updateGuildFlowSettings,
  upsertProductMapping,
  deleteProductMapping,
  createAutoOrder,
  createGuildServiceOrder,
  processGatewayPaymentForAutoOrders,
  executeAutoOrderDelivery,
  adminApproveOrderPayment,
  adminRejectOrCancelOrder,
  refreshFFGloryBalance,
  refreshFFGloryPricing,
  ensureFreshFFGloryData,
  resolveFFGloryCredentials,
  getAutoOrderState,
  appendApiError,
  saveAutoOrderState,
  registerPublicPortalBaseUrl,
  buildOrderPortalUrl,
  resolveStoredReceiptFilePath,
  submitGuildConfiguration,
  fetchOrderLiveGlory,
  findOrderByPortalToken,
  sendPhase5GuildConfigCard,
  type GuildBotQuantity,
} from './autoOrderService';
import { ffgloryClient, FFGloryApiError } from './ffgloryClient';

dotenv.config();

const rootDir = process.cwd();

async function startServer() {
  const app = express();
  const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Auto-detect public origin from trusted proxy headers for WhatsApp Guild Portal links
  app.use((req, _res, next) => {
    const fwdHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const fwdProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    if (fwdHost && !fwdHost.startsWith('localhost') && !fwdHost.startsWith('127.0.0.1')) {
      registerPublicPortalBaseUrl(`${fwdProto}://${fwdHost}`);
    }
    next();
  });

  // Restricted CORS configuration: never allow wildcard '*' on authenticated APIs
  const allowedOriginPatterns = [
    /^https?:\/\/localhost(?::\d+)?$/i,
    /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
    /^https:\/\/[a-z0-9-]+\.run\.app$/i,
    /^https:\/\/[a-z0-9-]+\.workers\.dev$/i,
  ];
  const configuredOrigins = [process.env.APP_URL, process.env.PUBLIC_URL]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => {
      try {
        return new URL(v).origin;
      } catch {
        return v.replace(/\/$/, '');
      }
    });

  app.use((req: Request, res: Response, next) => {
    const origin = req.headers.origin;
    const reqHost = req.get('host');
    const isSameHost =
      typeof origin === 'string' &&
      reqHost &&
      (() => {
        try {
          return new URL(origin).host === reqHost;
        } catch {
          return false;
        }
      })();
    const isAllowedOrigin =
      typeof origin === 'string' &&
      (isSameHost ||
        configuredOrigins.includes(origin) ||
        allowedOriginPatterns.some((re) => re.test(origin)));

    if (isAllowedOrigin && origin) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-user-id, x-yashi-pay-secret, x-admin-email'
    );
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // Cryptographic Master Admin middleware (verifies Firebase ID token + email_verified + allowlist)
  const verifyAdmin = async (req: AuthenticatedRequest, res: Response, next: () => void) => {
    try {
      const token = extractBearerToken(req);
      if (!token) {
        adminStore.addAuditLog(
          'anonymous',
          'UNAUTHORIZED_ADMIN_ATTEMPT',
          `Blocked missing-token attempt to access ${req.method} ${req.path} from IP ${req.ip || 'unknown'}`
        );
        return res.status(401).json({
          success: false,
          message: 'Unauthorized. Valid Master Admin sign-in token is required.',
        });
      }

      const verified = await verifyAuthToken(token);
      if (!verified.emailVerified || !isMasterAdminEmail(verified.email)) {
        adminStore.addAuditLog(
          verified.email || verified.uid,
          'UNAUTHORIZED_ADMIN_ATTEMPT',
          `Blocked non-admin attempt to access ${req.method} ${req.path} from IP ${req.ip || 'unknown'}`
        );
        return res.status(403).json({
          success: false,
          message: 'Forbidden. Verified Master Admin permissions required for this action.',
        });
      }

      req.authUser = verified;
      req.adminEmail = verified.email;
      next();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      adminStore.addAuditLog(
        'invalid-token',
        'UNAUTHORIZED_ADMIN_ATTEMPT',
        `Blocked invalid-token attempt to access ${req.method} ${req.path} (${msg})`
      );
      return res.status(401).json({
        success: false,
        message: 'Unauthorized. Please sign in again with a verified Master Admin account.',
      });
    }
  };

  // Multi-Tenant Isolation Helper: Resolves customer's private BotEngine strictly from verified Firebase UID
  const getEngineForReq = (req: AuthenticatedRequest) => {
    const authorizedId = resolveAuthorizedTenantId(req);
    return getBotEngine(authorizedId);
  };

  // Health check endpoint
  // 24/7 Cloud Keep-Alive Endpoint for UptimeRobot / Cron / Cloudflare Workers
  app.get('/api/keepalive', (req: Request, res: Response) => {
    const primaryEngine = getBotEngine('primary');
    res.json({
      status: 'active',
      keepAlivePulse: true,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      botState: primaryEngine.state.connectionStatus,
      isOnline: primaryEngine.state.isOnline,
      message: '24/7 Always-On heartbeat acknowledged. Cloud Run container is kept awake!'
    });
  });

  // --- SERVER-VERIFIED OWNER PASSCODE AUTH (For Preview / Iframe Environments) ---
  app.get('/api/auth/passcode-status', (_req: Request, res: Response) => {
    res.json({ success: true, data: getOwnerPasscodeStatus() });
  });

  app.post('/api/auth/passcode-claim', (req: Request, res: Response) => {
    const ipKey = String(req.ip || req.headers['x-forwarded-for'] || 'local');
    const rl = checkPasscodeRateLimit(ipKey);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please wait ${rl.retryAfterSec || 60} seconds.`,
      });
    }
    const { passcode, email } = req.body || {};
    const result = claimFirstRunOwnerPasscode(String(passcode || ''), typeof email === 'string' ? email : undefined);
    res.status(result.success ? 200 : 400).json(result);
  });

  app.post('/api/auth/passcode-login', (req: Request, res: Response) => {
    const ipKey = String(req.ip || req.headers['x-forwarded-for'] || 'local');
    const rl = checkPasscodeRateLimit(ipKey);
    if (!rl.allowed) {
      return res.status(429).json({
        success: false,
        message: `Too many attempts. Please wait ${rl.retryAfterSec || 60} seconds.`,
      });
    }
    const { passcode, email } = req.body || {};
    const result = verifyOwnerPasscodeLogin(String(passcode || ''), typeof email === 'string' ? email : undefined);
    res.status(result.success ? 200 : 401).json(result);
  });

  // --- ANDROID BANK NOTIFICATION GATEWAY ENDPOINTS ---
  app.get('/api/gateway/status', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const status = gatewayService.getStatus();
      res.json({ success: true, data: status });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get gateway status' });
    }
  });

  // Webhook endpoint called by Android APK (authenticated by device bot token)
  app.post('/api/gateway/bank-notification', (req: Request, res: Response) => {
    try {
      const { token, deviceId, deviceName, title, message, sender, rawText, batteryLevel } = req.body;
      const result = gatewayService.registerNotification({
        token,
        deviceId: deviceId || 'android-device',
        deviceName: deviceName || 'Android Phone',
        title,
        message,
        sender,
        rawText,
        batteryLevel,
      });

      if (result.matchedSlip) {
        botEngine.addLog(
          'INFO',
          `🎉 [PAYMENT AUTO-VERIFIED] Bank SMS matched customer ${result.matchedSlip.userName}! Amount: LKR ${result.matchedSlip.amount}, Ref: ${result.matchedSlip.ref}`
        );
      } else {
        botEngine.addLog(
          'INFO',
          `📥 [BANK ALERT SYNCED] ${result.notification.bank}: LKR ${result.notification.amount} (Ref: ${result.notification.ref})`
        );
      }

      res.json({ success: true, notification: result.notification, matched: Boolean(result.matchedSlip) });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to process bank alert' });
    }
  });

  // Test simulation endpoint for testing the matching pipeline directly from Dashboard
  app.post('/api/gateway/test-simulate', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { amount, ref, bank } = req.body;
      const result = gatewayService.simulateTestNotification(Number(amount) || 1500, ref, bank);
      botEngine.addLog('INFO', `🧪 [GATEWAY TEST] Simulated incoming ${result.notification.bank} SMS: LKR ${result.notification.amount} (Ref: ${result.notification.ref})`);
      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Simulation failed' });
    }
  });

  // Rules management
  app.get('/api/gateway/rules', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, data: gatewayService.getRules() });
  });

  app.post('/api/gateway/rules', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { name, sender, keyword, ignoreKeyword } = req.body;
      const newRule = gatewayService.addRule({ name, sender, keyword, ignoreKeyword, active: true });
      res.json({ success: true, data: newRule });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to add rule' });
    }
  });

  app.post('/api/gateway/rules/:id/toggle', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    const updated = gatewayService.toggleRule(req.params.id);
    if (updated) return res.json({ success: true, data: updated });
    res.status(404).json({ success: false, message: 'Rule not found' });
  });

  app.delete('/api/gateway/rules/:id', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    const success = gatewayService.deleteRule(req.params.id);
    res.json({ success });
  });

  // Bot Token and Gateway Configuration
  app.post('/api/gateway/config', verifyAdmin, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { botToken, pairedBotNumber } = req.body;
      const config = gatewayService.setConfig(botToken, pairedBotNumber);
      res.json({ success: true, data: config });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update config' });
    }
  });

  app.get('/api/health', (req: Request, res: Response) => {
    const memory = process.memoryUsage();
    res.json({
      status: 'ok',
      service: 'YASHI HALLS — WhatsApp Bot Management Engine (MINI • PRO • BUSINESS)',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      memory: {
        rssMb: Math.round(memory.rss / 1024 / 1024),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(memory.heapTotal / 1024 / 1024),
      },
      botState: botEngine.getState().connectionStatus,
    });
  });

  // Get live Bot State and metrics (isolated per authenticated customer)
  app.get('/api/bot/status', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const state = engine.getState();
      res.json({
        success: true,
        data: state,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to fetch bot state' });
    }
  });

  // Get live runtime logs (isolated per authenticated customer)
  app.get('/api/bot/logs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const logs = engine.getLogs();
      res.json({
        success: true,
        data: logs,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Failed to fetch bot logs' });
    }
  });

  // Start Bot instance (isolated per authenticated customer)
  app.post('/api/bot/start', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumber } = req.body || {};
      const cleanPhone = phoneNumber ? normalizeWhatsAppNumber(phoneNumber) : undefined;
      const engine = getEngineForReq(req);
      const result = await engine.start(cleanPhone);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to start bot' });
    }
  });

  // Stop Bot instance (isolated per authenticated customer)
  app.post('/api/bot/stop', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const result = await engine.stop();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to stop bot' });
    }
  });

  // Restart Bot instance (isolated per authenticated customer)
  app.post('/api/bot/restart', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const result = await engine.restart();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to restart bot' });
    }
  });

  // Admin Force-Logout / Disconnect a specific bot session
  app.post('/api/bot/logout', verifyAdmin, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sessionId = String(req.query.sessionId || req.body?.sessionId || '').trim();
      if (!sessionId) {
        return res.status(400).json({ success: false, message: 'sessionId is required' });
      }
      const engine = getBotEngine(sessionId);
      const result = await engine.clearSession();
      adminStore.addAuditLog(
        req.adminEmail || 'admin',
        'FORCE_LOGOUT_BOT',
        `Force-disconnected WhatsApp bot session ${sessionId}`
      );
      res.json({ ...result, success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to logout bot session' });
    }
  });

  // Request WhatsApp Pairing Code for phone number (isolated per authenticated customer)
  app.post(['/api/bot/pair/code', '/api/bot/pair'], requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        return res.status(400).json({ success: false, message: 'Phone number is required.' });
      }

      const cleanPhone = normalizeWhatsAppNumber(phoneNumber);
      if (!cleanPhone || cleanPhone.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Invalid phone number format. Enter e.g. 0740712934 or 94740712934.',
        });
      }

      const engine = getEngineForReq(req);
      const result = await engine.requestPairingCode(cleanPhone);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to request pairing code' });
    }
  });

  // Request QR Code pairing mode (isolated per authenticated customer)
  app.post('/api/bot/pair/qr', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { forceNew } = req.body || {};
      const engine = getEngineForReq(req);
      const result = await engine.generateQrCode(Boolean(forceNew));
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to generate QR Code' });
    }
  });

  // Clear Session & Credentials for clean re-pairing (isolated per authenticated customer)
  app.post('/api/bot/clear-session', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const result = await engine.clearSession();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to clear session' });
    }
  });

  // Set Bot Plan (MINI, PRO, or BUSINESS - verified against customer entitlement or admin role)
  app.post('/api/bot/plan', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { plan } = req.body;
      if (plan !== 'mini' && plan !== 'pro' && plan !== 'business') {
        return res.status(400).json({ success: false, message: 'Invalid plan. Allowed: "mini", "pro", or "business".' });
      }

      const authUser = req.authUser!;
      if (plan !== 'mini' && !authUser.isAdmin) {
        const customer = adminStore.getCustomer(authUser.email || authUser.uid);
        const entitledPlan = customer?.plan || 'mini';
        const rank: Record<string, number> = { mini: 0, pro: 1, business: 2 };
        if ((rank[plan] ?? 0) > (rank[entitledPlan] ?? 0)) {
          return res.status(403).json({
            success: false,
            message: `Your account is not yet unlocked for ${plan.toUpperCase()}. Please purchase or upgrade first.`,
          });
        }
      }

      const engine = getEngineForReq(req);
      const updatedState = engine.setPlan(plan);
      res.json({ success: true, plan, data: updatedState });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update plan' });
    }
  });

  // Secure Purchase Plan with Server-Side Coin Deduction & Validation
  const PLAN_PRICES: Record<string, number> = {
    mini: 0,
    pro: 10,
    business: 30,
  };

  app.post('/api/bot/purchase-plan', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { plan } = req.body;
      if (plan !== 'mini' && plan !== 'pro' && plan !== 'business') {
        return res.status(400).json({ success: false, message: 'Invalid plan. Allowed: "mini", "pro", or "business".' });
      }

      const authUser = req.authUser!;
      const cost = PLAN_PRICES[plan] ?? 0;
      const customerLookupKey = authUser.email || authUser.uid;
      let customer = adminStore.getCustomer(customerLookupKey);
      if (!customer && authUser.email) {
        customer = adminStore.syncCustomer(authUser.uid, authUser.email, authUser.name || authUser.email.split('@')[0]);
      }

      const serverCoins = authUser.isAdmin ? Math.max(cost, Number(customer?.coins) || 0) : Number(customer?.coins) || 0;

      if (cost > 0 && serverCoins < cost) {
        return res.status(400).json({
          success: false,
          message: `Insufficient coins in wallet! ${cost} coins required, but your verified balance is ${serverCoins} coins.`,
          requiredCoins: cost,
          currentCoins: serverCoins,
        });
      }

      let remainingCoins = serverCoins;
      if (cost > 0 && customer && !authUser.isAdmin) {
        const deductRes = adminStore.modifyCoins(
          customer.id,
          'DEDUCT',
          cost,
          `Purchased YASHI HALLS ${plan.toUpperCase()} Plan`,
          'system'
        );
        if (!deductRes.success) {
          return res.status(400).json({ success: false, message: deductRes.message || 'Coin deduction failed' });
        }
        remainingCoins = deductRes.newBalance;
      }

      if (customer) {
        customer.plan = plan;
        adminStore.saveDatabase(adminStore.db);
      }

      const engine = getEngineForReq(req);
      const updatedState = engine.setPlan(plan);

      res.json({
        success: true,
        plan,
        coinsDeducted: cost,
        remainingCoins,
        transaction: {
          id: `tx-${Date.now()}`,
          title: `Purchased YASHI HALLS ${plan.toUpperCase()} Plan`,
          date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          amount: -cost,
          category: 'purchase',
        },
        data: updatedState,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to process plan purchase' });
    }
  });

  // Sync WhatsApp Bot Profile Picture to Brand Logo (isolated per authenticated customer)
  app.post('/api/bot/sync-profile-pic', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { logoUrl } = req.body || {};
      const safeLogoUrl = typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : undefined;
      const engine = getEngineForReq(req);
      const result = await engine.syncProfilePictureWithLogo(safeLogoUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to sync profile picture' });
    }
  });

  // Reset Quotas (daily refresh - isolated per authenticated customer)
  app.post('/api/bot/reset-quotas', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const quotas = engine.resetQuotas();
      res.json({ success: true, quotas });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to reset quotas' });
    }
  });

  // Get Bot Configuration (isolated per authenticated customer)
  app.get('/api/bot/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const config = engine.getState().config;
      res.json({ success: true, data: config });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to read config' });
    }
  });

  // Update Bot Configuration (isolated per authenticated customer)
  app.post('/api/bot/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const engine = getEngineForReq(req);
      const { userId, plan: _ignoredPlan, ...configUpdates } = req.body || {};
      const updated = engine.updateConfig(configUpdates);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update config' });
    }
  });

  // --- BUSINESS BOT STORE & PRODUCT CATALOG ENDPOINTS ---
  const getBizStoreTenantId = (req: AuthenticatedRequest) => {
    const user = req.authUser!;
    const rawId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
    const requested =
      typeof rawId === 'string' && rawId.trim() && rawId !== 'null' && rawId !== 'undefined'
        ? rawId.trim()
        : '';
    if (user.isAdmin && requested) {
      return requested;
    }
    return `${user.uid}__business`;
  };

  app.get('/api/business-store', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const data = getBusinessStore(tenantId);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load business store' });
    }
  });

  app.post('/api/business-store/settings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const {
        storeName,
        mainLogoUrl,
        mainLogoBase64,
        welcomeText,
        panelButtonText,
        gloryButtonText,
        orderInstructions,
        categories,
      } = req.body || {};

      let resolvedLogoUrl = mainLogoUrl;
      if (typeof mainLogoBase64 === 'string' && mainLogoBase64.startsWith('data:image/')) {
        resolvedLogoUrl = saveBusinessAssetFromBase64(tenantId, mainLogoBase64, 'main_logo');
      }

      const data = updateBusinessStoreSettings(tenantId, {
        storeName,
        mainLogoUrl: resolvedLogoUrl,
        welcomeText,
        panelButtonText,
        gloryButtonText,
        orderInstructions,
        categories,
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update store settings' });
    }
  });

  app.post('/api/business-store/products', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const {
        name,
        category,
        platform,
        price,
        command,
        packages,
        subtitle,
        description,
        logoUrl,
        logoBase64,
        inStock,
        verified,
      } = req.body || {};

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Product name is required.' });
      }

      let resolvedLogoUrl = typeof logoUrl === 'string' ? logoUrl : '';
      if (typeof logoBase64 === 'string' && logoBase64.startsWith('data:image/')) {
        resolvedLogoUrl = saveBusinessAssetFromBase64(tenantId, logoBase64, 'product');
      }

      const data = addBusinessProduct(tenantId, {
        name: name.trim(),
        category: category || 'OTHER',
        platform: platform || 'android',
        price: price || '$0.00',
        command: typeof command === 'string' ? command : '',
        packages: Array.isArray(packages) ? packages : [],
        subtitle: subtitle || '',
        description: description || '',
        logoUrl: resolvedLogoUrl,
        inStock: inStock !== false,
        verified: verified !== false,
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to add product' });
    }
  });

  app.put('/api/business-store/products/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const productId = req.params.id;
      const { logoBase64, userId, ...rest } = req.body || {};

      if (typeof logoBase64 === 'string' && logoBase64.startsWith('data:image/')) {
        rest.logoUrl = saveBusinessAssetFromBase64(tenantId, logoBase64, 'product');
      }

      const data = updateBusinessProduct(tenantId, productId, rest);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(404).json({ success: false, message: err?.message || 'Failed to update product' });
    }
  });

  app.delete('/api/business-store/products/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const productId = req.params.id;
      const data = deleteBusinessProduct(tenantId, productId);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to delete product' });
    }
  });

  app.post('/api/business-store/upload-logo', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const { imageBase64, prefix } = req.body || {};
      if (!imageBase64 || typeof imageBase64 !== 'string') {
        return res.status(400).json({ success: false, message: 'imageBase64 is required' });
      }
      const assetUrl = saveBusinessAssetFromBase64(tenantId, imageBase64, prefix || 'logo');
      res.json({ success: true, url: assetUrl });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err?.message || 'Failed to upload logo' });
    }
  });

  app.get('/api/business-store/assets/:tenant/:filename', (req: Request, res: Response) => {
    try {
      const assetsBaseDir = path.resolve(process.cwd(), 'data', 'business_assets');
      const safeTenant = String(req.params.tenant || '').replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFile = path.basename(String(req.params.filename || ''));
      const filePath = path.resolve(assetsBaseDir, safeTenant, safeFile);
      if (!filePath.startsWith(assetsBaseDir + path.sep) || !fs.existsSync(filePath)) {
        return res.status(404).send('Asset not found');
      }
      res.sendFile(filePath);
    } catch {
      res.status(404).send('Asset not found');
    }
  });

  // --- YASHI HALLS PAY (BUSINESS BOT APK <-> BOT API SYSTEM) ---
  const extractPaySecret = (req: Request): string => {
    const authHeader = String(req.headers['authorization'] || '');
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }
    const headerSecret = req.headers['x-yashi-pay-secret'];
    if (typeof headerSecret === 'string' && headerSecret.trim()) {
      return headerSecret.trim();
    }
    const bodySecret = req.body?.secret || req.body?.token;
    return typeof bodySecret === 'string' ? bodySecret.trim() : '';
  };

  app.get('/api/business/pay/apk/info', (req: Request, res: Response) => {
    try {
      res.json({ success: true, data: getApkBinaryInfo() });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to read APK info' });
    }
  });

  app.get('/api/business/pay/apk/download', (req: Request, res: Response) => {
    try {
      const apkPath = getApkBinaryPath();
      if (!fs.existsSync(apkPath)) {
        return res.status(404).json({ success: false, message: 'YASHI HALLS Pay APK binary not built yet.' });
      }
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', 'attachment; filename="YashiHallsPay.apk"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(apkPath);
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to download APK' });
    }
  });

  const extractPublicOrigin = (req: Request): string => {
    const hostHeader = String(req.headers['x-forwarded-host'] || req.get('host') || '')
      .split(',')[0]
      .trim();
    if (!hostHeader) return (process.env.APP_URL || '').replace(/\/+$/, '');
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(hostHeader);
    const protoHeader = String(req.headers['x-forwarded-proto'] || req.protocol || 'https')
      .split(',')[0]
      .trim()
      .toLowerCase();
    const proto = isLocal ? protoHeader || 'http' : 'https';
    return `${proto}://${hostHeader}`;
  };

  app.post('/api/business/pay/apk/send-whatsapp', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const reqOrigin = extractPublicOrigin(req);
      if (reqOrigin) setBusinessPayOrigin(tenantId, reqOrigin);

      const bizEngine = getBotEngine(tenantId);
      const isBizOnline = Boolean(bizEngine && bizEngine.sock && bizEngine.state.isOnline);

      if (!isBizOnline || !bizEngine) {
        return res.status(503).json({
          success: false,
          message: 'Business Bot දැනට Online නැත. පළමුව Business Bot එක Connect කර නැවත උත්සාහ කරන්න (හෝ Business Bot chat එකේ .payapk යවන්න).',
        });
      }

      const rawPhone =
        (typeof req.body?.phoneNumber === 'string' && req.body.phoneNumber.trim()) ||
        bizEngine.state?.config?.ownerNumber ||
        bizEngine.state?.pairedNumber ||
        '';

      const cleanDigits = normalizeWhatsAppNumber(rawPhone) || String(rawPhone).replace(/\D/g, '');
      if (!cleanDigits || cleanDigits.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'වලංගු WhatsApp අංකයක් ඇතුළත් කරන්න (උදා: 0740712934).',
        });
      }

      const targetJid = `${cleanDigits}@s.whatsapp.net`;
      const result = await bizEngine.sendYashiPayApkToWhatsApp(targetJid);
      if (!result.ok) {
        return res.status(500).json({
          success: false,
          message: result.error || 'Failed to send APK to Business Bot WhatsApp',
        });
      }

      return res.json({
        success: true,
        sentTo: cleanDigits,
        viaBot: 'Business Bot',
        message: `YashiHallsPay-v2.0.0.apk ගොනුව +${cleanDigits} WhatsApp වෙත Business Bot හරහා සාර්ථකව යවන ලදී!`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Failed to deliver APK via Business Bot' });
    }
  });

  app.get('/api/business/pay/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const reqOrigin = extractPublicOrigin(req);
      if (reqOrigin) setBusinessPayOrigin(tenantId, reqOrigin);
      await ensurePayPreviewTunnel(2500);
      const state = getBusinessPayState(tenantId);
      const apkInfo = getApkBinaryInfo();
      const effectiveOrigin = resolveEffectivePayOrigin(tenantId, reqOrigin);
      const linkKey = buildBotLinkKey(tenantId, reqOrigin);
      const tunnel = getPayTunnelState();
      const totalPaidLkr = state.events
        .filter((ev) => ev.status !== 'ignored')
        .reduce((acc, ev) => acc + (Number(ev.amountLkr) || 0), 0);

      res.json({
        success: true,
        data: {
          ...state,
          linkKey,
          serverOrigin: effectiveOrigin,
          tunnel,
          apk: apkInfo,
          stats: {
            totalPaidLkr,
            matchedCount: state.events.filter((ev) => ev.status === 'matched').length,
            pendingOrdersCount: state.orders.filter((o) => o.status === 'pending_payment').length,
            activeDevicesCount: state.devices.filter((d) => Date.now() - new Date(d.lastSeenAt).getTime() < 1000 * 60 * 15).length,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load Business Pay state' });
    }
  });

  app.post('/api/business/pay/config', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const {
        enabled,
        autoMatchOrders,
        notifyOwnerOnPayment,
        notifyCustomerOnMatch,
        bankDetailsText,
        minAmountLkr,
        lkrPerUsdRate,
      } = req.body || {};

      const updated = updateBusinessPayConfig(tenantId, {
        enabled,
        autoMatchOrders,
        notifyOwnerOnPayment,
        notifyCustomerOnMatch,
        bankDetailsText,
        minAmountLkr,
        lkrPerUsdRate,
      });
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update Pay settings' });
    }
  });

  app.post('/api/business/pay/rotate-secret', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const updated = rotateBusinessPaySecret(tenantId);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to rotate secret key' });
    }
  });

  app.post('/api/business/pay/orders/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const status = req.body?.status;
      if (status !== 'pending_payment' && status !== 'paid' && status !== 'cancelled') {
        return res.status(400).json({ success: false, message: 'Invalid order status' });
      }
      const order = updateBusinessPayOrderStatus(tenantId, req.params.id, status);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }
      if (status === 'paid') {
        const engine = getBotEngine(tenantId);
        if (engine.sock && engine.state.isOnline && order.customerJid) {
          const msgText = [
            `✅ *PAYMENT CONFIRMED BY OWNER*`,
            `🧾 *Order ID:* ${order.id}`,
            `🛍️ *Product:* ${order.productName}${order.packageDays ? ` (${order.packageDays})` : ''}`,
            `💰 *Amount:* ${order.priceDisplay}`,
            ``,
            `ඔබගේ Order එක තහවුරු වී ඇත. Thank you! 🙏`,
          ].join('\n');
          await engine.sock.sendMessage(order.customerJid, { text: msgText }).catch(() => {});
        }
      }
      res.json({ success: true, data: order });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update order status' });
    }
  });

  app.post('/api/business/pay/test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const state = getBusinessPayState(tenantId);
      const amountNum = Number(req.body?.amountLkr) > 0 ? Number(req.body.amountLkr) : 1500;
      const bankName = String(req.body?.bank || 'Commercial Bank').slice(0, 48);
      const ref = String(req.body?.reference || Math.floor(10000000 + Math.random() * 90000000)).slice(0, 24);
      const rawMessage = `A/C ***412 Credited with LKR ${amountNum.toFixed(2)} via ${bankName}. Ref: ${ref}. [YASHI HALLS Pay Test]`;

      const result = ingestPayWebhookEvent(state, {
        source: 'test',
        sender: bankName,
        rawMessage,
        amountLkr: amountNum,
        reference: ref,
        deviceId: 'dashboard-simulator',
        deviceName: 'Dashboard Test Simulator',
      });

      const engine = getBotEngine(tenantId);
      await engine.handleIncomingBusinessPayment(result.event, result.matchedOrder);

      // Also feed test payment into Auto Order matching engine
      const autoOrderResult = await processGatewayPaymentForAutoOrders(
        tenantId,
        result.event,
        engine.getAutoOrderWhatsAppDispatcher(),
        {
          targetOrderId: typeof req.body?.orderId === 'string' ? req.body.orderId : undefined,
          verifiedBy: 'TEST_SIMULATOR',
        }
      );

      res.json({
        success: true,
        data: { ...result, autoOrderResult },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Test webhook failed' });
    }
  });

  // Mobile APK -> Business Bot Connectivity Check (with instant Owner WhatsApp confirmation)
  app.post('/api/business/pay/ping', async (req: Request, res: Response) => {
    try {
      const secret = extractPaySecret(req);
      const preferredTenant =
        typeof req.body?.tenantId === 'string'
          ? req.body.tenantId
          : typeof req.query.tenantId === 'string'
          ? req.query.tenantId
          : undefined;
      const state = resolveTenantByPaySecret(secret, preferredTenant);
      if (!state) {
        return res.status(401).json({
          success: false,
          message: 'Invalid Secret Key. Copy the YHP... Link Key from Business Bot Pay panel or .paykey.',
        });
      }

      const touchResult = touchPayDevice(state, {
        deviceId: req.body?.deviceId,
        deviceName: req.body?.deviceName,
        appVersion: req.body?.appVersion,
        batteryLevel: req.body?.batteryLevel !== undefined ? Number(req.body.batteryLevel) : undefined,
        simOperator: req.body?.simOperator,
        forceNotify: Boolean(req.body?.forceNotify || req.body?.manual),
      });

      const store = getBusinessStore(state.tenantId);
      const bizEngine = getBotEngine(state.tenantId);
      // Prefer connected Business Bot; if offline, fall back to the same user's primary connected bot
      let notifyEngine = bizEngine;
      if ((!notifyEngine.sock || !notifyEngine.state.isOnline) && state.tenantId.endsWith('__business')) {
        const primaryTenant = state.tenantId.replace(/__business$/, '');
        if (primaryTenant) {
          const primaryEngine = getBotEngine(primaryTenant);
          if (primaryEngine.sock && primaryEngine.state.isOnline) {
            notifyEngine = primaryEngine;
          }
        }
      }

      let ownerNotified = false;
      let ownerDigits: string | undefined;
      if (touchResult.shouldNotifyOwner && notifyEngine.sock && notifyEngine.state.isOnline) {
        const notifyRes = await notifyEngine.notifyOwnerPayAppConnected({
          deviceName: touchResult.device.deviceName,
          appVersion: touchResult.device.appVersion,
          batteryLevel: touchResult.device.batteryLevel,
          simOperator: touchResult.device.simOperator,
          storeName: store.storeName,
          isReconnect: touchResult.isReconnect,
        });
        if (notifyRes.sent) {
          ownerNotified = true;
          ownerDigits = notifyRes.ownerDigits;
          touchResult.device.lastConnectNotifiedAt = new Date().toISOString();
        }
      }

      saveBusinessPayState(state);

      return res.json({
        success: true,
        storeName: store.storeName,
        botName: bizEngine.state.config.botName || 'YASHI BUSINESS',
        botOnline: Boolean(bizEngine.state.isOnline || notifyEngine.state.isOnline),
        enabled: state.config.enabled,
        ownerNotified,
        ownerDigits,
        pendingOrdersCount: state.orders.filter((o) => o.status === 'pending_payment').length,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Ping failed' });
    }
  });

  // Dashboard helper: verify Android Pay App -> Bot connection & trigger owner WhatsApp confirmation
  app.post('/api/business/pay/test-connect', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const state = getBusinessPayState(tenantId);
      const store = getBusinessStore(tenantId);
      const bizEngine = getBotEngine(tenantId);
      let notifyEngine = bizEngine;
      if ((!notifyEngine.sock || !notifyEngine.state.isOnline) && tenantId.endsWith('__business')) {
        const primaryEngine = getBotEngine(tenantId.replace(/__business$/, ''));
        if (primaryEngine.sock && primaryEngine.state.isOnline) {
          notifyEngine = primaryEngine;
        }
      }

      if (!notifyEngine.sock || !notifyEngine.state.isOnline) {
        return res.status(503).json({
          success: false,
          message: 'WhatsApp Bot දැනට Online නැත. පළමුව Bot එක Connect කරන්න.',
        });
      }

      const latestDevice = state.devices[0];
      const notifyRes = await notifyEngine.notifyOwnerPayAppConnected({
        deviceName: latestDevice?.deviceName || 'YASHI HALLS Pay Android App',
        appVersion: latestDevice?.appVersion || '2.0.0',
        batteryLevel: latestDevice?.batteryLevel,
        simOperator: latestDevice?.simOperator,
        storeName: store.storeName,
        isReconnect: false,
      });

      if (!notifyRes.sent) {
        return res.status(500).json({
          success: false,
          message: notifyRes.error || 'Owner WhatsApp පණිවිඩය යැවීමට නොහැකි විය.',
        });
      }

      return res.json({
        success: true,
        ownerDigits: notifyRes.ownerDigits,
        message: `Owner (+${notifyRes.ownerDigits}) වෙත WhatsApp Connection Alert එක සාර්ථකව යවන ලදී!`,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Connection test failed' });
    }
  });

  // Mobile APK -> Business Bot Payment Webhook (Existing Android Permission App Connection)
  app.post('/api/business/pay/webhook', async (req: Request, res: Response) => {
    try {
      const secret = extractPaySecret(req);
      const preferredTenant = typeof req.body?.tenantId === 'string' ? req.body.tenantId : (typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined);
      const state = resolveTenantByPaySecret(secret, preferredTenant);
      if (!state) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid YASHI HALLS Pay Secret Key' });
      }

      if (!state.config.enabled) {
        return res.status(403).json({ success: false, message: 'YASHI HALLS Pay Gateway is currently paused in Business Bot settings.' });
      }

      const rawMessage = String(req.body?.rawMessage || req.body?.message || req.body?.text || '').trim();
      if (!rawMessage) {
        return res.status(400).json({ success: false, message: 'rawMessage is required' });
      }

      const sourceRaw = String(req.body?.source || 'notification').toLowerCase();
      const source: 'sms' | 'notification' = sourceRaw === 'sms' ? 'sms' : 'notification';

      const result = ingestPayWebhookEvent(state, {
        source,
        sender: req.body?.sender,
        appPackage: req.body?.appPackage,
        rawMessage,
        amountLkr: req.body?.amountLkr !== undefined ? Number(req.body.amountLkr) : undefined,
        balanceLkr: req.body?.balanceLkr !== undefined ? Number(req.body.balanceLkr) : undefined,
        reference: req.body?.reference,
        deviceId: req.body?.deviceId,
        deviceName: req.body?.deviceName,
        appVersion: req.body?.appVersion,
        batteryLevel: req.body?.batteryLevel !== undefined ? Number(req.body.batteryLevel) : undefined,
        simOperator: req.body?.simOperator,
      });

      let autoOrderOutcome: string | null = null;
      let autoOrderMatchedId: string | null = null;

      if (!result.duplicate && result.event.status !== 'ignored') {
        const engine = getBotEngine(state.tenantId);
        await engine.handleIncomingBusinessPayment(result.event, result.matchedOrder);

        // Process payment through Auto Order Matching & FFGlory Automatic Delivery
        const aoRes = await processGatewayPaymentForAutoOrders(
          state.tenantId,
          result.event,
          engine.getAutoOrderWhatsAppDispatcher(),
          { verifiedBy: 'AUTO_GATEWAY' }
        );
        autoOrderOutcome = aoRes.outcome;
        autoOrderMatchedId = aoRes.order?.id || null;
      }

      return res.json({
        success: true,
        duplicate: Boolean(result.duplicate),
        status: result.event.status,
        amountLkr: result.event.amountLkr,
        bank: result.event.bank,
        reference: result.event.reference,
        matchedOrderId: autoOrderMatchedId || result.matchedOrder?.id || null,
        autoOrderOutcome,
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err?.message || 'Webhook processing failed' });
    }
  });

  // --- AUTO ORDER MANAGEMENT & FFGLORY API DELIVERY ROUTES ---
  app.get('/api/auto-orders/dashboard', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const forceRefresh = req.query.force === 'true';
      await ensureFreshFFGloryData(tenantId, { force: forceRefresh });
      const summary = getAutoOrderDashboardSummary(tenantId);
      const store = getBusinessStore(tenantId);
      const engine = getBotEngine(tenantId);
      res.json({
        success: true,
        data: {
          ...summary,
          botOnline: Boolean(engine.state.isOnline),
          products: store.products.map((p) => ({
            id: p.id,
            name: p.name,
            category: p.category,
            platform: p.platform,
            price: p.price,
            packages: p.packages || [],
            inStock: p.inStock,
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load Auto Order dashboard' });
    }
  });

  app.post('/api/auto-orders/settings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const {
        ffgloryEnabled,
        operatingMode,
        autoDeliverOnVerifiedPayment,
        supportContact,
        apiKey,
        masterKey,
        clearApiKey,
        clearMasterKey,
      } = req.body || {};

      updateAutoOrderSettings(tenantId, actor, {
        ffgloryEnabled,
        operatingMode,
        autoDeliverOnVerifiedPayment,
        supportContact,
        apiKey,
        masterKey,
        clearApiKey,
        clearMasterKey,
      });

      // Immediately sync live FFGlory balance & pricing whenever credentials are present
      const { creds } = resolveFFGloryCredentials(tenantId);
      let balanceSync: { success: boolean; account?: any; error?: string } | null = null;
      if (creds.apiKey && creds.masterKey) {
        balanceSync = await refreshFFGloryBalance(tenantId);
        await refreshFFGloryPricing(tenantId).catch(() => null);
        // If new keys were just saved and FFGlory connected successfully, ensure LIVE mode is active
        if (balanceSync?.success && (apiKey || masterKey) && operatingMode !== 'TEST') {
          updateAutoOrderSettings(tenantId, actor, { operatingMode: 'LIVE', ffgloryEnabled: true });
        }
      }

      const freshSummary = getAutoOrderDashboardSummary(tenantId);
      res.json({
        success: true,
        data: freshSummary.settings,
        balance: balanceSync?.account || null,
        connectionSuccess: balanceSync ? balanceSync.success : null,
        message: balanceSync
          ? balanceSync.success
            ? `FFGlory API Connected (LIVE MODE)! Balance: ${balanceSync.account?.basic_credits ?? 0} Basic · ${balanceSync.account?.premium_credits ?? 0} Premium Credits`
            : `Settings saved, but FFGlory connection failed: ${balanceSync.error}`
          : 'FFGlory API settings saved securely on server.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to save API settings' });
    }
  });

  app.post('/api/auto-orders/test-connection', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const result = await refreshFFGloryBalance(tenantId);
      res.json({
        success: result.success,
        data: result.account || null,
        message: result.success
          ? `Connected to FFGlory Panel as ${result.account?.username} (Basic: ${result.account?.basic_credits}, Premium: ${result.account?.premium_credits})`
          : result.error || 'Failed to connect to FFGlory API',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Connection test error' });
    }
  });

  app.get('/api/auto-orders/balance', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const result = await refreshFFGloryBalance(tenantId);
      res.json({
        success: result.success,
        data: result.account || null,
        message: result.success ? 'Balance refreshed.' : result.error || 'Failed to fetch balance',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to check balance' });
    }
  });

  app.get('/api/auto-orders/pricing', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const result = await refreshFFGloryPricing(tenantId);
      res.json({
        success: result.success,
        data: result.pricing || null,
        message: result.success ? 'Loaded live regions & pricing from FFGlory.' : result.error || 'Failed to load pricing',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load pricing' });
    }
  });

  app.get('/api/auto-orders/ffglory/live-data', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const includeNotifications = req.query.includeNotifications === 'true';
      const { creds } = resolveFFGloryCredentials(tenantId);

      if (!creds.apiKey || !creds.masterKey) {
        return res.status(400).json({
          success: false,
          message: 'Configure FFGlory API Key and Master Key in API Settings first.',
        });
      }

      const [groupsRes, couponsRes, txnsRes, notifsRes] = await Promise.allSettled([
        ffgloryClient.getMyGroups(creds),
        ffgloryClient.getMyCoupons(creds),
        ffgloryClient.getTransactions(creds),
        includeNotifications ? ffgloryClient.getNotifications(creds) : Promise.resolve([]),
      ]);

      const state = getAutoOrderState(tenantId);
      let hasErrors = false;
      const errors: string[] = [];

      const recordErr = (endpoint: string, reason: any) => {
        hasErrors = true;
        const code = reason instanceof FFGloryApiError ? reason.statusCode : 500;
        const msg = reason?.message || 'Request failed';
        errors.push(`${endpoint}: ${msg}`);
        appendApiError(state, endpoint, code, msg);
      };

      if (groupsRes.status === 'rejected') recordErr('/api/client/my-groups', groupsRes.reason);
      if (couponsRes.status === 'rejected') recordErr('/api/client/my-coupons', couponsRes.reason);
      if (txnsRes.status === 'rejected') recordErr('/api/client/transactions', txnsRes.reason);
      if (notifsRes.status === 'rejected') recordErr('/api/client/notifications', notifsRes.reason);
      if (hasErrors) saveAutoOrderState(state);

      res.json({
        success: true,
        data: {
          groups: groupsRes.status === 'fulfilled' ? groupsRes.value : [],
          coupons: couponsRes.status === 'fulfilled' ? couponsRes.value : [],
          transactions: txnsRes.status === 'fulfilled' ? txnsRes.value : [],
          notifications: notifsRes.status === 'fulfilled' ? notifsRes.value : [],
          errors,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load FFGlory live data' });
    }
  });

  app.post('/api/auto-orders/mappings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const {
        productId,
        packageId,
        enabled,
        actionType,
        basicCredits,
        premiumCredits,
        region,
        priceLkrOverride,
      } = req.body || {};

      if (!productId || typeof productId !== 'string') {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }

      const mappings = upsertProductMapping(tenantId, actor, {
        productId,
        packageId,
        enabled: enabled !== false,
        actionType,
        basicCredits,
        premiumCredits,
        region,
        priceLkrOverride,
      });

      res.json({ success: true, data: mappings, message: 'Product delivery mapping saved.' });
    } catch (err: any) {
      res.status(400).json({ success: false, message: err?.message || 'Failed to save product mapping' });
    }
  });

  app.delete('/api/auto-orders/mappings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const productId = String(req.body?.productId || req.query.productId || '').trim();
      const packageId = String(req.body?.packageId || req.query.packageId || '').trim() || undefined;
      if (!productId) {
        return res.status(400).json({ success: false, message: 'productId is required.' });
      }
      const mappings = deleteProductMapping(tenantId, actor, productId, packageId);
      res.json({ success: true, data: mappings, message: 'Mapping removed.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to delete mapping' });
    }
  });

  app.post('/api/auto-orders/orders/:id/approve', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const engine = getBotEngine(tenantId);
      const result = await adminApproveOrderPayment(
        tenantId,
        req.params.id,
        actor,
        engine.getAutoOrderWhatsAppDispatcher(),
        {
          transactionId: req.body?.transactionId,
          bank: req.body?.bank,
          clanId: req.body?.clanId,
        }
      );
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to approve payment' });
    }
  });

  app.post('/api/auto-orders/orders/:id/reject', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const result = adminRejectOrCancelOrder(tenantId, req.params.id, actor, 'REJECT', req.body?.reason);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to reject payment' });
    }
  });

  app.post('/api/auto-orders/orders/:id/cancel', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const result = adminRejectOrCancelOrder(tenantId, req.params.id, actor, 'CANCEL', req.body?.reason);
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to cancel order' });
    }
  });

  app.post('/api/auto-orders/orders/:id/retry', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const engine = getBotEngine(tenantId);
      const result = await executeAutoOrderDelivery(tenantId, req.params.id, {
        actor,
        allowRetry: true,
        dispatcher: engine.getAutoOrderWhatsAppDispatcher(),
      });
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to retry delivery' });
    }
  });

  // Safe End-to-End Test Mode Simulator (Order -> Payment Verification -> Delivery)
  app.post('/api/auto-orders/simulate-test', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const state = getAutoOrderState(tenantId);
      if (state.settings.operatingMode !== 'TEST') {
        return res.status(400).json({
          success: false,
          message: 'Switch to TEST MODE in API Settings before running end-to-end simulations.',
        });
      }

      const {
        actionType = 'COUPON',
        customerNumber = '',
        customerName = 'Test Customer',
        amountLkr = 1500,
        basicCredits = 1,
        premiumCredits = 0,
        region = 'bd',
        clanId = '123456789',
        sendWhatsApp = false,
      } = req.body || {};

      const cleanDigits = normalizeWhatsAppNumber(String(customerNumber || '')) || String(customerNumber || '').replace(/\D/g, '');
      const customerJid = cleanDigits.length >= 8 ? `${cleanDigits}@s.whatsapp.net` : '';

      const order = createAutoOrder(tenantId, {
        customerJid,
        customerNumber: cleanDigits || '94700000000',
        customerName: String(customerName || 'Test Customer').slice(0, 60),
        productId: actionType === 'CLAN_GROUP' ? 'test-ffglory-group' : 'test-ffglory-coupon',
        productName:
          actionType === 'CLAN_GROUP'
            ? `Test Clan Glory Group (${String(region).toUpperCase()})`
            : `Test FFGlory Coupon (${basicCredits}B / ${premiumCredits}P)`,
        priceDisplay: `LKR ${Number(amountLkr) || 1500}`,
        amountLkr: Number(amountLkr) || 1500,
        clanId: actionType === 'CLAN_GROUP' ? String(clanId || '123456789') : undefined,
        regionOverride: actionType === 'CLAN_GROUP' ? String(region || 'bd') : undefined,
        modeOverride: 'TEST',
      });

      // Attach action params directly for the simulated test order
      const db = getAutoOrderState(tenantId);
      const found = db.orders.find((o) => o.id === order.id);
      if (found) {
        found.deliveryAction = actionType === 'CLAN_GROUP' ? 'CLAN_GROUP' : 'COUPON';
        found.deliveryParams =
          found.deliveryAction === 'CLAN_GROUP'
            ? { region: String(region || 'bd').toLowerCase(), clan_id: String(clanId || '123456789') }
            : {
                basic_credits: Math.max(0, Math.floor(Number(basicCredits) || 0)),
                premium_credits: Math.max(0, Math.floor(Number(premiumCredits) || 0)),
              };
        saveAutoOrderState(db);
      }

      const simRef = `SIM${Math.floor(10000000 + Math.random() * 90000000)}`;
      const engine = getBotEngine(tenantId);
      const simEvent = {
        id: `sim-${Date.now()}`,
        source: 'test' as const,
        bank: 'Commercial Bank (Test)',
        amountLkr: Number(amountLkr) || 1500,
        reference: simRef,
        sender: 'COMBANK',
        rawMessage: `A/C Credited LKR ${(Number(amountLkr) || 1500).toFixed(2)} Ref ${simRef} ${order.id}`,
        status: 'matched' as const,
        timestamp: new Date().toISOString(),
      };

      const flowResult = await processGatewayPaymentForAutoOrders(
        tenantId,
        simEvent,
        sendWhatsApp ? engine.getAutoOrderWhatsAppDispatcher() : undefined,
        { targetOrderId: order.id, verifiedBy: 'TEST_SIMULATOR' }
      );

      res.json({
        success: flowResult.outcome === 'VERIFIED_AND_DELIVERED',
        data: flowResult,
        message: flowResult.message,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Test simulation failed' });
    }
  });

  // --- YASHI HALLS INTERACTIVE GUILD SERVICE ADMIN & PORTAL ROUTES ---

  // Save Guild Bot Tier Pricing (4/8/12/16), Payment Account Details, & Welcome Flow Toggle
  app.post('/api/auto-orders/guild-settings', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const actor = req.authUser?.email || req.authUser?.uid || 'admin';
      const {
        guildFlowEnabled,
        welcomeOnFirstMessage,
        guildPricing,
        paymentAccount,
        publicPortalBaseUrl,
      } = req.body || {};

      const updated = updateGuildFlowSettings(tenantId, actor, {
        guildFlowEnabled,
        welcomeOnFirstMessage,
        guildPricing,
        paymentAccount,
        publicPortalBaseUrl,
      });

      res.json({
        success: true,
        data: updated,
        message: 'Guild Service Pricing & Payment Account Settings saved.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to save Guild settings' });
    }
  });

  // Securely stream a stored receipt file (Image/PDF) for Admin verification (strictly path-confined)
  app.get('/api/auto-orders/receipt-file/:fileName', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const resolvedPath = resolveStoredReceiptFilePath(tenantId, req.params.fileName);
      if (!resolvedPath) {
        return res.status(404).json({ success: false, message: 'Receipt file not found.' });
      }
      res.sendFile(resolvedPath);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load receipt file' });
    }
  });

  // Admin: Refresh Live Glory & Clan Info for a launched order
  app.post('/api/auto-orders/orders/:id/live-glory', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const result = await fetchOrderLiveGlory(tenantId, req.params.id, { force: true });
      res.status(result.success ? 200 : 400).json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to refresh Live Glory' });
    }
  });

  // Admin: Resend Phase 5 Guild Configuration Card to Customer WhatsApp
  app.post('/api/auto-orders/orders/:id/send-guild-config', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const state = getAutoOrderState(tenantId);
      const order = state.orders.find((o) => o.id === req.params.id);
      if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
      const engine = getBotEngine(tenantId);
      const sent = await sendPhase5GuildConfigCard(tenantId, order, engine.getAutoOrderWhatsAppDispatcher());
      res.json({
        success: sent,
        portalUrl: buildOrderPortalUrl(tenantId, order),
        message: sent ? 'Guild Configuration Card sent to WhatsApp.' : 'Bot offline — you can share the Portal URL directly.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to send Guild Config Card' });
    }
  });

  // Admin: Create a verified Test Guild Order & openable Interactive Guild Portal Link (Safe Test Mode)
  app.post('/api/auto-orders/simulate-guild-flow', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const tenantId = getBizStoreTenantId(req);
      const state = getAutoOrderState(tenantId);
      if (state.settings.operatingMode !== 'TEST') {
        return res.status(400).json({
          success: false,
          message: 'Switch to TEST MODE in API Settings to create interactive test Guild orders.',
        });
      }

      const rawQty = Number(req.body?.botQuantity || 4);
      const botQuantity: GuildBotQuantity =
        rawQty === 8 || rawQty === 12 || rawQty === 16 ? rawQty : 4;
      const customerName = String(req.body?.customerName || 'Test Guild Customer').slice(0, 60);
      const customerNumber = String(req.body?.customerNumber || '94700000000').replace(/\D/g, '') || '94700000000';

      const order = createGuildServiceOrder(tenantId, {
        customerJid: `${customerNumber}@s.whatsapp.net`,
        customerNumber,
        customerName,
        botQuantity,
        modeOverride: 'TEST',
      });

      // Simulate verified bank payment so order moves directly to Phase 5 (Interactive Guild Config Portal)
      const simRef = `SIMG${Math.floor(10000000 + Math.random() * 90000000)}`;
      const flowRes = await processGatewayPaymentForAutoOrders(
        tenantId,
        {
          id: `simg-${Date.now()}`,
          source: 'test',
          bank: 'Commercial Bank (Test)',
          amountLkr: order.amountLkr,
          reference: simRef,
          sender: 'COMBANK',
          rawMessage: `Credited LKR ${order.amountLkr.toFixed(2)} Ref ${simRef} ${order.id}`,
          status: 'matched',
          timestamp: new Date().toISOString(),
        },
        undefined,
        { targetOrderId: order.id, verifiedBy: 'TEST_SIMULATOR' }
      );

      const freshOrder = getAutoOrderState(tenantId).orders.find((o) => o.id === order.id) || order;
      const portalUrl = buildOrderPortalUrl(tenantId, freshOrder);

      res.json({
        success: true,
        data: {
          order: freshOrder,
          portalUrl,
          portalPath: `/guild-portal?order=${encodeURIComponent(freshOrder.id)}&token=${encodeURIComponent(freshOrder.portalToken || '')}`,
          outcome: flowRes.outcome,
        },
        message: `Test Guild Order ${freshOrder.id} (${botQuantity} BOTS · LKR ${freshOrder.amountLkr}) verified! Open the Guild Configuration Portal to test Phases 5–8.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Guild test simulation failed' });
    }
  });

  // --- PUBLIC TOKEN-SCOPED CUSTOMER GUILD PORTAL (PHASE 5 CONFIG + PHASE 7 PROCESSING + PHASE 8 LIVE GLORY) ---
  // Strictly authenticated by cryptographic orderId + portalToken (constant-time comparison). Zero secrets exposed.
  app.get('/api/guild-portal/:orderId', async (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.orderId || '').trim().toUpperCase();
      const token = String(req.query.token || '').trim();
      const match = findOrderByPortalToken(orderId, token);
      if (!match) {
        return res.status(403).json({
          success: false,
          message: 'Invalid or expired Guild Configuration link. Please check your WhatsApp order message.',
        });
      }

      const { tenantId, order } = match;
      // Ensure live FFGlory regions from GET /api/pricing are loaded (NEVER guessed!)
      await ensureFreshFFGloryData(tenantId, { balanceTtlMs: 60000, pricingTtlMs: 300000 }).catch(() => {});
      const state = getAutoOrderState(tenantId);
      const liveRegions = (state.settings.cachedPricing?.regions || []).filter((r) => r.enabled !== false);

      res.json({
        success: true,
        data: {
          brandName: 'YASHI HALLS',
          order: {
            id: order.id,
            mode: order.mode,
            serviceType: order.serviceType || 'GUILD_SERVICE',
            productName: order.productName,
            botQuantity: order.botQuantity || 4,
            amountLkr: order.amountLkr,
            status: order.status,
            statusReason: order.statusReason || '',
            processingStage: order.processingStage || (order.status === 'DELIVERED' ? 'LAUNCHED' : 'PAYMENT_VERIFIED'),
            guildConfig: order.guildConfig || null,
            payment: order.payment
              ? {
                  bank: order.payment.bank,
                  amountLkr: order.payment.amountLkr,
                  transactionId: order.payment.transactionId,
                  paidAt: order.payment.paidAt,
                }
              : null,
            delivery: order.delivery
              ? {
                  success: order.delivery.success,
                  groupId: order.delivery.groupId,
                  botCount: order.delivery.botCount,
                  region: order.delivery.region,
                  clanId: order.delivery.clanId,
                  completedAt: order.delivery.completedAt,
                  errorMessage: order.delivery.errorMessage,
                }
              : null,
            liveGlory: order.liveGlory
              ? {
                  currentGlory: order.liveGlory.currentGlory,
                  clanName: order.liveGlory.clanName,
                  clanLevel: order.liveGlory.clanLevel,
                  memberCount: order.liveGlory.memberCount,
                  groupStatus: order.liveGlory.groupStatus,
                  uptime: order.liveGlory.uptime,
                  lastUpdatedAt: order.liveGlory.lastUpdatedAt,
                  errors: order.liveGlory.errors,
                }
              : null,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
          },
          regions: liveRegions.map((r) => ({
            id: r.id,
            region_name: r.region_name,
            region_code: r.region_code,
            tier: r.tier,
            enabled: r.enabled,
          })),
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to load Guild Portal' });
    }
  });

  app.post('/api/guild-portal/:orderId/configure', async (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.orderId || '').trim().toUpperCase();
      const token = String(req.body?.token || '').trim();
      const regionId = String(req.body?.regionId || '').trim();
      const clanId = String(req.body?.clanId || '').trim();

      const match = findOrderByPortalToken(orderId, token);
      if (!match) {
        return res.status(403).json({ success: false, message: 'Invalid or expired portal authorization token.' });
      }

      const engine = getBotEngine(match.tenantId);
      const result = await submitGuildConfiguration(
        match.tenantId,
        match.order.id,
        {
          regionId,
          clanId,
          submittedVia: 'WEB_CARD',
          actor: `customer:${match.order.customerNumber}`,
        },
        engine.getAutoOrderWhatsAppDispatcher()
      );

      res.status(result.success ? 200 : 400).json({
        success: result.success,
        message: result.message,
        orderStatus: result.order?.status || null,
        groupId: result.order?.delivery?.groupId || null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to submit Guild Details' });
    }
  });

  app.post('/api/guild-portal/:orderId/live-glory', async (req: Request, res: Response) => {
    try {
      const orderId = String(req.params.orderId || '').trim().toUpperCase();
      const token = String(req.body?.token || '').trim();

      const match = findOrderByPortalToken(orderId, token);
      if (!match) {
        return res.status(403).json({ success: false, message: 'Invalid or expired portal authorization token.' });
      }

      const result = await fetchOrderLiveGlory(match.tenantId, match.order.id, { force: false });
      res.status(result.success ? 200 : 400).json({
        success: result.success,
        message: result.message,
        cooldownRemainingSec: result.cooldownRemainingSec || 0,
        liveGlory: result.liveGlory
          ? {
              currentGlory: result.liveGlory.currentGlory,
              clanName: result.liveGlory.clanName,
              clanLevel: result.liveGlory.clanLevel,
              memberCount: result.liveGlory.memberCount,
              groupStatus: result.liveGlory.groupStatus,
              uptime: result.liveGlory.uptime,
              lastUpdatedAt: result.liveGlory.lastUpdatedAt,
              errors: result.liveGlory.errors,
            }
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fetch Live Glory' });
    }
  });

  // Get registered plugins and provider status
  app.get('/api/plugins', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: getPluginStatusList(),
    });
  });

  // Server-side AI Chat with Gemini API (requires authenticated user)
  app.post('/api/ai/chat', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { prompt, context } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        return res.status(400).json({ success: false, message: 'Prompt is required' });
      }

      const result = await askGemini(prompt, context);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'AI request failed' });
    }
  });

  // --- MANUAL PURCHASE REQUESTS (AUTHENTICATED CUSTOMER & ADMIN) ---

  // Customer submits a manual purchase request for PRO/BUSINESS or Coins
  app.post('/api/purchase-requests/create', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const {
        customerName,
        itemType,
        itemName,
        planId,
        coinAmount,
        priceLkr,
        priceFormatted,
      } = req.body;

      const resolvedEmail = authUser.email || String(req.body?.customerEmail || '').trim().toLowerCase();
      if (!resolvedEmail || !itemType || !itemName) {
        return res.status(400).json({
          success: false,
          message: 'Missing required purchase request details.',
        });
      }

      const newReq = adminStore.createPurchaseRequest({
        customerId: authUser.uid,
        customerEmail: resolvedEmail,
        customerName: customerName || authUser.name || resolvedEmail.split('@')[0],
        itemType,
        itemName,
        planId,
        coinAmount: Number(coinAmount) || undefined,
        priceLkr: Number(priceLkr) || 0,
        priceFormatted: priceFormatted || `Rs ${Number(priceLkr || 0).toLocaleString()}`,
      });

      // Synchronize customer profile into admin customer directory without modifying plan/coins
      adminStore.syncCustomer(
        newReq.customerId,
        newReq.customerEmail,
        newReq.customerName
      );

      res.json({
        success: true,
        request: newReq,
        adminWhatsapp: adminStore.getSettings().adminWhatsapp,
        message: 'Manual purchase request registered successfully. Status: PENDING ADMIN APPROVAL.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to submit purchase request' });
    }
  });

  // Get user's own purchase requests (strictly own email unless verified Master Admin)
  app.get('/api/purchase-requests/user/:email', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const requestedEmail = String(req.params.email || '').trim().toLowerCase();
      if (!authUser.isAdmin && requestedEmail !== authUser.email) {
        return res.status(403).json({ success: false, message: 'Forbidden: cannot read another user’s purchase requests.' });
      }
      const all = adminStore.getPurchaseRequests();
      const userRequests = all.filter((r: any) => String(r.customerEmail || '').toLowerCase() === requestedEmail);
      res.json({ success: true, data: userRequests });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fetch requests' });
    }
  });

  // Get live customer profile by email (strictly own email unless verified Master Admin)
  app.get('/api/customer/profile/:email', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const requestedEmail = String(req.params.email || '').trim().toLowerCase();
      if (!authUser.isAdmin && requestedEmail !== authUser.email) {
        return res.status(403).json({ success: false, message: 'Forbidden: cannot read another user’s profile.' });
      }
      const cust = adminStore.getCustomer(requestedEmail);
      if (!cust) {
        return res.json({ success: false, message: 'Customer not found' });
      }
      res.json({ success: true, customer: cust });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Error' });
    }
  });

  // --- ADMIN PROTECTED ROUTES ---

  // Verify Admin Permissions
  app.post('/api/admin/verify', verifyAdmin, (req: Request, res: Response) => {
    res.json({
      success: true,
      isAdmin: true,
      email: (req as any).adminEmail,
      message: 'Verified Master Administrator privileges.',
    });
  });

  // Admin Overview Stats
  app.get('/api/admin/overview', verifyAdmin, (req: Request, res: Response) => {
    try {
      const stats = adminStore.getOverviewStats();
      const botState = botEngine.getState();
      res.json({
        success: true,
        data: {
          ...stats,
          botConnectionStatus: botState.connectionStatus,
          isBotOnline: botState.isOnline,
          pairedNumber: botState.pairedNumber,
          engineUptimeSeconds: botState.uptimeSeconds,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get stats' });
    }
  });

  // Admin Customers list
  app.get('/api/admin/customers', verifyAdmin, (req: Request, res: Response) => {
    try {
      const customers = adminStore.getCustomers();
      res.json({ success: true, data: customers });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get customers' });
    }
  });

  // Admin Paired WhatsApp Bots & Connected Accounts list
  app.get('/api/admin/paired-bots', verifyAdmin, (req: Request, res: Response) => {
    try {
      const sessionsDir = path.resolve(process.cwd(), 'data', 'sessions');
      const pairedList: any[] = [];
      const sessionFolderNames = fs.existsSync(sessionsDir)
        ? fs.readdirSync(sessionsDir).filter((f) => {
            try {
              return fs.statSync(path.join(sessionsDir, f)).isDirectory();
            } catch {
              return false;
            }
          })
        : [];

      const backups = adminStore.getSessionBackups() || {};
      const allIds = Array.from(new Set<string>([...sessionFolderNames, ...Object.keys(backups)]));

      for (const id of allIds) {
        const engine = getBotEngine(id);
        const state = engine.getState();
        const credsPath = path.join(sessionsDir, id, 'whatsapp_session', 'creds.json');
        let filePhone: string | null = null;
        let isRegistered = false;
        let lastModified: string | null = null;

        if (fs.existsSync(credsPath)) {
          try {
            const stat = fs.statSync(credsPath);
            lastModified = stat.mtime.toISOString();
            const raw = fs.readFileSync(credsPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && (parsed.registered || parsed.me?.id)) {
              isRegistered = true;
              filePhone = parsed.me?.id ? parsed.me.id.split(':')[0].split('@')[0] : null;
            }
          } catch {}
        }

        const backupInfo = backups[id];
        const displayPhone = state.pairedNumber || filePhone || backupInfo?.phoneNumber || (id.match(/^\d+$/) ? id : 'Unknown');

        pairedList.push({
          id,
          sessionId: id,
          pairedNumber: displayPhone,
          connectionStatus: state.connectionStatus,
          isOnline: state.isOnline,
          isRegistered: isRegistered || Boolean(backupInfo),
          plan: state.config.plan || 'mini',
          botName: state.config.botName || 'YASHI HALLS',
          ownerNumber: state.config.ownerNumber || '94740712934',
          uptimeSeconds: state.uptimeSeconds,
          lastActive: lastModified || backupInfo?.timestamp || new Date().toISOString(),
          totalMessagesReceived: state.totalMessagesReceived || 0,
          totalCommandsExecuted: state.totalCommandsExecuted || 0,
        });
      }

      res.json({ success: true, count: pairedList.length, data: pairedList });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fetch paired bots' });
    }
  });

  // Authenticated customer profile sync (non-admins cannot overwrite plan/coins or other users)
  app.post('/api/admin/customers/sync', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const { id, email, username, plan, coins } = req.body || {};

      if (authUser.isAdmin) {
        if (!email) return res.status(400).json({ success: false, message: 'Email required' });
        const record = adminStore.syncCustomer(id, email, username, plan, coins);
        return res.json({ success: true, data: record });
      }

      const ownEmail = authUser.email;
      if (!ownEmail) return res.status(400).json({ success: false, message: 'Verified email required' });
      const record = adminStore.syncCustomer(
        authUser.uid,
        ownEmail,
        typeof username === 'string' && username.trim() ? username.trim().slice(0, 64) : authUser.name || ownEmail.split('@')[0]
      );
      res.json({ success: true, data: record });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to sync' });
    }
  });

  // Admin Suspend / Unsuspend Customer
  app.post('/api/admin/customers/suspend', verifyAdmin, (req: Request, res: Response) => {
    try {
      const { customerId, isSuspended } = req.body;
      const adminEmail = (req as any).adminEmail;
      const updated = adminStore.setCustomerSuspended(customerId, Boolean(isSuspended), adminEmail);
      if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update' });
    }
  });

  // Admin Update Customer Note
  app.post('/api/admin/customers/note', verifyAdmin, (req: Request, res: Response) => {
    try {
      const { customerId, note } = req.body;
      const adminEmail = (req as any).adminEmail;
      const updated = adminStore.updateCustomerNote(customerId, String(note || ''), adminEmail);
      if (!updated) return res.status(404).json({ success: false, message: 'Customer not found' });
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update note' });
    }
  });

  // Admin Delete Customer
  app.delete('/api/admin/customers/:id', verifyAdmin, (req: Request, res: Response) => {
    try {
      const customerId = req.params.id;
      const adminEmail = (req as any).adminEmail;
      const ok = adminStore.deleteCustomer(customerId, adminEmail);
      if (!ok) return res.status(404).json({ success: false, message: 'Customer not found' });
      res.json({ success: true, message: 'Customer permanently deleted.' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to delete customer' });
    }
  });

  // Admin Modify Coins (Add / Deduct)
  app.post('/api/admin/coins/adjust', verifyAdmin, (req: Request, res: Response) => {
    try {
      const { customerId, action, amount, reason } = req.body;
      const adminEmail = (req as any).adminEmail;

      if (action !== 'ADD' && action !== 'DEDUCT') {
        return res.status(400).json({ success: false, message: 'Action must be "ADD" or "DEDUCT".' });
      }

      const numAmount = Number(amount);
      if (isNaN(numAmount) || numAmount <= 0) {
        return res.status(400).json({ success: false, message: 'Amount must be a positive number.' });
      }

      const result = adminStore.modifyCoins(customerId, action, numAmount, reason, adminEmail);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to adjust coins' });
    }
  });

  // Admin View Purchase Requests
  app.get('/api/admin/purchase-requests', verifyAdmin, (req: Request, res: Response) => {
    try {
      const status = req.query.status as string;
      const list = adminStore.getPurchaseRequests(status);
      res.json({ success: true, data: list });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fetch purchase requests' });
    }
  });

  // Admin Fulfill / Approve / Reject Purchase Request
  app.post('/api/admin/purchase-requests/fulfill', verifyAdmin, (req: Request, res: Response) => {
    try {
      const { requestId, action, adminNote } = req.body;
      const adminEmail = (req as any).adminEmail;

      if (action !== 'APPROVE' && action !== 'REJECT') {
        return res.status(400).json({ success: false, message: 'Action must be APPROVE or REJECT' });
      }

      const result = adminStore.fulfillPurchaseRequest(requestId, action, adminEmail, adminNote);
      if (!result.success) {
        return res.status(400).json(result);
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fulfill request' });
    }
  });

  // Admin View Audit Logs
  app.get('/api/admin/audit-logs', verifyAdmin, (req: Request, res: Response) => {
    try {
      const logs = adminStore.getAuditLogs();
      res.json({ success: true, data: logs });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get audit logs' });
    }
  });

  // Admin System Settings (Get & Update)
  app.get('/api/admin/settings', verifyAdmin, (req: Request, res: Response) => {
    try {
      const settings = adminStore.getSettings();
      res.json({ success: true, data: settings });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get settings' });
    }
  });

  app.post('/api/admin/settings', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const updated = adminStore.updateSettings(req.body, adminEmail);
      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update settings' });
    }
  });

  // Public Site Design Endpoint (used by Web Frontend & CSS Injector)
  app.get('/api/site-design', (_req: Request, res: Response) => {
    try {
      const design = adminStore.getSiteDesign();
      res.json({ success: true, data: design });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get site design' });
    }
  });

  // Admin Site Design & CSS Studio (Get & Update)
  app.get('/api/admin/site-design', verifyAdmin, (_req: Request, res: Response) => {
    try {
      const design = adminStore.getSiteDesign();
      res.json({ success: true, data: design });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get site design' });
    }
  });

  app.post('/api/admin/site-design', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const updated = adminStore.updateSiteDesign(req.body, adminEmail);
      res.json({ success: true, data: updated, message: 'Website Design & CSS updated successfully!' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update site design' });
    }
  });

  // Admin Bot Studio & Commands Engine (Get & Update)
  app.get('/api/admin/bot-studio', verifyAdmin, (_req: Request, res: Response) => {
    try {
      const studio = adminStore.getBotStudio();
      res.json({ success: true, data: studio });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get bot studio' });
    }
  });

  app.post('/api/admin/bot-studio', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const updated = adminStore.updateBotStudio(req.body, adminEmail);
      
      // Hot-apply changes to active BotEngine
      try {
        const engine = getEngineForReq(req);
        engine.updateConfig({
          botName: updated.botName,
          botLogoUrl: updated.botLogoUrl,
          prefix: updated.prefix,
          ownerNumber: updated.ownerNumber,
          ...(updated.featureFlags || {})
        });
      } catch (engineErr) {
        console.warn('[AppServer] Hot-sync to active bot engine warning:', engineErr);
      }

      res.json({ success: true, data: updated, message: 'Bot Engine & Commands Studio saved successfully!' });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update bot studio' });
    }
  });

  // 1. Audio Streaming Endpoint (supports HTTP 206 Partial Content Range for smooth browser playback & seeking)
  app.get('/api/voice-replies/audio/:id', (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const voiceReply = adminStore.getVoiceReply(id);
      if (!voiceReply) {
        return res.status(404).json({ success: false, message: 'Voice Reply record not found' });
      }

      const streamInfo = getAudioFileStream(voiceReply.audioPath);
      if (!streamInfo || !fs.existsSync(streamInfo.filePath)) {
        return res.status(404).json({ success: false, message: 'Audio file missing from storage' });
      }

      const stat = fs.statSync(streamInfo.filePath);
      const totalSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(streamInfo.filePath, { start, end });

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${totalSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': streamInfo.mimeType,
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': totalSize,
          'Content-Type': streamInfo.mimeType,
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(streamInfo.filePath).pipe(res);
      }
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Streaming audio failed' });
    }
  });

  // 2. Admin Get All Voice Replies
  app.get('/api/admin/voice-replies', verifyAdmin, (req: Request, res: Response) => {
    try {
      const scope = req.query.scope as string;
      const list = adminStore.getVoiceReplies(scope);
      res.json({ success: true, data: list });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to get voice replies' });
    }
  });

  // 3. Admin Create & Upload Voice Reply
  app.post('/api/admin/voice-replies/create', verifyAdmin, async (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const {
        name,
        triggers,
        audioBase64,
        audioFileName,
        language = 'Both',
        scope = 'GLOBAL',
        enabled = true,
        customerId,
        customerEmail,
      } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ success: false, message: 'Reply Name is required.' });
      }

      let parsedTriggers: string[] = [];
      if (Array.isArray(triggers)) {
        parsedTriggers = triggers.map((t) => String(t).trim()).filter(Boolean);
      } else if (typeof triggers === 'string') {
        parsedTriggers = triggers
          .split(/[,;\n]/)
          .map((t) => t.trim())
          .filter(Boolean);
      }

      if (parsedTriggers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one Trigger Message is required (e.g. "hi, hello, හායි").',
        });
      }

      if (!audioBase64 || !audioFileName) {
        return res.status(400).json({ success: false, message: 'Audio file (MP3/M4A/WAV/OGG) is required.' });
      }

      // Decode base64
      const base64Data = audioBase64.replace(/^data:audio\/[a-zA-Z0-9_-]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const validation = validateAudioBuffer(buffer, audioFileName);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error || 'Invalid audio file.' });
      }

      const prefixId = `vr_${Date.now()}`;
      const saved = await saveAudioFile(buffer, audioFileName, prefixId);

      const record = adminStore.createVoiceReply(
        {
          name: name.trim(),
          triggers: parsedTriggers,
          audioFileName: saved.fileName,
          audioPath: saved.filePath,
          mimeType: saved.mimeType,
          fileSizeBytes: saved.size,
          fileSizeFormatted: formatBytes(saved.size),
          language,
          enabled: Boolean(enabled),
          scope: scope === 'CUSTOMER' ? 'CUSTOMER' : 'GLOBAL',
          customerId: customerId || undefined,
          customerEmail: customerEmail || undefined,
        },
        adminEmail
      );

      res.json({
        success: true,
        message: `Voice Reply '${record.name}' saved and connected to WhatsApp Bot successfully!`,
        data: record,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to save voice reply' });
    }
  });

  // 4. Admin Update Voice Reply Details
  app.put('/api/admin/voice-replies/:id', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const { id } = req.params;
      const { name, triggers, language, scope, enabled } = req.body;

      let parsedTriggers: string[] | undefined = undefined;
      if (Array.isArray(triggers)) {
        parsedTriggers = triggers.map((t) => String(t).trim()).filter(Boolean);
      } else if (typeof triggers === 'string') {
        parsedTriggers = triggers.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
      }

      const updated = adminStore.updateVoiceReply(
        id,
        {
          ...(name ? { name: String(name).trim() } : {}),
          ...(parsedTriggers ? { triggers: parsedTriggers } : {}),
          ...(language ? { language } : {}),
          ...(scope ? { scope } : {}),
          ...(typeof enabled === 'boolean' ? { enabled } : {}),
        },
        adminEmail
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: 'Voice Reply not found' });
      }

      res.json({ success: true, message: 'Voice Reply updated successfully.', data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to update' });
    }
  });

  // 5. Admin Toggle Enabled
  app.post('/api/admin/voice-replies/:id/toggle', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const { id } = req.params;
      const { enabled } = req.body;
      const updated = adminStore.toggleVoiceReply(id, Boolean(enabled), adminEmail);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'Voice Reply not found' });
      }
      res.json({
        success: true,
        data: updated,
        message: `Voice Reply is now ${updated.enabled ? 'Enabled' : 'Disabled'}.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to toggle status' });
    }
  });

  // 6. Admin Replace Audio File
  app.post('/api/admin/voice-replies/:id/replace-audio', verifyAdmin, async (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const { id } = req.params;
      const { audioBase64, audioFileName } = req.body;

      const current = adminStore.getVoiceReply(id);
      if (!current) {
        return res.status(404).json({ success: false, message: 'Voice Reply not found' });
      }

      if (!audioBase64 || !audioFileName) {
        return res.status(400).json({ success: false, message: 'New audio file payload is required' });
      }

      const base64Data = audioBase64.replace(/^data:audio\/[a-zA-Z0-9_-]+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const validation = validateAudioBuffer(buffer, audioFileName);
      if (!validation.valid) {
        return res.status(400).json({ success: false, message: validation.error || 'Invalid audio file.' });
      }

      const prefixId = `vr_${Date.now()}`;
      const saved = await saveAudioFile(buffer, audioFileName, prefixId);

      // Delete old file
      deleteAudioFile(current.audioPath);

      const updated = adminStore.updateVoiceReply(
        id,
        {
          audioFileName: saved.fileName,
          audioPath: saved.filePath,
          mimeType: saved.mimeType,
          fileSizeBytes: saved.size,
          fileSizeFormatted: formatBytes(saved.size),
        },
        adminEmail
      );

      res.json({ success: true, message: 'Audio file replaced successfully.', data: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to replace audio' });
    }
  });

  // 7. Admin Delete Voice Reply
  app.delete('/api/admin/voice-replies/:id', verifyAdmin, (req: Request, res: Response) => {
    try {
      const adminEmail = (req as any).adminEmail;
      const { id } = req.params;
      const current = adminStore.getVoiceReply(id);
      if (!current) {
        return res.status(404).json({ success: false, message: 'Voice Reply not found' });
      }

      deleteAudioFile(current.audioPath);
      adminStore.deleteVoiceReply(id, adminEmail);

      res.json({ success: true, message: `Voice Reply '${current.name}' deleted successfully.` });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to delete voice reply' });
    }
  });

  // 8. Admin Test Trigger Match Simulator
  app.post('/api/admin/voice-replies/test-trigger', verifyAdmin, (req: Request, res: Response) => {
    try {
      const { message, customerId } = req.body;
      const result = adminStore.findMatchingVoiceReply(String(message || ''), customerId);
      res.json({
        success: true,
        matched: Boolean(result.match),
        match: result.match,
        matchedTrigger: result.matchedTrigger,
        inputMessage: message,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Test trigger failed' });
    }
  });

  // 9. Customer-facing Voice Replies and Bot Toggle (isolated per authenticated customer)
  app.get('/api/voice-replies/customer', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const engine = getEngineForReq(req);
      const list = adminStore.getVoiceReplies(undefined, authUser.uid);
      res.json({
        success: true,
        data: list,
        voiceAutoReplyEnabled: engine.getState().config.voiceAutoReplyEnabled,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to fetch customer voice replies' });
    }
  });

  app.post('/api/voice-replies/customer/toggle', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { enabled } = req.body;
      const engine = getEngineForReq(req);
      const updated = engine.updateConfig({ voiceAutoReplyEnabled: Boolean(enabled) });
      res.json({ success: true, voiceAutoReplyEnabled: updated.voiceAutoReplyEnabled });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Failed to toggle voice auto reply' });
    }
  });

  // --- INTERACTIVE NEON WEB MENU UI ---
  app.get(['/menu', '/menu.html'], (req: Request, res: Response) => {
    const menuFilePath = path.resolve(rootDir, 'public', 'menu.html');
    if (fs.existsSync(menuFilePath)) {
      res.sendFile(menuFilePath);
    } else {
      res.status(404).send('Menu UI not found');
    }
  });

  app.get(['/interactive-menu', '/interactive-menu.html', '/menutest'], (req: Request, res: Response) => {
    const candidates = [
      path.resolve(rootDir, 'public', 'interactive-menu.html'),
      path.resolve(rootDir, 'dist', 'interactive-menu.html'),
      path.resolve(process.cwd(), 'public', 'interactive-menu.html'),
      path.resolve(process.cwd(), 'dist', 'interactive-menu.html'),
    ];
    for (const candidatePath of candidates) {
      if (fs.existsSync(candidatePath)) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return res.sendFile(candidatePath);
      }
    }
    res.status(404).send('Interactive Menu UI not found');
  });

  // Direct Menu Command Dispatcher from WhatsApp In-App Webview
  app.post('/api/bot/execute-menu-command', async (req: Request, res: Response) => {
    try {
      const { command, jid, phone, userId } = req.body;
      if (!command) {
        return res.status(400).json({ success: false, message: 'Command is required' });
      }
      const engine = getBotEngine(userId || 'primary');
      if (!engine || !engine.sock) {
        return res.status(503).json({ success: false, message: 'WhatsApp Bot engine is not currently connected' });
      }
      const targetJid = jid || (phone ? `${phone.replace(/\D/g, '')}@s.whatsapp.net` : null) || (engine.state.pairedNumber ? `${engine.state.pairedNumber}@s.whatsapp.net` : null);
      if (!targetJid) {
        return res.status(400).json({ success: false, message: 'Target WhatsApp recipient JID is missing' });
      }

      const prefix = engine.state.config.prefix || '.';
      const cleanCmd = command.startsWith(prefix) ? command : `${prefix}${command.replace(/^[./!#]/, '')}`;

      const syntheticMsg = {
        key: {
          remoteJid: targetJid,
          fromMe: false,
          id: `MENU_WEB_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          participant: targetJid,
        },
        message: {
          conversation: cleanCmd,
        },
        pushName: 'Interactive Menu User',
        messageTimestamp: Math.floor(Date.now() / 1000),
      };

      engine.addLog('INFO', `⚡ [INTERACTIVE MENU TRIGGER] Incoming webview command '${cleanCmd}' for ${targetJid.split('@')[0]}`);
      // Process command directly inside engine
      await engine.handleIncomingMessage(syntheticMsg);

      res.json({
        success: true,
        message: `Command '${cleanCmd}' executed successfully`,
        jid: targetJid,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err?.message || 'Execution failed' });
    }
  });


  // --- VITE DEV MIDDLEWARE OR PRODUCTION STATIC SERVING ---
  const isProduction = process.env.NODE_ENV === 'production';
  const distPath = path.resolve(rootDir, 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response, next) => {
      if (req.path.startsWith('/api/')) return next();
      const indexPath = path.resolve(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output dist not found');
      }
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`🚀 [YASHI HALLS SERVER] Running on port ${PORT} (http://localhost:${PORT})`);
    console.log(`🤖 [BOT ENGINE] Ready to pair and host WhatsApp Multi-Device instance.`);

    // 1. Auto-verify & provision standalone audio/media engine binary
    ensureYtDlpBinary().catch((err) => {
      console.warn("[AUDIO ENGINE] yt-dlp init notice:", err?.message || err);
    });

    // 2. Initial temp garbage collection sweep
    cleanStaleTempFiles();

    // 3. Auto-resume all existing registered WhatsApp bot sessions (24/7 Always-On)
    autoBootAllRegisteredBots().catch((err) => {
      console.warn("[BOT ENGINE] autoBoot notice:", err?.message || err);
    });

    // 4. Auto-start Public HTTPS Preview Bridge for YASHI HALLS Pay Android App when running in Preview
    initPayPreviewTunnel(Number(PORT) || 3000);

    // 5. Built-in Internal 24/7 Anti-Sleep Self-Heartbeat Engine
    // Keeps Node.js process & Cloud container awake continuously without external tools like UptimeRobot
    setInterval(async () => {
      try {
        const portNum = Number(PORT) || 3000;
        const localTarget = `http://127.0.0.1:${portNum}/api/keepalive`;
        await fetch(localTarget, { headers: { 'User-Agent': 'YashiHalls-Internal-KeepAlive/1.0' } }).catch(() => {});

        const pubUrl = process.env.PUBLIC_URL || process.env.APP_URL;
        if (pubUrl && typeof pubUrl === 'string' && pubUrl.startsWith('http')) {
          const cleanPub = pubUrl.endsWith('/') ? pubUrl.slice(0, -1) : pubUrl;
          await fetch(`${cleanPub}/api/keepalive`, { headers: { 'User-Agent': 'YashiHalls-External-KeepAlive/1.0' } }).catch(() => {});
        }
      } catch (err) {}
    }, 15000);
  });
}

export { startServer };

