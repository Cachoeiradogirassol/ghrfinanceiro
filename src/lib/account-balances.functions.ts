import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { expandEnterpriseFilter } from "@/lib/enterprises";

export type AccountBalanceRow = {
  account_id: string;
  account_name: string;
  bank: string | null;
  enterprise: string | null;
  is_active: boolean;
  balance: number | null;
  as_of_date: string | null;
};

/** Lista todas as contas bancárias com o saldo informado manualmente (se houver). */
export const listAccountBalances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccountBalanceRow[]> => {
    const { data: banks, error } = await context.supabase
      .from("bank_accounts")
      .select("id, name, bank, enterprise, is_active")
      .order("name");
    if (error) throw new Error(error.message);

    const { data: saved, error: e2 } = await context.supabase
      .from("account_balances")
      .select("account_id, balance, as_of_date");
    if (e2) throw new Error(e2.message);

    const byAccount = new Map(
      (saved ?? []).map((s) => [s.account_id, s as { balance: number; as_of_date: string }]),
    );
    return (banks ?? []).map((b) => {
      const s = byAccount.get(b.id);
      return {
        account_id: b.id,
        account_name: b.name,
        bank: b.bank ?? null,
        enterprise: b.enterprise ?? null,
        is_active: b.is_active,
        balance: s ? Number(s.balance) : null,
        as_of_date: s ? s.as_of_date : null,
      };
    });
  });

const SaveSchema = z.object({
  as_of_date: z.string().min(10),
  items: z
    .array(z.object({ account_id: z.string().uuid(), balance: z.number().finite() }))
    .max(200),
});

/** Upsert explícito: um registro por conta e usuário. */
export const saveAccountBalances = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveSchema.parse(d))
  .handler(async ({ context, data }) => {
    if (data.items.length === 0) return { saved: 0 };
    const payload = data.items.map((it) => ({
      account_id: it.account_id,
      balance: it.balance,
      as_of_date: data.as_of_date,
      created_by: context.userId,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await context.supabase
      .from("account_balances")
      .upsert(payload, { onConflict: "created_by,account_id" });
    if (error) throw new Error(error.message);
    return { saved: payload.length };
  });

/** Remove o saldo informado de uma conta (volta ao valor derivado). */
export const clearAccountBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ account_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("account_balances")
      .delete()
      .eq("account_id", data.account_id)
      .eq("created_by", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Saldo inicial informado manualmente, somado conforme o filtro de empresa.
 * Retorna null em `total` quando não há nenhum saldo informado para o filtro.
 */
export const getManualOpeningBalance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ enterprise: z.string().optional() }).parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { data: banks, error } = await context.supabase
      .from("bank_accounts")
      .select("id, enterprise");
    if (error) throw new Error(error.message);
    const { data: saved, error: e2 } = await context.supabase
      .from("account_balances")
      .select("account_id, balance, as_of_date");
    if (e2) throw new Error(e2.message);

    const set = expandEnterpriseFilter(data.enterprise ?? "all");
    const allowed = new Set(
      (banks ?? [])
        .filter((b) => !set || (b.enterprise != null && set.has(b.enterprise)))
        .map((b) => b.id),
    );

    let total = 0;
    let count = 0;
    let asOf: string | null = null;
    for (const s of saved ?? []) {
      if (!allowed.has(s.account_id)) continue;
      total += Number(s.balance);
      count++;
      if (!asOf || s.as_of_date > asOf) asOf = s.as_of_date;
    }
    return count > 0
      ? { total, as_of_date: asOf, accounts: count }
      : { total: null as number | null, as_of_date: null as string | null, accounts: 0 };
  });
