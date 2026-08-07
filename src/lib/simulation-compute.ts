import type { SimCategory, SimItem } from "@/lib/simulation.functions";

/** Base sazonal 2025: por empreendimento, valor de cada mês-calendário (1–12). */
export type SeasonalBases = Record<
  string,
  { in: Record<number, number>; out: Record<number, number> }
>;

/** Média anual da base sazonal (usada apenas para exibição/resumo). */
export function seasonalAverage(
  bases: SeasonalBases,
  enterprise: string,
  flow: "in" | "out",
): number {
  const m = bases[enterprise]?.[flow];
  if (!m) return 0;
  const vals = Object.values(m);
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function addMonthsToKey(key: string, months: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("pt-BR", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

// Horizonte: mês atual + N meses futuros.
export function horizonMonths(n: number): string[] {
  const base = currentMonthKey();
  return Array.from({ length: n + 1 }, (_, i) => addMonthsToKey(base, i));
}

export type GlobalAdjust = { revenuePct: number; expensePct: number };

/** Série mensal (bruta, antes dos ajustes %) de um item. */
export function itemSeries(
  item: SimItem,
  months: string[],
  bases: SeasonalBases,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of months) out[m] = 0;

  const startKey = item.start_month ? item.start_month.slice(0, 7) : months[0];

  if (item.mode === "recurring") {
    for (const m of months) if (m >= startKey) out[m] = item.amount;
  } else if (item.mode === "spread") {
    const n = Math.max(1, item.months_count);
    const per = item.total_amount / n;
    for (let i = 0; i < n; i++) {
      const key = addMonthsToKey(startKey, i);
      if (key in out) out[key] = per;
    }
  } else if (item.mode === "seasonal") {
    // Sazonal: usa o valor do mês-calendário correspondente na base de 2025 × fator.
    const base = bases[item.enterprise];
    const table = (item.flow === "in" ? base?.in : base?.out) ?? {};
    for (const m of months) {
      if (m < startKey) continue;
      const monthNumber = Number(m.split("-")[1]);
      out[m] = Number(table[monthNumber] ?? 0) * (item.factor || 1);
    }
  } else {
    for (const m of months) out[m] = Number(item.monthly_values?.[m] ?? 0);
  }
  return out;
}

/** Aplica ajuste do item + ajuste global conforme o fluxo. */
export function adjustedItemSeries(
  item: SimItem,
  months: string[],
  bases: SeasonalBases,
  global: GlobalAdjust,
): Record<string, number> {
  const raw = itemSeries(item, months, bases);
  const globalPct = item.flow === "in" ? global.revenuePct : global.expensePct;
  const mult = (1 + item.adjust_pct / 100) * (1 + globalPct / 100);
  const out: Record<string, number> = {};
  for (const m of months) out[m] = (raw[m] ?? 0) * mult;
  return out;
}

export type CategoryTotals = {
  id: string;
  name: string;
  flowIn: Record<string, number>;
  flowOut: Record<string, number>;
};

export type SimulationResult = {
  months: string[];
  perMonth: Record<string, { in: number; out: number; net: number }>;
  categories: CategoryTotals[];
  totalIn: number;
  totalOut: number;
  totalNet: number;
  /** Overlay para somar na camada de simulação do motor de fluxo. */
  overlay: Record<string, { in: number; out: number }>;
};

export function computeSimulation(
  categories: SimCategory[],
  monthsCount: number,
  bases: SeasonalBases,
  global: GlobalAdjust,
  enterpriseFilter?: Set<string> | null,
): SimulationResult {
  const months = horizonMonths(monthsCount);
  const perMonth: SimulationResult["perMonth"] = {};
  for (const m of months) perMonth[m] = { in: 0, out: 0, net: 0 };

  const cats: CategoryTotals[] = [];
  for (const c of categories) {
    const flowIn: Record<string, number> = {};
    const flowOut: Record<string, number> = {};
    for (const m of months) {
      flowIn[m] = 0;
      flowOut[m] = 0;
    }
    for (const item of c.items) {
      if (enterpriseFilter && !enterpriseFilter.has(item.enterprise)) continue;
      const series = adjustedItemSeries(item, months, bases, global);
      for (const m of months) {
        const v = series[m] ?? 0;
        if (item.flow === "in") {
          flowIn[m] += v;
          perMonth[m].in += v;
        } else {
          flowOut[m] += v;
          perMonth[m].out += v;
        }
      }
    }
    cats.push({ id: c.id, name: c.name, flowIn, flowOut });
  }

  let totalIn = 0;
  let totalOut = 0;
  const overlay: Record<string, { in: number; out: number }> = {};
  for (const m of months) {
    perMonth[m].net = perMonth[m].in - perMonth[m].out;
    totalIn += perMonth[m].in;
    totalOut += perMonth[m].out;
    overlay[m] = { in: perMonth[m].in, out: perMonth[m].out };
  }

  return {
    months,
    perMonth,
    categories: cats,
    totalIn,
    totalOut,
    totalNet: totalIn - totalOut,
    overlay,
  };
}
