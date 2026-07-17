
-- 1) Contas contábeis novas ---------------------------------------------------
INSERT INTO public.accounts (name, kind, cost_center_id, is_active)
SELECT 'Faturamento Vendas', 'revenue', 'ceebd86d-68b7-4d9e-8b8b-ed76b1d1be85', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts
  WHERE cost_center_id = 'ceebd86d-68b7-4d9e-8b8b-ed76b1d1be85'
    AND lower(name) = 'faturamento vendas'
);

INSERT INTO public.accounts (name, kind, cost_center_id, is_active)
SELECT 'Taxas de Cartão', 'expense', 'ceebd86d-68b7-4d9e-8b8b-ed76b1d1be85', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts
  WHERE cost_center_id = 'ceebd86d-68b7-4d9e-8b8b-ed76b1d1be85'
    AND lower(name) = 'taxas de cartão'
);

INSERT INTO public.accounts (name, kind, cost_center_id, is_active)
SELECT 'Taxas de Cartão', 'expense', 'd452db68-3a26-40d4-b0e1-e68001b579af', true
WHERE NOT EXISTS (
  SELECT 1 FROM public.accounts
  WHERE cost_center_id = 'd452db68-3a26-40d4-b0e1-e68001b579af'
    AND lower(name) = 'taxas de cartão'
);

-- 2) Tabela de lotes de venda -------------------------------------------------
CREATE TABLE public.sales_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id),
  reference_date date NOT NULL,
  gross_debit numeric(14,2) NOT NULL DEFAULT 0,
  gross_credit numeric(14,2) NOT NULL DEFAULT 0,
  gross_pix numeric(14,2) NOT NULL DEFAULT 0,
  gross_total numeric(14,2) GENERATED ALWAYS AS (gross_debit + gross_credit + gross_pix) STORED,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  received_amount numeric(14,2) NOT NULL DEFAULT 0,
  fee_amount numeric(14,2),
  revenue_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  fee_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sales_batches_cost_center ON public.sales_batches(cost_center_id, status, reference_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_batches TO authenticated;
GRANT ALL ON public.sales_batches TO service_role;

ALTER TABLE public.sales_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sales_batches read" ON public.sales_batches
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sales_batches write" ON public.sales_batches
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_sales_batches_updated_at
  BEFORE UPDATE ON public.sales_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3) Vínculo linha do extrato -> lote de venda --------------------------------
ALTER TABLE public.bank_statement_lines
  ADD COLUMN sales_batch_id uuid REFERENCES public.sales_batches(id) ON DELETE SET NULL;

CREATE INDEX idx_bsl_sales_batch ON public.bank_statement_lines(sales_batch_id)
  WHERE sales_batch_id IS NOT NULL;

-- 4) Recalcular received_amount automaticamente -------------------------------
CREATE OR REPLACE FUNCTION public.recalc_sales_batch_received(_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _batch_id IS NULL THEN RETURN; END IF;
  UPDATE public.sales_batches sb
     SET received_amount = COALESCE((
           SELECT SUM(ABS(l.amount))
             FROM public.bank_statement_lines l
            WHERE l.sales_batch_id = _batch_id
         ), 0)
   WHERE sb.id = _batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_bsl_sales_batch_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.recalc_sales_batch_received(NEW.sales_batch_id);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.sales_batch_id IS DISTINCT FROM OLD.sales_batch_id THEN
      PERFORM public.recalc_sales_batch_received(OLD.sales_batch_id);
      PERFORM public.recalc_sales_batch_received(NEW.sales_batch_id);
    ELSIF NEW.amount IS DISTINCT FROM OLD.amount AND NEW.sales_batch_id IS NOT NULL THEN
      PERFORM public.recalc_sales_batch_received(NEW.sales_batch_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_sales_batch_received(OLD.sales_batch_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_bsl_sales_batch_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_statement_lines
  FOR EACH ROW EXECUTE FUNCTION public.trg_bsl_sales_batch_sync();
