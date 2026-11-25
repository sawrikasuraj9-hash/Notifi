/**
 * FFGlory Panel Reseller API Client (Server-Side Only)
 * Official Base URL: https://ffglory.pro
 * Official Docs: https://www.ffglory.pro/api-docs
 *
 * Security guarantees:
 * - Strictly locked to https://ffglory.pro (no SSRF to arbitrary hosts)
 * - API keys are never logged or returned in error strings
 * - Enforces request timeouts via AbortController
 * - Retries transient 409/429/network failures safely where appropriate
 */

const FFGLORY_BASE_URL = 'https://ffglory.pro';
const DEFAULT_TIMEOUT_MS = 18000;

export interface FFGloryCredentials {
  apiKey: string;
  masterKey: string;
}

export interface FFGloryAccountInfo {
  username: string;
  role: string;
  basic_credits: number;
  premium_credits: number;
  max_groups: number;
}

export interface FFGloryRegion {
  id: string;
  region_name: string;
  region_code: string;
  tier: 'basic' | 'premium' | string;
  enabled: boolean;
}

export interface FFGloryPricingResponse {
  basic_credit_usd: number;
  premium_credit_usd: number;
  regions: FFGloryRegion[];
}

export interface FFGloryLaunchGroupResponse {
  success: boolean;
  group_id?: string;
  bot_count?: number;
  message?: string;
  [key: string]: any;
}

export interface FFGloryLaunchProgressEvent {
  event: 'start' | 'progress' | 'done';
  generated: number;
  requested: number;
  etaSeconds?: number;
  region?: string;
  groupId?: string;
}

export interface FFGloryGroupItem {
  group_id: string;
  clan_id: string;
  region: string;
  status: string;
  container_count?: number;
  running_count?: number;
  created_at?: string;
  uptime?: string;
}

export interface FFGloryCreateCouponResponse {
  success: boolean;
  coupon?: {
    code: string;
    basic_credits: number;
    premium_credits: number;
    status: string;
    created_at?: string;
  };
  message?: string;
  [key: string]: any;
}

export interface FFGloryCouponItem {
  code: string;
  basic_credits: number;
  premium_credits: number;
  status: string;
  created_by?: string;
  created_at?: string;
}

export interface FFGloryTransactionItem {
  id: string;
  order_id?: string;
  basic_credits: number;
  premium_credits: number;
  status: string;
  created_at?: string;
}

export interface FFGloryNotificationItem {
  type?: string;
  title?: string;
  message?: string;
  created_at?: string;
  [key: string]: any;
}

export class FFGloryApiError extends Error {
  statusCode: number;
  endpoint: string;
  responseBody?: any;
  retryable: boolean;

  constructor(
    message: string,
    statusCode: number,
    endpoint: string,
    responseBody?: any,
    retryable = false
  ) {
    super(message);
    this.name = 'FFGloryApiError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
    this.retryable = retryable;
  }
}

/**
 * Scrubs any FFGlory API keys or master keys from arbitrary strings before logging or storage.
 */
export function redactFFGlorySecrets(input: string, creds?: Partial<FFGloryCredentials>): string {
  let out = String(input || '');
  if (creds?.apiKey && creds.apiKey.length >= 6) {
    out = out.split(creds.apiKey).join('[REDACTED_API_KEY]');
  }
  if (creds?.masterKey && creds.masterKey.length >= 6) {
    out = out.split(creds.masterKey).join('[REDACTED_MASTER_KEY]');
  }
  // Pattern-based scrubbing as defense in depth
  out = out.replace(/api_key=[^&\s"']+/gi, 'api_key=[REDACTED]');
  out = out.replace(/\bak_[a-f0-9]{16,}\b/gi, 'ak_[REDACTED]');
  return out;
}

export function maskSecretDisplay(secret: string): string {
  const clean = String(secret || '').trim();
  if (!clean) return '';
  if (clean.length <= 10) return '••••••••';
  return `${clean.slice(0, 6)}••••••${clean.slice(-4)}`;
}

function mapFriendlyErrorMessage(status: number, serverError?: string): string {
  const cleanServerErr = serverError ? String(serverError).trim() : '';
  switch (status) {
    case 400:
      return cleanServerErr || 'Bad request: missing or invalid parameters sent to FFGlory API.';
    case 401:
      return cleanServerErr || 'Unauthorized: invalid FFGlory API key.';
    case 402:
      return cleanServerErr || 'Insufficient FFGlory credits to complete this order.';
    case 403:
      return cleanServerErr || 'Forbidden: invalid x-api-key header or max groups limit reached.';
    case 404:
      return cleanServerErr || 'Requested FFGlory resource was not found.';
    case 409:
      return cleanServerErr || 'Conflict: another operation is currently in progress for this account or clan.';
    case 429:
      return cleanServerErr || 'Rate limited by FFGlory API. Please retry shortly.';
    default:
      return cleanServerErr || `FFGlory API request failed with HTTP ${status}.`;
  }
}

/**
 * Parses Server-Sent Events (text/event-stream) payloads returned by FFGlory endpoints
 * such as POST /api/client/auto-clan-group:
 *   event: start
 *   data: {"region":"Singapore","requested":4}
 *   event: progress
 *   data: {"eta_seconds":0,"generated":4,"requested":4}
 *   event: done
 *   data: {"group_id":"19223348535","message":"Group launched successfully","success":true}
 */
function parseFFGlorySseResponse(rawText: string): {
  parsed: any;
  sseError?: string;
} | null {
  if (!rawText || (!rawText.includes('data:') && !rawText.includes('event:'))) {
    return null;
  }

  const normalized = rawText.replace(/\r\n/g, '\n');
  const blocks = normalized.split(/\n\n+/);
  let mergedMeta: Record<string, any> = {};
  let donePayload: Record<string, any> | null = null;
  let lastValidData: Record<string, any> | null = null;
  let sseError: string | undefined;

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    let eventName = '';
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim().toLowerCase();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    }
    if (dataLines.length === 0) continue;
    const dataStr = dataLines.join('\n');
    let obj: any = null;
    try {
      obj = JSON.parse(dataStr);
    } catch {
      if (eventName === 'error') {
        sseError = dataStr;
      }
      continue;
    }

    if (obj && typeof obj === 'object') {
      lastValidData = obj;
      if (eventName === 'start' || eventName === 'progress') {
        mergedMeta = { ...mergedMeta, ...obj };
      } else if (eventName === 'done' || obj.group_id || obj.groupId || obj.success === true) {
        donePayload = { ...mergedMeta, ...obj };
      } else if (eventName === 'error' || obj.success === false || obj.error) {
        sseError = String(obj.error || obj.message || 'FFGlory SSE stream returned an error');
      }
    }
  }

  if (donePayload) {
    return { parsed: donePayload };
  }
  if (sseError) {
    return { parsed: lastValidData || mergedMeta, sseError };
  }
  if (lastValidData) {
    return { parsed: { ...mergedMeta, ...lastValidData } };
  }
  return null;
}

async function ffgloryRequest<T>(
  method: 'GET' | 'POST',
  endpointPath: string,
  options: {
    creds?: FFGloryCredentials;
    requiresAuth?: boolean;
    body?: Record<string, any>;
    timeoutMs?: number;
    maxRetries?: number;
  } = {}
): Promise<T> {
  const {
    creds,
    requiresAuth = true,
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = method === 'GET' ? 2 : 0,
  } = options;

  if (!endpointPath.startsWith('/api/')) {
    throw new FFGloryApiError('Invalid FFGlory endpoint path', 400, endpointPath);
  }

  if (requiresAuth) {
    if (!creds?.apiKey || !creds?.masterKey) {
      throw new FFGloryApiError(
        'FFGlory API credentials are not configured on the server.',
        401,
        endpointPath
      );
    }
  }

  const url = new URL(`${FFGLORY_BASE_URL}${endpointPath}`);
  if (requiresAuth && creds?.apiKey) {
    url.searchParams.set('api_key', creds.apiKey);
  }

  const headers: Record<string, string> = {
    Accept: 'application/json, text/event-stream',
    'User-Agent': 'YashiHalls-AutoOrder/1.0',
  };
  if (requiresAuth && creds?.masterKey) {
    headers['x-api-key'] = creds.masterKey;
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }

  let lastError: FFGloryApiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: method === 'POST' && body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const rawText = await response.text();
      let parsed: any = null;
      let sseStreamError: string | undefined;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const sseRes = parseFFGlorySseResponse(rawText);
          if (sseRes) {
            parsed = sseRes.parsed;
            sseStreamError = sseRes.sseError;
          } else {
            parsed = { raw: redactFFGlorySecrets(rawText.slice(0, 500), creds) };
          }
        }
      }

      if (!response.ok) {
        const isCloudflareChallenge =
          response.status === 403 &&
          (rawText.includes('_cf_chl_opt') || rawText.includes('Just a moment...'));
        const serverErr = isCloudflareChallenge
          ? 'FFGlory Cloudflare WAF rejected x-api-key (HTTP 403). Please verify your FFGlory Master Header Key (x-api-key) in API Settings.'
          : sseStreamError ||
            (typeof parsed?.error === 'string'
              ? parsed.error
              : typeof parsed?.message === 'string'
              ? parsed.message
              : '');
        const sanitizedErr = redactFFGlorySecrets(
          mapFriendlyErrorMessage(response.status, serverErr),
          creds
        );
        const retryable = !isCloudflareChallenge && (response.status === 409 || response.status === 429 || response.status >= 500);
        lastError = new FFGloryApiError(sanitizedErr, response.status, endpointPath, parsed, retryable);

        if (retryable && attempt < maxRetries) {
          const delayMs = response.status === 429 ? 2500 * (attempt + 1) : 1500 * (attempt + 1);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw lastError;
      }

      if (sseStreamError) {
        throw new FFGloryApiError(
          redactFFGlorySecrets(sseStreamError, creds),
          502,
          endpointPath,
          parsed,
          false
        );
      }

      return parsed as T;
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof FFGloryApiError) {
        throw err;
      }
      const isTimeout = err?.name === 'AbortError';
      const safeMsg = redactFFGlorySecrets(
        isTimeout
          ? `FFGlory API request timed out after ${Math.round(timeoutMs / 1000)}s.`
          : `Network error contacting FFGlory API: ${err?.message || 'Connection failed'}`,
        creds
      );
      lastError = new FFGloryApiError(safeMsg, isTimeout ? 504 : 503, endpointPath, undefined, true);

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError || new FFGloryApiError('Unknown FFGlory API error', 500, endpointPath);
}

export const ffgloryClient = {
  /** GET /api/auth/me — Account info & credit balances (with /api/client/balance fallback) */
  async getMe(creds: FFGloryCredentials): Promise<FFGloryAccountInfo> {
    const me = await ffgloryRequest<any>('GET', '/api/auth/me', { creds, requiresAuth: true });
    let basic = Number(me?.basic_credits);
    let premium = Number(me?.premium_credits);

    if (!Number.isFinite(basic) || !Number.isFinite(premium)) {
      try {
        const bal = await ffgloryRequest<any>('GET', '/api/client/balance', {
          creds,
          requiresAuth: true,
        });
        if (!Number.isFinite(basic) && Number.isFinite(Number(bal?.basic_credits))) {
          basic = Number(bal.basic_credits);
        }
        if (!Number.isFinite(premium) && Number.isFinite(Number(bal?.premium_credits))) {
          premium = Number(bal.premium_credits);
        }
      } catch {
        // ignore fallback error
      }
    }

    return {
      username: String(me?.username || 'FFGlory User'),
      role: String(me?.role || 'user'),
      basic_credits: Number.isFinite(basic) ? basic : 0,
      premium_credits: Number.isFinite(premium) ? premium : 0,
      max_groups: Number.isFinite(Number(me?.max_groups)) ? Number(me.max_groups) : 0,
    };
  },

  /** GET /api/client/balance — Direct credit balance check */
  async getBalance(creds: FFGloryCredentials): Promise<{ basic_credits: number; premium_credits: number }> {
    const bal = await ffgloryRequest<any>('GET', '/api/client/balance', { creds, requiresAuth: true });
    return {
      basic_credits: Number(bal?.basic_credits) || 0,
      premium_credits: Number(bal?.premium_credits) || 0,
    };
  },

  /** GET /api/pricing — Public regions & USD credit pricing */
  async getPricing(): Promise<FFGloryPricingResponse> {
    return ffgloryRequest<FFGloryPricingResponse>('GET', '/api/pricing', { requiresAuth: false });
  },

  /** POST /api/client/auto-clan-group — Launch a glory group for a clan (1 credit) with live SSE progress streaming */
  async launchAutoClanGroup(
    creds: FFGloryCredentials,
    params: { region: string; clan_id: string },
    onProgress?: (ev: FFGloryLaunchProgressEvent) => void | Promise<void>
  ): Promise<FFGloryLaunchGroupResponse> {
    const region = String(params.region || '').trim().toLowerCase();
    const clan_id = String(params.clan_id || '').trim();
    if (!region || !clan_id) {
      throw new FFGloryApiError('Both region and clan_id are required.', 400, '/api/client/auto-clan-group');
    }
    if (!creds?.apiKey || !creds?.masterKey) {
      throw new FFGloryApiError(
        'FFGlory API credentials are not configured on the server.',
        401,
        '/api/client/auto-clan-group'
      );
    }

    const endpointPath = '/api/client/auto-clan-group';
    const url = new URL(`${FFGLORY_BASE_URL}${endpointPath}`);
    url.searchParams.set('api_key', creds.apiKey);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'x-api-key': creds.masterKey,
          'User-Agent': 'YashiHalls-AutoOrder/1.0',
        },
        body: JSON.stringify({ region, clan_id }),
        signal: controller.signal,
      });

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();

      // If non-OK response or standard JSON, parse immediately
      if (!response.ok || (contentType.includes('application/json') && !contentType.includes('event-stream'))) {
        clearTimeout(timer);
        const rawText = await response.text();
        let parsed: any = null;
        let sseErr: string | undefined;
        if (rawText) {
          try {
            parsed = JSON.parse(rawText);
          } catch {
            const sseRes = parseFFGlorySseResponse(rawText);
            if (sseRes) {
              parsed = sseRes.parsed;
              sseErr = sseRes.sseError;
            } else {
              parsed = { raw: redactFFGlorySecrets(rawText.slice(0, 500), creds) };
            }
          }
        }
        if (!response.ok) {
          const isCloudflareChallenge =
            response.status === 403 &&
            (rawText.includes('_cf_chl_opt') || rawText.includes('Just a moment...'));
          const serverErr = isCloudflareChallenge
            ? 'FFGlory Cloudflare WAF rejected x-api-key (HTTP 403). Please verify your FFGlory Master Header Key (x-api-key) in API Settings.'
            : sseErr ||
              (typeof parsed?.error === 'string'
                ? parsed.error
                : typeof parsed?.message === 'string'
                ? parsed.message
                : '');
          throw new FFGloryApiError(
            redactFFGlorySecrets(mapFriendlyErrorMessage(response.status, serverErr), creds),
            response.status,
            endpointPath,
            parsed,
            !isCloudflareChallenge && (response.status === 409 || response.status === 429 || response.status >= 500)
          );
        }
        if (sseErr) {
          throw new FFGloryApiError(redactFFGlorySecrets(sseErr, creds), 502, endpointPath, parsed, false);
        }
        return parsed as FFGloryLaunchGroupResponse;
      }

      // Live SSE stream reading chunk-by-chunk so WhatsApp UI Card updates in real time!
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullRaw = '';
        let mergedMeta: Record<string, any> = { region, requested: 4, generated: 0 };
        let donePayload: Record<string, any> | null = null;
        let sseError: string | undefined;

        const processBlock = async (block: string) => {
          const lines = block
            .replace(/\r\n/g, '\n')
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
          if (lines.length === 0) return;
          let eventName = '';
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim().toLowerCase();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) return;
          const dataStr = dataLines.join('\n');
          let obj: any = null;
          try {
            obj = JSON.parse(dataStr);
          } catch {
            if (eventName === 'error') sseError = dataStr;
            return;
          }
          if (!obj || typeof obj !== 'object') return;

          if (eventName === 'start') {
            mergedMeta = { ...mergedMeta, ...obj };
            if (onProgress) {
              await Promise.resolve(
                onProgress({
                  event: 'start',
                  generated: Number(obj.generated) || 0,
                  requested: Number(obj.requested) || 4,
                  region: obj.region || region,
                })
              ).catch(() => {});
            }
          } else if (eventName === 'progress') {
            mergedMeta = { ...mergedMeta, ...obj };
            if (onProgress) {
              await Promise.resolve(
                onProgress({
                  event: 'progress',
                  generated: Number(obj.generated) || 0,
                  requested: Number(obj.requested) || Number(mergedMeta.requested) || 4,
                  etaSeconds: Number.isFinite(Number(obj.eta_seconds)) ? Number(obj.eta_seconds) : undefined,
                  region: mergedMeta.region || region,
                })
              ).catch(() => {});
            }
          } else if (eventName === 'done' || obj.group_id || obj.groupId || obj.success === true) {
            donePayload = {
              ...mergedMeta,
              ...obj,
              bot_count: Number(obj.bot_count || mergedMeta.generated || mergedMeta.requested || 4),
            };
            if (onProgress) {
              await Promise.resolve(
                onProgress({
                  event: 'done',
                  generated: Number(mergedMeta.requested) || 4,
                  requested: Number(mergedMeta.requested) || 4,
                  etaSeconds: 0,
                  region: mergedMeta.region || region,
                  groupId: String(obj.group_id || obj.groupId || ''),
                })
              ).catch(() => {});
            }
          } else if (eventName === 'error' || obj.success === false || obj.error) {
            sseError = String(obj.error || obj.message || 'FFGlory launch stream returned an error');
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullRaw += chunk;
          buffer += chunk.replace(/\r\n/g, '\n');
          let sepIdx = buffer.indexOf('\n\n');
          while (sepIdx !== -1) {
            const block = buffer.slice(0, sepIdx);
            buffer = buffer.slice(sepIdx + 2);
            await processBlock(block);
            sepIdx = buffer.indexOf('\n\n');
          }
        }
        if (buffer.trim()) {
          await processBlock(buffer);
        }
        clearTimeout(timer);

        if (donePayload) {
          return donePayload as FFGloryLaunchGroupResponse;
        }
        if (sseError) {
          throw new FFGloryApiError(redactFFGlorySecrets(sseError, creds), 502, endpointPath, mergedMeta, false);
        }
        // Fallback: try parsing fullRaw as JSON or SSE
        try {
          return JSON.parse(fullRaw) as FFGloryLaunchGroupResponse;
        } catch {
          const fallbackSse = parseFFGlorySseResponse(fullRaw);
          if (fallbackSse?.parsed) return fallbackSse.parsed as FFGloryLaunchGroupResponse;
          throw new FFGloryApiError(
            'FFGlory launch stream closed without a completion event.',
            502,
            endpointPath,
            { raw: redactFFGlorySecrets(fullRaw.slice(0, 400), creds) },
            false
          );
        }
      }

      // Fallback when body is not streamable
      const rawText = await response.text();
      clearTimeout(timer);
      try {
        return JSON.parse(rawText) as FFGloryLaunchGroupResponse;
      } catch {
        const sseRes = parseFFGlorySseResponse(rawText);
        if (sseRes?.sseError) {
          throw new FFGloryApiError(redactFFGlorySecrets(sseRes.sseError, creds), 502, endpointPath, sseRes.parsed, false);
        }
        if (sseRes?.parsed) return sseRes.parsed as FFGloryLaunchGroupResponse;
        return { success: false, raw: redactFFGlorySecrets(rawText.slice(0, 500), creds) } as any;
      }
    } catch (err: any) {
      clearTimeout(timer);
      if (err instanceof FFGloryApiError) throw err;
      const isTimeout = err?.name === 'AbortError';
      throw new FFGloryApiError(
        redactFFGlorySecrets(
          isTimeout
            ? 'FFGlory launch request timed out after 120s.'
            : `Network error contacting FFGlory API: ${err?.message || 'Connection failed'}`,
          creds
        ),
        isTimeout ? 504 : 503,
        endpointPath,
        undefined,
        true
      );
    }
  },

  /** GET /api/client/my-groups — List running and existing glory groups */
  async getMyGroups(creds: FFGloryCredentials): Promise<FFGloryGroupItem[]> {
    const data = await ffgloryRequest<any>('GET', '/api/client/my-groups', { creds, requiresAuth: true });
    return Array.isArray(data) ? data : Array.isArray(data?.groups) ? data.groups : [];
  },

  /** POST /api/client/create-coupon — Create a credit coupon code */
  async createCoupon(
    creds: FFGloryCredentials,
    params: { basic_credits: number; premium_credits: number }
  ): Promise<FFGloryCreateCouponResponse> {
    const basic_credits = Math.max(0, Math.min(100, Math.floor(Number(params.basic_credits) || 0)));
    const premium_credits = Math.max(0, Math.min(20, Math.floor(Number(params.premium_credits) || 0)));
    if (basic_credits + premium_credits < 1) {
      throw new FFGloryApiError(
        'At least 1 total credit (basic or premium) is required to create a coupon.',
        400,
        '/api/client/create-coupon'
      );
    }
    return ffgloryRequest<FFGloryCreateCouponResponse>('POST', '/api/client/create-coupon', {
      creds,
      requiresAuth: true,
      body: { basic_credits, premium_credits },
      maxRetries: 0,
      timeoutMs: 25000,
    });
  },

  /** GET /api/client/my-coupons — List created coupons */
  async getMyCoupons(creds: FFGloryCredentials): Promise<FFGloryCouponItem[]> {
    const data = await ffgloryRequest<any>('GET', '/api/client/my-coupons', { creds, requiresAuth: true });
    return Array.isArray(data) ? data : Array.isArray(data?.coupons) ? data.coupons : [];
  },

  /** GET /api/client/transactions — List last 50 FFGlory transactions */
  async getTransactions(creds: FFGloryCredentials): Promise<FFGloryTransactionItem[]> {
    const data = await ffgloryRequest<any>('GET', '/api/client/transactions', { creds, requiresAuth: true });
    return Array.isArray(data) ? data : Array.isArray(data?.transactions) ? data.transactions : [];
  },

  /** GET /api/client/notifications — Fetch pending one-time FFGlory notifications */
  async getNotifications(creds: FFGloryCredentials): Promise<FFGloryNotificationItem[]> {
    const data = await ffgloryRequest<any>('GET', '/api/client/notifications', { creds, requiresAuth: true });
    return Array.isArray(data) ? data : Array.isArray(data?.notifications) ? data.notifications : [];
  },

  /** POST /api/client/group-action — Execute group action (get-glory, get-clan-info, restart, stop, delete) */
  async groupAction(
    creds: FFGloryCredentials,
    params: {
      action: 'get-glory' | 'get-clan-info' | 'restart' | 'stop' | 'delete';
      group_id: string;
    }
  ): Promise<any> {
    const action = params.action;
    const group_id = String(params.group_id || '').trim();
    if (!group_id) {
      throw new FFGloryApiError('group_id is required for group-action.', 400, '/api/client/group-action');
    }
    return ffgloryRequest<any>('POST', '/api/client/group-action', {
      creds,
      requiresAuth: true,
      body: { action, group_id },
      maxRetries: action === 'get-glory' || action === 'get-clan-info' ? 1 : 0,
      timeoutMs: 20000,
    });
  },

  /** Helper: Fetch live glory + clan info + group status cleanly from official FFGlory endpoints */
  async getLiveGroupTelemetry(
    creds: FFGloryCredentials,
    groupId: string
  ): Promise<{
    currentGlory?: number | string;
    clanName?: string;
    clanLevel?: number | string;
    memberCount?: number | string;
    groupStatus: string;
    runningCount?: number;
    containerCount?: number;
    uptime?: string;
    rawGlory?: any;
    rawClanInfo?: any;
    errors: string[];
  }> {
    const cleanGroupId = String(groupId || '').trim();
    const errors: string[] = [];

    const [gloryRes, clanRes, groupsRes] = await Promise.allSettled([
      this.groupAction(creds, { action: 'get-glory', group_id: cleanGroupId }),
      this.groupAction(creds, { action: 'get-clan-info', group_id: cleanGroupId }),
      this.getMyGroups(creds),
    ]);

    const rawGlory = gloryRes.status === 'fulfilled' ? gloryRes.value : undefined;
    const rawClanInfo = clanRes.status === 'fulfilled' ? clanRes.value : undefined;
    const groupsList = groupsRes.status === 'fulfilled' ? groupsRes.value : [];

    if (gloryRes.status === 'rejected') {
      errors.push(`get-glory: ${gloryRes.reason?.message || 'Failed'}`);
    }
    if (clanRes.status === 'rejected') {
      errors.push(`get-clan-info: ${clanRes.reason?.message || 'Failed'}`);
    }
    if (groupsRes.status === 'rejected') {
      errors.push(`my-groups: ${groupsRes.reason?.message || 'Failed'}`);
    }

    const matchedGroup = groupsList.find((g) => String(g.group_id) === cleanGroupId);

    // Extract real values defensively across possible FFGlory response shapes without inventing fake values
    const gloryObj = rawGlory?.data || rawGlory?.result || rawGlory;
    const clanObj =
      rawClanInfo?.decoded ||
      rawClanInfo?.data?.decoded ||
      rawClanInfo?.clan_info ||
      rawClanInfo?.data?.clan_info ||
      rawClanInfo?.clan ||
      rawClanInfo?.guild ||
      rawClanInfo?.info ||
      rawClanInfo?.data ||
      rawClanInfo?.result ||
      rawClanInfo;

    const currentGlory =
      gloryObj?.total_glory ??
      gloryObj?.glory ??
      gloryObj?.current_glory ??
      gloryObj?.clan_glory ??
      rawClanInfo?.clan_glory?.total_glory ??
      rawClanInfo?.data?.clan_glory?.total_glory ??
      clanObj?.total_glory ??
      clanObj?.glory ??
      undefined;

    const clanName =
      clanObj?.clan_name ??
      clanObj?.clanName ??
      clanObj?.name ??
      clanObj?.guild_name ??
      gloryObj?.clan_name ??
      rawClanInfo?.clan_name ??
      undefined;

    const clanLevel =
      clanObj?.clan_level ??
      clanObj?.clanLevel ??
      clanObj?.level ??
      clanObj?.guild_level ??
      gloryObj?.clan_level ??
      undefined;

    const memberCount =
      clanObj?.member_num ??
      clanObj?.memberNum ??
      clanObj?.member_count ??
      clanObj?.members ??
      clanObj?.current_members ??
      undefined;

    return {
      currentGlory,
      clanName: typeof clanName === 'string' && clanName.trim() ? clanName.trim() : undefined,
      clanLevel,
      memberCount,
      groupStatus: matchedGroup?.status || (rawGlory?.success || rawClanInfo?.success ? 'running' : 'unknown'),
      runningCount: matchedGroup?.running_count ?? (Array.isArray(rawGlory?.details) ? rawGlory.details.length : undefined),
      containerCount: matchedGroup?.container_count ?? (Array.isArray(rawGlory?.details) ? rawGlory.details.length : undefined),
      uptime: matchedGroup?.uptime,
      rawGlory,
      rawClanInfo,
      errors,
    };
  },
};

