import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { ALL_MARKET_INSTRUMENTS } from "../_shared/marketSymbols.ts";

Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase server configuration");
    const response = await fetch(`${supabaseUrl}/functions/v1/cfd-market-data`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        action: "quotes",
        instruments: ALL_MARKET_INSTRUMENTS,
        maxAgeSeconds: 25,
        refreshKey: "all-active-markets",
        includeItems: false,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result?.error || `Twelve Data sync returned ${response.status}`);
    return new Response(JSON.stringify({
      success: result?.success === true,
      cache: result?.cache,
      updated: result?.updated || 0,
      unavailable: result?.unavailable || 0,
      itemCount: result?.itemCount || 0,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : "Scheduled market sync failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
