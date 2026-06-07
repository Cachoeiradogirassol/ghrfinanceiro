ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS enterprise_restriction public.enterprise_type NULL;

INSERT INTO public.cost_centers (code, name, enterprise, master_only, is_active)
VALUES (7, 'ALDEIA GIRASSOL', 'ghr_aldeia', false, true)
ON CONFLICT DO NOTHING;

INSERT INTO public.cost_centers (code, name, enterprise, master_only, is_active)
VALUES (8, 'LOTEAMENTO JK', 'ghr_jk', false, true)
ON CONFLICT DO NOTHING;