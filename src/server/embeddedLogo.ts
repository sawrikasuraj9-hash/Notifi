import fs from 'fs';
import path from 'path';

const FALLBACK_LOGO_SVG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#8b5cf6"/></linearGradient></defs><rect width="128" height="128" rx="28" fill="#090d1a"/><circle cx="64" cy="64" r="46" fill="url(#g)" opacity="0.22"/><text x="64" y="76" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="900" fill="#e2e8f0">YH</text></svg>`
  ).toString('base64');

const FALLBACK_HEADER_BG_SVG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 240"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0f172a"/><stop offset="50%" stop-color="#1e1035"/><stop offset="100%" stop-color="#042f2e"/></linearGradient></defs><rect width="800" height="240" fill="url(#bg)"/></svg>`
  ).toString('base64');

function loadImageAsDataUri(candidates: string[], fallback: string): string {
  for (const rel of candidates) {
    try {
      const fullPath = path.resolve(process.cwd(), rel);
      if (fs.existsSync(fullPath)) {
        const ext = path.extname(fullPath).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.webp'
            ? 'image/webp'
            : ext === '.svg'
            ? 'image/svg+xml'
            : 'image/jpeg';
        const buf = fs.readFileSync(fullPath);
        if (buf.length > 0) {
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      }
    } catch {
      // try next candidate
    }
  }
  return fallback;
}

export const EMBEDDED_BRAND_LOGO_BASE64: string = loadImageAsDataUri(
  ['data/bot_logo_opt.jpg', 'data/bot_logo.png', 'data/bot_logo.jpg'],
  FALLBACK_LOGO_SVG
);

export const EMBEDDED_HEADER_BG_BASE64: string = loadImageAsDataUri(
  ['data/bot_header_banner.png', 'data/main_menu_card_opt.png', 'data/bot_logo_opt.jpg'],
  FALLBACK_HEADER_BG_SVG
);
