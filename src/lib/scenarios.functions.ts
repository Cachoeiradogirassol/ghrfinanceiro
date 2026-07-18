import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type ProjectionScenario = {
  id: string;
  name: string;
  mode: "real_based" | "blank";
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const listScenarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("projection_scenarios" as never)
      .select("id, name, mode, notes, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ProjectionScenario[];
  });

const CreateInput = z.object({
  name: z.string().trim().min(2).max(120),
  mode: z.enum(["real_based", "blank"]),
  notes: z.string().max(500).optional().nullable(),
});

export const createScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("projection_scenarios" as never)
      .insert({
        name: data.name,
        mode: data.mode,
        notes: data.notes ?? null,
        created_by: context.userId,
      } as never)
      .select("id, name, mode, notes, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as ProjectionScenario;
  });

const RenameInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
});

export const renameScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RenameInput.parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("projection_scenarios" as never)
      .update({ name: data.name } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScenario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    // Delete related projections first (cascade não configurado no cash_projections.scenario_id, é SET NULL)
    // Estratégia: deletar projeções vinculadas ao cenário — o operador escolhe deletar TUDO.
    await context.supabase
      .from("cash_projections")
      .delete()
      .eq("scenario_id" as never, data.id);
    const { error } = await context.supabase
      .from("projection_scenarios" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
