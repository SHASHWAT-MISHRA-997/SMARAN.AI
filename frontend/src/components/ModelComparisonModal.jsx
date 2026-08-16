import React from 'react';
import { X, Cpu, Check, BarChart2, Sparkles, FileText, Eye, Mic, Video, Code, Brain, Trophy, Award, Target, Flame } from 'lucide-react';

const CAPABILITY_ICONS = {
  Text: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  Vision: <Eye className="w-3.5 h-3.5 text-emerald-400" />,
  Audio: <Mic className="w-3.5 h-3.5 text-amber-400" />,
  Video: <Video className="w-3.5 h-3.5 text-rose-400" />,
  Files: <FileText className="w-3.5 h-3.5 text-indigo-400" />,
  Code: <Code className="w-3.5 h-3.5 text-purple-400" />,
  Reasoning: <Brain className="w-3.5 h-3.5 text-cyan-400" />,
};

const ModelComparisonModal = ({ isOpen, onClose, models = [], userGpuVram = 6.0 }) => {
  if (!isOpen || !models || models.length === 0) return null;

  const benchmarkKeys = [
    { key: 'mmlu', label: 'MMLU (General Knowledge)', color: 'from-blue-500 to-indigo-500', barColor: 'bg-blue-500' },
    { key: 'humaneval', label: 'HumanEval (Python Coding)', color: 'from-cyan-500 to-teal-500', barColor: 'bg-cyan-500' },
    { key: 'gsm8k', label: 'GSM8K (Math Reasoning)', color: 'from-purple-500 to-pink-500', barColor: 'bg-purple-500' },
    { key: 'math', label: 'MATH (Advanced Competition Math)', color: 'from-amber-500 to-orange-500', barColor: 'bg-amber-500' },
    { key: 'gpqa', label: 'GPQA (Graduate Q&A)', color: 'from-emerald-500 to-green-500', barColor: 'bg-emerald-500' },
    { key: 'ifeval', label: 'IFEval (Strict Instruction Following)', color: 'from-rose-500 to-red-500', barColor: 'bg-rose-500' },
  ];

  const allCapabilities = ["Text", "Vision", "Audio", "Video", "Files", "Code", "Reasoning"];

  // Compute Overall Accuracy Average for each model
  const modelsWithAccuracy = models.map((m) => {
    const bm = m.benchmarks || {};
    const scores = [bm.mmlu, bm.humaneval, bm.gsm8k, bm.math, bm.gpqa, bm.ifeval].filter((s) => typeof s === 'number');
    const avgScore = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
    return { ...m, overallAccuracy: parseFloat(avgScore) };
  });

  // Sort by overall accuracy desc to find rankings
  const rankedModels = [...modelsWithAccuracy].sort((a, b) => b.overallAccuracy - a.overallAccuracy);

  const getRankBadge = (modelId) => {
    const rank = rankedModels.findIndex((m) => m.id === modelId) + 1;
    if (rank === 1) return { label: '🏆 #1 Overall Accuracy', bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40' };
    if (rank === 2) return { label: '🥈 #2 Runner Up', bg: 'bg-zinc-400/20 text-zinc-300 border-zinc-400/40' };
    if (rank === 3) return { label: '🥉 #3 Rank', bg: 'bg-amber-700/20 text-amber-400 border-amber-700/40' };
    return { label: `#${rank} Rank`, bg: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-6xl max-h-[92vh] bg-zinc-950 border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-left">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur-sm shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                <BarChart2 className="w-4 h-4 text-indigo-400" />
              </div>
              <h2 className="text-lg font-black text-white tracking-wide flex items-center gap-2">
                Side-by-Side Accuracy Comparison & Benchmark Matrix
                <span className="text-[10px] font-extrabold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  {models.length} Models
                </span>
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Verified technical benchmarks, accuracy charts, and hardware suitability compared on your {userGpuVram}GB GPU.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Matrix Body */}
        <div className="p-6 overflow-y-auto space-y-8">

          {/* 🏆 Overall Accuracy Comparison Cards */}
          <div>
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              Overall Benchmark Accuracy Rating & Rankings
            </h4>
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${models.length}, minmax(0, 1fr))` }}>
              {modelsWithAccuracy.map((m) => {
                const rankInfo = getRankBadge(m.id);
                return (
                  <div
                    key={m.id}
                    className={`p-4 rounded-2xl border transition-all relative ${
                      m.is_default || m.id === 'Qwen/Qwen3-4B-AWQ'
                        ? 'bg-indigo-950/20 border-indigo-500/40 ring-1 ring-indigo-500/20'
                        : 'bg-zinc-900/40 border-zinc-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-black uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md truncate whitespace-nowrap">
                        {m.company}
                      </span>
                      <span className={`text-[10px] font-black uppercase border px-2 py-0.5 rounded-md ${rankInfo.bg}`}>
                        {rankInfo.label}
                      </span>
                    </div>
                    <h3 className="text-base font-black text-white leading-snug">{m.name}</h3>

                    {/* Overall Accuracy Meter */}
                    <div className="mt-4 p-3 rounded-xl bg-zinc-950 border border-zinc-800 text-center space-y-1">
                      <div className="text-[10px] font-extrabold uppercase text-zinc-400">Overall Accuracy Score</div>
                      <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-cyan-400 to-indigo-400">
                        {m.overallAccuracy}%
                      </div>
                      {/* Overall Progress Bar */}
                      <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden mt-2">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-500"
                          style={{ width: `${m.overallAccuracy}%` }}
                        />
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-semibold">
                      <span className="text-zinc-400">Req GPU:</span>
                      <span className="text-indigo-300 font-extrabold">{m.recommended_gpu_vram_gb || 6.0} GB</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 📊 Side-by-Side Accuracy Comparison Bar Charts */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5 space-y-6">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-cyan-400" />
                Benchmark Accuracy Breakdown Comparison Graphs
              </h4>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Score Scale: 0 - 100%</span>
            </div>

            <div className="space-y-6">
              {benchmarkKeys.map(({ key, label, barColor }) => (
                <div key={key} className="bg-zinc-950 p-4 rounded-2xl border border-zinc-800/80 space-y-3">
                  <div className="flex items-center justify-between text-xs font-extrabold text-zinc-200">
                    <span className="flex items-center gap-2">
                      <Target className="w-3.5 h-3.5 text-indigo-400" />
                      {label}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {modelsWithAccuracy.map((m) => {
                      const score = m.benchmarks?.[key] || 0;
                      return (
                        <div key={m.id} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-zinc-300 flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-500" />
                              {m.name}
                            </span>
                            <span className="font-black text-white bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                              {score}%
                            </span>
                          </div>
                          {/* Accuracy Graph Bar */}
                          <div className="w-full h-3 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800/60 p-0.5">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all duration-500 shadow-sm`}
                              style={{ width: `${score}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ⚡ 1. Core Specifications & Quantization */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-indigo-400" />
              Core Specifications & Quantization
            </h4>
            <div className="divide-y divide-zinc-800/60 text-xs">
              <div className="py-3 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                <span className="font-bold text-zinc-400">Parameters</span>
                {models.map((m) => (
                  <span key={m.id} className="font-black text-white text-sm">
                    {m.parameters}
                  </span>
                ))}
              </div>
              <div className="py-3 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                <span className="font-bold text-zinc-400">Context Window</span>
                {models.map((m) => (
                  <span key={m.id} className="font-semibold text-zinc-200">
                    {m.context_length}
                  </span>
                ))}
              </div>
              <div className="py-3 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                <span className="font-bold text-zinc-400">Quantization</span>
                {models.map((m) => (
                  <span key={m.id} className="font-medium text-indigo-300">
                    {m.quantization}
                  </span>
                ))}
              </div>
              <div className="py-3 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                <span className="font-bold text-zinc-400">Req GPU Spec</span>
                {models.map((m) => (
                  <span key={m.id} className="font-extrabold text-indigo-400">
                    {m.recommended_gpu_name || `${m.recommended_gpu_vram_gb}GB VRAM`}
                  </span>
                ))}
              </div>
              <div className="py-3 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                <span className="font-bold text-zinc-400">Hardware Suitability</span>
                {models.map((m) => (
                  <div key={m.id}>
                    <span className="inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200">
                      {m.hardware_fit?.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 🌟 2. Capability Matrix */}
          <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-5">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-400 mb-4 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" />
              Multimodal Capability Matrix
            </h4>
            <div className="divide-y divide-zinc-800/60 text-xs">
              {allCapabilities.map((cap) => (
                <div key={cap} className="py-2.5 grid items-center" style={{ gridTemplateColumns: `160px repeat(${models.length}, minmax(0, 1fr))` }}>
                  <div className="flex items-center gap-2 font-bold text-zinc-300">
                    {CAPABILITY_ICONS[cap]}
                    <span>{cap}</span>
                  </div>
                  {models.map((m) => {
                    const supported = m.capabilities.includes(cap);
                    return (
                      <div key={m.id}>
                        {supported ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-bold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                            <Check className="w-3.5 h-3.5" /> Supported
                          </span>
                        ) : (
                          <span className="text-zinc-600 font-medium">—</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between shrink-0">
          <p className="text-xs text-zinc-500">
            All benchmark accuracy statistics are sourced from official published model evaluation sheets.
          </p>
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black tracking-wide transition-all shadow-lg cursor-pointer"
          >
            Close Matrix
          </button>
        </div>

      </div>
    </div>
  );
};

export default ModelComparisonModal;
