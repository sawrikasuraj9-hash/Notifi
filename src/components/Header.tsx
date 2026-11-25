import React, { useState } from 'react';
import { Menu, Bell, Coins, Shield, Radio, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const Header: React.FC = () => {
  const {
    user,
    coins,
    serverBotState,
    setIsSidebarOpen,
    setActiveTab,
    notifications,
    markNotificationRead,
    markAllNotificationsRead,
    isAdmin,
  } = useApp();

  const [showNotifs, setShowNotifs] = useState(false);
  const unreadCount = notifications.filter((n) => !n.read).length;
  const isOnline = Boolean(serverBotState?.isOnline);

  return (
    <header className="sticky top-0 z-30 h-16 px-4 md:px-6 bg-[#060b18]/85 backdrop-blur-xl border-b border-slate-800/70 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="lg:hidden p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-cyan-400 hover:border-cyan-500/40 transition cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center font-black text-xs text-white shadow-lg shadow-cyan-500/20 shrink-0">
            YH
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-extrabold tracking-wide text-white truncate">
              YASHI HALLS <span className="text-cyan-400">MINI</span>
            </h1>
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
              <span className="truncate">
                {isOnline ? 'WhatsApp Engine Online' : 'Engine Standby'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        {isAdmin && (
          <button
            onClick={() => setActiveTab('admin')}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-500/15 border border-purple-500/35 text-purple-300 hover:bg-purple-500/25 text-xs font-semibold transition cursor-pointer"
          >
            <Shield className="w-3.5 h-3.5" />
            Admin
          </button>
        )}

        <button
          onClick={() => setActiveTab('wallet')}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 hover:bg-amber-500/20 text-xs font-bold transition cursor-pointer"
        >
          <Coins className="w-3.5 h-3.5 text-amber-400" />
          <span>{coins.toLocaleString()}</span>
        </button>

        <div className="relative">
          <button
            onClick={() => setShowNotifs((v) => !v)}
            className="relative p-2 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-300 hover:text-cyan-400 hover:border-cyan-500/40 transition cursor-pointer"
            aria-label="Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5 text-cyan-400" />
                  Notifications
                </span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllNotificationsRead}
                    className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3 h-3" />
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/70">
                {notifications.length === 0 ? (
                  <p className="p-4 text-xs text-slate-400 text-center">No notifications yet.</p>
                ) : (
                  notifications.slice(0, 10).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markNotificationRead(n.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-slate-800/40 transition cursor-pointer ${
                        n.read ? 'opacity-65' : 'bg-cyan-500/5'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white truncate">{n.title}</p>
                        <span className="text-[10px] text-slate-500 shrink-0">{n.time}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{n.message}</p>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => setActiveTab('settings')}
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 border border-cyan-500/30 flex items-center justify-center text-xs font-bold text-cyan-300 hover:border-cyan-400 transition cursor-pointer"
          title={user.username}
        >
          {(user.avatarLetter || user.username?.[0] || 'Y').toUpperCase()}
        </button>
      </div>
    </header>
  );
};
