import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { CRYPTO_MARKET_INSTRUMENTS } from "../_shared/marketSymbols.ts";

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

    const response = await fetch(`${supabaseUrl}/functions/v1/cfd-market-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ action: "quotes", instruments: CRYPTO_MARKET_INSTRUMENTS, maxAgeSeconds: 10 }),
      signal: AbortSignal.timeout(25000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || `Twelve Data sync returned ${response.status}`);
    return new Response(JSON.stringify({ ...result, provider: "Twelve Data" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Market sync failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
