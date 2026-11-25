import React from 'react';
import { Rocket, Bot, Sparkles } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BOT_TEMPLATES } from '../data/initialData';

export const TemplatesView: React.FC = () => {
  const { setSelectedTemplateForDeploy, setOpenDeployModal } = useApp();

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-cyan-400" />
            Bot Templates
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Deploy pre-configured WhatsApp automation engines in one click.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {BOT_TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="rounded-2xl bg-[#0a101d] border border-slate-800 hover:border-cyan-500/40 p-5 flex flex-col justify-between gap-5 transition"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <Bot className="w-5 h-5" />
                </div>
                {tpl.badge && (
                  <span className="px-2.5 py-1 rounded-lg bg-purple-500/15 border border-purple-500/30 text-[10px] font-bold text-purple-300 uppercase">
                    {tpl.badge}
                  </span>
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{tpl.title}</h3>
                <p className="text-[11px] text-cyan-400 font-semibold mt-0.5">
                  {tpl.platform} • {tpl.category}
                </p>
                <p className="text-xs text-slate-400 mt-2 leading-relaxed">{tpl.description}</p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
              <span className="text-xs font-bold text-amber-400">
                {tpl.costCoins === 0 ? 'FREE' : `${tpl.costCoins} Coins`}
              </span>
              <button
                onClick={() => {
                  setSelectedTemplateForDeploy(tpl);
                  setOpenDeployModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition cursor-pointer"
              >
                <Rocket className="w-3.5 h-3.5" />
                Deploy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
