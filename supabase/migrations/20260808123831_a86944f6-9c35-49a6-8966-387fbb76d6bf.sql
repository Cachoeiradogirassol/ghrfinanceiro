DROP INDEX IF EXISTS public.ix_transactions_of_dedupe_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_transactions_of_dedupe_key
  ON public.transactions (of_dedupe_key)
  WHERE of_dedupe_key IS NOT NULL;