import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { wsSymbolToAppSymbol } from '../utils/symbolMapping';
import {
  CFD_INSTRUMENTS,
  TOP_CRYPTO_PAIRS,
  getCfdInstrument,
  resolveCfdAppSymbol
} from '../constants/tradingPairs';
import { supabase } from '../lib/supabaseClient';

export interface MarketDataItem {
  id?: string;
  symbol: string;
  price: number;
  volume_24h?: number;
  change_24h?: number;
  timestamp: string;
  high_price_24h?: number;
  low_price_24h?: number;
  market_cap?: number;
  funding_rate?: number;
  open_interest?: number;
  bid_price?: number;
  ask_price?: number;
  updated_at?: string;
}

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface MarketDataContextType {
  marketData: MarketDataItem[];
  snapshotData: MarketDataItem[];
  isConnected: boolean;
  connectionState: ConnectionState;
  error: string | null;
  getMarketDataBySymbol: (symbol: string) => MarketDataItem | null;
  getPriceBySymbol: (symbol: string) => number;
  getSnapshotPriceBySymbol: (symbol: string) => number;
  refreshSnapshot: () => void;
  lastSnapshotTime: number;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

interface MarketDataProviderProps {
  children: React.ReactNode;
}

const FREE_PRICE_INSTRUMENTS = [
  ...TOP_CRYPTO_PAIRS.filter(instrument => instrument.active).map(instrument => ({
    symbol: instrument.symbol,
    type: instrument.type
  })),
  ...CFD_INSTRUMENTS
    .filter(instrument => instrument.active && instrument.tradable !== false)
    .map(instrument => ({ symbol: instrument.symbol, type: instrument.type }))
];
const SUPABASE_PRICE_REFRESH_MS = 2 * 60 * 1000;

export const MarketDataProvider: React.FC<MarketDataProviderProps> = ({ children }) => {
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [snapshotData, setSnapshotData] = useState<MarketDataItem[]>([]);
  const [lastSnapshotTime, setLastSnapshotTime] = useState<number>(Date.now());
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const isConnected = connectionState === 'connected';

  const loadDatabaseFallback = useCallback(async () => {
    try {
      const cfdSymbols = FREE_PRICE_INSTRUMENTS.map(instrument => instrument.symbol);
      const rows: Array<Record<string, string | number | null>> = [];

      for (let index = 0; index < cfdSymbols.length; index += 100) {
        const { data, error: dbError } = await supabase
          .from('market_data')
          .select('symbol, price, change_24h, high_price_24h, low_price_24h, volume_24h, timestamp, bid_price, ask_price, updated_at, data_provider')
          .in('symbol', cfdSymbols.slice(index, index + 100))
          .eq('data_provider', 'twelve_data');

        if (dbError) throw dbError;
        if (data) rows.push(...data);
      }

      if (rows.length > 0) {
        const itemMap = new Map<string, { item: MarketDataItem; preferred: boolean }>();

        for (const row of rows) {
          const rawSymbol = String(row.symbol || '');
          const appSymbol = resolveCfdAppSymbol(rawSymbol) || wsSymbolToAppSymbol(rawSymbol);
          const instrument = getCfdInstrument(appSymbol);
          const preferred = instrument?.providerSymbol?.toUpperCase() === rawSymbol.toUpperCase();
          const item: MarketDataItem = {
            symbol: appSymbol,
            price: parseFloat(String(row.price)) || 0,
            change_24h: parseFloat(String(row.change_24h)) || 0,
            high_price_24h: parseFloat(String(row.high_price_24h)) || 0,
            low_price_24h: parseFloat(String(row.low_price_24h)) || 0,
            volume_24h: parseFloat(String(row.volume_24h)) || 0,
            bid_price: row.bid_price ? parseFloat(String(row.bid_price)) : undefined,
            ask_price: row.ask_price ? parseFloat(String(row.ask_price)) : undefined,
            timestamp: String(row.timestamp || new Date().toISOString()),
            updated_at: String(row.updated_at || new Date().toISOString())
          };
          const existing = itemMap.get(appSymbol);

          if (!existing || (preferred && !existing.preferred)) {
            itemMap.set(appSymbol, { item, preferred });
          }
        }

        const items = Array.from(itemMap.values(), entry => entry.item);

        if (items.length > 0) {
          setMarketData(prev => {
            const symbolMap = new Map(prev.map(item => [item.symbol, item]));
            for (const item of items) symbolMap.set(item.symbol, item);
            return Array.from(symbolMap.values());
          });
          setSnapshotData(items);
          setLastSnapshotTime(Date.now());
          setConnectionState('connected');
          setError(null);
        }
      } else {
        setConnectionState('disconnected');
        setError('The shared market cache has not been populated yet');
      }
    } catch {
      setConnectionState('disconnected');
      setError('Stored market prices are temporarily unavailable');
    }
  }, []);

  const getMarketDataBySymbol = useCallback((symbol: string): MarketDataItem | null => {
    const appSymbol = resolveCfdAppSymbol(symbol) || wsSymbolToAppSymbol(symbol);
    return marketData.find(item => item.symbol === appSymbol) || null;
  }, [marketData]);

  const getPriceBySymbol = useCallback((symbol: string): number => {
    const item = getMarketDataBySymbol(symbol);
    return item?.price || 0;
  }, [getMarketDataBySymbol]);

  const getSnapshotPriceBySymbol = useCallback((symbol: string): number => {
    const appSymbol = resolveCfdAppSymbol(symbol) || wsSymbolToAppSymbol(symbol);
    const item = snapshotData.find(entry => entry.symbol === appSymbol);
    return item?.price || 0;
  }, [snapshotData]);

  const refreshSnapshot = useCallback(() => {
    setSnapshotData([...marketData]);
    setLastSnapshotTime(Date.now());
  }, [marketData]);

  useEffect(() => {
    void loadDatabaseFallback();
    const databaseInterval = window.setInterval(
      () => void loadDatabaseFallback(),
      SUPABASE_PRICE_REFRESH_MS
    );
    return () => {
      window.clearInterval(databaseInterval);
    };
  }, [loadDatabaseFallback]);

  useEffect(() => {
    const handleOnline = () => void loadDatabaseFallback();
    const handleOffline = () => {
      setConnectionState('disconnected');
      setError('Browser is offline');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadDatabaseFallback]);

  const contextValue: MarketDataContextType = {
    marketData,
    snapshotData,
    isConnected,
    connectionState,
    error,
    getMarketDataBySymbol,
    getPriceBySymbol,
    getSnapshotPriceBySymbol,
    refreshSnapshot,
    lastSnapshotTime
  };

  return (
    <MarketDataContext.Provider value={contextValue}>
      {children}
    </MarketDataContext.Provider>
  );
};

export const useMarketData = (): MarketDataContextType => {
  const context = useContext(MarketDataContext);
  if (context === undefined) {
    throw new Error('useMarketData must be used within a MarketDataProvider');
  }
  return context;
};
