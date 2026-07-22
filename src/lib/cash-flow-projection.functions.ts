import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Utilidades de mês (YYYY-MM)
function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7);
}
function addMonthsToKey(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthRangeDates(key: string): { start: string; end: string } {
  const [y, m] = key.split("-").map(Number);
  const start = `${key}-01`;
  const endDate = new Date(Date.UTC(y, m, 0));
  const end = `${key}-${String(endDate.getUTCDate()).padStart(2, "0")}`;
  return { start, end };
}

export type CashFlowSource = "realized" | "committed" | "estimated" | "manual";
export type CashFlowFlow = "in" | "out";

export type BreakdownItem = {
  account_id: string;
  account_name: string;
  cost_center_id: string;
  cost_center_name: string;
  source: CashFlowSource;
  flow: CashFlowFlow;
  amount: number;
};

export type MonthLayer = {
  month: string; // YYYY-MM
  label: string;
  realized: { in: number; out: number };
  committed: { in: number; out: number };
  estimated: { in: number; out: number };
  manual: { in: number; out: number };
  net: number; // total in - total out (all layers)
  cumulative_balance: number;
  is_future: boolean;
  negative: boolean;
};

export type CashFlowProjection = {
  months: MonthLayer[];
  breakdown: Record<string, BreakdownItem[]>;
  alerts: string[];
};

const InputSchema = z.object({
  enterprise: z.string().optional(),
  cost_center_id: z.string().uuid().optional(),
  horizon_months: z.number().int().min(1).max(12).default(6),
  scenario_id: z.string().uuid().nullable().optional(),
  include_manual: z.boolean().optional().default(true),
});


export const buildCashFlowProjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InputSchema.parse(d))
  .handler(async ({ context, data }): Promise<CashFlowProjection> => {
    const currentKey = currentMonthKey();
    // Horizonte: histórico dos últimos 3 meses + mês atual + N futuros
    const historyStart = addMonthsToKey(currentKey, -3);
    const futureEnd = addMonthsToKey(currentKey, data.horizon_months);
    const { start: rangeStart } = monthRangeDates(historyStart);
    const { end: rangeEnd } = monthRangeDates(futureEnd);

    // Fetch transactions in range
    let q = context.supabase
      .from("transactions")
      .select(
        "id, type, amount, due_date, document_datetime, paid_at, status, cost_center_id, account_id, is_transfer, accounts(name, kind), cost_centers(name, enterprise)",
      )
      .eq("is_transfer", false)
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd);
    if (data.cost_center_id) q = q.eq("cost_center_id", data.cost_center_id);
    const { data: txs, error } = await q;
    if (error) throw new Error(error.message);

    type Row = {
      id: string;
      type: "receivable" | "payable";
      amount: number | string;
      due_date: string;
      document_datetime: string | null;
      paid_at: string | null;
      status: string;
      cost_center_id: string;
      account_id: string;
      accounts: { name: string; kind: string } | null;
      cost_centers: { name: string; enterprise: string } | null;
    };
    let rows = (txs ?? []) as unknown as Row[];
    if (data.enterprise) {
      rows = rows.filter((r) => r.cost_centers?.enterprise === data.enterprise);
    }

    // Manual: cash_projections (avaliar por mês) — filtrado por cenário quando informado.
    let qp = context.supabase
      .from("cash_projections")
      .select(
        "id, name, direction, cost_center_id, account_id, initial_amount, monthly_growth_rate, start_date, horizon_months, accounts(name), cost_centers(name, enterprise)",
      );
    if (data.cost_center_id) qp = qp.eq("cost_center_id", data.cost_center_id);
    if (data.scenario_id) qp = qp.eq("scenario_id" as never, data.scenario_id);
    const { data: projRows } = data.include_manual === false ? { data: [] } : await qp;

    type Proj = {
      id: string;
      name: string;
      direction: "inflow" | "outflow" | null;
      cost_center_id: string;
      account_id: string;
      initial_amount: number | string;
      monthly_growth_rate: number | string;
      start_date: string;
      horizon_months: number;
      accounts: { name: string } | null;
      cost_centers: { name: string; enterprise: string } | null;
    };
    let projections = (projRows ?? []) as unknown as Proj[];
    if (data.enterprise) {
      projections = projections.filter(
        (p) => p.cost_centers?.enterprise === data.enterprise,
      );
    }

    // Meses do horizonte (a partir do mês atual)
    const months: string[] = [];
    for (let i = 0; i < data.horizon_months + 1; i++) {
      months.push(addMonthsToKey(currentKey, i));
    }
    // Meses históricos (para estimativa)
    const historyMonths: string[] = [
      addMonthsToKey(currentKey, -3),
      addMonthsToKey(currentKey, -2),
      addMonthsToKey(currentKey, -1),
    ];

    // Histórico realizado por (mês, account_id)
    const historyRealized = new Map<string, Map<string, number>>();
    for (const r of rows) {
      if (r.status !== "reconciled") continue;
      const mkey = monthKey(r.paid_at ?? r.document_datetime ?? r.due_date);
      if (!historyMonths.includes(mkey) && !months.includes(mkey)) continue;
      const map = historyRealized.get(mkey) ?? new Map<string, number>();
      const cur = map.get(r.account_id) ?? 0;
      map.set(r.account_id, cur + Number(r.amount));
      historyRealized.set(mkey, map);
    }

    const breakdown: Record<string, BreakdownItem[]> = {};
    const monthly = new Map<
      string,
      { realized_in: number; realized_out: number; committed_in: number; committed_out: number; estimated_in: number; estimated_out: number; manual_in: number; manual_out: number }
    >();
    for (const m of months) {
      monthly.set(m, {
        realized_in: 0,
        realized_out: 0,
        committed_in: 0,
        committed_out: 0,
        estimated_in: 0,
        estimated_out: 0,
        manual_in: 0,
        manual_out: 0,
      });
      breakdown[m] = [];
    }

    // Realizado + Compromissos (a partir do mês atual)
    const committedByMonthAccount = new Map<string, Set<string>>();
    for (const r of rows) {
      const refDate = r.paid_at ?? r.document_datetime ?? r.due_date;
      const mkey = monthKey(r.status === "reconciled" ? refDate : r.due_date);
      if (!months.includes(mkey)) continue;
      const amt = Number(r.amount);
      const flow: CashFlowFlow = r.type === "receivable" ? "in" : "out";
      const bucket = monthly.get(mkey)!;
      if (r.status === "reconciled") {
        if (flow === "in") bucket.realized_in += amt;
        else bucket.realized_out += amt;
        breakdown[mkey].push({
          account_id: r.account_id,
          account_name: r.accounts?.name ?? "—",
          cost_center_id: r.cost_center_id,
          cost_center_name: r.cost_centers?.name ?? "—",
          source: "realized",
          flow,
          amount: amt,
        });
      } else {
        if (flow === "in") bucket.committed_in += amt;
        else bucket.committed_out += amt;
        breakdown[mkey].push({
          account_id: r.account_id,
          account_name: r.accounts?.name ?? "—",
          cost_center_id: r.cost_center_id,
          cost_center_name: r.cost_centers?.name ?? "—",
          source: "committed",
          flow,
          amount: amt,
        });
        const set = committedByMonthAccount.get(mkey) ?? new Set<string>();
        set.add(r.account_id);
        committedByMonthAccount.set(mkey, set);
      }
    }

    // Estimativa histórica: média dos últimos 3 meses realizados por account,
    // aplicada apenas em meses FUTUROS onde não há compromisso desse account.
    // Requer >= 2 meses com dados.
    // Precisamos também de metadados (name, cc) para o breakdown → coletar de rows.
    const accountMeta = new Map<
      string,
      { name: string; cost_center_id: string; cost_center_name: string; kind: string }
    >();
    for (const r of rows) {
      if (!accountMeta.has(r.account_id)) {
        accountMeta.set(r.account_id, {
          name: r.accounts?.name ?? "—",
          cost_center_id: r.cost_center_id,
          cost_center_name: r.cost_centers?.name ?? "—",
          kind: r.accounts?.kind ?? "expense",
        });
      }
    }

    const avgByAccount = new Map<string, number>();
    for (const [accId] of accountMeta) {
      let sum = 0;
      let count = 0;
      for (const m of historyMonths) {
        const v = historyRealized.get(m)?.get(accId);
        if (v !== undefined && v !== 0) {
          sum += v;
          count++;
        }
      }
      if (count >= 2) avgByAccount.set(accId, sum / count);
    }

    for (const m of months) {
      if (m <= currentKey) continue; // só futuros
      const committedSet = committedByMonthAccount.get(m) ?? new Set<string>();
      for (const [accId, avg] of avgByAccount) {
        if (committedSet.has(accId)) continue;
        const meta = accountMeta.get(accId)!;
        const flow: CashFlowFlow = meta.kind === "revenue" ? "in" : "out";
        const bucket = monthly.get(m)!;
        if (flow === "in") bucket.estimated_in += avg;
        else bucket.estimated_out += avg;
        breakdown[m].push({
          account_id: accId,
          account_name: meta.name,
          cost_center_id: meta.cost_center_id,
          cost_center_name: meta.cost_center_name,
          source: "estimated",
          flow,
          amount: avg,
        });
      }
    }

    // Camada Manual (cash_projections)
    for (const p of projections) {
      const initial = Number(p.initial_amount);
      const rate = Number(p.monthly_growth_rate) / 100;
      const startKey = monthKey(p.start_date);
      const flow: CashFlowFlow = p.direction === "outflow" ? "out" : "in";
      for (let i = 0; i < p.horizon_months; i++) {
        const mkey = addMonthsToKey(startKey, i);
        if (!months.includes(mkey)) continue;
        const value = initial * Math.pow(1 + rate, i);
        const bucket = monthly.get(mkey)!;
        if (flow === "in") bucket.manual_in += value;
        else bucket.manual_out += value;
        breakdown[mkey].push({
          account_id: p.account_id,
          account_name: p.accounts?.name ?? p.name,
          cost_center_id: p.cost_center_id,
          cost_center_name: p.cost_centers?.name ?? "—",
          source: "manual",
          flow,
          amount: value,
        });
      }
    }

    // Monta layers + saldo acumulado
    let cumulative = 0;
    const layers: MonthLayer[] = months.map((m) => {
      const b = monthly.get(m)!;
      const totalIn = b.realized_in + b.committed_in + b.estimated_in + b.manual_in;
      const totalOut = b.realized_out + b.committed_out + b.estimated_out + b.manual_out;
      const net = totalIn - totalOut;
      cumulative += net;
      const [y, mm] = m.split("-").map(Number);
      const label = new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("pt-BR", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
      return {
        month: m,
        label,
        realized: { in: b.realized_in, out: b.realized_out },
        committed: { in: b.committed_in, out: b.committed_out },
        estimated: { in: b.estimated_in, out: b.estimated_out },
        manual: { in: b.manual_in, out: b.manual_out },
        net,
        cumulative_balance: cumulative,
        is_future: m > currentKey,
        negative: cumulative < 0,
      };
    });

    const alerts: string[] = [];
    for (const layer of layers) {
      if (layer.negative) {
        alerts.push(
          `Saldo acumulado projetado NEGATIVO em ${layer.label}: ${layer.cumulative_balance.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        );
      }
    }

    return { months: layers, breakdown, alerts };
  });
