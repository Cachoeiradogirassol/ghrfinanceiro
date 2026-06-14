DROP POLICY IF EXISTS "Authenticated users can insert automatic extracts" ON public.bank_statement_extracts;
DROP POLICY IF EXISTS "Authenticated users can update automatic extracts" ON public.bank_statement_extracts;
DROP POLICY IF EXISTS "Authenticated users can delete automatic extracts" ON public.bank_statement_extracts;

CREATE POLICY "Master can insert automatic extracts"
ON public.bank_statement_extracts FOR INSERT TO authenticated
WITH CHECK (public.is_master());

CREATE POLICY "Master can update automatic extracts"
ON public.bank_statement_extracts FOR UPDATE TO authenticated
USING (public.is_master()) WITH CHECK (public.is_master());

CREATE POLICY "Master can delete automatic extracts"
ON public.bank_statement_extracts FOR DELETE TO authenticated
USING (public.is_master());