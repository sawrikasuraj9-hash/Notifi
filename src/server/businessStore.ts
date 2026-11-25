import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface BusinessPricePackage {
  id: string;
  days: string;
  price: string;
  label?: string;
}

export interface BusinessProduct {
  id: string;
  name: string;
  category: string;
  platform: 'android' | 'ios' | 'pc' | 'all' | string;
  price: string;
  command?: string;
  packages: BusinessPricePackage[];
  subtitle?: string;
  description?: string;
  logoUrl?: string;
  inStock: boolean;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessStoreData {
  tenantId: string;
  storeName: string;
  mainLogoUrl: string;
  welcomeText: string;
  panelButtonText: string;
  gloryButtonText: string;
  orderInstructions: string;
  categories: string[];
  products: BusinessProduct[];
  updatedAt: string;
}

const SESSIONS_DIR = path.resolve(process.cwd(), 'data', 'sessions');
const ASSETS_DIR = path.resolve(process.cwd(), 'data', 'business_assets');

function sanitizeTenant(tenantId: string): string {
  const clean = String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return clean || 'default';
}

function getStoreFilePath(tenantId: string): string {
  const dir = path.resolve(SESSIONS_DIR, sanitizeTenant(tenantId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.resolve(dir, 'business_store.json');
}

export function sanitizePanelCommandSlug(command?: string, fallbackName?: string): string {
  const raw = String(command || fallbackName || '')
    .trim()
    .replace(/^[./!#]+/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 32);
  return raw || 'panel';
}

function createDefaultStore(tenantId: string): BusinessStoreData {
  return {
    tenantId: sanitizeTenant(tenantId),
    storeName: 'YASHI BUSINESS STORE',
    mainLogoUrl: '',
    welcomeText:
      'ආයුබෝවන්! YASHI BUSINESS STORE වෙත සාදරයෙන් පිළිගනිමු. ඔබට අවශ්‍ය සේවාව පහතින් තෝරාගන්න.',
    panelButtonText: 'PANEL SERVICE',
    gloryButtonText: 'GUILD GLORY SERVICE',
    orderInstructions:
      'ඔබගේ Payment එක සිදුකර Receipt/Slip එක මෙම WhatsApp chat එකට එවන්න. ස්වයංක්‍රීයව තහවුරු වූ වහාම ඔබගේ සේවාව ලබාදෙනු ඇත.',
    categories: ['ANDROID', 'IOS', 'PC', 'GUILD GLORY', 'OTHER'],
    products: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getBusinessStore(tenantId: string): BusinessStoreData {
  const filePath = getStoreFilePath(tenantId);
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const def = createDefaultStore(tenantId);
      return {
        ...def,
        ...parsed,
        tenantId: sanitizeTenant(tenantId),
        categories: Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : def.categories,
        products: Array.isArray(parsed.products) ? parsed.products : [],
      };
    }
  } catch {
    // fallback to default
  }
  const initial = createDefaultStore(tenantId);
  saveBusinessStore(initial);
  return initial;
}

function saveBusinessStore(data: BusinessStoreData): BusinessStoreData {
  const filePath = getStoreFilePath(data.tenantId);
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  return data;
}

export function updateBusinessStoreSettings(
  tenantId: string,
  updates: Partial<
    Pick<
      BusinessStoreData,
      | 'storeName'
      | 'mainLogoUrl'
      | 'welcomeText'
      | 'panelButtonText'
      | 'gloryButtonText'
      | 'orderInstructions'
      | 'categories'
    >
  >
): BusinessStoreData {
  const store = getBusinessStore(tenantId);
  if (typeof updates.storeName === 'string') store.storeName = updates.storeName.trim() || store.storeName;
  if (typeof updates.mainLogoUrl === 'string') store.mainLogoUrl = updates.mainLogoUrl;
  if (typeof updates.welcomeText === 'string') store.welcomeText = updates.welcomeText;
  if (typeof updates.panelButtonText === 'string') store.panelButtonText = updates.panelButtonText;
  if (typeof updates.gloryButtonText === 'string') store.gloryButtonText = updates.gloryButtonText;
  if (typeof updates.orderInstructions === 'string') store.orderInstructions = updates.orderInstructions;
  if (Array.isArray(updates.categories)) {
    store.categories = updates.categories.map((c) => String(c).trim()).filter(Boolean);
  }
  return saveBusinessStore(store);
}

export function addBusinessProduct(
  tenantId: string,
  input: Omit<BusinessProduct, 'id' | 'createdAt' | 'updatedAt'>
): BusinessStoreData {
  const store = getBusinessStore(tenantId);
  const now = new Date().toISOString();
  const product: BusinessProduct = {
    id: `prod_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    name: String(input.name || '').trim(),
    category: String(input.category || 'OTHER').trim(),
    platform: input.platform || 'android',
    price: String(input.price || 'LKR 0'),
    command: input.command ? sanitizePanelCommandSlug(input.command, input.name) : sanitizePanelCommandSlug('', input.name),
    packages: Array.isArray(input.packages)
      ? input.packages.map((pkg, idx) => ({
          id: pkg.id || `pkg_${Date.now()}_${idx}`,
          days: String(pkg.days || '').trim(),
          price: String(pkg.price || '').trim(),
          label: pkg.label ? String(pkg.label).trim() : undefined,
        }))
      : [],
    subtitle: input.subtitle || '',
    description: input.description || '',
    logoUrl: input.logoUrl || '',
    inStock: input.inStock !== false,
    verified: input.verified !== false,
    createdAt: now,
    updatedAt: now,
  };
  store.products.push(product);
  return saveBusinessStore(store);
}

export function updateBusinessProduct(
  tenantId: string,
  productId: string,
  updates: Partial<BusinessProduct>
): BusinessStoreData {
  const store = getBusinessStore(tenantId);
  const idx = store.products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    throw new Error(`Product "${productId}" not found.`);
  }
  const existing = store.products[idx];
  const merged: BusinessProduct = {
    ...existing,
    ...updates,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  if (typeof updates.command === 'string') {
    merged.command = sanitizePanelCommandSlug(updates.command, merged.name);
  }
  if (Array.isArray(updates.packages)) {
    merged.packages = updates.packages.map((pkg, i) => ({
      id: pkg.id || `pkg_${Date.now()}_${i}`,
      days: String(pkg.days || '').trim(),
      price: String(pkg.price || '').trim(),
      label: pkg.label ? String(pkg.label).trim() : undefined,
    }));
  }
  store.products[idx] = merged;
  return saveBusinessStore(store);
}

export function deleteBusinessProduct(tenantId: string, productId: string): BusinessStoreData {
  const store = getBusinessStore(tenantId);
  store.products = store.products.filter((p) => p.id !== productId);
  return saveBusinessStore(store);
}

export function saveBusinessAssetFromBase64(
  tenantId: string,
  dataUriOrBase64: string,
  prefix = 'asset'
): string {
  const safeTenant = sanitizeTenant(tenantId);
  const tenantDir = path.resolve(ASSETS_DIR, safeTenant);
  if (!fs.existsSync(tenantDir)) fs.mkdirSync(tenantDir, { recursive: true });

  let ext = 'png';
  let base64 = dataUriOrBase64;
  const match = dataUriOrBase64.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
  if (match) {
    const rawExt = match[1].toLowerCase();
    ext = rawExt === 'jpeg' ? 'jpg' : rawExt.replace(/[^a-z0-9]/g, '') || 'png';
    base64 = match[2];
  }

  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) {
    throw new Error('Invalid base64 image data');
  }

  const safePrefix = String(prefix || 'asset').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const fileName = `${safePrefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.${ext}`;
  const filePath = path.resolve(tenantDir, fileName);
  fs.writeFileSync(filePath, buffer);
  return `/api/business-store/assets/${safeTenant}/${fileName}`;
}

export function resolveLocalAssetPath(assetUrl?: string): string | null {
  if (!assetUrl || typeof assetUrl !== 'string') return null;
  const prefix = '/api/business-store/assets/';
  if (assetUrl.startsWith(prefix)) {
    const rel = assetUrl.slice(prefix.length);
    const parts = rel.split('/').filter(Boolean);
    if (parts.length === 2) {
      const safeTenant = parts[0].replace(/[^a-zA-Z0-9_-]/g, '_');
      const safeFile = path.basename(parts[1]);
      const fullPath = path.resolve(ASSETS_DIR, safeTenant, safeFile);
      if (fullPath.startsWith(ASSETS_DIR + path.sep) && fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  if (path.isAbsolute(assetUrl) && fs.existsSync(assetUrl)) {
    return assetUrl;
  }
  return null;
}
