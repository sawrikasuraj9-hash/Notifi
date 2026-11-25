export interface PluginInfo {
  id: string;
  name: string;
  category: string;
  status: 'active' | 'requires_api_key';
  description: string;
  supportedFormats: string[];
}

export const REGISTERED_PLUGINS: PluginInfo[] = [
  {
    id: 'plugin-yashi-image',
    name: 'YASHI HALLS Visual Engine',
    category: 'image_gen',
    status:
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
        ? 'active'
        : 'requires_api_key',
    description: 'Generates visual concepts and graphics directly via YASHI HALLS AI capabilities.',
    supportedFormats: ['image/png', 'image/jpeg'],
  },
  {
    id: 'plugin-yt-downloader',
    name: 'YouTube & Media Stream Extractor',
    category: 'downloader',
    status: 'active',
    description: 'Extracts YouTube audio and video streams via the built-in yt-dlp and media engine.',
    supportedFormats: ['MP3 Audio (320kbps)', 'MP4 Video (720p/1080p)'],
  },
  {
    id: 'plugin-tiktok-downloader',
    name: 'TikTok No-Watermark Downloader',
    category: 'downloader',
    status: 'active',
    description: 'Extracts TikTok videos without watermark via the built-in scraper service.',
    supportedFormats: ['HD MP4'],
  },
];

export function getPluginStatusList(): PluginInfo[] {
  return REGISTERED_PLUGINS;
}
