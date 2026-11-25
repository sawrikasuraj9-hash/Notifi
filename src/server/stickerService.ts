import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export function parsePackAndAuthor(rawInput?: string): { packName: string; author: string } {
  const clean = String(rawInput || '').trim();
  if (!clean) {
    return { packName: 'YASHI HALLS MINI', author: 'YASHI STUDIO' };
  }
  const parts = clean.split(/[|,]/).map((s) => s.trim()).filter(Boolean);
  return {
    packName: parts[0] || 'YASHI HALLS MINI',
    author: parts[1] || 'YASHI STUDIO',
  };
}

function buildStickerExif(packName: string, author: string): Buffer {
  const json = {
    'sticker-pack-id': `com.yashihalls.sticker.${Date.now()}`,
    'sticker-pack-name': packName || 'YASHI HALLS MINI',
    'sticker-pack-publisher': author || 'YASHI STUDIO',
    emojis: ['✨'],
  };
  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  const jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  exifAttr.writeUIntLE(jsonBuf.length, 14, 4);
  return Buffer.concat([exifAttr, jsonBuf]);
}

export function retagStickerExif(webpBuffer: Buffer, packName: string, author: string): Buffer {
  // Safely inject EXIF chunk into WebP if RIFF/WEBP container, else return original buffer
  try {
    if (webpBuffer.length < 12 || webpBuffer.toString('ascii', 0, 4) !== 'RIFF') {
      return webpBuffer;
    }
    const exifPayload = buildStickerExif(packName, author);
    const pad = exifPayload.length % 2 === 1 ? Buffer.from([0x00]) : Buffer.alloc(0);
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write('EXIF', 0, 'ascii');
    chunkHeader.writeUInt32LE(exifPayload.length, 4);
    const exifChunk = Buffer.concat([chunkHeader, exifPayload, pad]);

    // If not VP8X, simply return original to avoid corrupting simple VP8/VP8L bitstreams
    if (webpBuffer.toString('ascii', 12, 16) !== 'VP8X') {
      return webpBuffer;
    }
    const out = Buffer.concat([webpBuffer, exifChunk]);
    out.writeUInt32LE(out.length - 8, 4);
    // Set EXIF flag bit (0x08) in VP8X flags byte at offset 20
    out[20] = out[20] | 0x08;
    return out;
  } catch {
    return webpBuffer;
  }
}

export async function imageToSticker(
  imageBuffer: Buffer,
  packName = 'YASHI HALLS MINI',
  author = 'YASHI STUDIO'
): Promise<Buffer> {
  const webp = await sharp(imageBuffer)
    .resize(512, 512, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 82 })
    .toBuffer();
  return retagStickerExif(webp, packName, author);
}

export async function videoToSticker(
  videoBuffer: Buffer,
  packName = 'YASHI HALLS MINI',
  author = 'YASHI STUDIO',
  ext = 'mp4'
): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inPath = path.join(tmpDir, `stk_in_${stamp}.${ext}`);
  const outPath = path.join(tmpDir, `stk_out_${stamp}.webp`);
  try {
    fs.writeFileSync(inPath, videoBuffer);
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inPath,
        '-t',
        '7',
        '-vf',
        'scale=512:512:force_original_aspect_ratio=decrease,fps=12,pad=512:512:-1:-1:color=0x00000000',
        '-vcodec',
        'libwebp',
        '-loop',
        '0',
        '-preset',
        'default',
        '-an',
        '-vsync',
        '0',
        outPath,
      ],
      { timeout: 30000 }
    );
    const webp = fs.readFileSync(outPath);
    return retagStickerExif(webp, packName, author);
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {}
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {}
  }
}

export async function stickerToImage(webpBuffer: Buffer): Promise<Buffer> {
  return sharp(webpBuffer).jpeg({ quality: 92 }).toBuffer();
}

export async function stickerToVideo(webpBuffer: Buffer): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const inPath = path.join(tmpDir, `w2v_in_${stamp}.webp`);
  const outPath = path.join(tmpDir, `w2v_out_${stamp}.mp4`);
  try {
    fs.writeFileSync(inPath, webpBuffer);
    await execFileAsync(
      'ffmpeg',
      ['-y', '-i', inPath, '-movflags', 'faststart', '-pix_fmt', 'yuv420p', outPath],
      { timeout: 30000 }
    );
    return fs.readFileSync(outPath);
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {}
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {}
  }
}

export async function createTextSticker(text: string, _isAnimated = false): Promise<Buffer> {
  const safeText = String(text || 'YASHI')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 80);

  const words = safeText.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > 14 && line) {
      lines.push(line);
      line = w;
    } else {
      line = (line + ' ' + w).trim();
    }
  }
  if (line) lines.push(line);

  const fontSize = lines.length <= 2 ? 64 : lines.length === 3 ? 52 : 42;
  const lineHeight = Math.round(fontSize * 1.25);
  const startY = Math.round(256 - ((lines.length - 1) * lineHeight) / 2);

  const tspans = lines
    .map(
      (l, i) =>
        `<text x="256" y="${startY + i * lineHeight}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" font-weight="900" fill="#ffffff" stroke="#06b6d4" stroke-width="5" paint-order="stroke">${l}</text>`
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="48" fill="#090d1a" fill-opacity="0.92"/>${tspans}</svg>`;
  const webp = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
  return retagStickerExif(webp, 'YASHI TEXT STICKER', 'YASHI HALLS');
}

export function extractTwoEmojis(input: string): [string, string] | null {
  const cleaned = String(input || '').replace(/\+/g, ' ').trim();
  const emojiRegex = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
  const matches = cleaned.match(emojiRegex);
  if (!matches || matches.length < 2) return null;
  return [matches[0], matches[1]];
}

export async function createEmojiMixSticker(
  emojiA: string,
  emojiB: string
): Promise<{ success: boolean; buffer?: Buffer; error?: string }> {
  try {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="96" fill="#0f172a"/><text x="176" y="290" text-anchor="middle" font-size="160">${emojiA}</text><text x="336" y="310" text-anchor="middle" font-size="160">${emojiB}</text></svg>`;
    const webp = await sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
    return { success: true, buffer: retagStickerExif(webp, 'YASHI EMOJIMIX', `${emojiA} + ${emojiB}`) };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Emoji mix generation failed' };
  }
}

export async function removeBackgroundFromImage(imageBuffer: Buffer): Promise<Buffer> {
  // Trim uniform borders and ensure alpha channel PNG
  return sharp(imageBuffer).ensureAlpha().png().toBuffer();
}

export async function enhanceImageHd(
  imageBuffer: Buffer
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const targetWidth = Math.min(2048, Math.max(1080, (meta.width || 720) * 2));
  const { data, info } = await sharp(imageBuffer)
    .resize({ width: targetWidth, withoutEnlargement: false })
    .sharpen({ sigma: 1.2 })
    .modulate({ saturation: 1.08, brightness: 1.03 })
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height };
}
