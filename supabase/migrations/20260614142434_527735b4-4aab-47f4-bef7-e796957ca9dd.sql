ALTER TABLE public.bank_statement_extracts
ADD COLUMN matched_transaction_id uuid REFERENCES public.transactions(id) ON DELETE SET NULL,
ADD COLUMN matched_by uuid,
ADD COLUMN matched_at timestamptz;

CREATE OR REPLACE FUNCTION public.confirm_bank_statement_extract_matches(_matches jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _match jsonb;
  _extract public.bank_statement_extracts%ROWTYPE;
  _tx public.transactions%ROWTYPE;
  _count integer := 0;
  _expected_positive boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária.';
  END IF;
  IF jsonb_typeof(_matches) <> 'array' OR jsonb_array_length(_matches) = 0 OR jsonb_array_length(_matches) > 200 THEN
    RAISE EXCEPTION 'Lote de conciliação inválido.';
  END IF;

  FOR _match IN SELECT value FROM jsonb_array_elements(_matches)
  LOOP
    SELECT * INTO _extract
    FROM public.bank_statement_extracts
    WHERE id = (_match->>'extract_id')::uuid
      AND status = 'pending'
    FOR UPDATE;

    SELECT * INTO _tx
    FROM public.transactions
    WHERE id = (_match->>'transaction_id')::uuid
      AND status <> 'reconciled'
    FOR UPDATE;

    IF _extract.id IS NULL OR _tx.id IS NULL THEN
      RAISE EXCEPTION 'Sugestão expirada ou já conciliada.';
    END IF;

    _expected_positive := _tx.type = 'receivable';
    IF _extract.bank_account_id IS DISTINCT FROM _tx.bank_account_id
       OR abs(abs(_extract.amount) - abs(_tx.amount)) > 0.01
       OR ((_extract.amount > 0) IS DISTINCT FROM _expected_positive)
       OR abs(_extract.transaction_date - COALESCE(_tx.document_datetime::date, _tx.due_date)) > 3 THEN
      RAISE EXCEPTION 'Sugestão não atende às regras de conta, valor, natureza e data.';
    END IF;

    UPDATE public.bank_statement_extracts
    SET status = 'reconciled',
        matched_transaction_id = _tx.id,
        matched_by = auth.uid(),
        matched_at = now()
    WHERE id = _extract.id;

    UPDATE public.transactions
    SET status = 'reconciled', paid_at = now()
    WHERE id = _tx.id;

    _count := _count + 1;
  END LOOP;

  RETURN _count;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_bank_statement_extract_matches(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_bank_statement_extract_matches(jsonb) TO authenticated, service_role;