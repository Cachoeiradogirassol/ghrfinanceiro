import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MASTER_EMAIL = "drs.cachoeira@gmail.com";

const EnterpriseEnum = z.enum([
  "turismo",
  "restaurante",
  "vinhedo",
  "ghr",
  "ghr_aldeia",
  "ghr_jk",
  "institucional_fazenda",
  "impostos",
]);

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
      .select("user_id, role, enterprise_restriction")
      .in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    return data.users.map((u) => {
      const r = roles?.find((x) => x.user_id === u.id);
      return {
        id: u.id,
        email: u.email,
        display_name: (u.user_metadata as { display_name?: string } | null)?.display_name ?? "",
        banned_until: (u as { banned_until?: string }).banned_until ?? null,
        created_at: u.created_at,
        role: r?.role ?? "user",
        enterprise_restriction: (r as { enterprise_restriction?: string | null } | undefined)?.enterprise_restriction ?? null,
      };
    });
  });

export const updateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        email: z.string().email(),
        display_name: z.string().max(100).optional(),
        role: z.enum(["user", "master"]),
        password: z.string().min(8).max(72).optional().or(z.literal("")),
        enterprise_restriction: EnterpriseEnum.nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const updates: { email: string; user_metadata: { display_name: string | null }; password?: string } = {
      email: data.email,
      user_metadata: { display_name: data.display_name ?? null },
    };
    if (data.password && data.password.length >= 8) updates.password = data.password;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, updates);
    if (error) {
      const msg = /weak|pwned|known to be weak/i.test(error.message)
        ? "Senha muito fraca ou vazada em banco público (HIBP). Escolha uma senha mais forte e única."
        : error.message;
      throw new Error(msg);
    }
    // sync role + restriction: remove other roles, ensure desired role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const restriction = data.role === "master" ? null : (data.enterprise_restriction ?? null);
    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role, enterprise_restriction: restriction });
    return { ok: true };
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
        enterprise_restriction: EnterpriseEnum.nullable().optional(),
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
    if (error) {
      const msg = /weak|pwned|known to be weak/i.test(error.message)
        ? "Senha muito fraca ou vazada em banco público (HIBP). Escolha uma senha mais forte e única."
        : error.message;
      throw new Error(msg);
    }
    const restriction = data.role === "master" ? null : (data.enterprise_restriction ?? null);
    await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: data.role, enterprise_restriction: restriction });
    return { id: created.user.id };
  });

// Returns the currently-signed-in user's enterprise restriction (null = no restriction / master).
export const getMyRestriction = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role, enterprise_restriction")
      .eq("user_id", context.userId)
      .maybeSingle();
    const role = (data as { role?: string } | null)?.role ?? "user";
    const restriction = (data as { enterprise_restriction?: string | null } | null)?.enterprise_restriction ?? null;
    return { role, enterprise_restriction: role === "master" ? null : restriction } as {
      role: string;
      enterprise_restriction: string | null;
    };
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
        enterprise: EnterpriseEnum,
        master_only: z.boolean().default(false),
        is_active: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = {
      code: data.code,
      name: data.name,
      enterprise: data.enterprise,
      master_only: data.master_only,
      is_active: data.is_active,
    };
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

export const archiveOrDeleteCostCenter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { count } = await context.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("cost_center_id", data.id);
    const { count: allocCount } = await context.supabase
      .from("transaction_allocations")
      .select("id", { count: "exact", head: true })
      .eq("cost_center_id", data.id);
    if (((count ?? 0) + (allocCount ?? 0)) > 0) {
      const { error } = await context.supabase
        .from("cost_centers")
        .update({ is_active: false })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { archived: true };
    }
    await context.supabase.from("accounts").delete().eq("cost_center_id", data.id);
    const { error } = await context.supabase
      .from("cost_centers")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });

// ---------- ACCOUNTS ----------
export const upsertAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        cost_center_id: z.string().uuid(),
        name: z.string().min(1).max(120),
        kind: z.enum(["expense", "revenue"]).default("expense"),
        is_active: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = {
      cost_center_id: data.cost_center_id,
      name: data.name,
      kind: data.kind,
      is_active: data.is_active,
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
    const { count } = await context.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_id", data.id);
    if ((count ?? 0) > 0) {
      const { error } = await context.supabase
        .from("accounts")
        .update({ is_active: false })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { archived: true };
    }
    const { error } = await context.supabase
      .from("accounts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
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
        enterprise: EnterpriseEnum,
        master_only: z.boolean().default(false),
        is_active: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const payload = {
      name: data.name,
      bank: data.bank ?? null,
      initial_balance: data.initial_balance,
      enterprise: data.enterprise,
      master_only: data.master_only,
      is_active: data.is_active,
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

export const archiveOrDeleteBankAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { count } = await context.supabase
      .from("transactions")
      .select("id", { count: "exact", head: true })
      .eq("bank_account_id", data.id);
    if ((count ?? 0) > 0) {
      const { error } = await context.supabase
        .from("bank_accounts")
        .update({ is_active: false })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { archived: true };
    }
    const { error } = await context.supabase
      .from("bank_accounts")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { deleted: true };
  });
