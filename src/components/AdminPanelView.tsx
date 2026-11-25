import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, 
  Users, 
  Coins, 
  ShoppingBag, 
  Settings as SettingsIcon, 
  FileText, 
  Activity, 
  Search, 
  Check, 
  X, 
  UserX, 
  UserCheck, 
  Trash2, 
  RefreshCw, 
  ExternalLink, 
  AlertTriangle,
  ArrowUpRight,
  ArrowDownLeft,
  MessageSquare,
  Lock,
  Sparkles,
  Bot,
  Zap,
  Tag,
  Building2,
  Crown,
  Mic,
  Palette,
  Cpu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../context/AppContext';
import { soundFX } from '../utils/sound';
import { 
  AdminCustomer, 
  PurchaseRequest, 
  AdminAuditLog, 
  AdminOverviewStats 
} from '../types';
import { VoiceAutoRepliesAdmin } from './VoiceAutoRepliesAdmin';
import { AdminSiteDesignStudio } from './AdminSiteDesignStudio';
import { AdminBotStudio } from './AdminBotStudio';
import { AutoOrderManagementView } from './AutoOrderManagementView';
import { auth, db, collection, getDocs, updateDoc, doc, getDoc, authFetch } from '../firebase';

type AdminTab =
  | 'overview'
  | 'paired-bots'
  | 'auto-orders'
  | 'bot-studio'
  | 'voice'
  | 'customers'
  | 'purchases'
  | 'wallet'
  | 'plans'
  | 'site-design'
  | 'settings'
  | 'audit';

export const AdminPanelView: React.FC = () => {
  const { user, isAdmin, effectiveUserId, addToast } = useApp();

  const [activeTab, setActiveTab] = useState<AdminTab>('paired-bots');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [stats, setStats] = useState<AdminOverviewStats | null>(null);
  const [customers, setCustomers] = useState<AdminCustomer[]>([]);
  const [pairedBots, setPairedBots] = useState<any[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRequest[]>([]);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [systemSettings, setSystemSettings] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Manual Coin Add / Deduct Modal State
  const [coinModalOpen, setCoinModalOpen] = useState(false);
  const [targetCustomer, setTargetCustomer] = useState<AdminCustomer | null>(null);
  const [coinAction, setCoinAction] = useState<'ADD' | 'DEDUCT'>('ADD');
  const [coinAmount, setCoinAmount] = useState<number>(50);
  const [coinReason, setCoinReason] = useState<string>('Manual Topup / Bonus');
  const [isCoinSubmitting, setIsCoinSubmitting] = useState(false);

  // Customer Note Modal State
  const [noteModalOpen, setNoteModalOpen] = useState(false);
  const [customerNoteText, setCustomerNoteText] = useState('');

  // Settings form state
  const [storeName, setStoreName] = useState('YASHI HALLS Cloud Platform');
  const [adminWhatsapp, setAdminWhatsapp] = useState('0740712934');
  const [proCoinPrice, setProCoinPrice] = useState(10);
  const [businessCoinPrice, setBusinessCoinPrice] = useState(30);

  const fetchAdminData = useCallback(async () => {
    if (!isAdmin) return;
    setIsLoading(true);
    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const headers = {
        'x-admin-email': adminEmail,
        'Content-Type': 'application/json',
      };

      const [resOverview, resCust, resPurch, resLogs, resSettings, resPaired] = await Promise.all([
        authFetch('/api/admin/overview', { headers }),
        authFetch('/api/admin/customers', { headers }),
        authFetch('/api/admin/purchase-requests', { headers }),
        authFetch('/api/admin/audit-logs', { headers }),
        authFetch('/api/admin/settings', { headers }),
        authFetch('/api/admin/paired-bots', { headers }),
      ]);

      if (resOverview.ok) {
        const d = await resOverview.json();
        if (d.success) setStats(d.data);
      }
      if (resPaired && resPaired.ok) {
        const d = await resPaired.json();
        if (d.success && Array.isArray(d.data)) {
          setPairedBots(d.data);
        }
      }
      
      let loadedCustomers: AdminCustomer[] = [];
      if (resCust.ok) {
        const d = await resCust.json();
        if (d.success && Array.isArray(d.data)) {
          loadedCustomers = d.data;
        }
      }

      // Fetch Real Live Customer Data from Firestore (only when signed in & online) & merge with backend directory
      if (auth.currentUser && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const customerById = new Map<string, AdminCustomer>();
          loadedCustomers.forEach((c) => {
            if (c.id) customerById.set(c.id, c);
            if (c.email) customerById.set(c.email.trim().toLowerCase(), c);
          });

          usersSnap.forEach((docSnap) => {
            const d = docSnap.data();
            const email = (d.email || '').trim().toLowerCase();
            const uid = docSnap.id;
            const existing = customerById.get(uid) || (email ? customerById.get(email) : undefined);
            const resolvedName = d.username || d.displayName || d.name || (existing?.username && existing.username !== 'Customer' ? existing.username : '') || (email ? email.split('@')[0] : 'Customer');

            const liveCust: AdminCustomer = {
              id: uid,
              email: d.email || (existing?.email ?? 'Unknown'),
              username: resolvedName,
              plan: d.plan || existing?.plan || 'mini',
              coins: typeof d.coins === 'number' ? d.coins : (existing?.coins ?? 5),
              isSuspended: Boolean(d.isSuspended ?? existing?.isSuspended),
              botStatus: existing?.botStatus || (d.botStatus ?? 'none'),
              createdAt: d.createdAt || existing?.createdAt || new Date().toISOString(),
              lastActive: d.lastActive || existing?.lastActive || new Date().toISOString(),
              adminNote: d.adminNote || existing?.adminNote,
              isOnline: Boolean(existing?.isOnline || d.botStatus === 'online'),
              mediaUsed: d.mediaUsed || existing?.mediaUsed || 0,
              aiUsed: d.aiUsed || existing?.aiUsed || 0,
            };
            customerById.set(uid, liveCust);

            // Proactively register into backend admin database
            authFetch('/api/admin/customers/sync', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: uid,
                email: liveCust.email,
                username: liveCust.username,
                plan: liveCust.plan,
                coins: liveCust.coins,
              }),
            }).catch(() => {});
          });

          setCustomers(Array.from(customerById.values()));
        } catch {
          setCustomers(loadedCustomers);
        }
      } else {
        setCustomers(loadedCustomers);
      }

      if (resPurch.ok) {
        const d = await resPurch.json();
        if (d.success) setPurchases(d.data);
      }
      if (resLogs.ok) {
        const d = await resLogs.json();
        if (d.success) setAuditLogs(d.data);
      }
      if (resSettings.ok) {
        const d = await resSettings.json();
        if (d.success) {
          setSystemSettings(d.data);
          setStoreName(d.data.storeName || '');
          setAdminWhatsapp(d.data.adminWhatsapp || '');
          if (d.data.planPricesCoins) {
            setProCoinPrice(d.data.planPricesCoins.pro || 10);
            setBusinessCoinPrice(d.data.planPricesCoins.business || 30);
          }
        }
      }
    } catch {
      addToast('Failed to load admin dataset', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, user.email, addToast]);

  useEffect(() => {
    fetchAdminData();
  }, [fetchAdminData]);

  // If Not Authorized Master Admin: Strictly Block
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-3xl bg-rose-500/15 border-2 border-rose-500/50 flex items-center justify-center mx-auto text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.3)]">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-black text-white">ACCESS DENIED</h2>
        <p className="text-sm text-slate-400 leading-relaxed">
          The requested console requires verified Root Master Administrator permissions.
          Only <strong className="text-cyan-400 font-mono">epavenav@gmail.com</strong> (or master admin) is authorized to view this control center.
        </p>
      </div>
    );
  }

  // --- ACTIONS ---

  const handleModifyCoins = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCustomer) return;
    setIsCoinSubmitting(true);
    soundFX.playClick();

    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const res = await authFetch('/api/admin/coins/adjust', {
        method: 'POST',
        headers: {
          'x-admin-email': adminEmail,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: targetCustomer.id,
          action: coinAction,
          amount: coinAmount,
          reason: coinReason,
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message, 'success');
        setCoinModalOpen(false);

        // Update Firestore directly if Firebase Auth session is active and customer exists
        if (auth.currentUser) {
          try {
            if (targetCustomer.id && targetCustomer.id.length > 5 && typeof data.newBalance === 'number') {
              await updateDoc(doc(db, 'users', targetCustomer.id), { coins: data.newBalance });
            }
          } catch {
            // fallback
          }
        }

        await fetchAdminData();
      } else {
        addToast(data.message || 'Failed to adjust coins', 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Server error', 'error');
    } finally {
      setIsCoinSubmitting(false);
    }
  };

  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  const handleToggleSuspend = async (cust: AdminCustomer) => {
    soundFX.playClick();
    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const res = await authFetch('/api/admin/customers/suspend', {
        method: 'POST',
        headers: {
          'x-admin-email': adminEmail,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customerId: cust.id,
          isSuspended: !cust.isSuspended,
        }),
      });
      const data = await res.json();
      if (data.success) {
        addToast(`Customer ${cust.email} ${cust.isSuspended ? 'unsuspended' : 'suspended'}!`, 'info');

        // Update Firestore user document when Firebase Auth session is active
        if (auth.currentUser) {
          try {
            if (cust.id && cust.id.length > 5) {
              await updateDoc(doc(db, 'users', cust.id), { isSuspended: !cust.isSuspended });
            }
          } catch {}
        }

        await fetchAdminData();
      }
    } catch {
      addToast('Failed to update suspension status', 'error');
    }
  };

  const handleDeleteCustomer = async (cust: AdminCustomer) => {
    soundFX.playClick();
    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const res = await authFetch(`/api/admin/customers/${cust.id}`, {
        method: 'DELETE',
        headers: { 'x-admin-email': adminEmail },
      });
      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message, 'success');
        await fetchAdminData();
      }
    } catch {
      addToast('Failed to delete customer', 'error');
    }
  };

  const handleFulfillPurchase = async (req: PurchaseRequest, action: 'APPROVE' | 'REJECT') => {
    soundFX.playClick();
    setFulfillingId(req.id);

    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const res = await authFetch('/api/admin/purchase-requests/fulfill', {
        method: 'POST',
        headers: {
          'x-admin-email': adminEmail,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId: req.id,
          action,
          adminNote: `Processed by ${adminEmail} at ${new Date().toLocaleTimeString()}`,
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast(data.message || `Purchase request ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully!`, 'success');

        // Direct Firestore Customer Sync: If approved and Firebase Auth is active, update user coins and plan in Firestore!
        if (action === 'APPROVE' && req.customerId && auth.currentUser) {
          try {
            const uRef = doc(db, 'users', req.customerId);
            const uSnap = await getDoc(uRef);
            if (uSnap.exists()) {
              const uData = uSnap.data();
              const payload: any = {};
              if (req.itemType === 'coin_pack' && req.coinAmount) {
                const cur = typeof uData.coins === 'number' ? uData.coins : 5;
                payload.coins = cur + req.coinAmount;
              } else if (req.itemType === 'plan' && req.planId) {
                payload.plan = req.planId;
                const curOwned = Array.isArray(uData.ownedPlans) ? uData.ownedPlans : ['mini'];
                payload.ownedPlans = Array.from(new Set([...curOwned, req.planId]));
              }
              if (Object.keys(payload).length > 0) {
                await updateDoc(uRef, payload);
              }
            }
          } catch (fErr) {
            console.warn('Could not update Firestore user directly:', fErr);
          }
        }

        await fetchAdminData();
      } else {
        addToast(data.message || 'Operation failed', 'error');
      }
    } catch (err: any) {
      addToast(err?.message || 'Error fulfilling request', 'error');
    } finally {
      setFulfillingId(null);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    soundFX.playClick();
    try {
      const adminEmail = user.email || 'sawrikasuraj759@gmail.com';
      const res = await authFetch('/api/admin/settings', {
        method: 'POST',
        headers: {
          'x-admin-email': adminEmail,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeName,
          adminWhatsapp,
          planPricesCoins: {
            mini: 0,
            pro: proCoinPrice,
            business: businessCoinPrice,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundFX.playSuccess();
        addToast('System settings saved successfully!', 'success');
        await fetchAdminData();
      }
    } catch {
      addToast('Failed to save settings', 'error');
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.email.toLowerCase().includes(q) ||
      c.username.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );
  });

  const filteredPurchases = purchases.filter((p) => {
    if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
    const q = searchQuery.toLowerCase();
    return (
      p.customerEmail.toLowerCase().includes(q) ||
      p.referenceId.toLowerCase().includes(q) ||
      p.itemName.toLowerCase().includes(q)
    );
  });

  const pendingCount = purchases.filter((p) => p.status === 'PENDING').length;

  const menuSections = [
    {
      title: 'MAIN',
      items: [
        { id: 'overview' as AdminTab, label: 'Dashboard', icon: Activity, badge: 'LIVE', badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' },
      ],
    },
    {
      title: 'MANAGE',
      items: [
        { id: 'paired-bots' as AdminTab, label: 'Paired WhatsApp Bots', icon: Cpu, badge: `${pairedBots.length}`, badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
        { id: 'auto-orders' as AdminTab, label: 'Auto Order Management', icon: Zap, badge: 'FFGLORY', badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
        { id: 'bot-studio' as AdminTab, label: 'Bot & Baileys Studio', icon: Bot, badge: 'CLUSTER', badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
        { id: 'voice' as AdminTab, label: 'Voice Auto-Replies', icon: Mic, badge: 'AUDIO', badgeClass: 'bg-pink-500/20 text-pink-300 border-pink-500/40' },
        { id: 'customers' as AdminTab, label: 'Users & Customers', icon: Users, badge: `${customers.length}`, badgeClass: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
        { id: 'purchases' as AdminTab, label: 'Customer Orders', icon: ShoppingBag, badge: pendingCount > 0 ? `${pendingCount} PENDING` : '0', badgeClass: pendingCount > 0 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse' : 'bg-slate-800 text-slate-400' },
        { id: 'wallet' as AdminTab, label: 'Coins & Wallet Hub', icon: Coins, badge: 'GRANT/DEBIT', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
        { id: 'plans' as AdminTab, label: 'Plan Pricing Matrix', icon: Tag, badge: 'MINI/PRO', badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
        { id: 'site-design' as AdminTab, label: 'Site Design & CSS', icon: Palette, badge: 'STUDIO', badgeClass: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
        { id: 'settings' as AdminTab, label: 'Security & Settings', icon: SettingsIcon, badge: 'BRAND', badgeClass: 'bg-slate-800 text-slate-300' },
      ],
    },
    {
      title: 'TOOLS & AUDIT',
      items: [
        { id: 'audit' as AdminTab, label: 'Logs & Security Trail', icon: FileText, badge: 'SECURITY', badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40' },
      ],
    },
  ];

  const renderSidebarContent = () => (
    <div className="flex flex-col h-full bg-[#0b0818] border-r border-purple-900/40 p-4 space-y-5 text-slate-200 overflow-y-auto w-72 shrink-0">
      {/* Brand Lockup Header */}
      <div className="flex items-center justify-between pb-3 border-b border-purple-900/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-600 to-cyan-500 flex items-center justify-center text-white shadow-[0_0_20px_rgba(124,58,237,0.5)] shrink-0">
            <Zap className="w-6 h-6 fill-white stroke-none" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h2 className="text-base font-black tracking-tight text-white font-mono">TOPUP STORE</h2>
              <span className="px-1.5 py-0.2 rounded bg-cyan-500/30 border border-cyan-400 text-cyan-300 text-[9px] font-mono font-bold uppercase">
                STORE
              </span>
            </div>
            <p className="text-[10px] text-slate-400 font-mono tracking-wide">MASTER BOARD CONSOLE</p>
          </div>
        </div>

        <button
          onClick={() => setMobileSidebarOpen(false)}
          className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-xl bg-slate-800/40"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Menu Sections & Links */}
      <div className="space-y-6 flex-1">
        {menuSections.map((sec) => (
          <div key={sec.title} className="space-y-1.5">
            <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest px-2">
              {sec.title}
            </div>

            <div className="space-y-1">
              {sec.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      soundFX.playClick();
                      setActiveTab(item.id);
                      setMobileSidebarOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold shadow-[0_0_20px_rgba(124,58,237,0.4)]'
                        : 'text-slate-400 hover:text-white hover:bg-purple-950/30'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-purple-400'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.badge && (
                      <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold shrink-0 border ${
                        isActive ? 'bg-white text-purple-950 font-black border-transparent' : item.badgeClass
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Callout Card (Matching Screenshot "POWER UP YOUR GAME") */}
      <div className="p-4 rounded-3xl bg-gradient-to-b from-[#160d30] to-[#0e0821] border border-purple-500/30 text-center space-y-2.5 shadow-[0_0_25px_rgba(124,58,237,0.2)] mt-auto">
        <div className="w-11 h-11 rounded-full border-2 border-purple-400/80 bg-purple-500/20 flex items-center justify-center text-purple-300 mx-auto shadow-[0_0_15px_rgba(168,85,247,0.4)] shrink-0">
          <Bot className="w-6 h-6" />
        </div>
        <div>
          <div className="text-xs font-black text-white tracking-wider font-mono">POWER UP YOUR BOT</div>
          <p className="text-[10px] text-slate-400 mt-0.5">Need Help? We're here to assist you!</p>
        </div>
        <a
          href={`https://wa.me/${adminWhatsapp.replace(/\D/g, '')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full block py-2.5 px-3 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black text-xs shadow-md transition-all uppercase tracking-wide"
        >
          Contact Support
        </a>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#05030c] text-slate-100 flex flex-col lg:flex-row font-sans -mt-6 -mx-3 sm:-mx-6">
      {/* Desktop Persistent Sidebar */}
      <div className="hidden lg:block shrink-0">
        {renderSidebarContent()}
      </div>

      {/* Mobile Sidebar Overlay Drawer */}
      <AnimatePresence>
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileSidebarOpen(false)}
              className="fixed inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="relative z-10"
            >
              {renderSidebarContent()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Right Area Workspace */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Workspace Top Header Bar */}
        <header className="p-4 sm:p-5 bg-[#0a0718]/90 backdrop-blur-md border-b border-purple-900/30 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-purple-950/40 border border-purple-500/30 text-purple-300 hover:text-white"
            >
              <Zap className="w-5 h-5" />
            </button>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-black text-white tracking-tight uppercase font-mono">
                  {menuSections.flatMap(s => s.items).find(i => i.id === activeTab)?.label || activeTab}
                </h1>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-400 text-purple-300 font-mono text-[9px] font-bold">
                  MASTER BOARD
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">
                Authenticated Admin: <span className="text-cyan-300 font-bold">{user.email}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                soundFX.playClick();
                fetchAdminData();
              }}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/40 text-purple-300 text-xs font-bold font-mono transition-all"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh Data</span>
            </button>
          </div>
        </header>

        {/* Workspace Body Content Area */}
        <div className="p-4 sm:p-6 space-y-6 flex-1">

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">TOTAL CUSTOMERS</span>
              <div className="text-2xl font-black text-white font-mono">{stats?.totalCustomers ?? customers.length}</div>
              <span className="text-[10px] text-emerald-400">{stats?.activeCustomers ?? customers.length} Active</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">TOTAL CIRCULATION COINS</span>
              <div className="text-2xl font-black text-amber-400 font-mono">{stats?.totalCoinsInCirculation ?? 0}</div>
              <span className="text-[10px] text-slate-400">Across user wallets</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">PENDING PURCHASES</span>
              <div className="text-2xl font-black text-cyan-400 font-mono">{stats?.pendingPurchases ?? 0}</div>
              <span className="text-[10px] text-amber-400">Awaiting Admin Check</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-[#17273d] space-y-1">
              <span className="text-[11px] text-slate-400 font-mono">SYSTEM HEALTH</span>
              <div className="text-base font-black text-emerald-400 font-mono mt-1">OPERATIONAL</div>
              <span className="text-[10px] text-slate-400">Baileys Cluster 24/7</span>
            </div>
          </div>

          {/* Plan Distribution & Pending Request Callouts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Crown className="w-4 h-4 text-cyan-400" />
                <span>Tier Plan Distribution</span>
              </h3>
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-emerald-500/30 text-center">
                  <div className="text-xs font-mono text-emerald-400 font-bold">MINI (FREE)</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.mini ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-cyan-500/30 text-center">
                  <div className="text-xs font-mono text-cyan-400 font-bold">PRO (PAID)</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.pro ?? 0}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-[#0d1c2e] border border-amber-500/30 text-center">
                  <div className="text-xs font-mono text-amber-400 font-bold">BUSINESS</div>
                  <div className="text-xl font-mono font-black text-white mt-1">
                    {stats?.planDistribution.business ?? 0}
                  </div>
                </div>
              </div>
            </div>

            <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-amber-400" />
                  <span>Pending Approval Queue</span>
                </h3>
                <span className="text-xs font-mono text-cyan-400 cursor-pointer" onClick={() => setActiveTab('purchases')}>
                  View all →
                </span>
              </div>

              {purchases.filter(p => p.status === 'PENDING').length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 font-mono">
                  No pending manual purchase requests. All caught up!
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {purchases.filter(p => p.status === 'PENDING').slice(0, 3).map((req) => (
                    <div key={req.id} className="p-3 rounded-xl bg-[#0e1c2d] border border-cyan-500/30 flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-white">{req.itemName}</div>
                        <div className="text-[11px] text-slate-400 font-mono">{req.customerEmail} · {req.priceFormatted}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleFulfillPurchase(req, 'APPROVE')}
                          className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[10px]"
                        >
                          Approve
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB: PAIRED WHATSAPP BOTS */}
      {activeTab === 'paired-bots' && (
        <div className="space-y-4">
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-[#09121e] border border-cyan-500/30 space-y-1">
              <span className="text-[11px] text-slate-400 font-mono uppercase">PAIRED ACCOUNTS</span>
              <div className="text-2xl font-black text-white font-mono">{pairedBots.length}</div>
              <span className="text-[10px] text-cyan-400 font-mono">Active Bot Instances</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-emerald-500/30 space-y-1">
              <span className="text-[11px] text-slate-400 font-mono uppercase">ONLINE STATUS</span>
              <div className="text-2xl font-black text-emerald-400 font-mono">
                {pairedBots.filter((b) => b.isOnline || b.connectionStatus === 'connected').length} / {pairedBots.length}
              </div>
              <span className="text-[10px] text-emerald-400 font-mono">Connected Baileys</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-amber-500/30 space-y-1">
              <span className="text-[11px] text-slate-400 font-mono uppercase">MESSAGES PROCESSED</span>
              <div className="text-2xl font-black text-amber-400 font-mono">
                {pairedBots.reduce((acc, b) => acc + (b.totalMessagesReceived || 0), 0)}
              </div>
              <span className="text-[10px] text-amber-300 font-mono">Across All Sessions</span>
            </div>

            <div className="p-4 rounded-2xl bg-[#09121e] border border-purple-500/30 space-y-1">
              <span className="text-[11px] text-slate-400 font-mono uppercase">COMMAND METRICS</span>
              <div className="text-2xl font-black text-purple-400 font-mono">
                {pairedBots.reduce((acc, b) => acc + (b.totalCommandsExecuted || 0), 0)}
              </div>
              <span className="text-[10px] text-purple-300 font-mono">Commands Triggered</span>
            </div>
          </div>

          {/* Search bar */}
          <div className="flex items-center gap-2 bg-[#09121e] border border-[#162740] rounded-2xl px-4 py-2.5 text-xs text-white">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search paired WhatsApp bots by Phone Number, Session ID, or Owner..."
              className="bg-transparent flex-1 focus:outline-none placeholder-slate-500 text-white font-mono"
            />
          </div>

          {/* Paired Bots Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pairedBots.filter((b) => {
              const q = searchQuery.toLowerCase();
              return (
                (b.pairedNumber || '').toLowerCase().includes(q) ||
                (b.sessionId || '').toLowerCase().includes(q) ||
                (b.ownerNumber || '').toLowerCase().includes(q) ||
                (b.botName || '').toLowerCase().includes(q)
              );
            }).length === 0 ? (
              <div className="col-span-full p-12 text-center text-xs text-slate-500 font-mono rounded-3xl bg-[#081220] border border-[#15273f]">
                No paired WhatsApp bot accounts found matching "{searchQuery}"
              </div>
            ) : (
              pairedBots.filter((b) => {
                const q = searchQuery.toLowerCase();
                return (
                  (b.pairedNumber || '').toLowerCase().includes(q) ||
                  (b.sessionId || '').toLowerCase().includes(q) ||
                  (b.ownerNumber || '').toLowerCase().includes(q) ||
                  (b.botName || '').toLowerCase().includes(q)
                );
              }).map((bot, idx) => {
                const isOnline = bot.isOnline || bot.connectionStatus === 'connected';
                const formattedPhone = bot.pairedNumber !== 'Unknown' 
                  ? (bot.pairedNumber.startsWith('+') ? bot.pairedNumber : `+${bot.pairedNumber}`) 
                  : 'Pending Pair Code';
                const waClean = bot.pairedNumber ? bot.pairedNumber.replace(/\D/g, '') : '';

                return (
                  <div
                    key={`paired-bot-${bot.id}-${idx}`}
                    className={`p-5 rounded-3xl border transition-all ${
                      isOnline
                        ? 'bg-gradient-to-br from-[#091729] to-[#0d1e34] border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.15)]'
                        : 'bg-[#081220] border-[#15273f]'
                    } space-y-4`}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-[#14263e] pb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-xs ${
                          isOnline ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}>
                          📱
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-white text-base">{formattedPhone}</span>
                            <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase ${
                              isOnline
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                                : 'bg-slate-700/40 text-slate-400 border border-slate-600/40'
                            }`}>
                              {isOnline ? '🟢 ONLINE' : '🔴 DISCONNECTED'}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                            Bot: <strong className="text-cyan-300">{bot.botName || 'YASHI HALLS'}</strong> · Session: <span className="text-slate-300">{bot.sessionId}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Details Table Grid */}
                    <div className="grid grid-cols-2 gap-2.5 text-xs font-mono">
                      <div className="p-2.5 rounded-xl bg-[#0c1827] border border-[#162740]">
                        <span className="text-[10px] text-slate-500 block">PLAN TIER</span>
                        <span className="font-bold text-amber-400 uppercase">{bot.plan || 'mini'}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#0c1827] border border-[#162740]">
                        <span className="text-[10px] text-slate-500 block">OWNER NUMBER</span>
                        <span className="font-bold text-white">{bot.ownerNumber || 'Default Admin'}</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#0c1827] border border-[#162740]">
                        <span className="text-[10px] text-slate-500 block">MESSAGES PROCESSED</span>
                        <span className="font-bold text-cyan-300">{bot.totalMessagesReceived || 0} msgs</span>
                      </div>
                      <div className="p-2.5 rounded-xl bg-[#0c1827] border border-[#162740]">
                        <span className="text-[10px] text-slate-500 block">COMMANDS RUN</span>
                        <span className="font-bold text-purple-300">{bot.totalCommandsExecuted || 0} cmds</span>
                      </div>
                    </div>

                    {/* Footer Actions */}
                    <div className="pt-1 flex items-center justify-between gap-2">
                      {waClean && (
                        <a
                          href={`https://wa.me/${waClean}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 py-2 px-3 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-all"
                        >
                          <span>Open in WhatsApp</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}

                      <button
                        onClick={async () => {
                          soundFX.playClick();
                          try {
                            const res = await authFetch(`/api/bot/logout?sessionId=${bot.sessionId}`, { method: 'POST' });
                            const d = await res.json();
                            if (d.success) {
                              addToast(`Unlinked bot session: ${bot.sessionId}`, 'success');
                              fetchAdminData();
                            } else {
                              addToast(d.message || 'Failed to logout session', 'error');
                            }
                          } catch {
                            addToast('Failed to contact server', 'error');
                          }
                        }}
                        className="py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-xs font-mono font-bold flex items-center gap-1"
                        title="Unlink WhatsApp Session"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Unlink Bot</span>
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMERS */}
      {activeTab === 'customers' && (
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex items-center gap-2 bg-[#09121e] border border-[#162740] rounded-2xl px-4 py-2.5 text-xs text-white">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customers by Email, Name, or Customer ID..."
              className="bg-transparent flex-1 focus:outline-none placeholder-slate-500 text-white font-mono"
            />
          </div>

          {/* Customer Table */}
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#0e1c2d] text-slate-400 font-mono border-b border-[#162740]">
                  <tr>
                    <th className="p-3.5">Customer</th>
                    <th className="p-3.5">Plan Tier</th>
                    <th className="p-3.5">Coins Balance</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Joined</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#122238] text-slate-300">
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-500 font-mono">
                        No customers found matching "{searchQuery}"
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((c, idx) => (
                      <tr key={`cust-row-${c.id}-${idx}`} className="hover:bg-[#0c1827] transition-colors">
                        <td className="p-3.5">
                          <div className="font-bold text-white">{c.username}</div>
                          <div className="text-[11px] text-slate-400 font-mono">{c.email}</div>
                          {c.adminNote && (
                            <div className="text-[10px] text-amber-300 italic mt-0.5">Note: {c.adminNote}</div>
                          )}
                        </td>
                        <td className="p-3.5">
                          <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${
                            c.plan === 'business'
                              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                              : c.plan === 'pro'
                              ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                              : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                          }`}>
                            {c.plan}
                          </span>
                        </td>
                        <td className="p-3.5 font-mono font-bold text-amber-400">
                          {c.coins} coins
                        </td>
                        <td className="p-3.5">
                          {c.isSuspended ? (
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-400 font-mono text-[10px] font-bold">
                              SUSPENDED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px] font-bold">
                              ACTIVE
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-[11px] text-slate-400">
                          {new Date(c.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-3.5 text-right space-x-1.5 whitespace-nowrap">
                          {/* Add / Deduct Coins */}
                          <button
                            onClick={() => {
                              soundFX.playClick();
                              setTargetCustomer(c);
                              setCoinAction('ADD');
                              setCoinModalOpen(true);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-bold text-[10px] border border-amber-500/40"
                          >
                            +/- Coins
                          </button>

                          {/* Suspend Toggle */}
                          <button
                            onClick={() => handleToggleSuspend(c)}
                            className={`p-1.5 rounded-lg border transition-colors ${
                              c.isSuspended
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            }`}
                            title={c.isSuspended ? 'Unsuspend' : 'Suspend'}
                          >
                            {c.isSuspended ? <UserCheck className="w-3.5 h-3.5" /> : <UserX className="w-3.5 h-3.5" />}
                          </button>

                          {/* Delete */}
                          <button
                            onClick={() => handleDeleteCustomer(c)}
                            className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-500/40"
                            title="Delete Account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WALLET & MANUAL COINS */}
      {activeTab === 'wallet' && (
        <div className="space-y-4">
          <div className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-400" />
              <span>Manual Coin Grant & Deduct Hub</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Master Admin has full authority to directly credit or debit coins from customer balances. 
              All coin modifications are recorded into the immutable Audit Log.
            </p>

            <div className="pt-2">
              <button
                onClick={() => {
                  soundFX.playClick();
                  setTargetCustomer(customers[0] || null);
                  setCoinAction('ADD');
                  setCoinModalOpen(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wide shadow-md"
              >
                + Open Manual Coin Adjustment Dialog
              </button>
            </div>
          </div>

          {/* Customer Balances Quick List */}
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] p-4 space-y-3">
            <h4 className="text-xs font-mono font-bold text-slate-400 uppercase">Customer Coin Directory</h4>
            <div className="divide-y divide-[#15273f]">
              {customers.map((c, idx) => (
                <div key={`cust-dir-${c.id}-${idx}`} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-white">{c.username}</span>
                    <span className="text-slate-400 font-mono ml-2">({c.email})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-bold text-amber-400 text-sm">{c.coins} coins</span>
                    <button
                      onClick={() => {
                        soundFX.playClick();
                        setTargetCustomer(c);
                        setCoinAction('ADD');
                        setCoinModalOpen(true);
                      }}
                      className="px-2.5 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold border border-cyan-500/40"
                    >
                      Modify
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PURCHASES APPROVAL CENTER */}
      {activeTab === 'purchases' && (
        <div className="space-y-4">
          {/* Status Filter */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {['ALL', 'PENDING', 'FULFILLED', 'REJECTED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all ${
                  statusFilter === st
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-[#09121e] text-slate-400 border border-[#17273d]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          {/* Requests Cards */}
          <div className="space-y-3">
            {filteredPurchases.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-500 font-mono rounded-3xl bg-[#081220] border border-[#15273f]">
                No purchase requests in status "{statusFilter}".
              </div>
            ) : (
              filteredPurchases.map((req) => (
                <div
                  key={req.id}
                  className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                    req.status === 'PENDING'
                      ? 'bg-gradient-to-br from-cyan-950/30 to-[#0e1c2d] border-cyan-400 shadow-[0_0_20px_rgba(0,240,255,0.15)]'
                      : req.status === 'FULFILLED'
                      ? 'bg-[#091422] border-emerald-500/40'
                      : 'bg-[#09121e] border-[#182a40]'
                  } space-y-3`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#14263e] pb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base">{req.itemName}</span>
                        <span className={`px-2 py-0.5 rounded-full font-mono text-[9px] font-bold uppercase ${
                          req.status === 'PENDING'
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse'
                            : req.status === 'FULFILLED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}>
                          {req.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400 font-mono mt-0.5">
                        Ref: <strong className="text-cyan-300">{req.referenceId}</strong> · Submitted: {new Date(req.createdAt).toLocaleString()}
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="text-lg font-mono font-black text-amber-400">{req.priceFormatted}</div>
                      {req.coinAmount && (
                        <div className="text-[11px] text-slate-400 font-mono">+{req.coinAmount} Coins grant</div>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-300">
                    <div>
                      <span className="text-slate-400 block mb-0.5">Customer Details:</span>
                      <span className="font-bold text-white">{req.customerName}</span> ({req.customerEmail})
                    </div>
                    <div>
                      <span className="text-slate-400 block mb-0.5">Direct WhatsApp Link:</span>
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`Hi ${req.customerName}, YASHI HALLS admin here regarding purchase Ref: ${req.referenceId}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        <span>Chat on WhatsApp</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  {/* Actions if Pending */}
                  {req.status === 'PENDING' && (
                    <div className="pt-2 flex items-center gap-2">
                      <button
                        disabled={fulfillingId === req.id}
                        onClick={() => handleFulfillPurchase(req, 'APPROVE')}
                        className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 shadow-[0_0_15px_rgba(16,185,129,0.3)] disabled:opacity-50"
                      >
                        {fulfillingId === req.id ? (
                          <>
                            <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                            <span>PROCESSING...</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-4 h-4 stroke-[3]" />
                            <span>APPROVE & FULFILL NOW</span>
                          </>
                        )}
                      </button>

                      <button
                        disabled={fulfillingId === req.id}
                        onClick={() => handleFulfillPurchase(req, 'REJECT')}
                        className="py-2.5 px-4 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 font-bold text-xs uppercase disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 5: PLAN PRICING */}
      {activeTab === 'plans' && (
        <div className="space-y-4">
          <form onSubmit={handleSaveSettings} className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Tag className="w-5 h-5 text-cyan-400" />
              <span>MINI / PRO / BUSINESS Coin Pricing Configuration</span>
            </h3>
            <p className="text-xs text-slate-400">
              MINI plan remains permanently 0 coins (Free). Configure coin upgrade costs for PRO and BUSINESS tiers:
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-emerald-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-emerald-400">YASHI HALLS MINI</span>
                <input
                  type="text"
                  value="0 Coins (Free)"
                  disabled
                  className="w-full bg-[#07111c] border border-[#162740] rounded-xl px-3 py-2 text-xs font-mono text-slate-400"
                />
                <span className="text-[10px] text-slate-500 block">Default tier for all new accounts</span>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-cyan-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-cyan-400">YASHI HALLS PRO</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={proCoinPrice}
                    onChange={(e) => setProCoinPrice(Number(e.target.value))}
                    className="w-full bg-[#07111c] border border-cyan-500/50 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-xs font-mono text-slate-400">coins</span>
                </div>
                <span className="text-[10px] text-slate-400 block">5 Bot slots, unlimited quotas</span>
              </div>

              <div className="p-4 rounded-2xl bg-[#0e1c2d] border border-amber-500/40 space-y-2">
                <span className="text-xs font-mono font-bold text-amber-400">YASHI HALLS BUSINESS</span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    value={businessCoinPrice}
                    onChange={(e) => setBusinessCoinPrice(Number(e.target.value))}
                    className="w-full bg-[#07111c] border border-amber-500/50 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-xs font-mono text-slate-400">coins</span>
                </div>
                <span className="text-[10px] text-slate-400 block">25 Bot slots, VIP Enterprise SLA</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider"
              >
                Save Plan Prices
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 6: SETTINGS */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          <form onSubmit={handleSaveSettings} className="p-5 rounded-3xl bg-[#081220] border border-[#15273f] space-y-4">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-amber-400" />
              <span>General Platform & WhatsApp Configuration</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Brand / Platform Name</label>
                <input
                  type="text"
                  value={storeName}
                  onChange={(e) => setStoreName(e.target.value)}
                  className="w-full bg-[#0a1422] border border-[#17273d] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-300">Admin WhatsApp Contact Number</label>
                <input
                  type="text"
                  value={adminWhatsapp}
                  onChange={(e) => setAdminWhatsapp(e.target.value)}
                  placeholder="0740712934"
                  className="w-full bg-[#0a1422] border border-[#17273d] rounded-xl px-3 py-2 text-xs font-mono text-white"
                />
                <span className="text-[10px] text-slate-400">Used by customer "Contact Admin to Purchase" button</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs uppercase tracking-wider"
              >
                Update System Settings
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB: VOICE AUTO-REPLIES */}
      {activeTab === 'voice' && (
        <VoiceAutoRepliesAdmin
          userEmail={user.email}
          addToast={addToast}
          customers={customers}
        />
      )}

      {/* TAB: WEBSITE DESIGN & CSS STUDIO */}
      {activeTab === 'site-design' && (
        <AdminSiteDesignStudio
          adminEmail={user.email || 'sawrikasuraj759@gmail.com'}
          addToast={addToast}
        />
      )}

      {/* TAB: AUTO ORDER MANAGEMENT (FFGLORY API DELIVERY) */}
      {activeTab === 'auto-orders' && (
        <AutoOrderManagementView
          tenantId={`${effectiveUserId || 'primary'}__business`}
          onToast={addToast}
        />
      )}

      {/* TAB: BOT ENGINE, BAILEYS & COMMAND STUDIO */}
      {activeTab === 'bot-studio' && (
        <AdminBotStudio
          adminEmail={user.email || 'sawrikasuraj759@gmail.com'}
          addToast={addToast}
        />
      )}

      {/* TAB 7: AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="space-y-4">
          <div className="rounded-3xl bg-[#081220] border border-[#15273f] p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>Immutable Admin Audit Trail</span>
            </h3>
            <p className="text-xs text-slate-400">
              Every sensitive administrative action, coin grant, suspension, and purchase approval is logged below.
            </p>

            <div className="space-y-2 pt-2 max-h-96 overflow-y-auto pr-1">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 rounded-xl bg-[#0c1827] border border-[#162740] text-xs font-mono space-y-1">
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span className="text-amber-400 font-bold">{log.action}</span>
                    <span>{new Date(log.timestamp).toLocaleString()}</span>
                  </div>
                  <div className="text-white leading-relaxed">{log.details}</div>
                  <div className="text-[10px] text-slate-500">By: {log.adminEmail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

        </div>
      </div>

      {/* MODAL: COIN ADD / DEDUCT */}
      <AnimatePresence>
        {coinModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              className="w-full max-w-md rounded-3xl bg-[#081220] border-2 border-amber-500/50 p-5 sm:p-6 shadow-[0_0_40px_rgba(245,158,11,0.3)] space-y-4"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#14263e]">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Coins className="w-5 h-5 text-amber-400" />
                  <span>Manual Coin Adjustment</span>
                </h3>
                <button onClick={() => setCoinModalOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleModifyCoins} className="space-y-3.5">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Target Customer</label>
                  <select
                    value={targetCustomer?.id || ''}
                    onChange={(e) => {
                      const found = customers.find((c) => c.id === e.target.value);
                      if (found) setTargetCustomer(found);
                    }}
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs text-white"
                  >
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.username} ({c.email}) — Balance: {c.coins} coins
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setCoinAction('ADD')}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      coinAction === 'ADD'
                        ? 'bg-emerald-500 text-slate-950 shadow-md'
                        : 'bg-[#0a1626] text-slate-400 border border-[#172b45]'
                    }`}
                  >
                    + ADD COINS
                  </button>

                  <button
                    type="button"
                    onClick={() => setCoinAction('DEDUCT')}
                    className={`py-2 rounded-xl text-xs font-bold transition-all ${
                      coinAction === 'DEDUCT'
                        ? 'bg-rose-500 text-white shadow-md'
                        : 'bg-[#0a1626] text-slate-400 border border-[#172b45]'
                    }`}
                  >
                    - DEDUCT COINS
                  </button>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Coin Amount</label>
                  <input
                    type="number"
                    min="1"
                    value={coinAmount}
                    onChange={(e) => setCoinAmount(Math.max(1, Number(e.target.value)))}
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1">Audit Reason</label>
                  <input
                    type="text"
                    value={coinReason}
                    onChange={(e) => setCoinReason(e.target.value)}
                    placeholder="e.g. Manual bank deposit verified / Launch promo"
                    className="w-full bg-[#0a1626] border border-[#172b45] rounded-xl px-3 py-2 text-xs text-white focus:outline-none"
                    required
                  />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="submit"
                    disabled={isCoinSubmitting}
                    className="flex-1 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black text-xs uppercase tracking-wider"
                  >
                    {isCoinSubmitting ? 'Updating Balance...' : `CONFIRM ${coinAction} ${coinAmount} COINS`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCoinModalOpen(false)}
                    className="py-3 px-4 rounded-xl bg-[#0b1626] text-slate-400 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
