import React, { useState, useEffect } from 'react';
import { X, Rocket, Bot } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { BOT_TEMPLATES } from '../data/initialData';

export const DeployBotModal: React.FC = () => {
  const {
    openDeployModal,
    setOpenDeployModal,
    selectedTemplateForDeploy,
    deployBot,
    addToast,
  } = useApp();

  const template = selectedTemplateForDeploy || BOT_TEMPLATES[0];
  const [botName, setBotName] = useState(template?.title || 'YASHI HALLS MINI');
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    if (template) {
      setBotName(template.title);
      const defaults: Record<string, string> = {};
      for (const item of template.defaultEnv || []) {
        defaults[item.key] = item.defaultValue;
      }
      setEnvValues(defaults);
    }
  }, [template]);

  if (!openDeployModal || !template) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsDeploying(true);
    try {
      const res = await deployBot(template, botName.trim() || template.title, envValues);
      addToast(res.message, res.success ? 'success' : 'error');
      if (res.success) setOpenDeployModal(false);
    } finally {
      setIsDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Deploy {template.title}</h3>
          </div>
          <button
            onClick={() => setOpenDeployModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Bot Instance Name</label>
            <input
              type="text"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              required
            />
          </div>

          {(template.defaultEnv || []).map((field) => (
            <div key={field.key} className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">
                {field.key}{' '}
                <span className="text-[10px] text-slate-500 font-normal">({field.description})</span>
              </label>
              <input
                type="text"
                value={envValues[field.key] ?? ''}
                onChange={(e) => setEnvValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                required={field.required}
              />
            </div>
          ))}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenDeployModal(false)}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isDeploying}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              <Rocket className="w-3.5 h-3.5" />
              {isDeploying ? 'Deploying...' : 'Launch Bot'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
