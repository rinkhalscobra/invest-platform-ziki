import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { useMarketData } from '../contexts/MarketDataContext';
import { TradingMode } from '../App';

interface OrderBookEntry {
  price: number;
  amount: number;
  total: number;
}

interface OrderBookProps {
  selectedPair: string;
  orderBook?: {  // Made optional since we're not passing it anymore
    bids: OrderBookEntry[];
    asks: OrderBookEntry[];
    lastUpdateId: number;
  };
  tradingMode: TradingMode;
}

interface OrderBookDropdownOption {
  label: string;
  value: number;
}

interface OrderBookDropdownProps {
  value: number;
  options: OrderBookDropdownOption[];
  onChange: (value: number) => void;
  align?: 'left' | 'right';
}

const OrderBookDropdown: React.FC<OrderBookDropdownProps> = ({
  value,
  options,
  onChange,
  align = 'right',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="flex min-w-[72px] items-center justify-between gap-2 rounded-lg border border-purple-500/35 app-action-soft px-3 py-1.5 text-white shadow-lg shadow-purple-950/20 transition-colors hover:from-indigo-500/24 hover:via-purple-500/26 hover:to-fuchsia-500/22"
      >
        <span className="font-medium">{selectedOption?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`text-purple-200 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute bottom-full z-20 mb-2 min-w-full overflow-hidden rounded-xl app-dropdown ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="p-1.5">
            {options.map((option) => {
              const isSelected = option.value === value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-white transition-colors ${
                    isSelected
                      ? 'bg-gradient-to-r from-indigo-500/20 via-purple-500/22 to-fuchsia-500/18'
                      : 'hover:bg-gradient-to-r hover:from-indigo-500/12 hover:via-purple-500/14 hover:to-fuchsia-500/12'
                  }`}
                >
                  <span className={isSelected ? 'text-white' : 'text-slate-200'}>{option.label}</span>
                  {isSelected ? <Check size={14} className="text-purple-200" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const OrderBook: React.FC<OrderBookProps> = ({
  selectedPair,
  orderBook,
  tradingMode
}) => {
  const { getPriceBySymbol, getMarketDataBySymbol } = useMarketData();
  const [displayMode, setDisplayMode] = useState<'both' | 'bids' | 'asks'>('both');
  const [precision, setPrecision] = useState(2);
  const [grouping, setGrouping] = useState(0.5);
  const currentPrice = getPriceBySymbol(selectedPair);
  const currentMarket = getMarketDataBySymbol(selectedPair);
  const isFuturesTheme = tradingMode === 'futures';
  const panelSurfaceClass = isFuturesTheme
    ? 'app-surface-primary'
    : 'bg-slate-800';
  const headerSurfaceClass = isFuturesTheme
    ? 'app-surface-muted'
    : 'bg-slate-800';
  const priceSurfaceClass = isFuturesTheme
    ? 'app-surface-muted'
    : 'bg-slate-700/30';
  const precisionOptions: OrderBookDropdownOption[] = [
    { label: '0', value: 0 },
    { label: '1', value: 1 },
    { label: '2', value: 2 },
    { label: '3', value: 3 },
    { label: '4', value: 4 },
  ];
  const groupingOptions: OrderBookDropdownOption[] = [
    { label: '0.1', value: 0.1 },
    { label: '0.5', value: 0.5 },
    { label: '1.0', value: 1 },
    { label: '5.0', value: 5 },
  ];

// Use supplied depth when available. Otherwise show only the cached market
// quote instead of presenting simulated price levels as live depth.
const displayOrderBook = orderBook && orderBook.bids.length > 0 && orderBook.asks.length > 0
  ? orderBook
  : {
      asks: currentPrice > 0
        ? [{ price: currentMarket?.ask_price || currentPrice, amount: 0, total: 0 }]
        : [],
      bids: currentPrice > 0
        ? [{ price: currentMarket?.bid_price || currentPrice, amount: 0, total: 0 }]
        : [],
      lastUpdateId: currentMarket?.timestamp ? new Date(currentMarket.timestamp).getTime() : 0
    };


  // Format price based on precision
  const formatPrice = (price: number) => {
    return price.toFixed(precision);
  };

  // Format amount
  const formatAmount = (amount: number) => {
    return amount > 0 ? amount.toFixed(4) : '—';
  };

  // Format total
  const formatTotal = (total: number) => {
    return total > 0 ? total.toFixed(4) : '—';
  };

  // Calculate depth percentage for visualization
  const calculateDepthPercentage = (total: number, maxTotal: number) => {
    return maxTotal > 0 ? (total / maxTotal) * 100 : 0;
  };

  // Get max total for visualization scaling
  const maxBidTotal = displayOrderBook.bids.length > 0
    ? displayOrderBook.bids[displayOrderBook.bids.length - 1].total
    : 0;
    
  const maxAskTotal = displayOrderBook.asks.length > 0
    ? displayOrderBook.asks[displayOrderBook.asks.length - 1].total
    : 0;

  const bidPrice = currentMarket?.bid_price || currentPrice || 0;
  const askPrice = currentMarket?.ask_price || currentPrice || 0;
  const spread = askPrice > 0 && bidPrice > 0 ? Math.max(0, askPrice - bidPrice) : 0;
  const midpoint = askPrice > 0 && bidPrice > 0 ? (askPrice + bidPrice) / 2 : currentPrice;
  const spreadPercentage = midpoint > 0 ? (spread / midpoint) * 100 : 0;
  const sessionHigh = currentMarket?.high_price_24h || currentPrice || 0;
  const sessionLow = currentMarket?.low_price_24h || currentPrice || 0;
  const sessionChange = currentMarket?.change_24h || 0;
  const sessionVolume = currentMarket?.volume_24h || 0;
  const rangePosition = sessionHigh > sessionLow
    ? Math.min(100, Math.max(0, ((currentPrice - sessionLow) / (sessionHigh - sessionLow)) * 100))
    : 50;
  const updatedAt = currentMarket?.updated_at || currentMarket?.timestamp;

  const formatCompactNumber = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return '—';
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className={`${panelSurfaceClass} flex h-full min-h-[320px] flex-col`} translate="no">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-700 p-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-purple-400 font-semibold">Market Quote</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setDisplayMode('both')}
            className={`text-xs px-2 py-1 rounded ${
              displayMode === 'both'
                ? 'bg-gradient-to-r from-indigo-500/20 via-purple-500/22 to-fuchsia-500/18 text-purple-200'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Both
          </button>
          <button
            onClick={() => setDisplayMode('bids')}
            className={`text-xs px-2 py-1 rounded ${
              displayMode === 'bids'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Bids
          </button>
          <button
            onClick={() => setDisplayMode('asks')}
            className={`text-xs px-2 py-1 rounded ${
              displayMode === 'asks'
                ? 'bg-red-500/20 text-red-400'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Asks
          </button>
        </div>
      </div>

      {/* Order Book Content */}
      <div
        className={`flex flex-1 flex-col overflow-auto ${
          tradingMode === 'futures'
            ? '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden'
            : '[scrollbar-color:#fb923c_#1e293b] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-slate-800 [&::-webkit-scrollbar-thumb]:bg-orange-400 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-[2px] [&::-webkit-scrollbar-thumb]:border-solid [&::-webkit-scrollbar-thumb]:border-slate-800'
        }`}
        translate="no"
      >
        {/* Column Headers */}
        <div className={`sticky top-0 grid grid-cols-3 border-b border-slate-700 p-2 text-[11px] text-slate-400 sm:text-xs ${headerSurfaceClass}`}>
          <div>Price ({tradingMode === 'cfd' ? 'USD' : 'USDT'})</div>
          <div className="text-right">Amount ({selectedPair.replace('USDT', '').substring(0, 3)})</div>
          <div className="text-right">Total</div>
        </div>

        {/* Asks (Sell Orders) - Only show if displayMode is 'both' or 'asks' */}
        {(displayMode === 'both' || displayMode === 'asks') && (
          <div className="border-b border-slate-700">
            {displayOrderBook.asks.slice().reverse().map((ask, index) => (
              <div key={`ask-${index}`} className="grid grid-cols-3 text-xs p-2 relative">
                <div className="text-red-400">{formatPrice(ask.price)}</div>
                <div className="text-right">{formatAmount(ask.amount)}</div>
                <div className="text-right">{formatTotal(ask.total)}</div>
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-500/10"
                  style={{ width: `${calculateDepthPercentage(ask.total, maxAskTotal)}%` }}
                ></div>
              </div>
            ))}
          </div>
        )}

        {/* Current Price */}
        {displayMode === 'both' && (
          <div className={`grid grid-cols-3 border-b border-slate-700 p-2 text-xs ${priceSurfaceClass}`}>
            <div className="text-cyan-400 font-bold">{currentPrice.toFixed(precision)}</div>
            <div className="text-right text-slate-400">Current Price</div>
            <div className="text-right"></div>
          </div>
        )}

        {/* Bids (Buy Orders) - Only show if displayMode is 'both' or 'bids' */}
        {(displayMode === 'both' || displayMode === 'bids') && (
          <div>
            {displayOrderBook.bids.map((bid, index) => (
              <div key={`bid-${index}`} className="grid grid-cols-3 text-xs p-2 relative">
                <div className="text-emerald-400">{formatPrice(bid.price)}</div>
                <div className="text-right">{formatAmount(bid.amount)}</div>
                <div className="text-right">{formatTotal(bid.total)}</div>
                <div
                  className="absolute right-0 top-0 bottom-0 bg-emerald-500/10"
                  style={{ width: `${calculateDepthPercentage(bid.total, maxBidTotal)}%` }}
                ></div>
              </div>
            ))}
          </div>
        )}

        <section className="flex min-h-[340px] flex-1 flex-col border-t border-slate-800/90 bg-slate-950/20 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Instrument summary</div>
              <div className="mt-1 text-sm font-semibold text-slate-200">{selectedPair.replace('USDT', '/USDT')}</div>
            </div>
            <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${sessionChange >= 0 ? 'border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300' : 'border-rose-500/20 bg-rose-500/[0.06] text-rose-300'}`}>
              {sessionChange >= 0 ? '+' : ''}{sessionChange.toFixed(2)}%
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-800 bg-slate-800">
            <div className="bg-[#0a1019] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Bid</div>
              <div className="mt-1 font-mono text-sm font-semibold text-emerald-400">{formatPrice(bidPrice)}</div>
            </div>
            <div className="bg-[#0a1019] p-3 text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Ask</div>
              <div className="mt-1 font-mono text-sm font-semibold text-rose-400">{formatPrice(askPrice)}</div>
            </div>
            <div className="bg-[#0a1019] p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Spread</div>
              <div className="mt-1 font-mono text-xs font-medium text-slate-200">{spread > 0 ? formatPrice(spread) : '—'}</div>
            </div>
            <div className="bg-[#0a1019] p-3 text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">Spread %</div>
              <div className="mt-1 font-mono text-xs font-medium text-slate-200">{spread > 0 ? `${spreadPercentage.toFixed(4)}%` : '—'}</div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              <span>24h range</span>
              <span>Current position</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-slate-800">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${rangePosition}%` }} />
              <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#0a1019] bg-cyan-300" style={{ left: `${rangePosition}%` }} />
            </div>
            <div className="mt-2 flex justify-between font-mono text-[11px] text-slate-400">
              <span>{formatPrice(sessionLow)}</span>
              <span>{formatPrice(sessionHigh)}</span>
            </div>
          </div>

          <div className="mt-5 space-y-3 border-t border-slate-800/80 pt-4 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">24h volume</span>
              <span className="font-mono font-medium text-slate-200">{formatCompactNumber(sessionVolume)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">24h low / high</span>
              <span className="font-mono text-[11px] text-slate-300">{formatPrice(sessionLow)} / {formatPrice(sessionHigh)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-slate-500">Last update</span>
              <span className="font-mono text-[11px] text-slate-300">
                {updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Waiting for data'}
              </span>
            </div>
          </div>

          <div className="mt-auto pt-5">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2 text-[10px] text-slate-400">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              Quotes refresh from the shared market cache every two minutes
            </div>
          </div>
        </section>
      </div>

      {/* Footer */}
      <div className="flex flex-col gap-3 border-t border-slate-700 p-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span>Precision: </span>
          {isFuturesTheme ? (
            <OrderBookDropdown
              value={precision}
              options={precisionOptions}
              onChange={setPrecision}
              align="left"
            />
          ) : (
            <select
              value={precision}
              onChange={(e) => setPrecision(parseInt(e.target.value))}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-white"
            >
              <option value="0">0</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
            </select>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-start">
          <span>Group: </span>
          {isFuturesTheme ? (
            <OrderBookDropdown
              value={grouping}
              options={groupingOptions}
              onChange={setGrouping}
              align="right"
            />
          ) : (
            <select
              value={grouping}
              onChange={(e) => setGrouping(parseFloat(e.target.value))}
              className="rounded border border-slate-600 bg-slate-700 px-2 py-1 text-white"
            >
              <option value="0.1">0.1</option>
              <option value="0.5">0.5</option>
              <option value="1">1.0</option>
              <option value="5">5.0</option>
            </select>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderBook;


