
-- 1) contacts table
CREATE TABLE public.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('FORNECEDOR','COLABORADOR')),
  document_type text NOT NULL CHECK (document_type IN ('PF','PJ')),
  document_number text NOT NULL,
  master_only boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX contacts_document_number_uidx ON public.contacts (document_number);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view contacts" ON public.contacts
  FOR SELECT TO authenticated
  USING (master_only = false OR is_master());

CREATE POLICY "insert contacts" ON public.contacts
  FOR INSERT TO authenticated
  WITH CHECK (master_only = false OR is_master());

CREATE POLICY "update contacts" ON public.contacts
  FOR UPDATE TO authenticated
  USING (master_only = false OR is_master())
  WITH CHECK (master_only = false OR is_master());

CREATE POLICY "delete contacts master" ON public.contacts
  FOR DELETE TO authenticated
  USING (is_master());

CREATE TRIGGER touch_contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) transactions: new columns
ALTER TABLE public.transactions
  ADD COLUMN contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN payment_method text CHECK (payment_method IN ('pix','boleto','credit_card','cash')),
  ADD COLUMN installment_number integer,
  ADD COLUMN installment_total integer,
  ADD COLUMN recurrence_group_id uuid,
  ADD COLUMN is_recurring boolean NOT NULL DEFAULT false;

-- 3) Seed Caixa Físico bank account
INSERT INTO public.bank_accounts (name, bank, initial_balance, master_only)
SELECT 'Caixa Físico - Dinheiro', 'Caixa', 0, false
WHERE NOT EXISTS (
  SELECT 1 FROM public.bank_accounts WHERE name = 'Caixa Físico - Dinheiro'
);
