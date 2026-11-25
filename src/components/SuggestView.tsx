import React, { useState } from 'react';
import { Lightbulb, Send, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

export const SuggestView: React.FC = () => {
  const { addToast } = useApp();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('WhatsApp Command');
  const [details, setDetails] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !details.trim()) {
      addToast('Please fill in both feature title and description.', 'error');
      return;
    }
    setSubmitted(true);
    addToast('Thank you! Your feature suggestion has been submitted.', 'success');
    setTitle('');
    setDetails('');
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-8">
      <div>
        <h2 className="text-xl font-black text-white flex items-center gap-2">
          <Lightbulb className="w-5 h-5 text-amber-400" />
          Suggest a Feature
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Tell us what commands, integrations, or business automation tools you want next.
        </p>
      </div>

      {submitted && (
        <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/35 p-4 flex items-center gap-3 text-emerald-300 text-xs">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>Your suggestion was recorded! Feel free to submit another idea anytime.</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl bg-[#0a101d] border border-slate-800 p-6 space-y-4"
      >
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option>WhatsApp Command</option>
            <option>Business Store & Auto-Orders</option>
            <option>FFGlory & Guild Automation</option>
            <option>AI & Media Downloader</option>
            <option>Dashboard UI</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Feature Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Auto-schedule daily guild glory reports"
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-300">Description</label>
          <textarea
            rows={4}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            placeholder="Describe how this feature should work..."
            className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-500 resize-none"
          />
        </div>

        <button
          type="submit"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" />
          Submit Suggestion
        </button>
      </form>
    </div>
  );
};
