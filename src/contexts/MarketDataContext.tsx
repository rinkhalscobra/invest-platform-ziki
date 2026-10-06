import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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

interface StreamPriceUpdate {
  symbol: string;
  price: number;
  timestamp?: string;
}

interface MarketStreamMessage {
  type?: 'connected' | 'price_update' | 'provider_status' | 'error';
  data?: StreamPriceUpdate[];
  message?: string;
}

const MarketDataContext = createContext<MarketDataContextType | undefined>(undefined);

const CACHED_PRICE_INSTRUMENTS = [
  ...TOP_CRYPTO_PAIRS.filter(instrument => instrument.active).map(instrument => instrument.symbol),
  ...CFD_INSTRUMENTS
    .filter(instrument => instrument.active && instrument.tradable !== false)
    .map(instrument => instrument.symbol)
];
const LIVE_MARKET_SYMBOLS = CACHED_PRICE_INSTRUMENTS;
const SUPABASE_PRICE_REFRESH_MS = 30 * 1000;
const PRICE_FLUSH_MS = 100;
const MAX_RECONNECT_DELAY_MS = 30_000;
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '');
const marketStreamUrl = `${supabaseUrl.replace(/^http/i, 'ws')}/functions/v1/market-stream`;

const normalizeAppSymbol = (symbol: string) => (
  resolveCfdAppSymbol(symbol) || wsSymbolToAppSymbol(symbol)
);

const rowToMarketItem = (row: Record<string, string | number | null>): MarketDataItem => ({
  symbol: normalizeAppSymbol(String(row.symbol || '')),
  price: Number(row.price) || 0,
  change_24h: Number(row.change_24h) || 0,
  high_price_24h: Number(row.high_price_24h) || 0,
  low_price_24h: Number(row.low_price_24h) || 0,
  volume_24h: Number(row.volume_24h) || 0,
  bid_price: row.bid_price ? Number(row.bid_price) : undefined,
  ask_price: row.ask_price ? Number(row.ask_price) : undefined,
  timestamp: String(row.timestamp || new Date().toISOString()),
  updated_at: String(row.updated_at || new Date().toISOString())
});

export const MarketDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [marketData, setMarketData] = useState<MarketDataItem[]>([]);
  const [snapshotData, setSnapshotData] = useState<MarketDataItem[]>([]);
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now());
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const shouldReconnectRef = useRef(false);
  const connectRef = useRef<() => void>(() => undefined);
  const priceBufferRef = useRef<Map<string, StreamPriceUpdate>>(new Map());

  const mergeItems = useCallback((items: MarketDataItem[]) => {
    if (items.length === 0) return;
    setMarketData(previous => {
      const next = new Map(previous.map(item => [item.symbol, item]));
      for (const item of items) {
        const existing = next.get(item.symbol);
        const existingTime = existing
          ? new Date(existing.updated_at || existing.timestamp).getTime()
          : 0;
        const incomingTime = new Date(item.updated_at || item.timestamp).getTime();
        if (existing && existingTime > incomingTime) continue;
        next.set(item.symbol, existing ? { ...existing, ...item } : item);
      }
      return Array.from(next.values());
    });
  }, []);

  const loadDatabaseFallback = useCallback(async () => {
    try {
      const rows: Array<Record<string, string | number | null>> = [];
      for (let index = 0; index < CACHED_PRICE_INSTRUMENTS.length; index += 100) {
        const { data, error: dbError } = await supabase
          .from('market_data')
          .select('symbol, price, change_24h, high_price_24h, low_price_24h, volume_24h, timestamp, bid_price, ask_price, updated_at, data_provider')
          .in('symbol', CACHED_PRICE_INSTRUMENTS.slice(index, index + 100))
          .eq('data_provider', 'twelve_data');
        if (dbError) throw dbError;
        if (data) rows.push(...data);
      }

      const preferredItems = new Map<string, { item: MarketDataItem; preferred: boolean }>();
      for (const row of rows) {
        const rawSymbol = String(row.symbol || '');
        const item = rowToMarketItem(row);
        if (!item.symbol || item.price <= 0) continue;
        const instrument = getCfdInstrument(item.symbol);
        const preferred = instrument?.providerSymbol?.toUpperCase() === rawSymbol.toUpperCase();
        const existing = preferredItems.get(item.symbol);
        if (!existing || (preferred && !existing.preferred)) {
          preferredItems.set(item.symbol, { item, preferred });
        }
      }

      const items = Array.from(preferredItems.values(), entry => entry.item);
      if (items.length === 0) return;
      mergeItems(items);
      setSnapshotData(items);
      setLastSnapshotTime(Date.now());
    } catch {
      setError(previous => previous || 'Stored market prices are temporarily unavailable');
    }
  }, [mergeItems]);

  const flushPriceBuffer = useCallback(() => {
    if (priceBufferRef.current.size === 0) return;
    const updates = Array.from(priceBufferRef.current.values());
    priceBufferRef.current.clear();
    setMarketData(previous => {
      const next = new Map(previous.map(item => [item.symbol, item]));
      for (const update of updates) {
        const symbol = normalizeAppSymbol(update.symbol);
        const price = Number(update.price);
        if (!symbol || !Number.isFinite(price) || price <= 0) continue;
        const existing = next.get(symbol);
        const timestamp = update.timestamp || new Date().toISOString();
        next.set(symbol, {
          ...(existing || { symbol, timestamp }),
          symbol,
          price,
          timestamp,
          updated_at: new Date().toISOString()
        });
      }
      return Array.from(next.values());
    });
  }, []);

  const clearSocket = useCallback(() => {
    const socket = wsRef.current;
    wsRef.current = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!shouldReconnectRef.current || !navigator.onLine || reconnectTimerRef.current !== null) return;
    setConnectionState('reconnecting');
    const delay = Math.min(1_000 * (2 ** reconnectAttemptsRef.current), MAX_RECONNECT_DELAY_MS);
    reconnectAttemptsRef.current += 1;
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(async () => {
    if (!shouldReconnectRef.current || !navigator.onLine) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    const { data: sessionResult } = await supabase.auth.getSession();
    if (!shouldReconnectRef.current) return;
    if (!sessionResult.session) {
      setConnectionState('disconnected');
      return;
    }

    clearSocket();
    setConnectionState(reconnectAttemptsRef.current > 0 ? 'reconnecting' : 'connecting');
    try {
      const socket = new WebSocket(marketStreamUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (wsRef.current !== socket || !shouldReconnectRef.current) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({
          type: 'start',
          accessToken: sessionResult.session.access_token,
          symbols: LIVE_MARKET_SYMBOLS
        }));
      };

      socket.onmessage = event => {
        if (wsRef.current !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as MarketStreamMessage;
          if (message.type === 'connected') {
            reconnectAttemptsRef.current = 0;
            setConnectionState('connected');
            setError(null);
          } else if (message.type === 'price_update' && Array.isArray(message.data)) {
            for (const update of message.data) {
              if (update?.symbol) priceBufferRef.current.set(update.symbol, update);
            }
          } else if (message.type === 'error') {
            setError(message.message || 'Live market stream is temporarily unavailable');
          }
        } catch {
          // Ignore malformed provider messages; a valid next tick can still arrive.
        }
      };

      socket.onerror = () => {
        if (wsRef.current === socket) setConnectionState('disconnected');
      };

      socket.onclose = () => {
        if (wsRef.current !== socket) return;
        wsRef.current = null;
        setConnectionState('disconnected');
        scheduleReconnect();
      };
    } catch {
      setConnectionState('disconnected');
      scheduleReconnect();
    }
  }, [clearSocket, scheduleReconnect]);

  connectRef.current = () => void connect();

  useEffect(() => {
    shouldReconnectRef.current = true;
    void loadDatabaseFallback();
    const initialConnectTimer = window.setTimeout(() => void connect(), 0);
    const databaseInterval = window.setInterval(() => void loadDatabaseFallback(), SUPABASE_PRICE_REFRESH_MS);
    flushTimerRef.current = window.setInterval(flushPriceBuffer, PRICE_FLUSH_MS);

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        reconnectAttemptsRef.current = 0;
        void connect();
      } else {
        clearSocket();
        setConnectionState('disconnected');
      }
    });

    return () => {
      shouldReconnectRef.current = false;
      window.clearTimeout(initialConnectTimer);
      window.clearInterval(databaseInterval);
      authListener.subscription.unsubscribe();
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      if (flushTimerRef.current !== null) window.clearInterval(flushTimerRef.current);
      reconnectTimerRef.current = null;
      flushTimerRef.current = null;
      clearSocket();
    };
  }, [clearSocket, connect, flushPriceBuffer, loadDatabaseFallback]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        reconnectAttemptsRef.current = 0;
        void connect();
      }
    };
    const handleOnline = () => {
      reconnectAttemptsRef.current = 0;
      void loadDatabaseFallback();
      void connect();
    };
    const handleOffline = () => {
      clearSocket();
      setConnectionState('disconnected');
      setError('Browser is offline');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [clearSocket, connect, loadDatabaseFallback]);

  const getMarketDataBySymbol = useCallback((symbol: string) => {
    const appSymbol = normalizeAppSymbol(symbol);
    return marketData.find(item => item.symbol === appSymbol) || null;
  }, [marketData]);

  const getPriceBySymbol = useCallback((symbol: string) => (
    getMarketDataBySymbol(symbol)?.price || 0
  ), [getMarketDataBySymbol]);

  const getSnapshotPriceBySymbol = useCallback((symbol: string) => {
    const appSymbol = normalizeAppSymbol(symbol);
    return snapshotData.find(item => item.symbol === appSymbol)?.price || 0;
  }, [snapshotData]);

  const refreshSnapshot = useCallback(() => {
    setSnapshotData([...marketData]);
    setLastSnapshotTime(Date.now());
  }, [marketData]);

  return (
    <MarketDataContext.Provider value={{
      marketData,
      snapshotData,
      isConnected: connectionState === 'connected',
      connectionState,
      error,
      getMarketDataBySymbol,
      getPriceBySymbol,
      getSnapshotPriceBySymbol,
      refreshSnapshot,
      lastSnapshotTime
    }}>
      {children}
    </MarketDataContext.Provider>
  );
};

export const useMarketData = (): MarketDataContextType => {
  const context = useContext(MarketDataContext);
  if (!context) throw new Error('useMarketData must be used within a MarketDataProvider');
  return context;
};
