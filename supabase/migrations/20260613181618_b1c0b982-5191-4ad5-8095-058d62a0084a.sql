ALTER TABLE public.contacts
  ALTER COLUMN document_type DROP NOT NULL,
  ALTER COLUMN document_number DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS phone text;

ALTER TABLE public.contacts
  DROP CONSTRAINT IF EXISTS contacts_document_type_check;

ALTER TABLE public.contacts
  ADD CONSTRAINT contacts_document_type_check
  CHECK (document_type IS NULL OR document_type IN ('PF', 'PJ'));

CREATE UNIQUE INDEX IF NOT EXISTS contacts_document_number_unique_not_null
  ON public.contacts (document_number)
  WHERE document_number IS NOT NULL AND document_number <> '';

COMMENT ON COLUMN public.contacts.phone IS 'Telefone opcional do fornecedor ou colaborador';