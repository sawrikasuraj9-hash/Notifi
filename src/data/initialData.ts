import {
  UserProfile,
  Transaction,
  AppNotification,
  BotTemplate,
  CoinPack,
  PlanTierConfig,
} from '../types';

export const APP_CONFIG = {
  brandName: 'YASHI HALLS',
  tagline: 'Cyber Multi-Device WhatsApp Cloud Engine',
  logoUrl: 'https://i.ibb.co/n2fYpDV/file-000000007c3c8210ae1b96d28b22c655.png',
  showcaseImageUrl: '/api/bot/menu-preview-image',
  whatsappChannelUrl: 'https://whatsapp.com/channel/0029Vb927N4GJP8MS1yurM2Z',
  ownerHotline: '0740712934',
  supportEmail: 'sawrikasuraj9@gmail.com',
  defaultPrefix: '.',
  version: 'v3.5 PRO',
};

export const INITIAL_USER: UserProfile = {
  username: 'Guest',
  email: '',
  isVerified: false,
  signInMethod: 'GOOGLE',
  plan: 'mini',
  ownedPlans: ['mini'],
  botSlotsUsed: 0,
  botSlotsTotal: 1,
  avatarLetter: 'Y',
  emailNotifications: true,
  productUpdates: false,
};

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-welcome',
    title: 'Welcome Cloud Starter Bonus',
    date: new Date().toISOString().split('T')[0],
    amount: 5,
    category: 'bonus',
  },
];

export const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 'notif-welcome',
    title: 'YASHI HALLS Engine Ready',
    message: 'Pair your WhatsApp account or launch your Business Auto-Order Store anytime.',
    time: 'Just now',
    read: false,
    type: 'success',
  },
];

export const PLAN_TIERS: PlanTierConfig[] = [
  {
    id: 'mini',
    name: 'YASHI MINI',
    badge: 'FREE',
    priceCoins: 0,
    slots: 1,
    mediaDailyQuota: 100,
    aiDailyQuota: 50,
    isFree: true,
    description: 'Essential 24/7 WhatsApp Bot hosting with core commands and pairing.',
    features: [
      '1 Active WhatsApp Bot Slot',
      'Instant Pairing Code & QR Login',
      'Core Group & Utility Commands',
      'Auto Status View & Voice Replies',
    ],
  },
  {
    id: 'pro',
    name: 'YASHI PRO',
    badge: 'POPULAR',
    priceCoins: 50,
    slots: 5,
    mediaDailyQuota: 999999,
    aiDailyQuota: 999999,
    isFree: false,
    description: 'Full 1000+ command suite, HD media downloads, AI chat, and multi-bot hosting.',
    features: [
      'Up to 5 Active Bot Slots',
      'Unlimited AI Chat & Media Downloads',
      'Sinhala Movies & Subtitles Engine',
      'Custom Menu Styling & Voice Auto-Replies',
    ],
  },
  {
    id: 'business',
    name: 'YASHI BUSINESS',
    badge: 'AUTO STORE',
    priceCoins: 100,
    slots: 25,
    mediaDailyQuota: 999999,
    aiDailyQuota: 999999,
    isFree: false,
    description: 'Dedicated Automated WhatsApp Store, YASHI Pay APK sync & FFGlory Auto-Delivery.',
    features: [
      'Dedicated Separate Business WhatsApp Bot',
      'Automated FFGlory Guild Service & Live Cards',
      'YASHI HALLS Pay Android SMS/Notification Sync',
      'AI Bank Receipt Verification & Owner Approval Flow',
    ],
  },
];

export const COIN_PACKS: CoinPack[] = [
  {
    id: 'pack-50',
    coins: 50,
    priceLkr: 500,
    priceKes: 220,
    daysEstimate: 30,
    maxBots: 5,
  },
  {
    id: 'pack-120',
    coins: 120,
    priceLkr: 1000,
    priceKes: 440,
    daysEstimate: 75,
    maxBots: 10,
    isBestValue: true,
  },
  {
    id: 'pack-300',
    coins: 300,
    priceLkr: 2200,
    priceKes: 950,
    daysEstimate: 180,
    maxBots: 25,
  },
];

export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: 'yashi-halls-pro',
    name: 'YASHI HALLS MD PRO',
    title: 'YASHI HALLS Multi-Device Pro Bot',
    description: 'Full-featured WhatsApp MD bot with AI assistant, HD downloads, movies, stickers & group automation.',
    platform: 'WhatsApp',
    category: 'Multi-Device',
    badge: 'OFFICIAL',
    costCoins: 0,
    repoUrl: 'https://github.com/yashihalls/yashi-md-pro',
    defaultEnv: [
      { key: 'PREFIX', defaultValue: '.', description: 'Bot command prefix', required: true },
      { key: 'BOT_NAME', defaultValue: 'YASHI HALLS', description: 'Display name on menus', required: true },
      { key: 'MODE', defaultValue: 'public', description: 'public or private mode', required: false },
    ],
  },
  {
    id: 'yashi-business-store',
    name: 'YASHI BUSINESS STORE',
    title: 'Automated Panels & FFGlory Store Bot',
    description: 'Automated WhatsApp store with interactive HTML cards, payment receipt OCR & FFGlory live delivery.',
    platform: 'WhatsApp',
    category: 'E-Commerce',
    badge: 'BUSINESS',
    costCoins: 0,
    repoUrl: 'https://github.com/yashihalls/yashi-business',
    defaultEnv: [
      { key: 'STORE_NAME', defaultValue: 'YASHI BUSINESS STORE', description: 'Store display name', required: true },
      { key: 'OWNER_NUMBER', defaultValue: '94740712934', description: 'Owner WhatsApp number', required: true },
    ],
  },
];
