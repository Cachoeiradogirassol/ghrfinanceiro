import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export interface AuditUser {
  user_id: string;
  created_count: number;
  updated_count: number;
  reconciled_count: number;
  total_amount: number;
}

export const buildAuditSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        months: z.number().int().min(1).max(36).default(6),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const from = new Date();
    from.setMonth(from.getMonth() - data.months);
    const fromIso = from.toISOString();

    const [{ data: txs }, { data: lines }] = await Promise.all([
      context.supabase
        .from("transactions")
        .select(
          "id, amount, type, status, created_by, updated_by, created_at, updated_at, cost_centers(enterprise, name)",
        )
        .gte("created_at", fromIso)
        .limit(2000),
      context.supabase
        .from("bank_statement_lines")
        .select("id, matched_by, matched_at, amount, bank_accounts(enterprise, name)")
        .gte("created_at", fromIso)
        .limit(2000),
    ]);

    const byUser = new Map<string, AuditUser>();
    const ensure = (uid: string) => {
      let b = byUser.get(uid);
      if (!b) {
        b = {
          user_id: uid,
          created_count: 0,
          updated_count: 0,
          reconciled_count: 0,
          total_amount: 0,
        };
        byUser.set(uid, b);
      }
      return b;
    };
    for (const t of txs ?? []) {
      if (t.created_by) {
        const b = ensure(t.created_by);
        b.created_count++;
        b.total_amount += Number(t.amount);
      }
      if (t.updated_by && t.updated_by !== t.created_by) {
        ensure(t.updated_by).updated_count++;
      }
    }
    for (const l of lines ?? []) {
      if (l.matched_by) ensure(l.matched_by).reconciled_count++;
    }

    // by enterprise volume
    const byEnterprise = new Map<string, { count: number; amount: number }>();
    for (const t of txs ?? []) {
      const ent =
        (t.cost_centers as { enterprise?: string } | null)?.enterprise ?? "—";
      const b = byEnterprise.get(ent) ?? { count: 0, amount: 0 };
      b.count++;
      b.amount += Number(t.amount);
      byEnterprise.set(ent, b);
    }

    return {
      byUser: Array.from(byUser.values()).sort(
        (a, b) => b.created_count - a.created_count,
      ),
      byEnterprise: Array.from(byEnterprise.entries()).map(([enterprise, v]) => ({
        enterprise,
        ...v,
      })),
      totalTransactions: txs?.length ?? 0,
      totalLines: lines?.length ?? 0,
    };
  });

interface CompBucket {
  revenue: number;
  expense: number;
  net: number;
}

export const buildComparativeDRE = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        months: z.number().int().min(2).max(36).default(12),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const from = new Date();
    from.setMonth(from.getMonth() - data.months);
    from.setDate(1);
    from.setHours(0, 0, 0, 0);

    const { data: txs, error } = await context.supabase
      .from("transactions")
      .select(
        "id, type, amount, due_date, document_datetime, status, cost_centers(enterprise)",
      )
      .gte("due_date", from.toISOString().slice(0, 10))
      .limit(5000);
    if (error) throw new Error(error.message);

    // month → enterprise → bucket
    const map = new Map<string, Map<string, CompBucket>>();
    for (const t of txs ?? []) {
      if (t.status === "pending") continue;
      const iso =
        (t.document_datetime as string | null) ?? (t.due_date as string);
      const monthKey = iso.slice(0, 7);
      const ent =
        (t.cost_centers as { enterprise?: string } | null)?.enterprise ?? "—";
      let perEnt = map.get(monthKey);
      if (!perEnt) {
        perEnt = new Map();
        map.set(monthKey, perEnt);
      }
      let b = perEnt.get(ent);
      if (!b) {
        b = { revenue: 0, expense: 0, net: 0 };
        perEnt.set(ent, b);
      }
      const amt = Number(t.amount);
      if (t.type === "receivable") b.revenue += amt;
      else b.expense += amt;
      b.net = b.revenue - b.expense;
    }

    const months = Array.from(map.keys()).sort();
    const enterprises = Array.from(
      new Set(Array.from(map.values()).flatMap((m) => Array.from(m.keys()))),
    ).sort();

    const series = months.map((m) => {
      const row: Record<string, number | string> = { month: m };
      let revTotal = 0;
      let expTotal = 0;
      for (const ent of enterprises) {
        const b = map.get(m)?.get(ent) ?? { revenue: 0, expense: 0, net: 0 };
        row[`${ent}_rev`] = b.revenue;
        row[`${ent}_exp`] = b.expense;
        row[`${ent}_net`] = b.net;
        revTotal += b.revenue;
        expTotal += b.expense;
      }
      row.total_rev = revTotal;
      row.total_exp = expTotal;
      row.total_net = revTotal - expTotal;
      return row;
    });

    return { months, enterprises, series };
  });
