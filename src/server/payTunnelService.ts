import fs from 'fs';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';

export interface PayTunnelState {
  active: boolean;
  url: string | null;
  status: 'disabled' | 'starting' | 'connected' | 'error';
  error?: string;
  startedAt?: string;
}

const BIN_DIR = path.resolve(process.cwd(), 'data', 'bin');
const CLOUDFLARED_PATH = path.resolve(BIN_DIR, 'cloudflared');

let tunnelProc: ChildProcess | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let isShuttingDown = false;
let currentPort = 3000;
let startPromise: Promise<string | null> | null = null;
let tunnelState: PayTunnelState = {
  active: false,
  url: null,
  status: 'disabled',
};

export function isPreviewAuthGatedOrigin(origin?: string): boolean {
  const clean = String(origin || process.env.APP_URL || '').trim().toLowerCase();
  if (!clean) return true;
  if (clean.includes('ais-dev-')) return true;
  if (clean.includes('localhost') || clean.includes('127.0.0.1') || clean.includes('0.0.0.0')) {
    return true;
  }
  return false;
}

export function getPayTunnelState(): PayTunnelState {
  return { ...tunnelState };
}

export function getActivePayTunnelUrl(): string | null {
  return tunnelState.active && tunnelState.url ? tunnelState.url : null;
}

async function ensureCloudflaredBinary(): Promise<string | null> {
  if (fs.existsSync(CLOUDFLARED_PATH)) {
    try {
      fs.chmodSync(CLOUDFLARED_PATH, 0o755);
    } catch {}
    return CLOUDFLARED_PATH;
  }

  try {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    const dlUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
    const res = await fetch(dlUrl, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (!res.ok) {
      throw new Error(`Download failed with HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const tmpPath = `${CLOUDFLARED_PATH}.tmp`;
    fs.writeFileSync(tmpPath, buf);
    fs.chmodSync(tmpPath, 0o755);
    fs.renameSync(tmpPath, CLOUDFLARED_PATH);
    return CLOUDFLARED_PATH;
  } catch (err: any) {
    tunnelState = {
      active: false,
      url: null,
      status: 'error',
      error: err?.message || 'Failed to prepare cloudflared binary',
    };
    return null;
  }
}

function startTunnelProcess(): Promise<string | null> {
  if (tunnelState.active && tunnelState.url && tunnelProc && !tunnelProc.killed) {
    return Promise.resolve(tunnelState.url);
  }
  if (startPromise) return startPromise;

  startPromise = (async () => {
    tunnelState = {
      active: false,
      url: null,
      status: 'starting',
    };

    const bin = await ensureCloudflaredBinary();
    if (!bin) {
      startPromise = null;
      return null;
    }

    return new Promise<string | null>((resolve) => {
      let resolved = false;
      const done = (val: string | null) => {
        if (!resolved) {
          resolved = true;
          startPromise = null;
          resolve(val);
        }
      };

      try {
        const proc = spawn(
          bin,
          ['tunnel', '--url', `http://127.0.0.1:${currentPort}`, '--protocol', 'http2', '--no-autoupdate'],
          { stdio: ['ignore', 'pipe', 'pipe'] }
        );
        tunnelProc = proc;

        const handleOutput = (chunk: Buffer) => {
          const text = chunk.toString('utf8');
          const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
          if (match && !tunnelState.url) {
            const foundUrl = match[0];
            tunnelState = {
              active: true,
              url: foundUrl,
              status: 'connected',
              startedAt: new Date().toISOString(),
            };
            console.log(`🌐 [PAY PREVIEW BRIDGE] Public Android Pay URL active: ${foundUrl}`);
            done(foundUrl);
          }
        };

        proc.stdout?.on('data', handleOutput);
        proc.stderr?.on('data', handleOutput);

        proc.on('error', (err) => {
          tunnelState = {
            active: false,
            url: null,
            status: 'error',
            error: err?.message || 'Tunnel process error',
          };
          done(null);
        });

        proc.on('exit', () => {
          if (tunnelProc === proc) {
            tunnelProc = null;
          }
          tunnelState = {
            active: false,
            url: null,
            status: isShuttingDown ? 'disabled' : 'starting',
          };
          done(null);

          if (!isShuttingDown && !restartTimer && isPreviewAuthGatedOrigin()) {
            restartTimer = setTimeout(() => {
              restartTimer = null;
              void startTunnelProcess();
            }, 5000);
          }
        });

        setTimeout(() => {
          if (!resolved) {
            done(tunnelState.url);
          }
        }, 12000);
      } catch (err: any) {
        tunnelState = {
          active: false,
          url: null,
          status: 'error',
          error: err?.message || 'Failed to spawn cloudflared',
        };
        done(null);
      }
    });
  })();

  return startPromise;
}

export function initPayPreviewTunnel(port = 3000): void {
  currentPort = port;
  if (!isPreviewAuthGatedOrigin(process.env.APP_URL)) {
    tunnelState = { active: false, url: null, status: 'disabled' };
    return;
  }

  const cleanup = () => {
    isShuttingDown = true;
    if (restartTimer) clearTimeout(restartTimer);
    if (tunnelProc && !tunnelProc.killed) {
      try {
        tunnelProc.kill();
      } catch {}
    }
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  void startTunnelProcess();
}

export async function ensurePayPreviewTunnel(waitMs = 7000): Promise<string | null> {
  if (!isPreviewAuthGatedOrigin(process.env.APP_URL)) {
    return null;
  }
  if (tunnelState.active && tunnelState.url) {
    return tunnelState.url;
  }
  const promise = startTunnelProcess();
  const timeout = new Promise<string | null>((resolve) =>
    setTimeout(() => resolve(tunnelState.url), waitMs)
  );
  return Promise.race([promise, timeout]);
}
