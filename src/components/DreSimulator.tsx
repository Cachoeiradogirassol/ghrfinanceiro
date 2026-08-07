import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Trash2,
  Pencil,
  SlidersHorizontal,
  Repeat,
  Split,
  Waves,
  KeyRound,
  FolderPlus,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { ENTERPRISE_GROUPS, ENTERPRISES, enterpriseLabel } from "@/lib/enterprises";
import {
  listSimCategories,
  createSimCategory,
  renameSimCategory,
  deleteSimCategory,
  createSimItem,
  updateSimItem,
  deleteSimItem,
  getSimSettings,
  saveSimSettings,
  getSeasonalBases,
  type SimCategory,
  type SimItem,
  type SimMode,
} from "@/lib/simulation.functions";
import {
  computeSimulation,
  adjustedItemSeries,

  monthLabel,
  horizonMonths,
  addMonthsToKey,
  currentMonthKey,
  type SimulationResult,
} from "@/lib/simulation-compute";

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtShort = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MODE_META: Record<SimMode, { label: string; icon: typeof Repeat; desc: string }> = {
  recurring: { label: "Recorrente", icon: Repeat, desc: "Mesmo valor em todo mês do horizonte." },
  spread: { label: "Diluído", icon: Split, desc: "Valor total dividido em N meses." },
  seasonal: {
    label: "Sazonal",
    icon: Waves,
    desc: "Usa o histórico realizado do empreendimento × fator.",
  },
  manual: { label: "Manual", icon: KeyRound, desc: "Valor livre, mês a mês." },
};

const HORIZONS = [3, 6, 9, 12];
const PRESETS = [
  { label: "Base", value: 0 },
  { label: "+15%", value: 15 },
  { label: "+20%", value: 20 },
  { label: "+45%", value: 45 },
];

type ItemDraft = {
  id?: string;
  category_id: string;
  name: string;
  enterprise: string;
  flow: "in" | "out";
  mode: SimMode;
  amount: number;
  total_amount: number;
  months_count: number;
  start_month: string;
  factor: number;
  adjust_pct: number;
  monthly_values: Record<string, number>;
};

function emptyDraft(category_id: string): ItemDraft {
  return {
    category_id,
    name: "",
    enterprise: "turismo",
    flow: "in",
    mode: "recurring",
    amount: 0,
    total_amount: 0,
    months_count: 6,
    start_month: `${currentMonthKey()}-01`,
    factor: 1,
    adjust_pct: 0,
    monthly_values: {},
  };
}

export function DreSimulator({
  scenarioId = null,
  onResult,
}: {
  scenarioId?: string | null;
  onResult?: (r: SimulationResult) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSimCategories);
  const settingsFn = useServerFn(getSimSettings);
  const basesFn = useServerFn(getSeasonalBases);
  const saveSettingsFn = useServerFn(saveSimSettings);
  const createCatFn = useServerFn(createSimCategory);
  const renameCatFn = useServerFn(renameSimCategory);
  const deleteCatFn = useServerFn(deleteSimCategory);
  const createItemFn = useServerFn(createSimItem);
  const updateItemFn = useServerFn(updateSimItem);
  const deleteItemFn = useServerFn(deleteSimItem);

  const catsQ = useQuery({
    queryKey: ["sim-categories", scenarioId],
    queryFn: () => listFn({ data: { scenario_id: scenarioId } }),
  });
  const settingsQ = useQuery({
    queryKey: ["sim-settings", scenarioId],
    queryFn: () => settingsFn({ data: { scenario_id: scenarioId } }),
  });
  const basesQ = useQuery({ queryKey: ["sim-seasonal-bases"], queryFn: () => basesFn() });

  const [horizon, setHorizon] = useState(6);
  const [revenuePct, setRevenuePct] = useState(0);
  const [expensePct, setExpensePct] = useState(0);
  const [enterpriseFilter, setEnterpriseFilter] = useState<string>("__all__");
  const [draft, setDraft] = useState<ItemDraft | null>(null);

  // Hidrata os ajustes salvos.
  useEffect(() => {
    if (!settingsQ.data) return;
    setHorizon(settingsQ.data.horizon_months);
    setRevenuePct(settingsQ.data.revenue_adjust_pct);
    setExpensePct(settingsQ.data.expense_adjust_pct);
  }, [settingsQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sim-categories", scenarioId] });
    qc.invalidateQueries({ queryKey: ["cash-flow-projection"] });
  };

  const persistSettings = (next: {
    horizon_months?: number;
    revenue_adjust_pct?: number;
    expense_adjust_pct?: number;
  }) => {
    saveSettingsFn({
      data: {
        scenario_id: scenarioId,
        horizon_months: next.horizon_months ?? horizon,
        revenue_adjust_pct: next.revenue_adjust_pct ?? revenuePct,
        expense_adjust_pct: next.expense_adjust_pct ?? expensePct,
      },
    })
      .then(() => qc.invalidateQueries({ queryKey: ["sim-settings", scenarioId] }))
      .catch((e: Error) => toast.error("Falha ao salvar ajustes: " + e.message));
  };

  const catMut = useMutation({
    mutationFn: async (name: string) =>
      createCatFn({
        data: { name, scenario_id: scenarioId, sort_order: (catsQ.data?.length ?? 0) + 1 },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Categoria criada.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const renameMut = useMutation({
    mutationFn: async (v: { id: string; name: string }) => renameCatFn({ data: v }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const delCatMut = useMutation({
    mutationFn: async (id: string) => deleteCatFn({ data: { id } }),
    onSuccess: () => {
      invalidate();
      toast.success("Categoria removida.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const delItemMut = useMutation({
    mutationFn: async (id: string) => deleteItemFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const saveItemMut = useMutation({
    mutationFn: async (d: ItemDraft) => {
      const payload = {
        name: d.name.trim(),
        enterprise: d.enterprise,
        flow: d.flow,
        mode: d.mode,
        amount: d.amount,
        total_amount: d.total_amount,
        months_count: d.months_count,
        start_month: d.start_month || null,
        factor: d.factor,
        adjust_pct: d.adjust_pct,
        monthly_values: d.monthly_values,
      };
      if (d.id) return updateItemFn({ data: { id: d.id, ...payload } });
      return createItemFn({ data: { category_id: d.category_id, ...payload } });
    },
    onSuccess: () => {
      invalidate();
      setDraft(null);
      toast.success("Lançamento de simulação salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const categories: SimCategory[] = catsQ.data ?? [];
  const filterSet = useMemo(
    () => (enterpriseFilter === "__all__" ? null : new Set<string>([enterpriseFilter])),
    [enterpriseFilter],
  );

  const result = useMemo(
    () =>
      computeSimulation(
        categories,
        horizon,
        basesQ.data ?? {},
        { revenuePct, expensePct },
        filterSet,
      ),
    [categories, horizon, basesQ.data, revenuePct, expensePct, filterSet],
  );

  useEffect(() => {
    onResult?.(result);
  }, [result, onResult]);

  const months = result.months;
  const revenueCats = result.categories.filter((c) =>
    months.some((m) => Math.abs(c.flowIn[m]) > 0.004),
  );
  const expenseCats = result.categories.filter((c) =>
    months.some((m) => Math.abs(c.flowOut[m]) > 0.004),
  );

  const itemSummary = (it: SimItem) => {
    if (it.mode === "recurring") return `${fmt(it.amount)}/mês`;
    if (it.mode === "spread") {
      const start = (it.start_month ?? `${currentMonthKey()}-01`).slice(0, 7);
      const end = addMonthsToKey(start, Math.max(0, it.months_count - 1));
      return `${fmt(it.total_amount)} ÷ ${it.months_count} = ${fmt(
        it.total_amount / Math.max(1, it.months_count),
      )}/mês · ${monthLabel(start)}–${monthLabel(end)}`;
    }
    if (it.mode === "seasonal")
      return `histórico ${enterpriseLabel(it.enterprise)} × ${it.factor.toLocaleString("pt-BR")}`;
    const filled = Object.values(it.monthly_values ?? {}).filter((v) => Number(v) !== 0).length;
    return `manual · ${filled} mês(es) preenchido(s)`;
  };

  return (
    <div className="space-y-4">
      {/* Cards de resultado */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-semibold text-sm">Resultado simulado por mês</h3>
            <p className="text-xs text-muted-foreground">
              Somente a camada de simulação (hipóteses). O caixa real continua no gráfico abaixo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Horizonte</span>
            {HORIZONS.map((h) => (
              <Button
                key={h}
                size="sm"
                variant={horizon === h ? "default" : "outline"}
                onClick={() => {
                  setHorizon(h);
                  persistSettings({ horizon_months: h });
                }}
              >
                {h}m
              </Button>
            ))}
            <Select value={enterpriseFilter} onValueChange={setEnterpriseFilter}>
              <SelectTrigger className="w-[230px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os empreendimentos</SelectItem>
                {ENTERPRISE_GROUPS.map((g) => (
                  <SelectGroup key={g.key}>
                    <SelectLabel>{g.label}</SelectLabel>
                    {ENTERPRISES.filter((e) => e.group === g.key).map((e) => (
                      <SelectItem key={e.value} value={e.value}>
                        {e.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
          {months.map((m) => {
            const v = result.perMonth[m];
            const pos = v.net >= 0;
            return (
              <div
                key={m}
                className={`rounded-md border p-2 ${
                  pos ? "border-emerald-500/40 bg-emerald-500/5" : "border-red-500/40 bg-red-500/5"
                }`}
              >
                <div className="text-[11px] uppercase text-muted-foreground">{monthLabel(m)}</div>
                <div
                  className={`font-mono text-sm font-semibold ${pos ? "text-emerald-600" : "text-red-600"}`}
                >
                  {fmtShort(v.net)}
                </div>
                <div className="text-[10px] text-muted-foreground font-mono">
                  +{fmtShort(v.in)} / -{fmtShort(v.out)}
                </div>
              </div>
            );
          })}
          <div
            className={`rounded-md border-2 p-2 ${
              result.totalNet >= 0
                ? "border-emerald-500 bg-emerald-500/10"
                : "border-red-500 bg-red-500/10"
            }`}
          >
            <div className="text-[11px] uppercase text-muted-foreground">Total do período</div>
            <div
              className={`font-mono text-sm font-bold ${
                result.totalNet >= 0 ? "text-emerald-600" : "text-red-600"
              }`}
            >
              {fmtShort(result.totalNet)}
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              +{fmtShort(result.totalIn)} / -{fmtShort(result.totalOut)}
            </div>
          </div>
        </div>
      </Card>

      {/* Ajustes globais */}
      <Card className="p-4 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          Ajustes globais da simulação
        </div>
        {(
          [
            { key: "rev", label: "Faturamento", value: revenuePct, set: setRevenuePct },
            { key: "exp", label: "Despesas", value: expensePct, set: setExpensePct },
          ] as const
        ).map((row) => (
          <div key={row.key} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">
                {row.label}:{" "}
                <span className="font-mono font-semibold text-foreground">
                  {row.value > 0 ? "+" : ""}
                  {row.value}%
                </span>
              </Label>
              <div className="flex gap-1">
                {PRESETS.map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    variant={row.value === p.value ? "default" : "outline"}
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      row.set(p.value);
                      persistSettings(
                        row.key === "rev"
                          ? { revenue_adjust_pct: p.value }
                          : { expense_adjust_pct: p.value },
                      );
                    }}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <Slider
              value={[row.value]}
              min={-50}
              max={100}
              step={1}
              onValueChange={(v) => row.set(v[0])}
              onValueCommit={(v) =>
                persistSettings(
                  row.key === "rev"
                    ? { revenue_adjust_pct: v[0] }
                    : { expense_adjust_pct: v[0] },
                )
              }
            />
          </div>
        ))}
      </Card>

      {/* Categorias e itens */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-sm">Lançamentos de simulação por categoria</h3>
            <p className="text-xs text-muted-foreground">
              Crie categorias (ex.: Vinhos, Holding &amp; Jurídico, Operacional) e adicione itens.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const n = window.prompt("Nome da nova categoria:");
              if (n && n.trim()) catMut.mutate(n.trim());
            }}
          >
            <FolderPlus className="h-4 w-4 mr-1" /> Nova categoria
          </Button>
        </div>

        {catsQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando simulação…</div>
        ) : categories.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Nenhuma categoria ainda. Comece criando uma categoria para agrupar suas hipóteses.
          </div>
        ) : (
          categories.map((c) => (
            <div key={c.id} className="rounded-md border">
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                <span className="font-medium text-sm">{c.name}</span>
                <Badge variant="outline">{c.items.length} item(ns)</Badge>
                <div className="ml-auto flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const n = window.prompt("Renomear categoria:", c.name);
                      if (n && n.trim()) renameMut.mutate({ id: c.id, name: n.trim() });
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm(`Excluir a categoria "${c.name}" e seus itens?`))
                        delCatMut.mutate(c.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft(c.id))}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Item
                  </Button>
                </div>
              </div>
              {c.items.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Sem itens nesta categoria.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Empreendimento</TableHead>
                      <TableHead>Fluxo</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Parâmetros</TableHead>
                      <TableHead className="text-right">Ajuste</TableHead>
                      <TableHead className="text-right">Total período</TableHead>
                      <TableHead className="w-20" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.items.map((it) => {
                      const ModeIcon = MODE_META[it.mode].icon;
                      const series = adjustedItemSeries(it, months, basesQ.data ?? {}, {
                        revenuePct,
                        expensePct,
                      });
                      const total = months.reduce((s, m) => s + (series[m] ?? 0), 0);

                      return (
                        <TableRow key={it.id}>
                          <TableCell className="text-xs font-medium">{it.name}</TableCell>
                          <TableCell className="text-xs">
                            {enterpriseLabel(it.enterprise)}
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={it.flow === "in" ? "default" : "destructive"}>
                              {it.flow === "in" ? "Entrada" : "Saída"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="inline-flex items-center gap-1">
                              <ModeIcon className="h-3.5 w-3.5 text-muted-foreground" />
                              {MODE_META[it.mode].label}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground font-mono">
                            {itemSummary(it)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono">
                            {it.adjust_pct > 0 ? "+" : ""}
                            {it.adjust_pct}%
                          </TableCell>
                          <TableCell className="text-right text-xs font-mono">
                            {total === 0 ? "—" : fmt(total)}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() =>
                                  setDraft({
                                    id: it.id,
                                    category_id: it.category_id,
                                    name: it.name,
                                    enterprise: it.enterprise,
                                    flow: it.flow,
                                    mode: it.mode,
                                    amount: it.amount,
                                    total_amount: it.total_amount,
                                    months_count: it.months_count,
                                    start_month: it.start_month ?? `${currentMonthKey()}-01`,
                                    factor: it.factor,
                                    adjust_pct: it.adjust_pct,
                                    monthly_values: it.monthly_values ?? {},
                                  })
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => delItemMut.mutate(it.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          ))
        )}
      </Card>

      {/* DRE consolidado */}
      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">DRE simulado consolidado</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[200px]">Linha</TableHead>
                {months.map((m) => (
                  <TableHead key={m} className="text-right">
                    {monthLabel(m)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="bg-emerald-500/5">
                <TableCell className="font-semibold text-xs uppercase">Faturamento</TableCell>
                {months.map((m) => (
                  <TableCell key={m} className="text-right font-mono text-xs font-semibold">
                    {fmtShort(result.perMonth[m].in)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-xs font-semibold">
                  {fmtShort(result.totalIn)}
                </TableCell>
              </TableRow>
              {revenueCats.map((c) => (
                <TableRow key={"r" + c.id}>
                  <TableCell className="pl-6 text-xs text-muted-foreground">{c.name}</TableCell>
                  {months.map((m) => (
                    <TableCell key={m} className="text-right font-mono text-xs">
                      {fmtShort(c.flowIn[m])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-xs">
                    {fmtShort(months.reduce((s, m) => s + c.flowIn[m], 0))}
                  </TableCell>
                </TableRow>
              ))}

              <TableRow className="bg-red-500/5">
                <TableCell className="font-semibold text-xs uppercase">Despesas</TableCell>
                {months.map((m) => (
                  <TableCell key={m} className="text-right font-mono text-xs font-semibold">
                    -{fmtShort(result.perMonth[m].out)}
                  </TableCell>
                ))}
                <TableCell className="text-right font-mono text-xs font-semibold">
                  -{fmtShort(result.totalOut)}
                </TableCell>
              </TableRow>
              {expenseCats.map((c) => (
                <TableRow key={"e" + c.id}>
                  <TableCell className="pl-6 text-xs text-muted-foreground">{c.name}</TableCell>
                  {months.map((m) => (
                    <TableCell key={m} className="text-right font-mono text-xs">
                      -{fmtShort(c.flowOut[m])}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-mono text-xs">
                    -{fmtShort(months.reduce((s, m) => s + c.flowOut[m], 0))}
                  </TableCell>
                </TableRow>
              ))}

              <TableRow className="border-t-2">
                <TableCell className="font-bold text-xs uppercase">Resultado</TableCell>
                {months.map((m) => {
                  const v = result.perMonth[m].net;
                  return (
                    <TableCell
                      key={m}
                      className={`text-right font-mono text-xs font-bold ${v >= 0 ? "text-emerald-600" : "text-red-600"}`}
                    >
                      {fmtShort(v)}
                    </TableCell>
                  );
                })}
                <TableCell
                  className={`text-right font-mono text-xs font-bold ${result.totalNet >= 0 ? "text-emerald-600" : "text-red-600"}`}
                >
                  {fmtShort(result.totalNet)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell className="text-xs uppercase text-muted-foreground">Margem %</TableCell>
                {months.map((m) => {
                  const v = result.perMonth[m];
                  const margin = v.in > 0 ? (v.net / v.in) * 100 : 0;
                  return (
                    <TableCell key={m} className="text-right font-mono text-xs">
                      {v.in > 0 ? `${margin.toFixed(1)}%` : "—"}
                    </TableCell>
                  );
                })}
                <TableCell className="text-right font-mono text-xs">
                  {result.totalIn > 0
                    ? `${((result.totalNet / result.totalIn) * 100).toFixed(1)}%`
                    : "—"}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Dialog de item */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Editar item" : "Novo item de simulação"}</DialogTitle>
            <DialogDescription>
              {draft ? MODE_META[draft.mode].desc : ""}
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Ex.: Venda de vinhos safra 2026"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Empreendimento</Label>
                  <Select
                    value={draft.enterprise}
                    onValueChange={(v) => setDraft({ ...draft, enterprise: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENTERPRISE_GROUPS.map((g) => (
                        <SelectGroup key={g.key}>
                          <SelectLabel>{g.label}</SelectLabel>
                          {ENTERPRISES.filter((e) => e.group === g.key).map((e) => (
                            <SelectItem key={e.value} value={e.value}>
                              {e.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Fluxo</Label>
                  <Select
                    value={draft.flow}
                    onValueChange={(v) => setDraft({ ...draft, flow: v as "in" | "out" })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in">Entrada (soma no caixa)</SelectItem>
                      <SelectItem value="out">Saída (subtrai do caixa)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Modo de lançamento</Label>
                  <Select
                    value={draft.mode}
                    onValueChange={(v) => setDraft({ ...draft, mode: v as SimMode })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(MODE_META) as SimMode[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {MODE_META[m].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {draft.mode === "recurring" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Valor mensal (R$)</Label>
                    <Input
                      type="number"
                      value={draft.amount}
                      onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mês inicial</Label>
                    <Input
                      type="month"
                      value={draft.start_month.slice(0, 7)}
                      onChange={(e) =>
                        setDraft({ ...draft, start_month: `${e.target.value}-01` })
                      }
                    />
                  </div>
                </div>
              )}

              {draft.mode === "spread" && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Valor total (R$)</Label>
                      <Input
                        type="number"
                        value={draft.total_amount}
                        onChange={(e) =>
                          setDraft({ ...draft, total_amount: Number(e.target.value) })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Diluir em (meses)</Label>
                      <Select
                        value={String(draft.months_count)}
                        onValueChange={(v) => setDraft({ ...draft, months_count: Number(v) })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[3, 6, 9, 12, 18, 24].map((n) => (
                            <SelectItem key={n} value={String(n)}>
                              {n} meses
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Mês inicial</Label>
                      <Input
                        type="month"
                        value={draft.start_month.slice(0, 7)}
                        onChange={(e) =>
                          setDraft({ ...draft, start_month: `${e.target.value}-01` })
                        }
                      />
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-xs font-mono">
                    = {fmt(draft.total_amount / Math.max(1, draft.months_count))}/mês ·{" "}
                    {monthLabel(draft.start_month.slice(0, 7))}–
                    {monthLabel(
                      addMonthsToKey(
                        draft.start_month.slice(0, 7),
                        Math.max(0, draft.months_count - 1),
                      ),
                    )}
                  </div>
                </div>
              )}

              {draft.mode === "seasonal" && (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Fator multiplicador</Label>
                      <Input
                        type="number"
                        step="0.05"
                        value={draft.factor}
                        onChange={(e) => setDraft({ ...draft, factor: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Mês inicial</Label>
                      <Input
                        type="month"
                        value={draft.start_month.slice(0, 7)}
                        onChange={(e) =>
                          setDraft({ ...draft, start_month: `${e.target.value}-01` })
                        }
                      />
                    </div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-xs">
                    Base sazonal 2025 ({enterpriseLabel(draft.enterprise)},{" "}
                    {draft.flow === "in" ? "entradas" : "saídas"}) — cada mês da projeção repete o
                    mês correspondente de 2025. Média:{" "}
                    <span className="font-mono font-semibold">
                      {fmt(
                        seasonalAverage(basesQ.data ?? {}, draft.enterprise, draft.flow) *
                          (draft.factor || 1),
                      )}
                    </span>
                    /mês
                  </div>

                </div>
              )}

              {draft.mode === "manual" && (
                <div className="space-y-2">
                  <Label className="text-xs">Valor por mês (R$)</Label>
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                    {horizonMonths(horizon).map((m) => (
                      <div key={m} className="space-y-1">
                        <div className="text-[11px] text-muted-foreground">{monthLabel(m)}</div>
                        <Input
                          type="number"
                          value={draft.monthly_values[m] ?? 0}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              monthly_values: {
                                ...draft.monthly_values,
                                [m]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Separator />
              <div className="space-y-1 max-w-[240px]">
                <Label className="text-xs">Ajuste deste item (%)</Label>
                <Input
                  type="number"
                  value={draft.adjust_pct}
                  onChange={(e) => setDraft({ ...draft, adjust_pct: Number(e.target.value) })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancelar
            </Button>
            <Button
              disabled={!draft?.name.trim() || saveItemMut.isPending}
              onClick={() => draft && saveItemMut.mutate(draft)}
            >
              Salvar item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
