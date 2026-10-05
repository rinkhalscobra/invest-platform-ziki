/* Prevent legacy market providers from being mistaken for Twelve Data cache rows. */

ALTER TABLE public.market_data
  ADD COLUMN IF NOT EXISTS data_provider text;

CREATE INDEX IF NOT EXISTS idx_market_data_provider_updated
  ON public.market_data(data_provider, updated_at DESC);

COMMENT ON COLUMN public.market_data.data_provider IS
  'Origin of this cached quote. Active application pricing requires twelve_data.';
