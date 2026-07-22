import { Fragment, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronRight, Wallet, Sparkles, Layers, Table as TableIcon, Rows3 } from "lucide-react";
import { SpreadsheetView, type SpreadsheetRow } from "@/components/SpreadsheetView";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildCashFlowProjection,
  type BreakdownItem,
  type CashFlowSource,
} from "@/lib/cash-flow-projection.functions";
import { listCostCenters, buildProjection } from "@/lib/finance.functions";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const ENTERPRISES = [
  { value: "__all__", label: "Todas as empresas" },
  { value: "restaurante", label: "Restaurante" },
  { value: "vinhedo", label: "Vinhedo / Cachoeira" },
  { value: "turismo", label: "Turismo" },
  { value: "ghr_aldeia", label: "GHR Aldeia" },
  { value: "ghr_jk", label: "GHR JK" },
];

const sourceLabel: Record<CashFlowSource, string> = {
  realized: "Realizado",
  committed: "Compromisso",
  estimated: "Estimado",
  manual: "Simulação",
};
const sourceBadge: Record<
  CashFlowSource,
  "default" | "secondary" | "outline" | "destructive"
> = {
  realized: "default",
  committed: "secondary",
  estimated: "outline",
  manual: "outline",
};

type Scenario = "real" | "sim" | "mixed";

const scenarioMeta: Record<Scenario, { label: string; desc: string; icon: typeof Wallet }> = {
  real: {
    label: "Somente Real",
    desc: "Caixa real projetado: conciliado + compromissos + estimativa histórica.",
    icon: Wallet,
  },
  sim: {
    label: "Somente Simulação",
    desc: "Isola as hipóteses (projeções manuais/IA) partindo de zero.",
    icon: Sparkles,
  },
  mixed: {
    label: "Real + Simulação",
    desc: "Caixa real projetado com as hipóteses sobrepostas — veja o impacto.",
    icon: Layers,
  },
};

export function CashFlowProjectionPanel({
  mode = "real_based",
  scenarioId = null,
}: {
  mode?: "real_based" | "blank";
  scenarioId?: string | null;
} = {}) {
  const buildFn = useServerFn(buildCashFlowProjection);
  const balanceFn = useServerFn(buildProjection);
  const ccFn = useServerFn(listCostCenters);

  const [enterprise, setEnterprise] = useState<string>("__all__");
  const [ccId, setCcId] = useState<string>("__all__");
  // Modo "blank" força visualização apenas simulada.
  const [scenario, setScenario] = useState<Scenario>(mode === "blank" ? "sim" : "real");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [view, setView] = useState<"normal" | "sheet">("normal");

  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });
  const filteredCcs = useMemo(
    () =>
      (ccs.data ?? []).filter(
        (c) => enterprise === "__all__" || c.enterprise === enterprise,
      ),
    [ccs.data, enterprise],
  );

  const q = useQuery({
    queryKey: ["cash-flow-projection", enterprise, ccId, scenarioId, mode],
    queryFn: () =>
      buildFn({
        data: {
          enterprise: enterprise === "__all__" ? undefined : enterprise,
          cost_center_id: ccId === "__all__" ? undefined : ccId,
          horizon_months: 6,
          scenario_id: scenarioId ?? undefined,
        },
      }),
  });


  // Saldo consolidado atual — ancora do "Caixa Real Projetado".
  // buildProjection só aceita enterprise; quando um centro de custo específico
  // está selecionado, ancoramos a partir de 0 (evita atribuir o saldo do grupo
  // inteiro a um único CC).
  const balanceEnterprise = enterprise === "__all__" ? "all" : enterprise;
  const balanceQ = useQuery({
    queryKey: ["cash-flow-current-balance", balanceEnterprise],
    queryFn: () => balanceFn({ data: { enterprise: balanceEnterprise as never } }),
  });
  const currentBalance =
    mode === "blank" ? 0 : ccId === "__all__" ? balanceQ.data?.currentBalance ?? 0 : 0;


  type ChartPoint = {
    month: string;
    Entradas: number;
    Saídas: number;
    Real?: number;
    Simulação?: number;
    "Real + Simulação"?: number;
  };

  const { chartData, monthRows, scenarioAlerts } = useMemo(() => {
    const months = q.data?.months ?? [];
    const chart: ChartPoint[] = [];
    const rows: Array<{
      month: string;
      label: string;
      is_future: boolean;
      layers: (typeof months)[number];
      net: number;
      cumulative: number;
      negative: boolean;
    }> = [];
    const alerts: string[] = [];

    let cumReal = currentBalance;
    let cumSim = 0;
    let cumMixed = currentBalance;

    for (const m of months) {
      const realNet =
        m.realized.in + m.committed.in + m.estimated.in -
        (m.realized.out + m.committed.out + m.estimated.out);
      const simNet = m.manual.in - m.manual.out;

      cumReal += realNet;
      cumSim += simNet;
      cumMixed += realNet + simNet;

      let net = 0;
      let cumulative = 0;
      let entradas = 0;
      let saidas = 0;
      if (scenario === "real") {
        net = realNet;
        cumulative = cumReal;
        entradas = m.realized.in + m.committed.in + m.estimated.in;
        saidas = m.realized.out + m.committed.out + m.estimated.out;
      } else if (scenario === "sim") {
        net = simNet;
        cumulative = cumSim;
        entradas = m.manual.in;
        saidas = m.manual.out;
      } else {
        net = realNet + simNet;
        cumulative = cumMixed;
        entradas = m.realized.in + m.committed.in + m.estimated.in + m.manual.in;
        saidas = m.realized.out + m.committed.out + m.estimated.out + m.manual.out;
      }

      const negative = cumulative < 0;
      if (negative) {
        alerts.push(
          `Saldo acumulado NEGATIVO em ${m.label}: ${fmt(cumulative)} (${scenarioMeta[scenario].label})`,
        );
      }

      const point: ChartPoint = { month: m.label, Entradas: entradas, Saídas: saidas };
      if (scenario === "real") point["Real"] = cumReal;
      else if (scenario === "sim") point["Simulação"] = cumSim;
      else {
        point["Real"] = cumReal;
        point["Real + Simulação"] = cumMixed;
      }
      chart.push(point);
      rows.push({
        month: m.month,
        label: m.label,
        is_future: m.is_future,
        layers: m,
        net,
        cumulative,
        negative,
      });
    }
    return { chartData: chart, monthRows: rows, scenarioAlerts: alerts };
  }, [q.data, scenario, currentBalance]);

  const scenarioLineColor: Record<string, string> = {
    Real: "hsl(221 83% 53%)",
    Simulação: "hsl(280 70% 55%)",
    "Real + Simulação": "hsl(160 84% 39%)",
  };

  // Planilha corrida: achata o breakdown por mês em linhas transação-a-transação,
  // respeitando o cenário ativo (mesma regra de filtro por source do gráfico).
  const sheetRows = useMemo<SpreadsheetRow[]>(() => {
    const breakdown = q.data?.breakdown ?? {};
    const monthOrder = (q.data?.months ?? []).map((m) => m.month);
    const rows: SpreadsheetRow[] = [];
    const sourceMap: Record<CashFlowSource, string> = {
      realized: "Realizado",
      committed: "Compromisso",
      estimated: "Estimativa",
      manual: "Simulação",
    };
    for (const mkey of monthOrder) {
      const items = breakdown[mkey] ?? [];
      // dia estimado = primeiro dia do mês de competência (sem dia exato disponível)
      const date = `${mkey}-01`;
      for (const it of items) {
        if (scenario === "real" && it.source === "manual") continue;
        if (scenario === "sim" && it.source !== "manual") continue;
        rows.push({
          date,
          description: `${it.account_name} — ${it.cost_center_name}`,
          type: it.flow,
          category: it.account_name,
          amount: it.amount,
          isEstimate: it.source === "estimated" || it.source === "manual",
          sourceLabel: sourceMap[it.source],
        });
      }
    }
    return rows;
  }, [q.data, scenario]);
  const sheetStartBalance = scenario === "sim" ? 0 : currentBalance;

  return (
    <div className="space-y-4">
      {/* Seletor de cenário */}
      <Card className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Cenário de projeção
            </div>
            <p className="text-xs text-muted-foreground max-w-xl">
              {scenarioMeta[scenario].desc} Real = caixa de verdade; Simulação = hipóteses (IA /
              manual). No modo Misto o saldo parte do caixa consolidado atual.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(mode === "blank" ? (["sim"] as Scenario[]) : (Object.keys(scenarioMeta) as Scenario[])).map((s) => {
              const Icon = scenarioMeta[s].icon;
              const active = scenario === s;
              return (
                <Button
                  key={s}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  onClick={() => setScenario(s)}
                  className={active ? "" : "text-muted-foreground"}
                >
                  <Icon className="h-4 w-4 mr-1" />
                  {scenarioMeta[s].label}
                </Button>
              );
            })}
          </div>

        </div>
        {(scenario === "real" || scenario === "mixed") && (
          <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5" />
            Saldo inicial (caixa consolidado{" "}
            {enterprise === "__all__" ? "geral" : ENTERPRISES.find((e) => e.value === enterprise)?.label}
            ):{" "}
            <span className="font-mono font-semibold text-foreground">
              {ccId === "__all__" ? fmt(currentBalance) : "— (filtrado por CC)"}
            </span>
          </div>
        )}
      </Card>

      {scenarioAlerts.length > 0 && (
        <Card className="p-3 border-amber-500/40 bg-amber-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="space-y-0.5 text-xs">
              <div className="font-medium text-amber-700 dark:text-amber-400">
                Meses com saldo acumulado negativo neste cenário
              </div>
              <ul className="text-muted-foreground">
                {scenarioAlerts.map((a, i) => (
                  <li key={i}>• {a}</li>
                ))}
              </ul>
              <div className="pt-1 text-[11px] text-muted-foreground italic">
                Retrato parcial — não considera compromissos ainda não lançados nem receitas
                variáveis fora do horizonte.
              </div>
            </div>
          </div>
        </Card>
      )}


      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Empresa</label>
          <Select
            value={enterprise}
            onValueChange={(v) => {
              setEnterprise(v);
              setCcId("__all__");
            }}
          >
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTERPRISES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Centro de custo</label>
          <Select value={ccId} onValueChange={setCcId}>
            <SelectTrigger className="w-[240px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              {filteredCcs.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="text-xs text-muted-foreground ml-auto max-w-md text-right">
          Horizonte: mês atual + 6 meses · Estimativa = média dos últimos 3 meses realizados por
          categoria · Simulação = projeções manuais/IA
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={view === "sheet" ? "default" : "outline"}
            onClick={() => setView((v) => (v === "sheet" ? "normal" : "sheet"))}
          >
            {view === "sheet" ? (
              <><Rows3 className="h-4 w-4 mr-1" /> Ver normal</>
            ) : (
              <><TableIcon className="h-4 w-4 mr-1" /> Ver como planilha</>
            )}
          </Button>
        </div>
      </div>

      {view === "sheet" ? (
        <Card className="p-4">
          <div className="mb-3 text-xs text-muted-foreground">
            Visão planilha — cenário{" "}
            <span className="font-medium text-foreground">
              {scenarioMeta[scenario].label}
            </span>
            . Itens sem dia exato (estimativa / mensal) aparecem no dia 1º do mês de competência,
            marcados com <span className="italic">~</span>.
          </div>
          <SpreadsheetView
            rows={sheetRows}
            startingBalance={sheetStartBalance}
            fileName={`projecao_${scenario}`}
            maxHeight="65vh"
          />
        </Card>
      ) : (
      <>
      <Card className="p-4">
        {q.isLoading ? (
          <div className="h-[320px] flex items-center justify-center text-muted-foreground">
            Calculando fluxo projetado…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <ReferenceLine y={0} stroke="hsl(0 84% 60%)" strokeDasharray="4 4" />
              <Bar dataKey="Entradas" fill="hsl(142 71% 45%)" />
              <Bar dataKey="Saídas" fill="hsl(0 84% 60%)" />
              {scenario === "real" && (
                <Line
                  type="monotone"
                  dataKey="Real"
                  stroke={scenarioLineColor.Real}
                  strokeWidth={2.5}
                  dot
                />
              )}
              {scenario === "sim" && (
                <Line
                  type="monotone"
                  dataKey="Simulação"
                  stroke={scenarioLineColor["Simulação"]}
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  dot
                />
              )}
              {scenario === "mixed" && (
                <>
                  <Line
                    type="monotone"
                    dataKey="Real"
                    stroke={scenarioLineColor.Real}
                    strokeWidth={2}
                    dot
                  />
                  <Line
                    type="monotone"
                    dataKey="Real + Simulação"
                    stroke={scenarioLineColor["Real + Simulação"]}
                    strokeWidth={2.5}
                    strokeDasharray="6 3"
                    dot
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Detalhamento por mês</h3>
          <Badge variant="outline">{scenarioMeta[scenario].label}</Badge>
        </div>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Realizado</TableHead>
                <TableHead className="text-right">Compromissos</TableHead>
                <TableHead className="text-right">Estimado</TableHead>
                <TableHead className="text-right">Simulação</TableHead>
                <TableHead className="text-right">Líquido ({scenarioMeta[scenario].label})</TableHead>
                <TableHead className="text-right">Saldo acum.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthRows.map((row) => {
                const m = row.layers;
                const isOpen = expanded === row.month;
                const bd: BreakdownItem[] = q.data?.breakdown[row.month] ?? [];
                const layerSum = (l: { in: number; out: number }) => l.in - l.out;
                return (
                  <Fragment key={row.month}>
                    <TableRow
                      className={
                        row.negative
                          ? "bg-red-500/5"
                          : row.is_future
                            ? ""
                            : "bg-muted/30"
                      }
                    >
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setExpanded(isOpen ? null : row.month)}
                          aria-label="Expandir"
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.label}{" "}
                        {row.is_future && (
                          <Badge variant="outline" className="ml-1">
                            futuro
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${scenario === "sim" ? "opacity-40" : ""}`}
                      >
                        {fmt(layerSum(m.realized))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${scenario === "sim" ? "opacity-40" : ""}`}
                      >
                        {fmt(layerSum(m.committed))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs italic ${scenario === "sim" ? "opacity-40" : "opacity-70"}`}
                      >
                        {fmt(layerSum(m.estimated))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono text-xs ${scenario === "real" ? "opacity-40" : ""}`}
                      >
                        {fmt(layerSum(m.manual))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${row.net < 0 ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {fmt(row.net)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-semibold ${row.negative ? "text-red-600" : ""}`}
                      >
                        {fmt(row.cumulative)}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/20 p-0">
                          <div className="p-3">
                            {bd.length === 0 ? (
                              <div className="text-xs text-muted-foreground">
                                Sem movimentações neste mês.
                              </div>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Categoria</TableHead>
                                    <TableHead>Centro de custo</TableHead>
                                    <TableHead>Origem</TableHead>
                                    <TableHead>Fluxo</TableHead>
                                    <TableHead className="text-right">Valor</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {bd
                                    .filter((it) => {
                                      if (scenario === "real") return it.source !== "manual";
                                      if (scenario === "sim") return it.source === "manual";
                                      return true;
                                    })
                                    .slice()
                                    .sort((a, b) => b.amount - a.amount)
                                    .map((it, idx) => (
                                      <TableRow
                                        key={idx}
                                        className={
                                          it.source === "estimated"
                                            ? "opacity-70 italic"
                                            : it.source === "manual"
                                              ? "bg-purple-500/5"
                                              : ""
                                        }
                                      >
                                        <TableCell className="text-xs">
                                          {it.account_name}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {it.cost_center_name}
                                        </TableCell>
                                        <TableCell>
                                          <Badge variant={sourceBadge[it.source]}>
                                            {sourceLabel[it.source]}
                                          </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs">
                                          {it.flow === "in" ? "Entrada" : "Saída"}
                                        </TableCell>
                                        <TableCell
                                          className={`text-right font-mono text-xs ${it.flow === "in" ? "text-emerald-600" : "text-red-600"}`}
                                        >
                                          {fmt(it.amount)}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                </TableBody>
                              </Table>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
