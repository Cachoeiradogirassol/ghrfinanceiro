CREATE TABLE public.bank_statement_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  transaction_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  pluggy_transaction_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reconciled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_extracts TO authenticated;
GRANT ALL ON public.bank_statement_extracts TO service_role;

ALTER TABLE public.bank_statement_extracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read automatic extracts"
ON public.bank_statement_extracts FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Authenticated users can insert automatic extracts"
ON public.bank_statement_extracts FOR INSERT TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update automatic extracts"
ON public.bank_statement_extracts FOR UPDATE TO authenticated
USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete automatic extracts"
ON public.bank_statement_extracts FOR DELETE TO authenticated
USING (true);

CREATE INDEX bank_statement_extracts_pending_match_idx
ON public.bank_statement_extracts (bank_account_id, status, transaction_date, amount);

CREATE TRIGGER touch_bank_statement_extracts_updated_at
BEFORE UPDATE ON public.bank_statement_extracts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.bank_accounts
ADD COLUMN pluggy_item_id text,
ADD COLUMN pluggy_account_id text;

CREATE UNIQUE INDEX bank_accounts_pluggy_account_id_unique
ON public.bank_accounts (pluggy_account_id)
WHERE pluggy_account_id IS NOT NULL;