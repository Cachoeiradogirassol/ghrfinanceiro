import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SimFlow = "in" | "out";
export type SimMode = "recurring" | "spread" | "seasonal" | "manual";

export type SimItem = {
  id: string;
  category_id: string;
  name: string;
  enterprise: string;
  flow: SimFlow;
  mode: SimMode;
  amount: number;
  total_amount: number;
  months_count: number;
  start_month: string | null;
  factor: number;
  adjust_pct: number;
  monthly_values: Record<string, number>;
  sort_order: number;
};

export type SimCategory = {
  id: string;
  scenario_id: string | null;
  name: string;
  sort_order: number;
  items: SimItem[];
};

export type SimSettings = {
  revenue_adjust_pct: number;
  expense_adjust_pct: number;
  horizon_months: number;
};

const ScenarioArg = z.object({ scenario_id: z.string().uuid().nullable().optional() });

// ---------- LISTAR CATEGORIAS + ITENS ----------
export const listSimCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ScenarioArg.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<SimCategory[]> => {
    let q = context.supabase
      .from("sim_categories" as never)
      .select("id, scenario_id, name, sort_order, sim_items(*)")
      .order("sort_order", { ascending: true });
    q = data.scenario_id
      ? q.eq("scenario_id" as never, data.scenario_id)
      : q.is("scenario_id" as never, null);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    type Raw = {
      id: string;
      scenario_id: string | null;
      name: string;
      sort_order: number;
      sim_items: Array<Record<string, unknown>> | null;
    };
    return ((rows ?? []) as unknown as Raw[]).map((c) => ({
      id: c.id,
      scenario_id: c.scenario_id,
      name: c.name,
      sort_order: c.sort_order,
      items: (c.sim_items ?? [])
        .map((raw) => {
          const it = raw as Record<string, unknown>;
          return {
            id: String(it.id),
            category_id: String(it.category_id),
            name: String(it.name ?? ""),
            enterprise: String(it.enterprise ?? "turismo"),
            flow: (it.flow === "out" ? "out" : "in") as SimFlow,
            mode: (it.mode ?? "recurring") as SimMode,
            amount: Number(it.amount ?? 0),
            total_amount: Number(it.total_amount ?? 0),
            months_count: Number(it.months_count ?? 6),
            start_month: (it.start_month as string | null) ?? null,
            factor: Number(it.factor ?? 1),
            adjust_pct: Number(it.adjust_pct ?? 0),
            monthly_values: (it.monthly_values ?? {}) as Record<string, number>,
            sort_order: Number(it.sort_order ?? 0),
          } satisfies SimItem;
        })
        .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    }));
  });

// ---------- CATEGORIAS ----------
export const createSimCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(120),
        scenario_id: z.string().uuid().nullable().optional(),
        sort_order: z.number().int().default(0),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("sim_categories" as never)
      .insert({
        name: data.name,
        scenario_id: data.scenario_id ?? null,
        sort_order: data.sort_order,
        created_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as { id: string };
  });

export const renameSimCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), name: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("sim_categories" as never)
      .update({ name: data.name } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSimCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("sim_categories" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ITENS ----------
const ItemFields = z.object({
  name: z.string().trim().min(1).max(160),
  enterprise: z.string().min(1),
  flow: z.enum(["in", "out"]),
  mode: z.enum(["recurring", "spread", "seasonal", "manual"]),
  amount: z.number().default(0),
  total_amount: z.number().default(0),
  months_count: z.number().int().min(1).max(60).default(6),
  start_month: z.string().nullable().optional(),
  factor: z.number().min(0).max(20).default(1),
  adjust_pct: z.number().min(-100).max(500).default(0),
  monthly_values: z.record(z.string(), z.number()).default({}),
});

export const createSimItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ItemFields.extend({ category_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("sim_items" as never)
      .insert({ ...data, created_by: context.userId } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row as unknown as { id: string };
  });

export const updateSimItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    ItemFields.partial().extend({ id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase
      .from("sim_items" as never)
      .update(patch as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSimItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("sim_items" as never)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- AJUSTES GLOBAIS ----------
export const getSimSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ScenarioArg.parse(d ?? {}))
  .handler(async ({ context, data }): Promise<SimSettings> => {
    let q = context.supabase
      .from("sim_settings" as never)
      .select("revenue_adjust_pct, expense_adjust_pct, horizon_months");
    q = data.scenario_id
      ? q.eq("scenario_id" as never, data.scenario_id)
      : q.is("scenario_id" as never, null);
    const { data: row, error } = await q.maybeSingle();
    if (error) throw new Error(error.message);
    const r = row as unknown as SimSettings | null;
    return {
      revenue_adjust_pct: Number(r?.revenue_adjust_pct ?? 0),
      expense_adjust_pct: Number(r?.expense_adjust_pct ?? 0),
      horizon_months: Number(r?.horizon_months ?? 6),
    };
  });

export const saveSimSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        scenario_id: z.string().uuid().nullable().optional(),
        revenue_adjust_pct: z.number().min(-100).max(500),
        expense_adjust_pct: z.number().min(-100).max(500),
        horizon_months: z.number().int().min(1).max(12),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    let sel = context.supabase.from("sim_settings" as never).select("id");
    sel = data.scenario_id
      ? sel.eq("scenario_id" as never, data.scenario_id)
      : sel.is("scenario_id" as never, null);
    const { data: existing } = await sel.maybeSingle();
    const patch = {
      revenue_adjust_pct: data.revenue_adjust_pct,
      expense_adjust_pct: data.expense_adjust_pct,
      horizon_months: data.horizon_months,
      updated_at: new Date().toISOString(),
    };
    if (existing) {
      const { error } = await context.supabase
        .from("sim_settings" as never)
        .update(patch as never)
        .eq("id", (existing as unknown as { id: string }).id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("sim_settings" as never).insert({
        ...patch,
        scenario_id: data.scenario_id ?? null,
        created_by: context.userId,
      } as never);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// ---------- BASE SAZONAL (histórico realizado por empreendimento) ----------
// Média mensal dos últimos 3 meses conciliados, por empreendimento e fluxo.
// Mesma base que a camada "estimado" usa: transações conciliadas, sem transferências.
export const getSeasonalBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Record<string, { in: number; out: number }>> => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    const { data, error } = await context.supabase
      .from("transactions")
      .select("type, amount, is_transfer, status, cost_centers(enterprise)")
      .eq("is_transfer", false)
      .eq("status", "reconciled")
      .gte("due_date", start.toISOString().slice(0, 10))
      .lte("due_date", end.toISOString().slice(0, 10));
    if (error) throw new Error(error.message);
    type Row = {
      type: "receivable" | "payable";
      amount: number | string;
      cost_centers: { enterprise: string } | null;
    };
    const acc: Record<string, { in: number; out: number }> = {};
    for (const r of (data ?? []) as unknown as Row[]) {
      const ent = r.cost_centers?.enterprise;
      if (!ent) continue;
      acc[ent] = acc[ent] ?? { in: 0, out: 0 };
      if (r.type === "receivable") acc[ent].in += Number(r.amount);
      else acc[ent].out += Number(r.amount);
    }
    for (const k of Object.keys(acc)) {
      acc[k].in = acc[k].in / 3;
      acc[k].out = acc[k].out / 3;
    }
    return acc;
  });
