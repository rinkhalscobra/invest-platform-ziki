import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { TOP_CRYPTO_PAIRS } from '../constants/tradingPairs';
import { supabase } from '../lib/supabaseClient';

// The exported names are retained for component compatibility; all values in
// this context now come exclusively from the Twelve Data-backed Edge Function.

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type PriceDirection = 'up' | 'down' | 'neutral';

interface CryptoTickerData {
  price: number;
  change_24h: number;
  high_price_24h: number;
  low_price_24h: number;
  volume_24h: number;
  bid_price: number;
  ask_price: number;
}

interface TwelveDataMarketRow extends CryptoTickerData {
  symbol: string;
  data_provider?: string;
}

interface BybitDataContextType {
  prices: Map<string, number>;
  isConnected: boolean;
  connectionState: ConnectionState;
  getPriceBySymbol: (symbol: string) => number;
  getPriceDirection: (symbol: string) => PriceDirection;
  getCryptoDataBySymbol: (symbol: string) => CryptoTickerData | null;
}

const BybitDataContext = createContext<BybitDataContextType | undefined>(undefined);
const CRYPTO_SYMBOLS = TOP_CRYPTO_PAIRS.filter(pair => pair.active).map(pair => pair.symbol);
const SUPABASE_PRICE_REFRESH_MS = 2 * 60 * 1000;

const toTicker = (row: Partial<TwelveDataMarketRow>): CryptoTickerData | null => {
  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    change_24h: Number(row.change_24h) || 0,
    high_price_24h: Number(row.high_price_24h) || 0,
    low_price_24h: Number(row.low_price_24h) || 0,
    volume_24h: Number(row.volume_24h) || 0,
    bid_price: Number(row.bid_price) || price,
    ask_price: Number(row.ask_price) || price,
  };
};

export const BybitDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prices, setPrices] = useState<Map<string, number>>(new Map());
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const tickerDataRef = useRef<Map<string, CryptoTickerData>>(new Map());
  const priceDirectionsRef = useRef<Map<string, PriceDirection>>(new Map());
  const previousPricesRef = useRef<Map<string, number>>(new Map());

  const applyRows = useCallback((rows: TwelveDataMarketRow[]) => {
    if (rows.length === 0) return;
    setPrices(previous => {
      const next = new Map(previous);
      for (const row of rows) {
        const ticker = toTicker(row);
        if (!ticker) continue;
        const oldPrice = previousPricesRef.current.get(row.symbol) || next.get(row.symbol) || 0;
        priceDirectionsRef.current.set(
          row.symbol,
          oldPrice === 0 || ticker.price === oldPrice ? 'neutral' : ticker.price > oldPrice ? 'up' : 'down'
        );
        previousPricesRef.current.set(row.symbol, ticker.price);
        tickerDataRef.current.set(row.symbol, ticker);
        next.set(row.symbol, ticker.price);
      }
      return next;
    });
  }, []);

  const loadDatabaseFallback = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('symbol, price, change_24h, high_price_24h, low_price_24h, volume_24h, bid_price, ask_price, data_provider')
        .in('symbol', CRYPTO_SYMBOLS)
        .eq('data_provider', 'twelve_data');
      if (error) throw error;
      if (data?.length) {
        applyRows(data as TwelveDataMarketRow[]);
        setConnectionState('connected');
      } else {
        setConnectionState('disconnected');
      }
    } catch {
      setConnectionState('disconnected');
    }
  }, [applyRows]);

  useEffect(() => {
    void loadDatabaseFallback();
    const interval = window.setInterval(
      () => void loadDatabaseFallback(),
      SUPABASE_PRICE_REFRESH_MS
    );
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void loadDatabaseFallback();
    };
    const handleOnline = () => void loadDatabaseFallback();
    const handleOffline = () => setConnectionState('disconnected');
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadDatabaseFallback]);

  const getPriceBySymbol = useCallback((symbol: string) => prices.get(symbol.toUpperCase()) || 0, [prices]);
  const getPriceDirection = useCallback((symbol: string) => priceDirectionsRef.current.get(symbol.toUpperCase()) || 'neutral', []);
  const getCryptoDataBySymbol = useCallback((symbol: string) => tickerDataRef.current.get(symbol.toUpperCase()) || null, []);

  return (
    <BybitDataContext.Provider value={{
      prices,
      isConnected: connectionState === 'connected',
      connectionState,
      getPriceBySymbol,
      getPriceDirection,
      getCryptoDataBySymbol,
    }}>
      {children}
    </BybitDataContext.Provider>
  );
};

export const useBybitData = (): BybitDataContextType => {
  const context = useContext(BybitDataContext);
  if (!context) throw new Error('useBybitData must be used within a BybitDataProvider');
  return context;
};
