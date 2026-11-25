export interface ResolvedImageResult {
  success: boolean;
  buffer?: Buffer;
  mimeType?: string;
  sourceUrl?: string;
  title?: string;
  width?: number;
  height?: number;
  error?: string;
}

const IMAGE_ENGINE_UA = 'YashiHallsBot/2.0 (image-engine)';

async function downloadImageCandidate(
  candidateUrl: string,
  title: string,
  width = 1280,
  height = 720,
  minBytes = 1024
): Promise<ResolvedImageResult | null> {
  if (!candidateUrl || !candidateUrl.startsWith('http')) return null;
  const downloadRes = await fetch(candidateUrl, {
    headers: { 'User-Agent': IMAGE_ENGINE_UA },
  });
  if (!downloadRes.ok) return null;

  const contentType = downloadRes.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return null;

  const arrayBuf = await downloadRes.arrayBuffer();
  const buffer = Buffer.from(arrayBuf);
  if (buffer.length <= minBytes) return null;

  return {
    success: true,
    buffer,
    mimeType: contentType,
    sourceUrl: candidateUrl,
    title,
    width,
    height,
  };
}

export async function resolveSearchImage(query: string): Promise<ResolvedImageResult> {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return { success: false, error: 'Query is empty' };
  }

  try {
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanQuery)}`,
      { headers: { 'User-Agent': IMAGE_ENGINE_UA, Accept: 'application/json' } }
    );
    if (summaryRes.ok) {
      const summaryData = (await summaryRes.json()) as any;
      const candidateUrl = summaryData.originalimage?.source || summaryData.thumbnail?.source;
      const resolved = await downloadImageCandidate(
        candidateUrl,
        summaryData.title || cleanQuery,
        summaryData.originalimage?.width || 1280,
        summaryData.originalimage?.height || 720
      );
      if (resolved) return resolved;
    }
  } catch {
    // Fall through to Wikipedia search
  }

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanQuery
    )}&format=json&srlimit=1`;
    const sRes = await fetch(searchUrl, { headers: { 'User-Agent': IMAGE_ENGINE_UA } });
    if (sRes.ok) {
      const sData = (await sRes.json()) as any;
      const matchedTitle = sData.query?.search?.[0]?.title;
      if (matchedTitle) {
        const pageRes = await fetch(
          `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(matchedTitle)}`,
          { headers: { 'User-Agent': IMAGE_ENGINE_UA } }
        );
        if (pageRes.ok) {
          const pageData = (await pageRes.json()) as any;
          const candidateUrl = pageData.originalimage?.source || pageData.thumbnail?.source;
          const resolved = await downloadImageCandidate(
            candidateUrl,
            pageData.title || cleanQuery,
            pageData.originalimage?.width || 1280,
            pageData.originalimage?.height || 720
          );
          if (resolved) return resolved;
        }
      }
    }
  } catch {
    // Fall through to Pollinations fallback
  }

  try {
    const aiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
      cleanQuery
    )}?width=1024&height=768&nologo=true&seed=${Math.floor(Math.random() * 99999)}`;
    const aiRes = await fetch(aiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (aiRes.ok) {
      const contentType = aiRes.headers.get('content-type') || 'image/jpeg';
      if (contentType.startsWith('image/')) {
        const arrayBuf = await aiRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 2048) {
          return {
            success: true,
            buffer,
            mimeType: contentType,
            sourceUrl: aiUrl,
            title: cleanQuery,
            width: 1024,
            height: 768,
          };
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to resolve image for "${cleanQuery}": ${msg}` };
  }

  return {
    success: false,
    error: `Could not retrieve verified image for "${cleanQuery}". Please try another keyword.`,
  };
}
