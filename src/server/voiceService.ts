import fs from 'fs';
import path from 'path';

const VOICE_DIR = path.resolve(process.cwd(), 'data', 'voice_replies');

function ensureVoiceDir(): void {
  if (!fs.existsSync(VOICE_DIR)) {
    fs.mkdirSync(VOICE_DIR, { recursive: true });
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx++;
  }
  return `${val >= 10 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

function inferMimeType(fileNameOrPath: string): string {
  const ext = path.extname(fileNameOrPath).toLowerCase();
  if (ext === '.ogg' || ext === '.opus') return 'audio/ogg; codecs=opus';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.aac') return 'audio/aac';
  if (ext === '.webm') return 'audio/webm';
  return 'audio/mpeg';
}

export function validateAudioBuffer(
  buffer: Buffer,
  fileName: string
): { valid: boolean; error?: string } {
  if (!buffer || buffer.length === 0) {
    return { valid: false, error: 'Audio file is empty.' };
  }
  const maxBytes = 15 * 1024 * 1024; // 15 MB
  if (buffer.length > maxBytes) {
    return { valid: false, error: 'Audio file exceeds maximum size of 15 MB.' };
  }
  const ext = path.extname(fileName || '').toLowerCase();
  const allowed = ['.mp3', '.ogg', '.opus', '.m4a', '.wav', '.aac', '.webm', '.mp4'];
  if (ext && !allowed.includes(ext)) {
    return { valid: false, error: `Unsupported audio extension "${ext}". Allowed: ${allowed.join(', ')}` };
  }
  return { valid: true };
}

export async function saveAudioFile(
  buffer: Buffer,
  originalFileName: string,
  prefixId = `vr_${Date.now()}`
): Promise<{ fileName: string; filePath: string; mimeType: string; size: number }> {
  ensureVoiceDir();
  const ext = path.extname(originalFileName || '.mp3').toLowerCase() || '.mp3';
  const safeBase = path
    .basename(originalFileName || 'voice', ext)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 48);
  const fileName = `${prefixId}_${safeBase}${ext}`;
  const filePath = path.resolve(VOICE_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return {
    fileName,
    filePath,
    mimeType: inferMimeType(fileName),
    size: buffer.length,
  };
}

export function deleteAudioFile(audioPath?: string): boolean {
  if (!audioPath) return false;
  try {
    const resolved = path.isAbsolute(audioPath)
      ? audioPath
      : path.resolve(VOICE_DIR, path.basename(audioPath));
    if (resolved.startsWith(VOICE_DIR) && fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
      return true;
    }
  } catch {
    // ignore cleanup error
  }
  return false;
}

export function getAudioFileStream(
  audioPath?: string
): { filePath: string; mimeType: string } | null {
  if (!audioPath) return null;
  const candidates = [
    audioPath,
    path.resolve(process.cwd(), audioPath),
    path.resolve(VOICE_DIR, path.basename(audioPath)),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return {
          filePath: candidate,
          mimeType: inferMimeType(candidate),
        };
      }
    } catch {
      // continue
    }
  }
  return null;
}

export async function getWhatsAppVoiceBuffer(
  audioPath?: string
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const info = getAudioFileStream(audioPath);
  if (!info) return null;
  try {
    const buffer = fs.readFileSync(info.filePath);
    if (!buffer.length) return null;
    const ext = path.extname(info.filePath).toLowerCase();
    const mimeType =
      ext === '.opus' || ext === '.ogg' ? 'audio/ogg; codecs=opus' : 'audio/mpeg';
    return { buffer, mimeType };
  } catch {
    return null;
  }
}

export async function seedDefaultVoiceFiles(): Promise<{
  hi: string;
  morning: string;
  night: string;
  howAreYou: string;
}> {
  ensureVoiceDir();
  const findExisting = (patterns: string[], fallbackName: string): string => {
    try {
      const files = fs.readdirSync(VOICE_DIR);
      for (const pat of patterns) {
        const match = files.find((f) => f.toLowerCase().startsWith(pat.toLowerCase()));
        if (match) return path.resolve(VOICE_DIR, match);
      }
    } catch {
      // ignore
    }
    const target = path.resolve(VOICE_DIR, fallbackName);
    if (!fs.existsSync(target)) {
      // Minimal valid silent MP3 frame placeholder if no seed file exists
      fs.writeFileSync(target, Buffer.alloc(0));
    }
    return target;
  };

  return {
    hi: findExisting(['hi_', 'hello_', 'seed_hi'], 'seed_hi.mp3'),
    morning: findExisting(['good_morning_', 'gm_', 'seed_good_morning'], 'seed_good_morning.mp3'),
    night: findExisting(['good_night_', 'gn_', 'seed_good_night'], 'seed_good_night.mp3'),
    howAreYou: findExisting(['kohomada_', 'how_are_you', 'seed_how_are_you'], 'seed_how_are_you.mp3'),
  };
}
