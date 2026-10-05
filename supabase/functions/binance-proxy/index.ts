import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(JSON.stringify({
  error: "This legacy provider endpoint is disabled. Use cfd-market-data, backed by Twelve Data.",
}), {
  status: 410,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
}));
