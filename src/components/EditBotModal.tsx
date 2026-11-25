import React, { useState, useEffect } from 'react';
import { X, Save, Bot } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const EditBotModal: React.FC = () => {
  const {
    openEditBotModal,
    setOpenEditBotModal,
    serverBotState,
    updateBotConfig,
    addToast,
  } = useApp();

  const [botName, setBotName] = useState('YASHI HALLS MINI');
  const [ownerName, setOwnerName] = useState('YASHI HALLS');
  const [prefix, setPrefix] = useState('.');
  const [ownerNumber, setOwnerNumber] = useState('');
  const [mode, setMode] = useState<'public' | 'private'>('public');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (openEditBotModal && serverBotState?.config) {
      setBotName(serverBotState.config.botName || 'YASHI HALLS MINI');
      setOwnerName(serverBotState.config.ownerName || 'YASHI HALLS');
      setPrefix(serverBotState.config.prefix || '.');
      setOwnerNumber(serverBotState.config.ownerNumber || '');
      setMode(serverBotState.config.mode || 'public');
    }
  }, [openEditBotModal, serverBotState]);

  if (!openEditBotModal) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateBotConfig({
        botName: botName.trim() || 'YASHI HALLS MINI',
        ownerName: ownerName.trim() || 'YASHI HALLS',
        prefix: prefix.trim() || '.',
        ownerNumber: ownerNumber.trim(),
        mode,
      });
      addToast('Bot settings saved successfully!', 'success');
      setOpenEditBotModal(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-slate-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Edit Bot Identity</h3>
          </div>
          <button
            onClick={() => setOpenEditBotModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Bot Display Name</label>
            <input
              type="text"
              value={botName}
              onChange={(e) => setBotName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Owner Name</label>
            <input
              type="text"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Command Prefix</label>
              <input
                type="text"
                value={prefix}
                maxLength={3}
                onChange={(e) => setPrefix(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value === 'private' ? 'private' : 'public')}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="public">Public</option>
                <option value="private">Private</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Owner WhatsApp Number</label>
            <input
              type="text"
              value={ownerNumber}
              onChange={(e) => setOwnerNumber(e.target.value)}
              placeholder="e.g. 94740712934"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpenEditBotModal(false)}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
