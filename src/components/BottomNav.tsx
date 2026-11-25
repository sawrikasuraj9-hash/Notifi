import React from 'react';
import { LayoutDashboard, Smartphone, Store, Wallet, Settings } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { AppTab } from '../types';

const NAV_ITEMS: { id: AppTab; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { id: 'deployments', label: 'Pair Bot', icon: Smartphone },
  { id: 'business-bot', label: 'Business', icon: Store },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export const BottomNav: React.FC = () => {
  const { activeTab, setActiveTab } = useApp();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#060b18]/95 backdrop-blur-xl border-t border-slate-800/80 px-2 py-2">
      <div className="grid grid-cols-5 gap-1 max-w-lg mx-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition cursor-pointer ${
                active
                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[10px] font-semibold leading-none">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
