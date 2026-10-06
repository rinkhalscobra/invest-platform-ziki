import React, { createContext, useCallback, useContext, useMemo, useRef } from 'react';
import { TOP_CRYPTO_PAIRS } from '../constants/tradingPairs';
import { useMarketData } from './MarketDataContext';

// The exported names are retained for component compatibility. Crypto prices
// now use the same paid Twelve Data WebSocket as every other market.

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

interface BybitDataContextType {
  prices: Map<string, number>;
  isConnected: boolean;
  connectionState: ConnectionState;
  getPriceBySymbol: (symbol: string) => number;
  getPriceDirection: (symbol: string) => PriceDirection;
  getCryptoDataBySymbol: (symbol: string) => CryptoTickerData | null;
}

const BybitDataContext = createContext<BybitDataContextType | undefined>(undefined);
const CRYPTO_SYMBOLS = new Set(TOP_CRYPTO_PAIRS.filter(pair => pair.active).map(pair => pair.symbol));

export const BybitDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { marketData, connectionState, isConnected } = useMarketData();
  const previousPricesRef = useRef<Map<string, number>>(new Map());
  const priceDirectionsRef = useRef<Map<string, PriceDirection>>(new Map());

  const cryptoData = useMemo(() => {
    const tickers = new Map<string, CryptoTickerData>();
    const prices = new Map<string, number>();

    for (const item of marketData) {
      if (!CRYPTO_SYMBOLS.has(item.symbol) || !Number.isFinite(item.price) || item.price <= 0) continue;
      const previousPrice = previousPricesRef.current.get(item.symbol);
      if (previousPrice === undefined) {
        priceDirectionsRef.current.set(item.symbol, 'neutral');
      } else if (previousPrice !== item.price) {
        priceDirectionsRef.current.set(item.symbol, item.price > previousPrice ? 'up' : 'down');
      }
      previousPricesRef.current.set(item.symbol, item.price);
      prices.set(item.symbol, item.price);
      tickers.set(item.symbol, {
        price: item.price,
        change_24h: item.change_24h || 0,
        high_price_24h: item.high_price_24h || 0,
        low_price_24h: item.low_price_24h || 0,
        volume_24h: item.volume_24h || 0,
        bid_price: item.bid_price || item.price,
        ask_price: item.ask_price || item.price,
      });
    }

    return { prices, tickers };
  }, [marketData]);

  const getPriceBySymbol = useCallback((symbol: string) => (
    cryptoData.prices.get(symbol.toUpperCase()) || 0
  ), [cryptoData.prices]);

  const getPriceDirection = useCallback((symbol: string) => (
    priceDirectionsRef.current.get(symbol.toUpperCase()) || 'neutral'
  ), []);

  const getCryptoDataBySymbol = useCallback((symbol: string) => (
    cryptoData.tickers.get(symbol.toUpperCase()) || null
  ), [cryptoData.tickers]);

  return (
    <BybitDataContext.Provider value={{
      prices: cryptoData.prices,
      isConnected,
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
