import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";
import { ALL_MARKET_INSTRUMENTS } from "../_shared/marketSymbols.ts";

type Instrument = { symbol: string; type: "crypto" | "forex" | "commodity" | "stock" | "index" };
type StartMessage = { type?: string; accessToken?: string; symbols?: unknown[] };

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

const toProviderSymbol = (instrument: Instrument): { symbol: string; multiplier: number } => {
  if (providerOverrides[instrument.symbol]) {
    return { symbol: providerOverrides[instrument.symbol], multiplier: 1 };
  }
  if (instrument.type !== "crypto") return { symbol: instrument.symbol, multiplier: 1 };
  if (instrument.symbol === "1000PEPEUSDT") return { symbol: "PEPE/USD", multiplier: 1000 };
  if (instrument.symbol === "SHIB1000USDT") return { symbol: "SHIB/USD", multiplier: 1000 };
  const base = instrument.symbol.endsWith("USDT")
    ? instrument.symbol.slice(0, -4)
    : instrument.symbol;
  return { symbol: `${base}/USD`, multiplier: 1 };
};

const allowedInstruments = new Map(
  ALL_MARKET_INSTRUMENTS
    .map((instrument) => [instrument.symbol, instrument as Instrument]),
);

const jsonResponse = (body: Record<string, unknown>, status: number) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

Deno.serve(async (request: Request) => {
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") {
    return jsonResponse({ error: "WebSocket upgrade required" }, 426);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const twelveDataKey = Deno.env.get("TWELVE_DATA_API_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey || !twelveDataKey) {
    return jsonResponse({ error: "Market stream configuration is incomplete" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { socket, response } = Deno.upgradeWebSocket(request);
  let upstream: WebSocket | null = null;
  let heartbeat: number | null = null;
  let authenticated = false;
  let announcedConnected = false;
  let finished = false;
  let resolveClosed: (() => void) | null = null;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });

  const send = (payload: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  };

  const cleanup = () => {
    if (finished) return;
    finished = true;
    if (heartbeat !== null) clearInterval(heartbeat);
    heartbeat = null;
    const providerSocket = upstream;
    upstream = null;
    if (providerSocket && (providerSocket.readyState === WebSocket.OPEN || providerSocket.readyState === WebSocket.CONNECTING)) {
      providerSocket.close();
    }
    resolveClosed?.();
  };

  const authTimeout = setTimeout(() => {
    if (!authenticated && socket.readyState === WebSocket.OPEN) {
      socket.close(1008, "Authentication timed out");
    }
  }, 8_000);

  socket.onmessage = async (event) => {
    if (authenticated) return;
    try {
      const message = JSON.parse(String(event.data)) as StartMessage;
      if (message.type !== "start" || !message.accessToken || !Array.isArray(message.symbols)) {
        socket.close(1008, "Invalid start message");
        return;
      }

      const { data: userResult, error: userError } = await admin.auth.getUser(message.accessToken);
      if (userError || !userResult.user) {
        socket.close(1008, "Invalid session");
        return;
      }

      const requested = Array.from(new Set(message.symbols
        .filter((symbol): symbol is string => typeof symbol === "string")
        .map((symbol) => symbol.toUpperCase())))
        .map((symbol) => allowedInstruments.get(symbol))
        .filter((instrument): instrument is Instrument => Boolean(instrument));
      if (requested.length === 0) {
        socket.close(1008, "No supported symbols requested");
        return;
      }

      authenticated = true;
      clearTimeout(authTimeout);
      const targetsByProvider = new Map<string, Array<{ symbol: string; multiplier: number }>>();
      for (const instrument of requested) {
        const provider = toProviderSymbol(instrument);
        const targets = targetsByProvider.get(provider.symbol) || [];
        targets.push({ symbol: instrument.symbol, multiplier: provider.multiplier });
        targetsByProvider.set(provider.symbol, targets);
      }

      upstream = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${encodeURIComponent(twelveDataKey)}`);
      upstream.onopen = () => {
        upstream?.send(JSON.stringify({
          action: "subscribe",
          params: { symbols: Array.from(targetsByProvider.keys()).join(",") },
        }));
        heartbeat = setInterval(() => {
          if (upstream?.readyState === WebSocket.OPEN) {
            upstream.send(JSON.stringify({ action: "heartbeat" }));
          }
        }, 10_000);
      };

      upstream.onmessage = (providerEvent) => {
        try {
          const payload = JSON.parse(String(providerEvent.data)) as Record<string, unknown>;
          if (payload.event === "price") {
            const providerSymbol = String(payload.symbol || "").toUpperCase();
            const price = Number(payload.price);
            if (!Number.isFinite(price) || price <= 0) return;
            const timestamp = Number(payload.timestamp);
            const isoTimestamp = timestamp > 0
              ? new Date(timestamp * 1000).toISOString()
              : new Date().toISOString();
            const updates = (targetsByProvider.get(providerSymbol) || []).map((target) => ({
              symbol: target.symbol,
              price: price * target.multiplier,
              timestamp: isoTimestamp,
            }));
            if (!announcedConnected) {
              announcedConnected = true;
              send({ type: "connected", symbols: requested.length });
            }
            if (updates.length > 0) send({ type: "price_update", data: updates });
          } else if (payload.event === "subscribe-status") {
            const successes = Array.isArray(payload.success) ? payload.success.length : 0;
            if (!announcedConnected && payload.status === "ok" && successes > 0) {
              announcedConnected = true;
              send({ type: "connected", symbols: successes });
            } else if (payload.status === "error" || successes === 0) {
              send({
                type: "error",
                message: String(payload.message || "The live quote subscription was rejected by the provider"),
              });
            }
            send({ type: "provider_status", data: payload });
          }
        } catch {
          // Ignore malformed upstream frames without interrupting valid price ticks.
        }
      };

      upstream.onerror = () => send({ type: "error", message: "Live quote provider connection failed" });
      upstream.onclose = () => {
        upstream = null;
        if (socket.readyState === WebSocket.OPEN) socket.close(1012, "Market provider disconnected");
      };
    } catch {
      socket.close(1008, "Invalid stream request");
    }
  };

  socket.onerror = cleanup;
  socket.onclose = () => {
    clearTimeout(authTimeout);
    cleanup();
  };

  // Keep the Edge Function isolate alive while the upgraded connection is open.
  EdgeRuntime.waitUntil(closed);
  return response;
});
