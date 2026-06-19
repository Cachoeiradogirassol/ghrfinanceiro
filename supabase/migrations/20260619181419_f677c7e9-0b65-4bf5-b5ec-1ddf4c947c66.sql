CREATE OR REPLACE FUNCTION public.guard_locked_projections()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  ref_date date;
  old_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    ref_date := OLD.start_date;
    IF public.is_date_locked(ref_date) THEN
      RAISE EXCEPTION 'Período fechado: projeção em % está bloqueada para alterações.', ref_date;
    END IF;
    RETURN OLD;
  END IF;

  ref_date := NEW.start_date;
  IF public.is_date_locked(ref_date) THEN
    RAISE EXCEPTION 'Período fechado: projeção em % está bloqueada para alterações.', ref_date;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_date := OLD.start_date;
    IF old_date IS DISTINCT FROM ref_date AND public.is_date_locked(old_date) THEN
      RAISE EXCEPTION 'Período fechado: data original % está bloqueada.', old_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;