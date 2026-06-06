import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MASTER_EMAIL = "drs.cachoeira@gmail.com";

async function assertMaster(context: {
  supabase: { from: (t: string) => { select: (s: string) => { eq: (k: string, v: string) => { eq: (k: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> } } } } };
  userId: string;
  claims: { email?: string };
}) {
  if (context.claims?.email === MASTER_EMAIL) return;
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "master")
    .maybeSingle();
  if (!data) throw new Error("Acesso negado: apenas o Master pode executar esta ação.");
}

// ---------- USERS ----------
export const listUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMaster(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    const ids = data.users.map((u) => u.id);
    const { data: roles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    return data.users.map((u) => ({
      id: u.id,
      email: u.email,
      banned_until: (u as { banned_until?: string }).banned_until ?? null,
      created_at: u.created_at,
      role: roles?.find((r) => r.user_id === u.id)?.role ?? "user",
    }));
  });

export const createUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        email: z.string().email(),
        password: z.string().min(8).max(72),
        display_name: z.string().max(100).optional(),
        role: z.enum(["user", "master"]).default("user"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { display_name: data.display_name ?? null },
    });
    if (error) throw new Error(error.message);
    // ensure role row reflects requested role (trigger sets default)
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: created.user.id, role: data.role },
        { onConflict: "user_id,role" },
      );
    return { id: created.user.id };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ user_id: z.string().uuid(), active: z.boolean() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.active ? "none" : "876000h",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ user_id: z.string().uuid(), password: z.string().min(8).max(72) })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- COST CENTERS ----------
export const upsertCostCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        code: z.number().int().min(1).max(999),
        name: z.string().min(1).max(120),
        master_only: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = { code: data.code, name: data.name, master_only: data.master_only };
    if (data.id) {
      const { error } = await context.supabase
        .from("cost_centers")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("cost_centers")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

// ---------- ACCOUNTS (subcategorias) ----------
export const upsertAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        cost_center_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        kind: z.enum(["expense", "revenue"]).default("expense"),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = {
      cost_center_id: data.cost_center_id,
      name: data.name,
      kind: data.kind,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("accounts")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("accounts")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("accounts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- BANK ACCOUNTS ----------
export const upsertBankAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        bank: z.string().max(120).optional().nullable(),
        initial_balance: z.number(),
        master_only: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = {
      name: data.name,
      bank: data.bank ?? null,
      initial_balance: data.initial_balance,
      master_only: data.master_only,
    };
    if (data.id) {
      const { error } = await context.supabase
        .from("bank_accounts")
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await context.supabase
      .from("bank_accounts")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });
