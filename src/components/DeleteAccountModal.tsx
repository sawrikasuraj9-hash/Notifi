import React, { useState } from 'react';
import { X, AlertTriangle, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const DeleteAccountModal: React.FC = () => {
  const {
    openDeleteAccountModal,
    setOpenDeleteAccountModal,
    resetAccountData,
    logout,
    addToast,
  } = useApp();

  const [confirmText, setConfirmText] = useState('');

  if (!openDeleteAccountModal) return null;

  const canDelete = confirmText.trim().toUpperCase() === 'DELETE';

  const handleConfirm = async () => {
    if (!canDelete) return;
    resetAccountData();
    setOpenDeleteAccountModal(false);
    addToast('Account data cleared and signed out.', 'info');
    await logout();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#0a101d] border border-rose-500/40 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-5 h-5" />
            <h3 className="text-sm font-bold">Reset / Delete Account Data</h3>
          </div>
          <button
            onClick={() => setOpenDeleteAccountModal(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            This will reset your local account configuration and sign you out. Type{' '}
            <span className="font-mono font-bold text-rose-400">DELETE</span> below to confirm.
          </p>

          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
          />

          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => setOpenDeleteAccountModal(false)}
              className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canDelete}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-white font-bold text-xs transition cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Confirm Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
