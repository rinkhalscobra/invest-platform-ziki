import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { wsSymbolToAppSymbol } from '../utils/symbolMapping';
import {
  CFD_INSTRUMENTS,
  getCfdInstrument,
  getCfdProviderSymbols,
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

const WS_URL = 'wss://stream.valore.capital/';

export const MarketDataProvider: React.FC<MarketDataProviderProps> = ({ children }) => {
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [snapshotData, setSnapshotData] = useState<MarketDataItem[]>([]);
  const [lastSnapshotTime, setLastSnapshotTime] = useState<number>(Date.now());
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const isConnected = connectionState === 'connected';
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef<number>(0);
  const dbFallbackLoadedRef = useRef<boolean>(false);
  const maxReconnectAttempts = 10;
  const baseReconnectDelay = 1000;
  const maxReconnectDelay = 30000;

  const loadDatabaseFallback = useCallback(async () => {
    if (dbFallbackLoadedRef.current) return;

    try {
      const cfdSymbols = Array.from(new Set([
        ...CFD_INSTRUMENTS.map(instrument => instrument.symbol),
        ...getCfdProviderSymbols()
      ]));
      const rows: Array<Record<string, string | number | null>> = [];

      for (let index = 0; index < cfdSymbols.length; index += 100) {
        const { data, error: dbError } = await supabase
          .from('market_data')
          .select('symbol, price, change_24h, high_price_24h, low_price_24h, volume_24h, timestamp, bid_price, ask_price, updated_at')
          .in('symbol', cfdSymbols.slice(index, index + 100));

        if (dbError) return;
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
            const existingSymbols = new Set(prev.map(p => p.symbol));
            const newItems = items.filter(item => !existingSymbols.has(item.symbol) || prev.find(p => p.symbol === item.symbol)?.price === 0);

            if (newItems.length === 0) return prev;

            const merged = [...prev];
            for (const newItem of newItems) {
              const existingIdx = merged.findIndex(p => p.symbol === newItem.symbol);
              if (existingIdx >= 0 && merged[existingIdx].price === 0) {
                merged[existingIdx] = newItem;
              } else if (existingIdx < 0) {
                merged.push(newItem);
              }
            }
            return merged;
          });

          setSnapshotData(prev => {
            const existingSymbols = new Set(prev.map(p => p.symbol));
            const newItems = items.filter(item => !existingSymbols.has(item.symbol));
            if (newItems.length === 0) return prev;
            return [...prev, ...newItems];
          });

          dbFallbackLoadedRef.current = true;
        }
      }
    } catch {
      // Silently fail
    }
  }, []);

  const transformWsData = useCallback((wsData: {
    symbol: string;
    price: number;
    volume: number | null;
    timestamp: string;
    source: string;
  }): MarketDataItem => {
    const appSymbol = resolveCfdAppSymbol(wsData.symbol) || wsSymbolToAppSymbol(wsData.symbol);
    return {
      symbol: appSymbol,
      price: wsData.price || 0,
      volume_24h: wsData.volume ?? 0,
      change_24h: 0,
      timestamp: wsData.timestamp || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }, []);

  const updateMarketDataItem = useCallback((newData: MarketDataItem) => {
    setMarketData(prev => {
      const existingIndex = prev.findIndex(item => item.symbol === newData.symbol);

      if (existingIndex >= 0) {
        const existing = prev[existingIndex];
        const updated = [...prev];
        updated[existingIndex] = {
          ...existing,
          ...newData,
          change_24h: newData.change_24h || existing.change_24h || 0,
          updated_at: new Date().toISOString()
        };
        return updated;
      } else {
        return [...prev, newData];
      }
    });
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
    const item = snapshotData.find(item => item.symbol === symbol);
    return item?.price || 0;
  }, [snapshotData]);

  const refreshSnapshot = useCallback(() => {
    setSnapshotData([...marketData]);
    setLastSnapshotTime(Date.now());
  }, [marketData]);

  const handleWsMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(event.data);

      switch (message.type) {
        case 'connected':
          break;

        case 'snapshot': {
          const snapshotObj = message.data as Record<string, {
            symbol: string;
            price: number;
            volume: number | null;
            timestamp: string;
            source: string;
          }>;

          const items: MarketDataItem[] = Object.values(snapshotObj).map(transformWsData);
          setMarketData(prev => {
            const symbolMap = new Map(prev.map(item => [item.symbol, item]));
            for (const item of items) {
              symbolMap.set(item.symbol, item);
            }
            return Array.from(symbolMap.values());
          });
          setSnapshotData(prev => {
            if (prev.length === 0) {
              setLastSnapshotTime(Date.now());
              return [...items];
            }
            const symbolMap = new Map(prev.map(item => [item.symbol, item]));
            for (const item of items) {
              symbolMap.set(item.symbol, item);
            }
            return Array.from(symbolMap.values());
          });
          break;
        }

        case 'price_update': {
          const updates = message.data as Array<{
            symbol: string;
            price: number;
            volume: number | null;
            timestamp: string;
            source: string;
          }>;

          for (const update of updates) {
            const transformed = transformWsData(update);
            updateMarketDataItem(transformed);
          }
          break;
        }
      }
    } catch {
      // Silently ignore parse errors
    }
  }, [transformWsData, updateMarketDataItem]);

  const connect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // Ignore close errors
      }
      wsRef.current = null;
    }

    setConnectionState('connecting');

    try {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnectionState('connected');
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      ws.onclose = () => {
        setConnectionState('disconnected');
        wsRef.current = null;
        scheduleReconnect();
      };

      ws.onerror = () => {
        setConnectionState('disconnected');
      };

      ws.onmessage = handleWsMessage;

      wsRef.current = ws;
    } catch {
      setError('Failed to connect to market stream');
      scheduleReconnect();
    }
  }, [handleWsMessage]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
      setError(null);
      setConnectionState('disconnected');
      return;
    }

    setConnectionState('reconnecting');
    reconnectAttemptsRef.current += 1;

    const delay = Math.min(
      baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current - 1),
      maxReconnectDelay
    );

    if (reconnectAttemptsRef.current <= 3) {
      setError(`Connection lost - reconnecting in ${Math.ceil(delay / 1000)}s (attempt ${reconnectAttemptsRef.current}/${maxReconnectAttempts})`);
    } else {
      setError(null);
    }

    reconnectTimeoutRef.current = window.setTimeout(() => {
      connect();
    }, delay);
  }, [connect]);

  useEffect(() => {
    loadDatabaseFallback();
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, loadDatabaseFallback]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !isConnected) {
        reconnectAttemptsRef.current = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isConnected, connect]);

  useEffect(() => {
    const handleOnline = () => {
      if (!isConnected) {
        reconnectAttemptsRef.current = 0;
        connect();
      }
    };

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
  }, [isConnected, connect]);

  const syncPricesToDatabase = useCallback(async () => {
    if (marketData.length === 0) return;

    try {
      const timestamp = new Date().toISOString();
      const pricesToSync = marketData
        .filter(item => item.price > 0)
        .map(item => ({
          symbol: item.symbol,
          price: item.price,
          change_24h: item.change_24h || 0,
          high_price_24h: item.high_price_24h || 0,
          low_price_24h: item.low_price_24h || 0,
          volume_24h: item.volume_24h || 0,
          bid_price: item.bid_price,
          ask_price: item.ask_price,
          timestamp,
          updated_at: timestamp
        }));

      if (pricesToSync.length === 0) return;

      const batchSize = 50;
      for (let i = 0; i < pricesToSync.length; i += batchSize) {
        const batch = pricesToSync.slice(i, i + batchSize);
        await supabase.from('market_data').upsert(batch, {
          onConflict: 'symbol',
          ignoreDuplicates: false
        });
      }

      console.log(`Synced ${pricesToSync.length} prices to database`);
    } catch (err) {
      console.error('Error syncing prices to database:', err);
    }
  }, [marketData]);

  useEffect(() => {
    const syncInterval = setInterval(() => {
      syncPricesToDatabase();
    }, 60000);

    return () => {
      clearInterval(syncInterval);
    };
  }, [syncPricesToDatabase]);

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
