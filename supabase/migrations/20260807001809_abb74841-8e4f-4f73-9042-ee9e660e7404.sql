CREATE TABLE public.account_balances (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  balance numeric NOT NULL DEFAULT 0,
  as_of_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (created_by, account_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_balances TO authenticated;
GRANT ALL ON public.account_balances TO service_role;

ALTER TABLE public.account_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own account balances"
ON public.account_balances FOR ALL TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE TRIGGER trg_account_balances_touch
BEFORE UPDATE ON public.account_balances
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();