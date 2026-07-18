-- 1) Tabela de cenários (projeções nomeadas)
CREATE TABLE public.projection_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'real_based' CHECK (mode IN ('real_based','blank')),
  notes TEXT,
  created_by UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.projection_scenarios TO authenticated;
GRANT ALL ON public.projection_scenarios TO service_role;

ALTER TABLE public.projection_scenarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scenarios owner all"
  ON public.projection_scenarios FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_projection_scenarios_updated
BEFORE UPDATE ON public.projection_scenarios
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Vincular cash_projections a um scenario
ALTER TABLE public.cash_projections
  ADD COLUMN scenario_id UUID REFERENCES public.projection_scenarios(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_projections_scenario ON public.cash_projections(scenario_id);

-- 3) Backfill: criar um cenário "Geral" por usuário e migrar projeções existentes
DO $$
DECLARE
  u RECORD;
  new_scenario UUID;
BEGIN
  FOR u IN SELECT DISTINCT created_by FROM public.cash_projections WHERE created_by IS NOT NULL LOOP
    INSERT INTO public.projection_scenarios (name, mode, notes, created_by)
    VALUES ('Geral', 'real_based', 'Cenário padrão criado automaticamente para projeções pré-existentes.', u.created_by)
    RETURNING id INTO new_scenario;

    UPDATE public.cash_projections
      SET scenario_id = new_scenario
    WHERE created_by = u.created_by AND scenario_id IS NULL;
  END LOOP;
END $$;