import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BarChart3,
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  Gift,
  Home,
  Layers,
  LogOut,
  Menu,
  Repeat,
  Search,
  ShieldCheck,
  Target,
  TrendingUp,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import BrandLogo from './BrandLogo';
import { TradingMode } from '../App';
import { MarketData } from '../hooks/useDatabase';
import { useMarketData } from '../contexts/MarketDataContext';
import { useBybitData } from '../contexts/BybitDataContext';
import { CFD_INSTRUMENTS, TOP_CRYPTO_PAIRS, getCfdInstrument } from '../constants/tradingPairs';

interface ClientDashboardHeaderProps {
  tradingMode: TradingMode;
  setTradingMode: (mode: TradingMode) => void;
  selectedPair: string;
  setSelectedPair: (pair: string) => void;
  currentPrice: number;
  marketData?: MarketData;
  usdtBalance: number;
  btcBalance: number;
  totalPortfolioValue: number;
  user: SupabaseUser;
  signOut: () => void;
  marketDataList: MarketData[];
  isAdmin: boolean;
}

const currencyOptions = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss Franc' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'BTC', symbol: '₿', name: 'Bitcoin' },
  { code: 'ETH', symbol: 'Ξ', name: 'Ethereum' },
];

const marketModes: TradingMode[] = ['futures', 'cfd', 'prop_firm'];

const ClientDashboardHeader: React.FC<ClientDashboardHeaderProps> = ({
  tradingMode,
  setTradingMode,
  selectedPair,
  setSelectedPair,
  currentPrice,
  totalPortfolioValue,
  user,
  signOut,
  isAdmin,
}) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isConnected: cfdConnected, getPriceBySymbol: getCfdPrice } = useMarketData();
  const { isConnected: cryptoConnected, getPriceBySymbol: getCryptoPrice } = useBybitData();
  const [showBalances, setShowBalances] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [pairSearch, setPairSearch] = useState('');
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const pairRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const currencyRef = useRef<HTMLDivElement>(null);

  const navigationItems = [
    { key: 'home', label: t('navigation.home'), icon: Home },
    { key: 'swap', label: t('trading.swap'), icon: Repeat },
    { key: 'futures', label: t('trading.futures'), icon: TrendingUp },
    { key: 'cfd', label: t('trading.cfd'), icon: BarChart3 },
    { key: 'prop_firm', label: t('propFirm.prop'), icon: Target },
    { key: 'robot', label: t('trading.robot'), icon: Bot },
    { key: 'events', label: t('trading.events'), icon: Activity },
    { key: 'staking', label: t('trading.staking'), icon: Layers },
    { key: 'wheel', label: 'Spin Wheel', icon: Gift },
  ] as const;

  const isMarketWorkspace = marketModes.includes(tradingMode);
  const marketOnline = cfdConnected || cryptoConnected;

  useEffect(() => {
    const closeMenus = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!pairRef.current?.contains(target)) setPairOpen(false);
      if (!profileRef.current?.contains(target)) setProfileOpen(false);
      if (!currencyRef.current?.contains(target)) setCurrencyOpen(false);
    };
    document.addEventListener('mousedown', closeMenus);
    return () => document.removeEventListener('mousedown', closeMenus);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setPairOpen(false);
    setPairSearch('');
  }, [tradingMode]);

  const formatPair = (symbol: string) => {
    const instrument = getCfdInstrument(symbol);
    if (instrument && ['stock', 'index'].includes(instrument.type)) return instrument.name;
    return symbol.endsWith('USDT') ? symbol.replace('USDT', '/USDT') : symbol;
  };

  const getPrice = (symbol: string) => {
    if (symbol.replace('/', '').endsWith('USDT')) return getCryptoPrice(symbol.replace('/', ''));
    return getCfdPrice(symbol);
  };

  const currentPairPrice = getPrice(selectedPair) || currentPrice || 0;

  const formatPrice = (symbol: string, price: number) => {
    if (!price) return '—';
    if (symbol.endsWith('USDT')) {
      if (price < 0.01) return price.toFixed(8);
      if (price < 1) return price.toFixed(6);
      return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (symbol.includes('/') && !/XAU|XAG|XPT|XPD/.test(symbol)) return price.toFixed(5);
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  };

  const pairs = useMemo(() => {
    const search = pairSearch.trim().toLowerCase();
    const source = tradingMode === 'cfd'
      ? CFD_INSTRUMENTS.filter((item) => item.active).map((item) => ({
          symbol: item.symbol,
          name: item.name,
          category: item.category,
          tradable: item.tradable,
        }))
      : TOP_CRYPTO_PAIRS.map((item) => ({
          symbol: item.symbol,
          name: item.name,
          category: 'crypto',
          tradable: true,
        }));

    return source.filter((item) => !search
      || item.symbol.toLowerCase().includes(search)
      || item.name.toLowerCase().includes(search)
      || item.category?.toLowerCase().includes(search));
  }, [pairSearch, tradingMode]);

  const convertPortfolio = (currency: string) => {
    if (currency === 'USD') return totalPortfolioValue;
    if (currency === 'BTC' || currency === 'ETH') {
      const rate = getCryptoPrice(`${currency}USDT`);
      return rate > 0 ? totalPortfolioValue / rate : totalPortfolioValue;
    }
    const direct = getCfdPrice(`USD/${currency}`);
    if (direct > 0) return totalPortfolioValue * direct;
    const inverse = getCfdPrice(`${currency}/USD`);
    return inverse > 0 ? totalPortfolioValue / inverse : totalPortfolioValue;
  };

  const selectedCurrency = currencyOptions.find((item) => item.code === displayCurrency) || currencyOptions[0];

  const selectMode = (mode: TradingMode) => {
    setTradingMode(mode);
    setMobileOpen(false);
  };

  const renderPairSelector = (mobile = false) => (
    <div className={`relative ${mobile ? 'w-full' : ''}`} ref={pairRef}>
      <button
        type="button"
        onClick={() => setPairOpen((open) => !open)}
        className={`terminal-instrument-button ${mobile ? 'w-full justify-between' : ''}`}
      >
        <span className="terminal-instrument-name">
          <span className="terminal-instrument-label">Instrument</span>
          <span className="terminal-instrument-symbol">{formatPair(selectedPair)}</span>
        </span>
        <span className="terminal-instrument-price">
          <span>{formatPrice(selectedPair, currentPairPrice)}</span>
          <small>USD</small>
        </span>
        <ChevronDown size={15} className="shrink-0 text-slate-500" />
      </button>

      {pairOpen && (
        <div className={`app-dropdown absolute z-50 mt-2 overflow-hidden rounded-xl ${mobile ? 'left-0 right-0' : 'right-0 w-[360px]'}`}>
          <div className="border-b border-slate-800 p-3">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                autoFocus
                value={pairSearch}
                onChange={(event) => setPairSearch(event.target.value)}
                placeholder="Search markets"
                className="app-input w-full rounded-lg py-2.5 pl-9 pr-3 text-sm"
              />
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {pairs.map((item) => {
              const price = getPrice(item.symbol);
              return (
                <button
                  type="button"
                  key={item.symbol}
                  disabled={item.tradable === false}
                  onClick={() => {
                    setSelectedPair(item.symbol);
                    setPairOpen(false);
                    setPairSearch('');
                  }}
                  className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-slate-800/70 ${selectedPair === item.symbol ? 'bg-blue-500/10' : ''} ${item.tradable === false ? 'opacity-50' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-100">{formatPair(item.symbol)}</span>
                    <span className="block truncate text-[10px] uppercase tracking-wider text-slate-500">{item.category}</span>
                  </span>
                  <span className="font-mono text-xs text-slate-300">{formatPrice(item.symbol, price)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <header className="terminal-header sticky top-0 z-40">
      <div className="terminal-account-bar">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <BrandLogo className="h-10 w-auto max-w-40 sm:h-11 sm:max-w-44" />
          <div className="hidden h-7 w-px bg-slate-800 md:block" />
          <div className="hidden items-center gap-2 rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-[11px] font-medium text-slate-400 md:flex">
            <span className={`h-1.5 w-1.5 rounded-full ${marketOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            {marketOnline ? 'Markets live' : 'Connecting'}
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative hidden sm:block" ref={currencyRef}>
            <div className="terminal-balance-card">
              <button type="button" onClick={() => setShowBalances((shown) => !shown)} className="text-slate-500 hover:text-slate-200" aria-label="Toggle balance visibility">
                {showBalances ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button type="button" onClick={() => setCurrencyOpen((open) => !open)} className="min-w-28 text-left">
                <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">Portfolio value</span>
                <span className="mt-0.5 block font-mono text-sm font-semibold text-slate-100">
                  {showBalances
                    ? `${selectedCurrency.symbol}${convertPortfolio(displayCurrency).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : '••••••'}
                </span>
              </button>
              <ChevronDown size={14} className="text-slate-600" />
            </div>
            {currencyOpen && (
              <div className="app-dropdown absolute right-0 mt-2 w-56 overflow-hidden rounded-xl p-1.5">
                {currencyOptions.map((option) => (
                  <button
                    type="button"
                    key={option.code}
                    onClick={() => {
                      setDisplayCurrency(option.code);
                      setCurrencyOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-slate-800/70 ${displayCurrency === option.code ? 'bg-blue-500/10 text-blue-300' : 'text-slate-300'}`}
                  >
                    <span>{option.name}</span>
                    <span className="font-mono text-xs">{option.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button type="button" onClick={() => selectMode('wallet')} className="terminal-deposit-button">
            <Wallet size={15} />
            <span className="hidden sm:inline">Wallet</span>
          </button>

          <div className="relative" ref={profileRef}>
            <button type="button" onClick={() => setProfileOpen((open) => !open)} className="terminal-profile-button" aria-label="Account menu">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-blue-300"><User size={16} /></span>
              <span className="hidden max-w-36 text-left xl:block">
                <span className="block truncate text-xs font-medium text-slate-200">{user.email?.split('@')[0]}</span>
                <span className="block text-[10px] text-slate-500">Verified account</span>
              </span>
              <ChevronDown size={14} className="hidden text-slate-600 sm:block" />
            </button>
            {profileOpen && (
              <div className="app-dropdown absolute right-0 mt-2 w-64 overflow-hidden rounded-xl">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="truncate text-sm font-medium text-slate-100">{user.email}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Personal trading account</div>
                </div>
                <div className="p-1.5">
                  <button type="button" onClick={() => { selectMode('wallet'); setProfileOpen(false); }} className="terminal-menu-item"><Wallet size={15} />Wallet &amp; funding</button>
                  <button type="button" onClick={() => { selectMode('profile'); setProfileOpen(false); }} className="terminal-menu-item"><User size={15} />Profile &amp; security</button>
                  {isAdmin && <button type="button" onClick={() => navigate('/admin')} className="terminal-menu-item"><ShieldCheck size={15} />Administration CRM</button>}
                  <button type="button" onClick={signOut} className="terminal-menu-item text-rose-300 hover:text-rose-200"><LogOut size={15} />Sign out</button>
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={() => setMobileOpen((open) => !open)} className="terminal-mobile-toggle lg:hidden" aria-label="Open navigation">
            {mobileOpen ? <X size={19} /> : <Menu size={19} />}
          </button>
        </div>
      </div>

      <div className="terminal-product-bar hidden lg:flex">
        <nav className="hide-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden" aria-label="Client products">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const active = tradingMode === item.key;
            return (
              <button type="button" key={item.key} onClick={() => selectMode(item.key)} className={`terminal-nav-item ${active ? 'terminal-nav-item-active' : ''}`}>
                <Icon size={15} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
        {isMarketWorkspace && renderPairSelector()}
      </div>

      {mobileOpen && (
        <div className="terminal-mobile-menu lg:hidden">
          <div className="mb-3 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:hidden">
            <span>
              <span className="block text-[10px] uppercase tracking-wider text-slate-500">Portfolio</span>
              <span className="font-mono text-sm font-semibold text-slate-100">{showBalances ? `$${totalPortfolioValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '••••••'}</span>
            </span>
            <button type="button" onClick={() => setShowBalances((shown) => !shown)} className="p-2 text-slate-500">{showBalances ? <Eye size={16} /> : <EyeOff size={16} />}</button>
          </div>
          <nav className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" aria-label="Mobile client products">
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
                <button type="button" key={item.key} onClick={() => selectMode(item.key)} className={`terminal-mobile-nav-item ${tradingMode === item.key ? 'terminal-mobile-nav-item-active' : ''}`}>
                  <Icon size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          {isMarketWorkspace && <div className="mt-3">{renderPairSelector(true)}</div>}
        </div>
      )}
    </header>
  );
};

export default ClientDashboardHeader;
