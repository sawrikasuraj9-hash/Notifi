import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
// @ts-ignore - yt-search ships without bundled TypeScript declarations
import ytSearch from 'yt-search';

const execFileAsync = promisify(execFile);
const TMP_DIR = path.resolve(os.tmpdir(), 'yashi_audio_tmp');

export interface SongAudioResult {
  success: boolean;
  buffer?: Buffer;
  fileName?: string;
  title?: string;
  artist?: string;
  duration?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  fileSizeStr?: string;
  error?: string;
}

export interface YoutubeSearchResult {
  title: string;
  url: string;
  videoId: string;
  duration: string;
  views: number;
  author: string;
  thumbnail: string;
  description: string;
}

export interface SongPreviewInfo {
  title: string;
  artist?: string;
  duration?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
}

let resolvedYtDlpPath: string | null = null;

export async function ensureYtDlpBinary(): Promise<string | null> {
  if (resolvedYtDlpPath && fs.existsSync(resolvedYtDlpPath)) {
    return resolvedYtDlpPath;
  }
  const candidates = [
    path.resolve(process.cwd(), 'bin', 'yt-dlp'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    'yt-dlp',
  ];
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 4000 });
      resolvedYtDlpPath = bin;
      return bin;
    } catch {
      // try next
    }
  }
  return null;
}

export function cleanStaleTempFiles(): void {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const entry of fs.readdirSync(TMP_DIR)) {
      const full = path.join(TMP_DIR, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(full);
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export async function searchYoutubeVideo(query: string): Promise<YoutubeSearchResult | null> {
  try {
    const res = await ytSearch(query);
    const first = res?.videos?.[0];
    if (!first) return null;
    return {
      title: first.title || query,
      url: first.url,
      videoId: first.videoId,
      duration: first.timestamp || '0:00',
      views: first.views || 0,
      author: first.author?.name || 'YouTube',
      thumbnail: first.thumbnail || first.image || '',
      description: first.description || '',
    };
  } catch {
    return null;
  }
}

export async function previewSongInfo(queryOrUrl: string): Promise<SongPreviewInfo> {
  const clean = String(queryOrUrl || '').trim();
  if (!clean) return { title: 'Unknown Track' };
  const yt = await searchYoutubeVideo(clean);
  if (yt) {
    return {
      title: yt.title,
      artist: yt.author,
      duration: yt.duration,
      thumbnailUrl: yt.thumbnail,
      sourceUrl: yt.url,
    };
  }
  return { title: clean };
}

export async function resolveSongAudio(queryOrUrl: string): Promise<SongAudioResult> {
  const clean = String(queryOrUrl || '').trim();
  if (!clean) {
    return { success: false, error: 'Please provide a song name or YouTube URL.' };
  }

  let targetUrl = clean;
  let meta: SongPreviewInfo = { title: clean };

  if (!/^https?:\/\//i.test(clean)) {
    const found = await searchYoutubeVideo(clean);
    if (!found) {
      return { success: false, error: `No song found for "${clean}".` };
    }
    targetUrl = found.url;
    meta = {
      title: found.title,
      artist: found.author,
      duration: found.duration,
      thumbnailUrl: found.thumbnail,
      sourceUrl: found.url,
    };
  } else {
    meta = await previewSongInfo(clean).catch(() => ({ title: 'Audio Track', sourceUrl: clean }));
  }

  const ytDlp = await ensureYtDlpBinary();
  if (!ytDlp) {
    return {
      success: false,
      title: meta.title,
      sourceUrl: targetUrl,
      thumbnailUrl: meta.thumbnailUrl,
      error: 'yt-dlp binary is not installed in this container.',
    };
  }

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }

  const outBase = path.join(TMP_DIR, `song_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const outTemplate = `${outBase}.%(ext)s`;

  try {
    await execFileAsync(
      ytDlp,
      [
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '128K',
        '--no-playlist',
        '--max-filesize',
        '45M',
        '-o',
        outTemplate,
        targetUrl,
      ],
      { timeout: 90000 }
    );

    const files = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(path.basename(outBase)));
    if (files.length === 0) {
      return { success: false, error: 'Audio extraction completed but output file was not created.' };
    }
    const produced = path.join(TMP_DIR, files[0]);
    const buffer = fs.readFileSync(produced);
    try {
      fs.unlinkSync(produced);
    } catch {
      // ignore
    }

    const safeTitle = (meta.title || 'song').replace(/[/\\?%*:|"<>]/g, '').trim() || 'song';
    return {
      success: true,
      buffer,
      fileName: `${safeTitle}.mp3`,
      title: meta.title || safeTitle,
      artist: meta.artist,
      duration: meta.duration,
      thumbnailUrl: meta.thumbnailUrl,
      sourceUrl: targetUrl,
      fileSizeStr: `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
    };
  } catch (err: any) {
    return {
      success: false,
      title: meta.title,
      sourceUrl: targetUrl,
      error: err?.message || 'Failed to download audio stream.',
    };
  }
}
