import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------- LIST ----------
export const listProjections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cash_projections")
      .select(
        "*, cost_centers(code, name, enterprise), accounts(name, kind), contacts(name), bank_accounts:default_bank_account_id(name, bank), realizations:cash_projection_realizations(id, month_index, transaction_id, realized_amount, realized_at)",
      )
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- CREATE ----------
const ProjectionInput = z.object({
  name: z.string().trim().min(2).max(120),
  direction: z.enum(["inflow", "outflow"]).default("inflow"),
  cost_center_id: z.string().uuid(),
  account_id: z.string().uuid(),
  contact_id: z.string().uuid().nullable().optional(),
  default_bank_account_id: z.string().uuid().nullable().optional(),
  initial_amount: z.number().nonnegative(),
  monthly_growth_rate: z.number().min(-100).max(100),
  start_date: z.string(),
  horizon_months: z.number().int().min(1).max(120).default(24),
  notes: z.string().max(500).nullable().optional(),
});

export const createProjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ProjectionInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("cash_projections")
      .insert({
        name: data.name,
        direction: data.direction,
        cost_center_id: data.cost_center_id,
        account_id: data.account_id,
        contact_id: data.contact_id ?? null,
        default_bank_account_id: data.default_bank_account_id ?? null,
        initial_amount: data.initial_amount,
        monthly_growth_rate: data.monthly_growth_rate,
        start_date: data.start_date,
        horizon_months: data.horizon_months,
        notes: data.notes ?? null,
        created_by: context.userId,
      } as never)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- BULK CREATE (Modo Grade Rápida) ----------
const BulkProjRow = z.object({
  name: z.string().trim().min(2).max(120),
  direction: z.enum(["inflow", "outflow"]).default("inflow"),
  cost_center_id: z.string().uuid(),
  account_id: z.string().uuid(),
  initial_amount: z.number().nonnegative(),
  start_date: z.string(),
  monthly_growth_rate: z.number().min(-100).max(100).default(0),
  horizon_months: z.number().int().min(1).max(120).default(12),
});

export const bulkCreateProjections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ rows: z.array(BulkProjRow).min(1).max(500) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const rows = data.rows.map((r) => ({
      name: r.name,
      direction: r.direction,
      cost_center_id: r.cost_center_id,
      account_id: r.account_id,
      contact_id: null,
      default_bank_account_id: null,
      initial_amount: r.initial_amount,
      monthly_growth_rate: r.monthly_growth_rate,
      start_date: r.start_date,
      horizon_months: r.horizon_months,
      notes: null,
      created_by: context.userId,
    }));
    const { data: inserted, error } = await context.supabase
      .from("cash_projections")
      .insert(rows as never)
      .select("id");
    if (error) throw new Error("Falha no bulk insert: " + error.message);
    return { created: inserted?.length ?? 0 };
  });

// ---------- DELETE ----------
export const deleteProjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("cash_projections")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- REALIZE MONTH ----------
const RealizeInput = z.object({
  projection_id: z.string().uuid(),
  month_index: z.number().int().min(0),
  realized_amount: z.number().positive(),
  bank_account_id: z.string().uuid(),
  due_date: z.string(),
  description: z.string().max(500).optional().nullable(),
});

export const realizeProjectionMonth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RealizeInput.parse(d))
  .handler(async ({ context, data }) => {
    // Load projection (RLS scopes ownership)
    const { data: proj, error: pErr } = await context.supabase
      .from("cash_projections")
      .select("id, name, cost_center_id, account_id, contact_id, direction")
      .eq("id", data.projection_id)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proj) throw new Error("Projeção não encontrada.");

    const projDirection = (proj as { direction?: string }).direction ?? "inflow";
    const txType = projDirection === "outflow" ? "payable" : "receivable";

    // Inflow exige contato (pagador/cliente); outflow não — quem paga é a própria estrutura.
    if (projDirection === "inflow" && !proj.contact_id) {
      throw new Error(
        "Esta projeção de entrada não possui contato (cliente) padrão. Edite a projeção e defina um contato antes de realizar no caixa.",
      );
    }


    // Already realized?
    const { data: existing } = await context.supabase
      .from("cash_projection_realizations")
      .select("id")
      .eq("projection_id", data.projection_id)
      .eq("month_index", data.month_index)
      .maybeSingle();
    if (existing) throw new Error("Esta parcela mensal já foi realizada no caixa.");

    // Create real transaction as reconciled
    const { data: tx, error: txErr } = await context.supabase
      .from("transactions")
      .insert({
        cost_center_id: proj.cost_center_id,
        account_id: proj.account_id,
        bank_account_id: data.bank_account_id,
        contact_id: proj.contact_id,
        type: txType,
        amount: data.realized_amount,
        description:
          data.description ??
          `${proj.name} — realização preditiva (mês ${data.month_index + 1})`,
        document_datetime: data.due_date,
        due_date: data.due_date,
        is_batch: false,
        status: "reconciled",
        payment_method: null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (txErr) throw new Error("Falha ao criar lançamento: " + txErr.message);

    // Register realization
    const { error: rErr } = await context.supabase
      .from("cash_projection_realizations")
      .insert({
        projection_id: data.projection_id,
        month_index: data.month_index,
        transaction_id: tx.id,
        realized_amount: data.realized_amount,
        created_by: context.userId,
      });
    if (rErr) {
      // try to rollback transaction
      await context.supabase.from("transactions").delete().eq("id", tx.id);
      throw new Error("Falha ao registrar realização: " + rErr.message);
    }

    return { ok: true, transaction_id: tx.id };
  });
