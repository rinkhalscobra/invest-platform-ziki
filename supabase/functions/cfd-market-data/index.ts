import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.39.0";

type InstrumentType = "crypto" | "forex" | "commodity" | "stock" | "index";
type RequestedInstrument = { symbol: string; type: InstrumentType };
type QuotePayload = Record<string, unknown> & {
  symbol?: string;
  close?: string;
  high?: string;
  low?: string;
  volume?: string;
  percent_change?: string;
  timestamp?: number;
  last_quote_at?: number;
  status?: string;
  code?: number;
  message?: string;
};
type MarketRow = {
  symbol: string;
  price: number;
  change_24h: number;
  high_price_24h: number;
  low_price_24h: number;
  volume_24h: number;
  bid_price: number;
  ask_price: number;
  timestamp: string;
  updated_at: string;
  data_provider: "twelve_data";
};
type TimeSeriesBar = {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "private, no-store" },
});
const MAX_INSTRUMENTS = 250;
const QUOTE_BATCH_SIZE = 50;
const SHARED_CACHE_SECONDS = 110;

const providerOverrides: Record<string, string> = {
  "WTICO/USD": "WTI/USD",
  "BCO/USD": "XBR/USD",
  "NATGAS/USD": "UNG",
  "CORN/USD": "CORN",
  "WHEAT/USD": "WEAT",
  "SUGAR/USD": "CANE",
  "COPPER/USD": "HG1",
  "SOYBN/USD": "SOYB",
  "COFFEE/USD": "JO",
  "COCOA/USD": "NIB",
  "COTTON/USD": "BAL",
  "NI225": "EWJ",
  "STOXX50": "FEZ",
  "KOSPI": "EWY",
  "SAMSUNG": "005930",
  "AUSDT": "A/USDT",
};

const validInstrument = (value: unknown): value is RequestedInstrument => {
  if (!value || typeof value !== "object") return false;
  const item = value as RequestedInstrument;
  return typeof item.symbol === "string"
    && item.symbol.length > 0
    && item.symbol.length <= 30
    && /^[A-Z0-9./^=-]+$/i.test(item.symbol)
    && ["crypto", "forex", "commodity", "stock", "index"].includes(item.type);
};

const toProviderSymbol = (instrument: RequestedInstrument): { symbol: string; multiplier: number } => {
  const appSymbol = instrument.symbol.toUpperCase();
  if (providerOverrides[appSymbol]) return { symbol: providerOverrides[appSymbol], multiplier: 1 };
  if (instrument.type !== "crypto") return { symbol: appSymbol, multiplier: 1 };
  if (appSymbol === "1000PEPEUSDT") return { symbol: "PEPE/USD", multiplier: 1000 };
  if (appSymbol === "SHIB1000USDT") return { symbol: "SHIB/USD", multiplier: 1000 };
  const base = appSymbol.endsWith("USDT") ? appSymbol.slice(0, -4) : appSymbol;
  return { symbol: `${base}/USD`, multiplier: 1 };
};

const chunk = <T,>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
};

const fetchTwelveData = async (path: string, apiKey: string) => {
  const response = await fetch(`https://api.twelvedata.com${path}`, {
    headers: { "Accept": "application/json", "Authorization": `apikey ${apiKey}` },
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Twelve Data returned ${response.status}`);
  return payload;
};

const parseQuote = (
  quote: QuotePayload,
  appSymbol: string,
  multiplier: number,
  now: string,
): MarketRow | null => {
  if (!quote || quote.status === "error" || quote.code) return null;
  const price = Number(quote.close) * multiplier;
  if (!Number.isFinite(price) || price <= 0) return null;
  const quoteTime = Number(quote.last_quote_at || quote.timestamp || 0);
  return {
    symbol: appSymbol,
    price,
    change_24h: Number(quote.percent_change) || 0,
    high_price_24h: (Number(quote.high) || 0) * multiplier,
    low_price_24h: (Number(quote.low) || 0) * multiplier,
    volume_24h: Number(quote.volume) || 0,
    bid_price: price,
    ask_price: price,
    timestamp: quoteTime > 0 ? new Date(quoteTime * 1000).toISOString() : now,
    updated_at: now,
    data_provider: "twelve_data",
  };
};

const fetchQuotes = async (instruments: RequestedInstrument[], apiKey: string): Promise<MarketRow[]> => {
  const now = new Date().toISOString();
  const providerMap = new Map<string, Array<{ appSymbol: string; multiplier: number }>>();
  for (const instrument of instruments) {
    const provider = toProviderSymbol(instrument);
    const entries = providerMap.get(provider.symbol) || [];
    entries.push({ appSymbol: instrument.symbol, multiplier: provider.multiplier });
    providerMap.set(provider.symbol, entries);
  }

  const rows: MarketRow[] = [];
  for (const symbols of chunk(Array.from(providerMap.keys()), QUOTE_BATCH_SIZE)) {
    const query = encodeURIComponent(symbols.join(","));
    const payload = await fetchTwelveData(`/quote?symbol=${query}&dp=11`, apiKey) as QuotePayload;
    const batchQuotes = symbols.length === 1 ? { [symbols[0]]: payload } : payload;
    for (const providerSymbol of symbols) {
      const quote = (batchQuotes as Record<string, QuotePayload>)[providerSymbol];
      for (const target of providerMap.get(providerSymbol) || []) {
        const row = parseQuote(quote, target.appSymbol, target.multiplier, now);
        if (row) rows.push(row);
      }
    }
  }
  return rows;
};

const claimRefresh = async (
  admin: SupabaseClient,
  syncKey: string,
  minimumIntervalSeconds = SHARED_CACHE_SECONDS,
) => {
  const { data, error } = await admin.rpc("claim_market_data_refresh", {
    requested_sync_key: syncKey,
    minimum_interval_seconds: minimumIntervalSeconds,
  });
  if (error) throw error;
  return data === true;
};

const finishRefresh = async (
  admin: SupabaseClient,
  syncKey: string,
  errorMessage: string | null = null,
) => {
  const { error } = await admin.rpc("finish_market_data_refresh", {
    requested_sync_key: syncKey,
    error_message: errorMessage,
  });
  if (error) console.warn("Could not update market refresh diagnostics", error);
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const twelveDataKey = Deno.env.get("TWELVE_DATA_API_KEY") || "";
    const authorization = request.headers.get("Authorization") || "";
    if (!supabaseUrl || !serviceRoleKey || !twelveDataKey) return json({ error: "Market data server configuration is incomplete" }, 500);
    if (!authorization.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const bearerToken = authorization.slice("Bearer ".length);
    const isServiceCaller = bearerToken === serviceRoleKey;
    if (!isServiceCaller) {
      const { data: userResult, error: userError } = await admin.auth.getUser(bearerToken);
      if (userError || !userResult.user) return json({ error: "Invalid session" }, 401);
    }

    const body = await request.json().catch(() => ({})) as {
      action?: "quotes" | "time_series";
      instruments?: unknown[];
      symbol?: string;
      type?: InstrumentType;
      interval?: string;
      outputsize?: number;
      maxAgeSeconds?: number;
      refreshKey?: string;
      includeItems?: boolean;
    };

    if (body.action === "time_series") {
      const instrument = { symbol: String(body.symbol || "").toUpperCase(), type: body.type || "stock" };
      if (!validInstrument(instrument)) return json({ error: "A valid market symbol is required" }, 400);
      const allowedIntervals = new Set(["1min", "5min", "15min", "30min", "45min", "1h", "2h", "4h", "1day", "1week", "1month"]);
      const interval = allowedIntervals.has(body.interval || "") ? body.interval! : "5min";
      const outputsize = Math.min(500, Math.max(20, Number(body.outputsize) || 120));
      const cacheKey = `series:${instrument.symbol}:${interval}`;
      const { data: cachedSeries, error: cachedSeriesError } = await admin
        .from("market_time_series_cache")
        .select("bars, updated_at")
        .eq("symbol", instrument.symbol)
        .eq("interval", interval)
        .maybeSingle();
      if (cachedSeriesError) throw cachedSeriesError;

      const cachedBars = Array.isArray(cachedSeries?.bars) ? cachedSeries.bars as TimeSeriesBar[] : [];
      const cacheAge = cachedSeries?.updated_at
        ? Date.now() - new Date(cachedSeries.updated_at).getTime()
        : Number.POSITIVE_INFINITY;
      if (cachedBars.length > 0 && cacheAge < SHARED_CACHE_SECONDS * 1000) {
        return json({
          success: true,
          source: "Supabase cache",
          provider: "Twelve Data",
          symbol: instrument.symbol,
          interval,
          values: cachedBars,
          cached: true,
        });
      }

      const claimed = await claimRefresh(admin, cacheKey);
      if (!claimed) {
        if (cachedBars.length > 0) {
          return json({
            success: true,
            source: "Supabase cache",
            provider: "Twelve Data",
            symbol: instrument.symbol,
            interval,
            values: cachedBars,
            cached: true,
          });
        }
        return json({ error: "Market history refresh is already running. Please retry shortly." }, 503);
      }

      const provider = toProviderSymbol(instrument);
      try {
        const query = new URLSearchParams({ symbol: provider.symbol, interval, outputsize: String(outputsize), timezone: "UTC", dp: "11" });
        const payload = await fetchTwelveData(`/time_series?${query.toString()}`, twelveDataKey) as {
          status?: string;
          message?: string;
          values?: Array<Record<string, string>>;
        };
        if (payload.status === "error") throw new Error(payload.message || "Twelve Data history is unavailable");
        const values = (payload.values || []).map((value) => ({
          datetime: value.datetime,
          open: Number(value.open) * provider.multiplier,
          high: Number(value.high) * provider.multiplier,
          low: Number(value.low) * provider.multiplier,
          close: Number(value.close) * provider.multiplier,
          volume: Number(value.volume) || 0,
        })).filter((value) => Number.isFinite(value.close) && value.close > 0);
        const { error: cacheError } = await admin.from("market_time_series_cache").upsert({
          symbol: instrument.symbol,
          interval,
          bars: values,
          data_provider: "twelve_data",
          updated_at: new Date().toISOString(),
        }, { onConflict: "symbol,interval" });
        if (cacheError) throw cacheError;
        await finishRefresh(admin, cacheKey);
        return json({
          success: true,
          source: "Twelve Data",
          provider: "Twelve Data",
          symbol: instrument.symbol,
          interval,
          values,
          cached: false,
        });
      } catch (seriesError) {
        await finishRefresh(admin, cacheKey, seriesError instanceof Error ? seriesError.message : "History refresh failed");
        if (cachedBars.length > 0) {
          return json({
            success: true,
            source: "Supabase stale cache",
            provider: "Twelve Data",
            symbol: instrument.symbol,
            interval,
            values: cachedBars,
            cached: true,
            stale: true,
          });
        }
        throw seriesError;
      }
    }

    const instruments = Array.from(new Map((body.instruments || [])
      .filter(validInstrument)
      .slice(0, MAX_INSTRUMENTS)
      .map((item) => [item.symbol.toUpperCase(), { symbol: item.symbol.toUpperCase(), type: item.type }] as const)).values());
    if (instruments.length === 0) return json({ error: "No valid instruments supplied" }, 400);

    const maxAgeSeconds = Math.max(SHARED_CACHE_SECONDS, Math.min(300, Number(body.maxAgeSeconds) || SHARED_CACHE_SECONDS));
    const requestedSymbols = instruments.map((item) => item.symbol);
    const cachedRows: MarketRow[] = [];
    for (const symbols of chunk(requestedSymbols, 100)) {
      const { data, error } = await admin.from("market_data")
        .select("symbol, price, change_24h, high_price_24h, low_price_24h, volume_24h, bid_price, ask_price, timestamp, updated_at, data_provider")
        .in("symbol", symbols)
        .eq("data_provider", "twelve_data");
      if (error) throw error;
      cachedRows.push(...((data || []) as MarketRow[]));
    }

    const freshAfter = Date.now() - maxAgeSeconds * 1000;
    const freshRows = cachedRows.filter((row) => new Date(row.updated_at || row.timestamp).getTime() >= freshAfter);
    const freshSymbols = new Set(freshRows.map((row) => row.symbol));
    const staleInstruments = instruments.filter((item) => !freshSymbols.has(item.symbol));
    let fetchedRows: MarketRow[] = [];
    let quoteRefreshClaimed = false;
    const quoteRefreshKey = "quotes:all-active-markets";
    const isScheduledRefresh = isServiceCaller && body.refreshKey === "all-active-markets";
    if (isScheduledRefresh && staleInstruments.length > 0) {
      const claimed = await claimRefresh(admin, quoteRefreshKey);
      if (claimed) {
        quoteRefreshClaimed = true;
        try {
          fetchedRows = await fetchQuotes(staleInstruments, twelveDataKey);
        } catch (quoteError) {
          await finishRefresh(admin, quoteRefreshKey, quoteError instanceof Error ? quoteError.message : "Quote refresh failed");
          throw quoteError;
        }
      }
    }

    for (const rows of chunk(fetchedRows, 100)) {
      const { error } = await admin.from("market_data").upsert(rows, { onConflict: "symbol", ignoreDuplicates: false });
      if (error) throw error;
    }
    if (quoteRefreshClaimed) await finishRefresh(admin, quoteRefreshKey);

    const itemMap = new Map<string, MarketRow>();
    for (const row of cachedRows) itemMap.set(row.symbol, row);
    for (const row of fetchedRows) itemMap.set(row.symbol, row);
    const items = requestedSymbols.map((symbol) => itemMap.get(symbol)).filter(Boolean);
    const responseBody: Record<string, unknown> = {
      success: true,
      source: "Twelve Data",
      cache: fetchedRows.length > 0 ? "refreshed" : "supabase",
      updated: fetchedRows.length,
      unavailable: requestedSymbols.length - items.length,
      itemCount: items.length,
    };
    if (body.includeItems !== false) responseBody.items = items;
    return json(responseBody);
  } catch (error) {
    console.error("Twelve Data market request failed", error);
    return json({ error: error instanceof Error ? error.message : "Market request failed" }, 500);
  }
});
