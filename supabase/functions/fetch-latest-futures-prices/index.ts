import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.0";
import { inferMarketType } from "../_shared/marketSymbols.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase server configuration");
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const body = await request.json().catch(() => ({})) as { symbols?: string[] };
    let symbols = Array.isArray(body.symbols) ? body.symbols : [];
    if (symbols.length === 0) {
      const { data, error } = await admin.from("market_data").select("symbol").limit(250);
      if (error) throw error;
      symbols = (data || []).map((row: { symbol: string }) => row.symbol);
    }
    const instruments = Array.from(new Set(symbols.map((symbol) => String(symbol).toUpperCase())))
      .slice(0, 250)
      .map((symbol) => ({ symbol, type: inferMarketType(symbol) }));
    const response = await fetch(`${supabaseUrl}/functions/v1/cfd-market-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ action: "quotes", instruments, maxAgeSeconds: 5 }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || `Twelve Data refresh returned ${response.status}`);
    return new Response(JSON.stringify({ ...result, provider: "Twelve Data" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Price refresh failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
