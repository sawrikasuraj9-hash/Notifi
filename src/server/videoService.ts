import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ensureYtDlpBinary, searchYoutubeVideo } from './audioService';

const execFileAsync = promisify(execFile);
const TMP_DIR = path.resolve(os.tmpdir(), 'yashi_video_tmp');

export type VideoQualityFlag = 'sd' | 'hd' | '360p' | '480p' | '720p' | '1080p';

export interface VideoResolveResult {
  success: boolean;
  buffer?: Buffer;
  videoUrl?: string;
  isDirectDownloadable?: boolean;
  title?: string;
  quality?: string;
  fileSizeStr?: string;
  thumbnailUrl?: string;
  duration?: string;
  error?: string;
}

export interface MediaPreviewResult {
  title: string;
  thumbnailUrl?: string;
  duration?: string;
  author?: string;
  sourceUrl?: string;
}

export function extractMediaQualityFlag(rawArgs: string): {
  cleanQuery: string;
  quality: VideoQualityFlag;
} {
  const input = String(rawArgs || '').trim();
  const match = input.match(/\b(1080p|720p|480p|360p|hd|sd)\b/i);
  if (match) {
    const flag = match[1].toLowerCase() as VideoQualityFlag;
    const cleanQuery = input.replace(match[0], '').replace(/\s+/g, ' ').trim();
    return { cleanQuery, quality: flag };
  }
  return { cleanQuery: input, quality: '720p' };
}

export async function previewMediaForCard(
  queryOrUrl: string,
  platformLabel = 'Video'
): Promise<MediaPreviewResult> {
  const clean = String(queryOrUrl || '').trim();
  if (!clean) return { title: `${platformLabel} Media` };
  if (!/^https?:\/\//i.test(clean) || /youtu\.?be/i.test(clean)) {
    const yt = await searchYoutubeVideo(clean);
    if (yt) {
      return {
        title: yt.title,
        thumbnailUrl: yt.thumbnail,
        duration: yt.duration,
        author: yt.author,
        sourceUrl: yt.url,
      };
    }
  }
  return {
    title: `${platformLabel} Media`,
    sourceUrl: /^https?:\/\//i.test(clean) ? clean : undefined,
  };
}

export async function resolveVideo(
  queryOrUrl: string,
  quality: VideoQualityFlag = '720p'
): Promise<VideoResolveResult> {
  const clean = String(queryOrUrl || '').trim();
  if (!clean) {
    return { success: false, error: 'Please provide a video URL or search query.' };
  }

  let targetUrl = clean;
  let title = 'Video';
  let thumbnailUrl: string | undefined;

  if (!/^https?:\/\//i.test(clean)) {
    const yt = await searchYoutubeVideo(clean);
    if (!yt) {
      return { success: false, error: `No video found for "${clean}".` };
    }
    targetUrl = yt.url;
    title = yt.title;
    thumbnailUrl = yt.thumbnail;
  }

  const ytDlp = await ensureYtDlpBinary();
  if (!ytDlp) {
    return {
      success: false,
      title,
      thumbnailUrl,
      error: 'yt-dlp binary is not available on this server.',
    };
  }

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const maxHeight =
    quality === '360p' || quality === 'sd'
      ? 360
      : quality === '480p'
      ? 480
      : quality === '1080p'
      ? 1080
      : 720;

  const outBase = path.join(TMP_DIR, `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const outTemplate = `${outBase}.%(ext)s`;

  try {
    await execFileAsync(
      ytDlp,
      [
        '-f',
        `best[height<=${maxHeight}][ext=mp4]/best[ext=mp4]/best`,
        '--no-playlist',
        '--max-filesize',
        '64M',
        '-o',
        outTemplate,
        targetUrl,
      ],
      { timeout: 120000 }
    );

    const files = fs.readdirSync(TMP_DIR).filter((f) => f.startsWith(path.basename(outBase)));
    if (files.length === 0) {
      return { success: false, error: 'Video download produced no output file.' };
    }
    const produced = path.join(TMP_DIR, files[0]);
    const buffer = fs.readFileSync(produced);
    try {
      fs.unlinkSync(produced);
    } catch {}

    return {
      success: true,
      buffer,
      title,
      quality: `${maxHeight}p`,
      fileSizeStr: `${(buffer.length / (1024 * 1024)).toFixed(2)} MB`,
      thumbnailUrl,
      isDirectDownloadable: false,
    };
  } catch (err: any) {
    return {
      success: false,
      title,
      thumbnailUrl,
      error: err?.message || 'Failed to download video.',
    };
  }
}
