import fs from 'fs';
import os from 'os';
import path from 'path';

export interface MovieMirror {
  label: string;
  quality: string;
  size: string;
  url: string;
}

export interface MovieSearchItem {
  id: string;
  title: string;
  year?: string;
  rating?: string;
  language?: string;
  genres?: string[];
  synopsis?: string;
  posterUrl?: string;
  pageUrl?: string;
  downloads: MovieMirror[];
}

export interface FilmSetItem {
  name: string;
  movies: string[];
}

export interface MovieDownloadProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
  quality?: string;
}

const TMP_DIR = path.resolve(os.tmpdir(), 'yashi_movies_tmp');

export function formatBytesSize(bytes: number): string {
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

export async function cleanupStaleMovieTempFiles(): Promise<void> {
  try {
    if (!fs.existsSync(TMP_DIR)) return;
    const cutoff = Date.now() - 45 * 60 * 1000;
    for (const entry of fs.readdirSync(TMP_DIR)) {
      const full = path.join(TMP_DIR, entry);
      try {
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(full);
      } catch {}
    }
  } catch {}
}

export function extractMovieQualityFlag(rawQuery: string): {
  cleanQuery: string;
  preferredQuality?: string;
} {
  const input = String(rawQuery || '').trim();
  const match = input.match(/\b(1080p|720p|480p|360p|hd|sd)\b/i);
  if (match) {
    return {
      cleanQuery: input.replace(match[0], '').replace(/\s+/g, ' ').trim(),
      preferredQuality: match[1].toLowerCase(),
    };
  }
  return { cleanQuery: input };
}

const KNOWN_FILM_SETS: Record<string, FilmSetItem> = {
  avengers: {
    name: 'The Avengers Collection',
    movies: ['The Avengers (2012)', 'Avengers: Age of Ultron (2015)', 'Avengers: Infinity War (2018)', 'Avengers: Endgame (2019)'],
  },
  'harry potter': {
    name: 'Harry Potter Complete Series',
    movies: [
      'Harry Potter 1 - Philosophers Stone',
      'Harry Potter 2 - Chamber of Secrets',
      'Harry Potter 3 - Prisoner of Azkaban',
      'Harry Potter 4 - Goblet of Fire',
      'Harry Potter 5 - Order of the Phoenix',
      'Harry Potter 6 - Half-Blood Prince',
      'Harry Potter 7 - Deathly Hallows Part 1',
      'Harry Potter 8 - Deathly Hallows Part 2',
    ],
  },
  'fast and furious': {
    name: 'Fast & Furious Saga',
    movies: ['The Fast and the Furious', '2 Fast 2 Furious', 'Tokyo Drift', 'Fast Five', 'Furious 7', 'Fast X'],
  },
};

export function searchFilmSets(query: string): FilmSetItem | null {
  const lower = String(query || '').trim().toLowerCase();
  if (!lower) return null;
  for (const [key, set] of Object.entries(KNOWN_FILM_SETS)) {
    if (lower === key || lower === `${key} set` || lower === `${key} collection`) {
      return set;
    }
  }
  return null;
}

export function formatFilmSetCard(set: FilmSetItem, prefix = '.'): string {
  const lines = set.movies.map((m, idx) => `${idx + 1}. \`${prefix}film ${m}\``);
  return `🎬 *${set.name}*\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n_Tap & copy any command above to download!_`;
}

export async function searchMovies(
  _query: string,
  _onlyDub = false,
  _preferredQuality?: string
): Promise<MovieSearchItem[]> {
  return [];
}

export function formatMovieCard(movie: MovieSearchItem, prefix = '.'): string {
  return [
    `🎬 *${movie.title}*${movie.year ? ` (${movie.year})` : ''}`,
    movie.rating ? `⭐ *Rating:* ${movie.rating}` : '',
    movie.language ? `🗣️ *Language:* ${movie.language}` : '',
    movie.synopsis ? `📝 ${movie.synopsis.slice(0, 220)}` : '',
    `💡 Use \`${prefix}film ${movie.title}\``,
  ]
    .filter(Boolean)
    .join('\n');
}

export async function downloadMovieFileWithFallback(
  mirrors: MovieMirror[],
  title: string,
  _cookie?: string,
  onProgress?: (prog: MovieDownloadProgress) => void
): Promise<{ success: boolean; filePath?: string; fileName?: string; sizeBytes?: number; error?: string }> {
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    return { success: false, error: 'No download mirrors available.' };
  }
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

  for (const mirror of mirrors) {
    if (!mirror?.url) continue;
    try {
      const resp = await fetch(mirror.url, { redirect: 'follow' });
      if (!resp.ok || !resp.body) continue;

      const totalBytes = Number(resp.headers.get('content-length') || 0);
      const safeName = `${String(title || 'movie').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 48)}.mp4`;
      const filePath = path.join(TMP_DIR, `${Date.now()}_${safeName}`);
      const writer = fs.createWriteStream(filePath);
      const reader = resp.body.getReader();

      let downloadedBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          writer.write(Buffer.from(value));
          downloadedBytes += value.length;
          if (onProgress) {
            const percent = totalBytes > 0 ? Math.min(99, Math.round((downloadedBytes / totalBytes) * 100)) : 50;
            onProgress({ percent, downloadedBytes, totalBytes, quality: mirror.quality });
          }
        }
      }
      await new Promise<void>((resolve, reject) => {
        writer.end(() => resolve());
        writer.on('error', reject);
      });

      return { success: true, filePath, fileName: safeName, sizeBytes: downloadedBytes };
    } catch {
      // try next mirror
    }
  }
  return { success: false, error: 'All movie download mirrors failed.' };
}

export async function searchAndDownloadSubtitle(
  query: string
): Promise<{ success: boolean; buffer?: Buffer; fileName?: string; title?: string; error?: string }> {
  return {
    success: false,
    title: query,
    error: `Sinhala subtitle not found right now for "${query}".`,
  };
}

export async function fetchPosterAsDataUri(url?: string): Promise<string> {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return '';
    const mime = resp.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length || buf.length > 2 * 1024 * 1024) return '';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return '';
  }
}
