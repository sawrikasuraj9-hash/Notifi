import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction } from 'express';
import { adminStore } from './adminStore';

const FIREBASE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

export const AUTHORIZED_ADMIN_EMAILS = [
  'sawrikasuraj9@gmail.com',
  'sawrikasuraj759@gmail.com',
  'epavenav@gmail.com',
];

// Session HMAC signing key: reads process.env.SESSION_SECRET or falls back to an ephemeral 32-byte key in memory
const SESSION_SIGNING_SECRET: Buffer = (() => {
  const envSecret = String(process.env.SESSION_SECRET || '').trim();
  if (envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  return crypto.randomBytes(32);
})();

const SESSION_TOKEN_PREFIX = 'yh_sess.';
const SESSION_TTL_SEC = 12 * 60 * 60; // 12 hours

// Simple in-memory rate limiter for passcode login attempts (per IP)
const passcodeAttemptMap = new Map<string, { count: number; resetAt: number }>();

export function checkPasscodeRateLimit(ipKey: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = passcodeAttemptMap.get(ipKey);
  if (!entry || now >= entry.resetAt) {
    passcodeAttemptMap.set(ipKey, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return { allowed: true };
  }
  if (entry.count >= 12) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
  }
  entry.count += 1;
  return { allowed: true };
}

export function getOwnerPasscodeStatus() {
  const envPasscode = String(process.env.ADMIN_PASSCODE || '').trim();
  const envManaged = envPasscode.length > 0;
  const claimed = adminStore.getOwnerPasscodeRecord();
  return {
    configured: envManaged || Boolean(claimed),
    envManaged,
    canClaimFirstRun: !envManaged && !claimed,
    defaultEmail: claimed?.email || AUTHORIZED_ADMIN_EMAILS[0],
  };
}

function hashPasscodeScrypt(passcode: string, saltHex: string): Buffer {
  return crypto.scryptSync(passcode, Buffer.from(saltHex, 'hex'), 64);
}

export function claimFirstRunOwnerPasscode(
  passcode: string,
  emailInput?: string
): { success: boolean; token?: string; user?: VerifiedFirebaseUser; message: string } {
  const status = getOwnerPasscodeStatus();
  if (!status.canClaimFirstRun) {
    return {
      success: false,
      message: status.envManaged
        ? 'Owner passcode is configured via server environment secrets.'
        : 'Owner passcode has already been claimed. Please sign in with your passcode.',
    };
  }
  const cleanPass = String(passcode || '');
  if (cleanPass.length < 6 || cleanPass.length > 128) {
    return { success: false, message: 'Passcode must be between 6 and 128 characters.' };
  }

  const candidateEmail = String(emailInput || '').trim().toLowerCase();
  const email = isMasterAdminEmail(candidateEmail) ? candidateEmail : AUTHORIZED_ADMIN_EMAILS[0];

  const saltHex = crypto.randomBytes(16).toString('hex');
  const hashBuf = hashPasscodeScrypt(cleanPass, saltHex);
  adminStore.setOwnerPasscodeRecord({
    salt: saltHex,
    hash: hashBuf.toString('hex'),
    email,
    claimedAt: new Date().toISOString(),
  });
  adminStore.addAuditLog(email, 'OWNER_PASSCODE_CLAIMED', 'First-run owner passcode claimed and locked.');

  const verifiedUser = buildOwnerSessionUser(email);
  const token = issueServerSessionToken(verifiedUser);
  return { success: true, token, user: verifiedUser, message: 'Owner passcode set and signed in successfully.' };
}

export function verifyOwnerPasscodeLogin(
  passcode: string,
  emailInput?: string
): { success: boolean; token?: string; user?: VerifiedFirebaseUser; message: string } {
  const cleanPass = String(passcode || '');
  if (!cleanPass) {
    return { success: false, message: 'Passcode is required.' };
  }

  const envPasscode = String(process.env.ADMIN_PASSCODE || '').trim();
  const candidateEmail = String(emailInput || '').trim().toLowerCase();

  if (envPasscode.length > 0) {
    const a = crypto.createHash('sha256').update(cleanPass).digest();
    const b = crypto.createHash('sha256').update(envPasscode).digest();
    if (!crypto.timingSafeEqual(a, b)) {
      return { success: false, message: 'Invalid owner passcode.' };
    }
    const email = isMasterAdminEmail(candidateEmail) ? candidateEmail : AUTHORIZED_ADMIN_EMAILS[0];
    const verifiedUser = buildOwnerSessionUser(email);
    return { success: true, token: issueServerSessionToken(verifiedUser), user: verifiedUser, message: 'Signed in via server owner passcode.' };
  }

  const claimed = adminStore.getOwnerPasscodeRecord();
  if (!claimed) {
    return { success: false, message: 'Owner passcode has not been set up yet. Complete first-run setup first.' };
  }

  const expectedBuf = Buffer.from(claimed.hash, 'hex');
  const actualBuf = hashPasscodeScrypt(cleanPass, claimed.salt);
  if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
    return { success: false, message: 'Invalid owner passcode.' };
  }

  const email = isMasterAdminEmail(candidateEmail) ? candidateEmail : claimed.email || AUTHORIZED_ADMIN_EMAILS[0];
  const verifiedUser = buildOwnerSessionUser(email);
  return { success: true, token: issueServerSessionToken(verifiedUser), user: verifiedUser, message: 'Signed in via owner passcode.' };
}

function buildOwnerSessionUser(email: string): VerifiedFirebaseUser {
  const safeEmail = email.trim().toLowerCase();
  const uid = `user_${safeEmail.replace(/[^a-z0-9_-]/g, '_')}`;
  return {
    uid,
    email: safeEmail,
    emailVerified: true,
    name: safeEmail.split('@')[0] || 'Owner',
    isAdmin: isMasterAdminEmail(safeEmail),
  };
}

function toBase64Url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function issueServerSessionToken(user: VerifiedFirebaseUser): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    uid: user.uid,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SEC,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sigB64 = toBase64Url(
    crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(payloadB64).digest()
  );
  return `${SESSION_TOKEN_PREFIX}${payloadB64}.${sigB64}`;
}

export function verifyServerSessionToken(token: string): VerifiedFirebaseUser {
  if (!token.startsWith(SESSION_TOKEN_PREFIX)) {
    throw new Error('Not a server session token');
  }
  const rest = token.slice(SESSION_TOKEN_PREFIX.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx <= 0) {
    throw new Error('Malformed server session token');
  }
  const payloadB64 = rest.slice(0, dotIdx);
  const sigB64 = rest.slice(dotIdx + 1);
  const expectedSig = crypto.createHmac('sha256', SESSION_SIGNING_SECRET).update(payloadB64).digest();
  const actualSig = decodeBase64UrlBuffer(sigB64);
  if (expectedSig.length !== actualSig.length || !crypto.timingSafeEqual(expectedSig, actualSig)) {
    throw new Error('Invalid session token signature');
  }
  const payload = decodeBase64UrlJson<{
    uid?: string;
    email?: string;
    name?: string;
    isAdmin?: boolean;
    exp?: number;
  }>(payloadB64);
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Session token has expired. Please sign in again.');
  }
  if (typeof payload.uid !== 'string' || !payload.uid.trim()) {
    throw new Error('Invalid session token subject');
  }
  const cleanEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined;
  return {
    uid: payload.uid.trim(),
    email: cleanEmail,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    isAdmin: Boolean(payload.isAdmin) && isMasterAdminEmail(cleanEmail),
  };
}

export interface VerifiedFirebaseUser {
  uid: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  isAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  authUser?: VerifiedFirebaseUser;
  adminEmail?: string;
}

let cachedProjectId: string | null = null;
function getFirebaseProjectId(): string {
  if (cachedProjectId) return cachedProjectId;
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (typeof parsed?.projectId === 'string' && parsed.projectId.trim()) {
        const projectId = parsed.projectId.trim();
        cachedProjectId = projectId;
        return projectId;
      }
    }
  } catch (err) {
    console.warn('[FirebaseAuth] Failed to read firebase-applet-config.json:', err);
  }
  return process.env.FIREBASE_PROJECT_ID || '';
}

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function getGooglePublicCerts(forceRefresh = false): Promise<Record<string, string>> {
  const now = Date.now();
  if (!forceRefresh && Object.keys(cachedCerts).length > 0 && now < certsExpiresAt) {
    return cachedCerts;
  }

  const res = await fetch(FIREBASE_CERTS_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Firebase public certs (HTTP ${res.status})`);
  }

  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Math.max(60, parseInt(maxAgeMatch[1], 10)) : 3600;

  cachedCerts = certs;
  certsExpiresAt = now + maxAgeSec * 1000;
  return cachedCerts;
}

function decodeBase64UrlJson<T = Record<string, unknown>>(segment: string): T {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const raw = Buffer.from(padded + '='.repeat(padLen), 'base64').toString('utf-8');
  return JSON.parse(raw) as T;
}

function decodeBase64UrlBuffer(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export function isMasterAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return AUTHORIZED_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

export async function verifyFirebaseIdToken(token: string): Promise<VerifiedFirebaseUser> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = decodeBase64UrlJson<{ alg?: string; kid?: string }>(headerB64);
  const payload = decodeBase64UrlJson<{
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  }>(payloadB64);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token algorithm or key ID');
  }

  const projectId = getFirebaseProjectId();
  if (!projectId) {
    throw new Error('Firebase projectId is not configured on server');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    throw new Error('Firebase ID token issued-at time is invalid');
  }
  if (payload.aud !== projectId) {
    throw new Error('Firebase ID token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Firebase ID token issuer mismatch');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token subject is missing or invalid');
  }

  let certs = await getGooglePublicCerts(false);
  let cert = certs[header.kid];
  if (!cert) {
    certs = await getGooglePublicCerts(true);
    cert = certs[header.kid];
  }
  if (!cert) {
    throw new Error('Unknown Firebase signing certificate');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signature = decodeBase64UrlBuffer(signatureB64);
  const valid = verifier.verify(cert, signature);
  if (!valid) {
    throw new Error('Invalid Firebase ID token signature');
  }

  const cleanEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined;
  const emailVerified = payload.email_verified === true;

  return {
    uid: payload.sub.trim(),
    email: cleanEmail,
    emailVerified,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    isAdmin: emailVerified && isMasterAdminEmail(cleanEmail),
  };
}

export async function verifyAuthToken(token: string): Promise<VerifiedFirebaseUser> {
  if (token.startsWith(SESSION_TOKEN_PREFIX)) {
    return verifyServerSessionToken(token);
  }
  return verifyFirebaseIdToken(token);
}

export function extractBearerToken(req: Request): string | null {
  const authHeader = String(req.headers['authorization'] || '');
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  return null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. Please sign in to continue.',
      });
      return;
    }
    const verified = await verifyAuthToken(token);
    req.authUser = verified;
    next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid authentication token';
    res.status(401).json({
      success: false,
      message: `Unauthorized: ${msg}`,
    });
  }
}

export function resolveAuthorizedTenantId(req: AuthenticatedRequest): string {
  const user = req.authUser;
  if (!user) {
    throw new Error('Unauthenticated tenant access');
  }

  const rawRequested = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
  const requested =
    typeof rawRequested === 'string' && rawRequested.trim() && rawRequested !== 'null' && rawRequested !== 'undefined'
      ? rawRequested.trim()
      : '';

  // Master Admins may inspect or manage any requested tenant
  if (user.isAdmin && requested) {
    return requested;
  }

  // Standard users may strictly access only their own UID or their own Business Bot tenant
  const ownBusinessTenant = `${user.uid}__business`;
  if (requested === ownBusinessTenant) {
    return ownBusinessTenant;
  }

  return user.uid;
}
