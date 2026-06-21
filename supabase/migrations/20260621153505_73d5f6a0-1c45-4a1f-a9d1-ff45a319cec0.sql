INSERT INTO public.cost_centers (code, name, enterprise, is_active)
VALUES ('9', 'GHR - Loteamento Alexânia', 'ghr_alexania'::public.enterprise_type, true)
ON CONFLICT DO NOTHING;