import React, { useState } from 'react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend, LineChart, Line, 
  PieChart, Pie, Cell 
} from 'recharts';
import { BarChart3, LineChart as LineIcon, PieChart as PieIcon, Table, Download, Eye, EyeOff } from 'lucide-react';

// Premium Color Palettes (Harmonious tailwind-compatible HSL scales)
const COLORS = [
  '#6366f1', // Indigo
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#14b8a6'  // Teal
];

const GRADIENTS = [
  { id: 'colorIndigo', start: '#818cf8', end: '#4f46e5' },
  { id: 'colorBlue', start: '#60a5fa', end: '#2563eb' },
  { id: 'colorEmerald', start: '#34d399', end: '#059669' },
  { id: 'colorAmber', start: '#fbbf24', end: '#d97706' }
];

export default function ArtifactRenderer({ data }) {
  const [activeTab, setActiveTab] = useState(data.type || 'bar');
  const [showRaw, setShowRaw] = useState(false);

  if (!data) return null;
  const { title = 'Data Visualization', labels = [], datasets = [] } = data;
  
  if (labels.length === 0 || datasets.length === 0) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-xl text-red-600 text-sm">
        Invalid Chart Data: Labels or datasets are missing.
      </div>
    );
  }

  // Format data for Recharts
  const chartData = labels.map((label, index) => {
    const row = { name: label };
    datasets.forEach(dataset => {
      row[dataset.label] = dataset.data[index] || 0;
    });
    return row;
  });

  const datasetKeys = datasets.map(d => d.label);

  // CSV Export utility
  const exportToCSV = () => {
    let csvContent = 'data:text/csv;charset=utf-8,';
    csvContent += ['Label', ...datasetKeys].join(',') + '\n';
    
    chartData.forEach(row => {
      const line = [row.name, ...datasetKeys.map(key => row[key])].join(',');
      csvContent += line + '\n';
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${title.replace(/\s+/g, '_')}_data.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="my-6 w-full max-w-3xl bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-lg overflow-hidden transition-all duration-300">
      
      {/* Header Panel */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40 gap-3">
        <div>
          <h4 className="text-sm font-black text-zinc-950 dark:text-white tracking-wide uppercase">{title}</h4>
          <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold mt-0.5">Interactive Analytics Dashboard</p>
        </div>
        
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-900 p-1 rounded-xl self-stretch sm:self-auto border border-zinc-200 dark:border-zinc-800">
          <button 
            onClick={() => setActiveTab('bar')}
            className={`p-1.5 rounded-lg transition-all ${activeTab === 'bar' ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
            title="Bar Chart"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveTab('line')}
            className={`p-1.5 rounded-lg transition-all ${activeTab === 'line' ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
            title="Line Chart"
          >
            <LineIcon className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveTab('pie')}
            className={`p-1.5 rounded-lg transition-all ${activeTab === 'pie' ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
            title="Pie Chart"
          >
            <PieIcon className="w-4 h-4" />
          </button>
          <button 
            onClick={() => setActiveTab('table')}
            className={`p-1.5 rounded-lg transition-all ${activeTab === 'table' ? 'bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300'}`}
            title="Data Table"
          >
            <Table className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Chart Viewer */}
      <div className="p-5 min-h-[300px] flex items-center justify-center bg-white dark:bg-zinc-950/20">
        
        {activeTab === 'bar' && (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  {GRADIENTS.map(g => (
                    <linearGradient key={g.id} id={g.id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={g.start} stopOpacity={0.9}/>
                      <stop offset="95%" stopColor={g.end} stopOpacity={0.3}/>
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800/80" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }}
                  axisLine={{ stroke: '#3f3f46', opacity: 0.2 }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }}
                  axisLine={{ stroke: '#3f3f46', opacity: 0.2 }}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', color: '#fff' }}
                  labelStyle={{ fontWeight: 'bold', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 10 }} />
                {datasetKeys.map((key, i) => (
                  <Bar 
                    key={key} 
                    dataKey={key} 
                    fill={`url(#${GRADIENTS[i % GRADIENTS.length].id})`} 
                    radius={[6, 6, 0, 0]} 
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === 'line' && (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-zinc-200 dark:stroke-zinc-800/80" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }}
                  axisLine={{ stroke: '#3f3f46', opacity: 0.2 }}
                  tickLine={false}
                />
                <YAxis 
                  tick={{ fill: '#71717a', fontSize: 10, fontWeight: 700 }}
                  axisLine={{ stroke: '#3f3f46', opacity: 0.2 }}
                  tickLine={false}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', color: '#fff' }}
                  labelStyle={{ fontWeight: 'bold', fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700, paddingTop: 10 }} />
                {datasetKeys.map((key, i) => (
                  <Line 
                    key={key} 
                    type="monotone" 
                    dataKey={key} 
                    stroke={COLORS[i % COLORS.length]} 
                    strokeWidth={3}
                    dot={{ r: 4, strokeWidth: 2 }}
                    activeDot={{ r: 6 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === 'pie' && (
          <div className="w-full h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData.map(row => ({ name: row.name, value: row[datasetKeys[0]] }))}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '12px', color: '#fff' }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {activeTab === 'table' && (
          <div className="w-full max-h-[290px] overflow-auto border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-4 py-2.5 text-xs font-black text-zinc-500 uppercase">Item</th>
                  {datasetKeys.map(key => (
                    <th key={key} className="px-4 py-2.5 text-xs font-black text-zinc-500 uppercase text-right">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-950/20">
                {chartData.map((row, idx) => (
                  <tr key={idx} className="hover:bg-zinc-100/50 dark:hover:bg-zinc-900/40 transition-colors font-semibold">
                    <td className="px-4 py-2.5 text-sm text-zinc-950 dark:text-white">{row.name}</td>
                    {datasetKeys.map(key => (
                      <td key={key} className="px-4 py-2.5 text-sm text-zinc-950 dark:text-zinc-300 font-mono text-right">{row[key].toLocaleString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="flex items-center justify-between p-3.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950/40">
        <button 
          onClick={exportToCSV}
          className="flex items-center gap-1.5 text-xs font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 cursor-pointer select-none"
        >
          <Download className="w-3.5 h-3.5" />
          Export to CSV
        </button>

        <button 
          onClick={() => setShowRaw(!showRaw)}
          className="flex items-center gap-1 text-[10px] font-bold text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 cursor-pointer select-none"
        >
          {showRaw ? (
            <>
              <EyeOff className="w-3 h-3" /> Hide Raw Data
            </>
          ) : (
            <>
              <Eye className="w-3 h-3" /> Show Raw Data
            </>
          )}
        </button>
      </div>

      {/* Raw JSON block (hidden by default) */}
      {showRaw && (
        <div className="p-4 bg-zinc-950 border-t border-zinc-800 text-left">
          <pre className="text-[11px] font-mono text-emerald-400 overflow-x-auto p-3 rounded-lg bg-zinc-900 leading-normal">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
