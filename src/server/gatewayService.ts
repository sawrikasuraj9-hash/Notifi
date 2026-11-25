import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface GatewayRule {
  id: string;
  name: string;
  sender: string;
  keyword: string;
  ignoreKeyword?: string;
  active: boolean;
  createdAt: string;
}

export interface GatewayNotification {
  id: string;
  bank: string;
  sender: string;
  amount: number;
  ref: string;
  rawText: string;
  deviceId: string;
  deviceName: string;
  receivedAt: string;
  matched: boolean;
}

export interface GatewayConfig {
  botToken: string;
  pairedBotNumber: string;
  deviceConnected: boolean;
  lastHeartbeatAt: string | null;
  lastDeviceName: string | null;
  batteryLevel: number | null;
}

interface GatewayState {
  config: GatewayConfig;
  rules: GatewayRule[];
  notifications: GatewayNotification[];
}

const DATA_FILE = path.resolve(process.cwd(), 'data', 'gateway_state.json');

function defaultState(): GatewayState {
  return {
    config: {
      botToken: `YH-GW-${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      pairedBotNumber: '',
      deviceConnected: false,
      lastHeartbeatAt: null,
      lastDeviceName: null,
      batteryLevel: null,
    },
    rules: [
      {
        id: 'rule-combank',
        name: 'Commercial Bank Credit',
        sender: 'COMBANK',
        keyword: 'credited',
        ignoreKeyword: 'debited',
        active: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'rule-sampath',
        name: 'Sampath Bank Vishwa',
        sender: 'SAMPATH',
        keyword: 'credited',
        ignoreKeyword: 'debited',
        active: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'rule-boc',
        name: 'Bank of Ceylon (BOC)',
        sender: 'BOC',
        keyword: 'credited',
        ignoreKeyword: 'debited',
        active: true,
        createdAt: new Date().toISOString(),
      },
    ],
    notifications: [],
  };
}

class GatewayService {
  private state: GatewayState;

  constructor() {
    this.state = this.load();
  }

  private load(): GatewayState {
    try {
      if (fs.existsSync(DATA_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
          ...defaultState(),
          ...parsed,
          config: { ...defaultState().config, ...(parsed.config || {}) },
          rules: Array.isArray(parsed.rules) ? parsed.rules : defaultState().rules,
          notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
        };
      }
    } catch {
      // fallback to default
    }
    return defaultState();
  }

  private save(): void {
    try {
      const dir = path.dirname(DATA_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2));
    } catch {
      // ignore write errors
    }
  }

  getStatus() {
    const lastMs = this.state.config.lastHeartbeatAt
      ? new Date(this.state.config.lastHeartbeatAt).getTime()
      : 0;
    const isOnline = lastMs > 0 && Date.now() - lastMs < 15 * 60 * 1000;
    return {
      config: { ...this.state.config, deviceConnected: isOnline },
      rules: this.state.rules,
      recentNotifications: this.state.notifications.slice(0, 50),
      totalReceived: this.state.notifications.length,
    };
  }

  registerNotification(payload: {
    token?: string;
    deviceId?: string;
    deviceName?: string;
    title?: string;
    message?: string;
    sender?: string;
    rawText?: string;
    batteryLevel?: number;
  }): { notification: GatewayNotification; matchedSlip: any | null } {
    const text = String(payload.rawText || payload.message || payload.title || '').trim();
    const sender = String(payload.sender || payload.title || 'Bank Alert').trim();
    const amountMatch = text.match(/(?:LKR|RS\.?|රු\.?)\s*([0-9,]+(?:\.\d{1,2})?)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : 0;
    const refMatch = text.match(/(?:REF|TXN|ID)[:\s#-]*([A-Z0-9-]{4,24})/i);
    const ref = refMatch ? refMatch[1] : `REF-${Date.now().toString().slice(-6)}`;

    this.state.config.deviceConnected = true;
    this.state.config.lastHeartbeatAt = new Date().toISOString();
    this.state.config.lastDeviceName = payload.deviceName || 'Android Phone';
    if (typeof payload.batteryLevel === 'number') {
      this.state.config.batteryLevel = payload.batteryLevel;
    }

    const notification: GatewayNotification = {
      id: `gw_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      bank: sender,
      sender,
      amount: Number.isFinite(amount) ? amount : 0,
      ref,
      rawText: text,
      deviceId: payload.deviceId || 'android-device',
      deviceName: payload.deviceName || 'Android Phone',
      receivedAt: new Date().toISOString(),
      matched: false,
    };

    this.state.notifications.unshift(notification);
    if (this.state.notifications.length > 200) {
      this.state.notifications = this.state.notifications.slice(0, 200);
    }
    this.save();

    return { notification, matchedSlip: null };
  }

  simulateTestNotification(amount = 1500, ref?: string, bank = 'Commercial Bank') {
    const finalRef = ref || String(Math.floor(10000000 + Math.random() * 90000000));
    return this.registerNotification({
      deviceId: 'dashboard-simulator',
      deviceName: 'Dashboard Simulator',
      sender: bank,
      rawText: `Account credited with LKR ${amount.toFixed(2)} via ${bank}. Ref: ${finalRef}`,
    });
  }

  getRules(): GatewayRule[] {
    return this.state.rules;
  }

  addRule(input: {
    name: string;
    sender: string;
    keyword: string;
    ignoreKeyword?: string;
    active?: boolean;
  }): GatewayRule {
    const rule: GatewayRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: String(input.name || 'Custom Rule').trim(),
      sender: String(input.sender || '').trim(),
      keyword: String(input.keyword || 'credited').trim(),
      ignoreKeyword: input.ignoreKeyword ? String(input.ignoreKeyword).trim() : '',
      active: input.active !== false,
      createdAt: new Date().toISOString(),
    };
    this.state.rules.push(rule);
    this.save();
    return rule;
  }

  toggleRule(id: string): GatewayRule | null {
    const rule = this.state.rules.find((r) => r.id === id);
    if (!rule) return null;
    rule.active = !rule.active;
    this.save();
    return rule;
  }

  deleteRule(id: string): boolean {
    const before = this.state.rules.length;
    this.state.rules = this.state.rules.filter((r) => r.id !== id);
    if (this.state.rules.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  setConfig(botToken?: string, pairedBotNumber?: string): GatewayConfig {
    if (typeof botToken === 'string' && botToken.trim()) {
      this.state.config.botToken = botToken.trim();
    }
    if (typeof pairedBotNumber === 'string') {
      this.state.config.pairedBotNumber = pairedBotNumber.trim();
    }
    this.save();
    return this.state.config;
  }
}

export const gatewayService = new GatewayService();
