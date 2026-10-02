/* Portfolio snapshots are written with UPSERT. Existing same-day rows take
   the UPDATE path, so authenticated users need both USING and WITH CHECK. */

DROP POLICY IF EXISTS "Users can update own portfolio snapshots"
  ON public.portfolio_snapshots;

CREATE POLICY "Users can update own portfolio snapshots"
  ON public.portfolio_snapshots
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
