import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { CFD_INSTRUMENTS, TOP_CRYPTO_PAIRS } from '../constants/tradingPairs';
import { supabase } from '../lib/supabaseClient';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

interface TradingChartProps {
  selectedPair: string;
  backgroundVariant?: 'default' | 'futures' | 'cfd';
}

interface MarketBar {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const intervals = ['1min', '5min', '15min', '1h', '1day'] as const;
type ChartInterval = typeof intervals[number];
const SUPABASE_CHART_REFRESH_MS = 30 * 1000;

const getInstrumentType = (symbol: string) => {
  if (TOP_CRYPTO_PAIRS.some(item => item.symbol === symbol) || symbol.endsWith('USDT')) return 'crypto';
  return CFD_INSTRUMENTS.find(item => item.symbol === symbol)?.type || 'stock';
};

const formatAxisTime = (value: string, interval: ChartInterval) => {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return interval === '1day'
    ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
};

const TradingChart: React.FC<TradingChartProps> = ({ selectedPair, backgroundVariant = 'default' }) => {
  const [interval, setInterval] = useState<ChartInterval>('5min');
  const [bars, setBars] = useState<MarketBar[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadSeries = useCallback(async () => {
    if (!selectedPair) return;
    setIsLoading(true);
    try {
      const { data: sessionResult } = await supabase.auth.getSession();
      if (!sessionResult.session) throw new Error('Sign in to load live market history');
      const { data, error: invokeError } = await supabase.functions.invoke('cfd-market-data', {
        body: {
          action: 'time_series',
          symbol: selectedPair,
          type: getInstrumentType(selectedPair),
          interval,
          outputsize: 160,
        },
        headers: { Authorization: `Bearer ${sessionResult.session.access_token}` }
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error('Market history is temporarily unavailable');
      const values = Array.isArray(data?.values) ? data.values as MarketBar[] : [];
      if (values.length === 0) throw new Error('No chart history is available for this market');
      setBars([...values].reverse());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load market chart');
    } finally {
      setIsLoading(false);
    }
  }, [interval, selectedPair]);

  useEffect(() => {
    void loadSeries();
    const timer = window.setInterval(() => void loadSeries(), SUPABASE_CHART_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [interval, loadSeries]);

  const chartData = useMemo(() => ({
    labels: bars.map(bar => formatAxisTime(bar.datetime, interval)),
    datasets: [{
      label: selectedPair,
      data: bars.map(bar => bar.close),
      borderColor: '#22c55e',
      backgroundColor: 'rgba(34, 197, 94, 0.10)',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      fill: true,
      tension: 0.15,
    }]
  }), [bars, interval, selectedPair]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: { labels: { color: '#cbd5e1', boxWidth: 12 } },
      tooltip: {
        callbacks: {
          afterBody: (items: Array<{ dataIndex: number }>) => {
            const bar = bars[items[0]?.dataIndex];
            return bar ? [`O ${bar.open}`, `H ${bar.high}`, `L ${bar.low}`, `C ${bar.close}`] : [];
          }
        }
      }
    },
    scales: {
      x: { ticks: { color: '#64748b', maxTicksLimit: 8 }, grid: { color: 'rgba(51,65,85,0.35)' } },
      y: { position: 'right' as const, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.45)' } }
    }
  }), [bars]);

  const themed = backgroundVariant === 'futures' || backgroundVariant === 'cfd';
  return (
    <div className={`relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-xl ${themed ? 'app-surface-primary' : 'bg-slate-900'} sm:min-h-[340px] lg:min-h-[420px] xl:min-h-0`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700/70 px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
          Live market data · refreshed every 30 seconds
        </div>
        <div className="flex gap-1">
          {intervals.map(value => (
            <button
              type="button"
              key={value}
              onClick={() => setInterval(value)}
              className={`rounded-md px-2 py-1 text-[11px] font-semibold ${interval === value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1 p-3">
        {bars.length > 0 && <Line data={chartData} options={chartOptions} />}
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm">
            <div className="text-center text-sm text-slate-300"><div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />Loading market chart</div>
          </div>
        )}
        {!isLoading && error && bars.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-400">{error}</div>
        )}
      </div>
    </div>
  );
};

export default TradingChart;
