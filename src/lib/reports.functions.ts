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
        "id, type, amount, due_date, document_datetime, status, is_transfer, cost_centers(enterprise)",
      )
      .gte("due_date", from.toISOString().slice(0, 10))
      .eq("is_transfer", false)
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

// ---------- COST ANALYTICS (per enterprise / account) ----------

const EnterpriseFilter = z
  .enum([
    "all",
    "turismo",
    "restaurante",
    "vinhedo",
    "ghr",
    "institucional_fazenda",
    "impostos",
  ])
  .default("all");

export const buildCostAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        enterprise: EnterpriseFilter,
        accountId: z.string().uuid().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const to = data.to ?? new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 12);
    const from = data.from ?? fromDate.toISOString().slice(0, 10);

    // Pull transactions with allocations within the period; filter realised only
    let q = context.supabase
      .from("transactions")
      .select(
        "id, amount, type, status, due_date, document_datetime, account_id, is_transfer, accounts(name, kind), cost_centers(enterprise), transaction_allocations(amount, cost_centers(enterprise))",
      )
      .gte("due_date", from)
      .lte("due_date", to)
      .eq("is_transfer", false)
      .limit(8000);
    if (data.accountId) q = q.eq("account_id", data.accountId);
    const { data: txs, error } = await q;
    if (error) throw new Error(error.message);

    const realised = (txs ?? []).filter((t) => t.status !== "pending");

    // Split-by-enterprise (use allocations when present, else fall back to tx cost_center.enterprise)
    const byEnt = new Map<string, number>();
    let totalAmount = 0;
    const monthly = new Map<string, number>();
    let revenueForEnterprise = 0;
    let expenseForEnterprise = 0;

    for (const t of realised) {
      const amt = Number(t.amount);
      const allocs =
        (t.transaction_allocations as
          | { amount: number; cost_centers: { enterprise?: string } | null }[]
          | null) ?? [];
      if (t.type === "payable") {
        if (allocs.length > 0) {
          for (const a of allocs) {
            const ent = a.cost_centers?.enterprise ?? "—";
            if (data.enterprise !== "all" && ent !== data.enterprise) continue;
            const v = Number(a.amount);
            byEnt.set(ent, (byEnt.get(ent) ?? 0) + v);
            totalAmount += v;
          }
        } else {
          const ent =
            (t.cost_centers as { enterprise?: string } | null)?.enterprise ?? "—";
          if (data.enterprise === "all" || ent === data.enterprise) {
            byEnt.set(ent, (byEnt.get(ent) ?? 0) + amt);
            totalAmount += amt;
          }
        }
      }

      // monthly time series of the filtered account (expenses only when payable)
      if (t.type === "payable") {
        const iso =
          (t.document_datetime as string | null) ?? (t.due_date as string);
        const key = iso.slice(0, 7);
        monthly.set(key, (monthly.get(key) ?? 0) + amt);
      }

      // enterprise revenue/expense for impact percent
      if (data.enterprise !== "all") {
        const ent =
          (t.cost_centers as { enterprise?: string } | null)?.enterprise ?? "—";
        if (ent === data.enterprise) {
          if (t.type === "receivable") revenueForEnterprise += amt;
          else expenseForEnterprise += amt;
        }
      }
    }

    const distribution = Array.from(byEnt.entries())
      .map(([enterprise, amount]) => ({ enterprise, amount }))
      .sort((a, b) => b.amount - a.amount);

    const timeline = Array.from(monthly.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, amount]) => ({ month, amount }));

    const monthsCount = Math.max(1, timeline.length);
    const monthlyAvg = totalAmount / monthsCount;
    const impactPct =
      data.enterprise !== "all" && expenseForEnterprise > 0
        ? (totalAmount / expenseForEnterprise) * 100
        : 0;

    return {
      distribution,
      timeline,
      kpis: {
        total: totalAmount,
        monthlyAvg,
        impactPct,
        enterpriseRevenue: revenueForEnterprise,
        enterpriseExpense: expenseForEnterprise,
      },
      period: { from, to },
    };
  });

