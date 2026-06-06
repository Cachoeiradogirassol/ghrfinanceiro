
-- 1) ENUM empreendimento
DO $$ BEGIN
  CREATE TYPE public.enterprise_type AS ENUM ('turismo','restaurante','vinhedo','ghr','institucional_fazenda','impostos');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Colunas enterprise + is_active em cost_centers e bank_accounts
ALTER TABLE public.cost_centers
  ADD COLUMN IF NOT EXISTS enterprise public.enterprise_type,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS enterprise public.enterprise_type,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 3) Seed automático dos centros existentes
UPDATE public.cost_centers SET enterprise = 'turismo'                WHERE code = 1 AND enterprise IS NULL;
UPDATE public.cost_centers SET enterprise = 'restaurante'            WHERE code = 2 AND enterprise IS NULL;
UPDATE public.cost_centers SET enterprise = 'vinhedo'                WHERE code = 3 AND enterprise IS NULL;
UPDATE public.cost_centers SET enterprise = 'institucional_fazenda'  WHERE code = 4 AND enterprise IS NULL;
UPDATE public.cost_centers SET enterprise = 'impostos'               WHERE code = 5 AND enterprise IS NULL;
UPDATE public.cost_centers SET enterprise = 'ghr'                    WHERE code = 6 AND enterprise IS NULL;

-- 4) Seed automático contas bancárias
UPDATE public.bank_accounts SET enterprise = 'turismo'                WHERE name ILIKE '%cachoeira%' AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'restaurante'            WHERE name ILIKE '%restaurante%' AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'vinhedo'                WHERE name ILIKE '%vinhedo%' AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'institucional_fazenda'  WHERE name ILIKE '%fazenda%' AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'impostos'               WHERE name ILIKE '%imposto%' AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'ghr'                    WHERE (name ILIKE '%holding%' OR name ILIKE '%ghr%') AND enterprise IS NULL;
UPDATE public.bank_accounts SET enterprise = 'ghr'                    WHERE name ILIKE '%caixa f%sico%' AND enterprise IS NULL;
-- fallback para qualquer remanescente
UPDATE public.bank_accounts SET enterprise = 'ghr' WHERE enterprise IS NULL;
UPDATE public.cost_centers  SET enterprise = 'ghr' WHERE enterprise IS NULL;

-- 5) Tornar NOT NULL agora que tudo está preenchido
ALTER TABLE public.cost_centers ALTER COLUMN enterprise SET NOT NULL;
ALTER TABLE public.bank_accounts ALTER COLUMN enterprise SET NOT NULL;

-- 6) Tabela de rateios (split de uma transação por vários centros de custo)
CREATE TABLE IF NOT EXISTS public.transaction_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id),
  amount numeric NOT NULL,
  percent numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alloc_tx ON public.transaction_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_alloc_cc ON public.transaction_allocations(cost_center_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_allocations TO authenticated;
GRANT ALL ON public.transaction_allocations TO service_role;
ALTER TABLE public.transaction_allocations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view allocations" ON public.transaction_allocations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transaction_allocations.cost_center_id AND (c.master_only = false OR public.is_master())));

CREATE POLICY "write allocations" ON public.transaction_allocations FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transaction_allocations.cost_center_id AND (c.master_only = false OR public.is_master())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.cost_centers c WHERE c.id = transaction_allocations.cost_center_id AND (c.master_only = false OR public.is_master())));
