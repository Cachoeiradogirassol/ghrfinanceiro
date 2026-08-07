CREATE TABLE public.seasonal_baseline (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  enterprise public.enterprise_type NOT NULL,
  flow text NOT NULL CHECK (flow IN ('in','out')),
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount numeric NOT NULL DEFAULT 0,
  year integer NOT NULL DEFAULT 2025,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enterprise, flow, month, year)
);

GRANT SELECT ON public.seasonal_baseline TO authenticated;
GRANT ALL ON public.seasonal_baseline TO service_role;

ALTER TABLE public.seasonal_baseline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read seasonal baseline"
ON public.seasonal_baseline FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER trg_seasonal_baseline_touch
BEFORE UPDATE ON public.seasonal_baseline
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.seasonal_baseline (enterprise, flow, month, amount, year) VALUES
('turismo','in',1,30071.20,2025),('turismo','in',2,25005.60,2025),('turismo','in',3,51016.87,2025),('turismo','in',4,33936.83,2025),('turismo','in',5,21143.96,2025),('turismo','in',6,11479.65,2025),('turismo','in',7,11403.12,2025),('turismo','in',8,24870.39,2025),('turismo','in',9,41362.52,2025),('turismo','in',10,36920.59,2025),('turismo','in',11,22804.66,2025),('turismo','in',12,29273.53,2025),
('restaurante','in',1,21051.28,2025),('restaurante','in',2,22035.92,2025),('restaurante','in',3,44164.54,2025),('restaurante','in',4,18870.29,2025),('restaurante','in',5,17234.47,2025),('restaurante','in',6,7730.27,2025),('restaurante','in',7,0,2025),('restaurante','in',8,18057.88,2025),('restaurante','in',9,31148.66,2025),('restaurante','in',10,39314.31,2025),('restaurante','in',11,35939.48,2025),('restaurante','in',12,14330.89,2025),
('vinhedo','in',1,4376,2025),('vinhedo','in',2,5908,2025),('vinhedo','in',3,4242,2025),('vinhedo','in',4,7417.50,2025),('vinhedo','in',5,7125.80,2025),('vinhedo','in',6,955,2025),('vinhedo','in',7,1470,2025),('vinhedo','in',8,1272.50,2025),('vinhedo','in',9,5355.89,2025),('vinhedo','in',10,16167,2025),('vinhedo','in',11,14368,2025),('vinhedo','in',12,15367,2025),
('turismo','out',1,16944.31,2025),('turismo','out',2,15759.51,2025),('turismo','out',3,25904.42,2025),('turismo','out',4,13261.32,2025),('turismo','out',5,16284.58,2025),('turismo','out',6,17650.72,2025),('turismo','out',7,15352.85,2025),('turismo','out',8,13444.23,2025),('turismo','out',9,15220.40,2025),('turismo','out',10,29329.28,2025),('turismo','out',11,19120.19,2025),('turismo','out',12,27110.07,2025),
('restaurante','out',1,16968.27,2025),('restaurante','out',2,6820.96,2025),('restaurante','out',3,21686.39,2025),('restaurante','out',4,17881.03,2025),('restaurante','out',5,15732.74,2025),('restaurante','out',6,11647.62,2025),('restaurante','out',7,18178.15,2025),('restaurante','out',8,23673.14,2025),('restaurante','out',9,27980.05,2025),('restaurante','out',10,19241.36,2025),('restaurante','out',11,29121.14,2025),('restaurante','out',12,21496.83,2025),
('vinhedo','out',1,8292.58,2025),('vinhedo','out',2,7046.02,2025),('vinhedo','out',3,5560.42,2025),('vinhedo','out',4,5608.25,2025),('vinhedo','out',5,6709.26,2025),('vinhedo','out',6,2120.58,2025),('vinhedo','out',7,6796.60,2025),('vinhedo','out',8,17153.40,2025),('vinhedo','out',9,23304.61,2025),('vinhedo','out',10,14901,2025),('vinhedo','out',11,20052,2025),('vinhedo','out',12,22534.33,2025),
('institucional_fazenda','out',1,16411.95,2025),('institucional_fazenda','out',2,4008.80,2025),('institucional_fazenda','out',3,6634.37,2025),('institucional_fazenda','out',4,17094.35,2025),('institucional_fazenda','out',5,8757.60,2025),('institucional_fazenda','out',6,9115.93,2025),('institucional_fazenda','out',7,9724.63,2025),('institucional_fazenda','out',8,10678.04,2025),('institucional_fazenda','out',9,13331.76,2025),('institucional_fazenda','out',10,0,2025),('institucional_fazenda','out',11,11015.10,2025),('institucional_fazenda','out',12,0,2025),
('impostos','out',1,2467.59,2025),('impostos','out',2,2652.25,2025),('impostos','out',3,2671.80,2025),('impostos','out',4,2632.78,2025),('impostos','out',5,3177.62,2025),('impostos','out',6,2946.49,2025),('impostos','out',7,3384.47,2025),('impostos','out',8,3017.96,2025),('impostos','out',9,2844.60,2025),('impostos','out',10,2907.34,2025),('impostos','out',11,3048.21,2025),('impostos','out',12,3709.94,2025)
ON CONFLICT (enterprise, flow, month, year) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now();