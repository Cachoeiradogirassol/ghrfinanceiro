ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS of_dedupe_key text;

CREATE INDEX IF NOT EXISTS ix_transactions_of_dedupe_key
  ON public.transactions(of_dedupe_key)
  WHERE of_dedupe_key IS NOT NULL;