export type MarketInstrumentType = "crypto" | "forex" | "commodity" | "stock" | "index";

const CRYPTO_SYMBOLS = ["1000PEPEUSDT", "AAVEUSDT", "ADAUSDT", "ALGOUSDT", "APTUSDT", "ARBUSDT", "ATOMUSDT", "AUSDT", "AVAXUSDT", "BCHUSDT", "BNBUSDT", "BTCUSDT", "DOGEUSDT", "DOTUSDT", "ETHUSDT", "FILUSDT", "HBARUSDT", "INJUSDT", "LINKUSDT", "LTCUSDT", "NEARUSDT", "OPUSDT", "POLUSDT", "RENDERUSDT", "SHIB1000USDT", "SKYUSDT", "SOLUSDT", "SUIUSDT", "TRXUSDT", "UNIUSDT", "VETUSDT", "XLMUSDT", "XMRUSDT", "XRPUSDT", "XTZUSDT"] as const;
const FOREX_SYMBOLS = ["AUD/CAD", "AUD/CHF", "AUD/HKD", "AUD/JPY", "AUD/NZD", "AUD/SGD", "AUD/USD", "AUD/ZAR", "CAD/CHF", "CAD/JPY", "CHF/JPY", "EUR/AUD", "EUR/CAD", "EUR/CHF", "EUR/CZK", "EUR/DKK", "EUR/GBP", "EUR/HUF", "EUR/ILS", "EUR/JPY", "EUR/NOK", "EUR/NZD", "EUR/PLN", "EUR/SEK", "EUR/TRY", "EUR/USD", "EUR/ZAR", "GBP/AUD", "GBP/CAD", "GBP/CHF", "GBP/JPY", "GBP/NZD", "GBP/USD", "GBP/ZAR", "HKD/JPY", "NZD/CAD", "NZD/CHF", "NZD/JPY", "NZD/SGD", "NZD/USD", "SGD/JPY", "USD/AED", "USD/BRL", "USD/CAD", "USD/CHF", "USD/CLP", "USD/CNH", "USD/COP", "USD/CZK", "USD/DKK", "USD/HKD", "USD/HUF", "USD/IDR", "USD/ILS", "USD/INR", "USD/JPY", "USD/KRW", "USD/MXN", "USD/MYR", "USD/NOK", "USD/PEN", "USD/PHP", "USD/PLN", "USD/QAR", "USD/SAR", "USD/SEK", "USD/SGD", "USD/THB", "USD/TRY", "USD/TWD", "USD/ZAR"] as const;
const COMMODITY_SYMBOLS = ["BCO/USD", "CORN/USD", "NATGAS/USD", "SUGAR/USD", "WHEAT/USD", "WTICO/USD", "XAG/USD", "XAU/USD", "XPD/USD", "XPT/USD"] as const;
const STOCK_SYMBOLS = ["AAPL", "ABT", "ADBE", "AMAT", "AMD", "AMGN", "AMZN", "ARM", "ASML", "AVGO", "AXP", "BA", "BAC", "BK", "BLK", "C", "CAT", "COIN", "COST", "CRM", "CRWD", "CSCO", "CVS", "CVX", "DELL", "DIS", "GOOGL", "GS", "HD", "HON", "HOOD", "HPE", "IBM", "INTC", "INTU", "JPM", "KLAC", "KO", "LLY", "LOW", "LRCX", "LYFT", "MA", "MCD", "META", "MRNA", "MRVL", "MS", "MSFT", "MU", "NFLX", "NKE", "NOW", "NVDA", "ORCL", "PEP", "PFE", "PLTR", "PYPL", "QCOM", "RIVN", "SAMSUNG", "SBUX", "SHOP", "SMCI", "SNOW", "SONY", "T", "TGT", "TSLA", "TSM", "TXN", "UBER", "UNH", "V", "WFC", "WMT", "XOM"] as const;
const INDEX_SYMBOLS = ["ARKK", "ASX", "BITO", "CAC", "GLD", "HYG", "IWM", "IYR", "JEPI", "KOSPI", "NI225", "QQQ", "SLV", "SMH", "SOXX", "SPY", "SPYD", "STOXX50", "TLT", "VOO", "VTI", "XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"] as const;

const instruments = (symbols: readonly string[], type: MarketInstrumentType) => (
  symbols.map((symbol) => ({ symbol, type }))
);

export const CRYPTO_MARKET_INSTRUMENTS = instruments(CRYPTO_SYMBOLS, "crypto");

// This single server-side list mirrors every active, tradable web instrument.
export const ALL_MARKET_INSTRUMENTS = [
  ...CRYPTO_MARKET_INSTRUMENTS,
  ...instruments(FOREX_SYMBOLS, "forex"),
  ...instruments(COMMODITY_SYMBOLS, "commodity"),
  ...instruments(STOCK_SYMBOLS, "stock"),
  ...instruments(INDEX_SYMBOLS, "index"),
];

export const inferMarketType = (symbol: string): MarketInstrumentType => {
  const upper = symbol.toUpperCase();
  if (CRYPTO_SYMBOLS.includes(upper as typeof CRYPTO_SYMBOLS[number])) return "crypto";
  if (FOREX_SYMBOLS.includes(upper as typeof FOREX_SYMBOLS[number])) return "forex";
  if (COMMODITY_SYMBOLS.includes(upper as typeof COMMODITY_SYMBOLS[number])) return "commodity";
  if (INDEX_SYMBOLS.includes(upper as typeof INDEX_SYMBOLS[number])) return "index";
  return "stock";
};
