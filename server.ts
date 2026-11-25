// Filter transient libsignal Signal session renegotiation noise (auto-recovered by Baileys retry receipts)
const _origConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const first = String(args[0] ?? '');
  if (
    first.includes('Failed to decrypt message with any known session') ||
    first.includes('Session error:Error: Bad MAC') ||
    first.includes('Session error: Error: Bad MAC')
  ) {
    return;
  }
  _origConsoleError(...args);
};

process.on('uncaughtException', (err: Error) => {
  console.error('[SERVER SAFEGUARD] Uncaught Exception:', err?.stack || err?.message || err);
});

process.on('unhandledRejection', (reason: unknown) => {
  const detail = reason instanceof Error ? reason.stack || reason.message : String(reason);
  console.error('[SERVER SAFEGUARD] Unhandled Rejection:', detail);
});

import { startServer } from './src/server/appServer';

startServer().catch((err: unknown) => {
  console.error('Fatal Server Error:', err);
});
