CREATE TABLE public.intercompany_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NULL REFERENCES public.transactions(id) ON DELETE CASCADE,
  projection_id uuid NULL REFERENCES public.cash_projections(id) ON DELETE CASCADE,
  source_cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id) ON DELETE RESTRICT,
  target_cost_center_id uuid NOT NULL REFERENCES public.cost_centers(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT intercompany_transfers_single_origin CHECK (
    (transaction_id IS NOT NULL AND projection_id IS NULL)
    OR (transaction_id IS NULL AND projection_id IS NOT NULL)
  ),
  CONSTRAINT intercompany_transfers_distinct_centers CHECK (source_cost_center_id <> target_cost_center_id),
  CONSTRAINT intercompany_transfers_transaction_target_key UNIQUE (transaction_id, target_cost_center_id),
  CONSTRAINT intercompany_transfers_projection_target_key UNIQUE (projection_id, target_cost_center_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intercompany_transfers TO authenticated;
GRANT ALL ON public.intercompany_transfers TO service_role;

ALTER TABLE public.intercompany_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "intercompany transfers select own or master"
ON public.intercompany_transfers FOR SELECT TO authenticated
USING (created_by = auth.uid() OR public.is_master());

CREATE POLICY "intercompany transfers insert self"
ON public.intercompany_transfers FOR INSERT TO authenticated
WITH CHECK (created_by = auth.uid());

CREATE POLICY "intercompany transfers update own or master"
ON public.intercompany_transfers FOR UPDATE TO authenticated
USING (created_by = auth.uid() OR public.is_master())
WITH CHECK (created_by = auth.uid() OR public.is_master());

CREATE POLICY "intercompany transfers delete own or master"
ON public.intercompany_transfers FOR DELETE TO authenticated
USING (created_by = auth.uid() OR public.is_master());

CREATE INDEX intercompany_transfers_transaction_idx ON public.intercompany_transfers(transaction_id);
CREATE INDEX intercompany_transfers_projection_idx ON public.intercompany_transfers(projection_id);
CREATE INDEX intercompany_transfers_source_idx ON public.intercompany_transfers(source_cost_center_id);
CREATE INDEX intercompany_transfers_target_idx ON public.intercompany_transfers(target_cost_center_id);

CREATE OR REPLACE FUNCTION public.sync_transaction_intercompany(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tx public.transactions%ROWTYPE;
  _bank_enterprise public.enterprise_type;
  _source_cc uuid;
  _allocation_count integer;
BEGIN
  DELETE FROM public.intercompany_transfers WHERE transaction_id = _transaction_id;

  SELECT * INTO _tx FROM public.transactions WHERE id = _transaction_id;
  IF NOT FOUND OR _tx.bank_account_id IS NULL OR _tx.type <> 'payable' THEN
    RETURN;
  END IF;

  SELECT enterprise INTO _bank_enterprise
  FROM public.bank_accounts WHERE id = _tx.bank_account_id;

  SELECT id INTO _source_cc
  FROM public.cost_centers
  WHERE enterprise = _bank_enterprise AND is_active = true
  ORDER BY code, id
  LIMIT 1;

  IF _source_cc IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO _allocation_count
  FROM public.transaction_allocations WHERE transaction_id = _transaction_id;

  IF _allocation_count > 0 THEN
    INSERT INTO public.intercompany_transfers
      (transaction_id, source_cost_center_id, target_cost_center_id, amount, created_by)
    SELECT _tx.id, _source_cc, a.cost_center_id, sum(a.amount), COALESCE(_tx.created_by, auth.uid())
    FROM public.transaction_allocations a
    JOIN public.cost_centers target ON target.id = a.cost_center_id
    WHERE a.transaction_id = _tx.id
      AND target.enterprise <> _bank_enterprise
      AND a.amount > 0
    GROUP BY a.cost_center_id;
  ELSE
    INSERT INTO public.intercompany_transfers
      (transaction_id, source_cost_center_id, target_cost_center_id, amount, created_by)
    SELECT _tx.id, _source_cc, _tx.cost_center_id, _tx.amount, COALESCE(_tx.created_by, auth.uid())
    FROM public.cost_centers target
    WHERE target.id = _tx.cost_center_id
      AND target.enterprise <> _bank_enterprise
      AND _tx.amount > 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_projection_intercompany(_projection_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _projection public.cash_projections%ROWTYPE;
  _bank_enterprise public.enterprise_type;
  _source_cc uuid;
BEGIN
  DELETE FROM public.intercompany_transfers WHERE projection_id = _projection_id;

  SELECT * INTO _projection FROM public.cash_projections WHERE id = _projection_id;
  IF NOT FOUND OR _projection.default_bank_account_id IS NULL
     OR _projection.cost_center_id IS NULL OR _projection.direction <> 'outflow' THEN
    RETURN;
  END IF;

  SELECT enterprise INTO _bank_enterprise
  FROM public.bank_accounts WHERE id = _projection.default_bank_account_id;

  SELECT id INTO _source_cc
  FROM public.cost_centers
  WHERE enterprise = _bank_enterprise AND is_active = true
  ORDER BY code, id
  LIMIT 1;

  IF _source_cc IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.intercompany_transfers
    (projection_id, source_cost_center_id, target_cost_center_id, amount, created_by)
  SELECT _projection.id, _source_cc, _projection.cost_center_id,
         _projection.initial_amount, COALESCE(_projection.created_by, auth.uid())
  FROM public.cost_centers target
  WHERE target.id = _projection.cost_center_id
    AND target.enterprise <> _bank_enterprise
    AND _projection.initial_amount > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_transaction_intercompany()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.intercompany_transfers WHERE transaction_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.sync_transaction_intercompany(NEW.id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_allocation_intercompany()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_transaction_intercompany(COALESCE(NEW.transaction_id, OLD.transaction_id));
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_sync_projection_intercompany()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.intercompany_transfers WHERE projection_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.sync_projection_intercompany(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_transactions_intercompany
AFTER INSERT OR UPDATE OF bank_account_id, cost_center_id, amount, type, created_by
ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_transaction_intercompany();

CREATE TRIGGER trg_sync_allocations_intercompany
AFTER INSERT OR UPDATE OF transaction_id, cost_center_id, amount OR DELETE
ON public.transaction_allocations
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_allocation_intercompany();

CREATE TRIGGER trg_sync_projections_intercompany
AFTER INSERT OR UPDATE OF default_bank_account_id, cost_center_id, initial_amount, direction, created_by
ON public.cash_projections
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_projection_intercompany();

CREATE OR REPLACE VIEW public.v_dre_consolidada
WITH (security_invoker = true)
AS
SELECT
  ict.id,
  ict.transaction_id,
  ict.projection_id,
  ict.source_cost_center_id,
  source.enterprise AS source_enterprise,
  ict.target_cost_center_id,
  target.enterprise AS target_enterprise,
  ict.amount,
  COALESCE((t.document_datetime)::date, t.due_date, p.start_date) AS competence_date,
  ict.created_by,
  ict.created_at
FROM public.intercompany_transfers ict
LEFT JOIN public.transactions t ON t.id = ict.transaction_id
LEFT JOIN public.cash_projections p ON p.id = ict.projection_id
JOIN public.cost_centers source ON source.id = ict.source_cost_center_id
JOIN public.cost_centers target ON target.id = ict.target_cost_center_id;

GRANT SELECT ON public.v_dre_consolidada TO authenticated;
GRANT ALL ON public.v_dre_consolidada TO service_role;