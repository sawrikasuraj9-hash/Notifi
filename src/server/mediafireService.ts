export interface MediaFireResolveResult {
  success: boolean;
  downloadUrl?: string;
  fileName?: string;
  fileSize?: string;
  mimeType?: string;
  error?: string;
}

export async function resolveMediaFire(url: string): Promise<MediaFireResolveResult> {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl || !/mediafire\.com/i.test(cleanUrl)) {
    return { success: false, error: 'Invalid MediaFire URL.' };
  }

  try {
    const resp = await fetch(cleanUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      return { success: false, error: `MediaFire returned HTTP ${resp.status}` };
    }

    const html = await resp.text();
    const linkMatch =
      html.match(/aria-label="Download file"[^>]*href="(https?:\/\/download[^"]+)"/i) ||
      html.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i);

    if (!linkMatch || !linkMatch[1]) {
      return { success: false, error: 'Could not extract direct download link from MediaFire page.' };
    }

    const downloadUrl = linkMatch[1];
    const urlFileName = decodeURIComponent(downloadUrl.split('/').pop() || 'mediafire_file');
    const titleMatch = html.match(/<div class="dl-btn-label"[^>]*title="([^"]+)"/i);
    const fileName = (titleMatch?.[1] || urlFileName).trim();

    const sizeMatch = html.match(/Download\s*\(([0-9.]+\s*(?:GB|MB|KB|B))\)/i);
    const fileSize = sizeMatch ? sizeMatch[1] : 'Unknown';

    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const mimeMap: Record<string, string> = {
      apk: 'application/vnd.android.package-archive',
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      pdf: 'application/pdf',
      mp4: 'video/mp4',
      mp3: 'audio/mpeg',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
    };

    return {
      success: true,
      downloadUrl,
      fileName,
      fileSize,
      mimeType: mimeMap[ext] || 'application/octet-stream',
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Failed to reach MediaFire.',
    };
  }
}
