import { useMemo, useState } from "react";
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
} from "recharts";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

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
import { listCostCenters } from "@/lib/finance.functions";

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
  manual: "Manual",
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

export function CashFlowProjectionPanel() {
  const buildFn = useServerFn(buildCashFlowProjection);
  const ccFn = useServerFn(listCostCenters);

  const [enterprise, setEnterprise] = useState<string>("__all__");
  const [ccId, setCcId] = useState<string>("__all__");
  const [expanded, setExpanded] = useState<string | null>(null);

  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });
  const filteredCcs = useMemo(
    () =>
      (ccs.data ?? []).filter(
        (c) => enterprise === "__all__" || c.enterprise === enterprise,
      ),
    [ccs.data, enterprise],
  );

  const q = useQuery({
    queryKey: ["cash-flow-projection", enterprise, ccId],
    queryFn: () =>
      buildFn({
        data: {
          enterprise: enterprise === "__all__" ? undefined : enterprise,
          cost_center_id: ccId === "__all__" ? undefined : ccId,
          horizon_months: 6,
        },
      }),
  });

  const chartData = useMemo(() => {
    return (q.data?.months ?? []).map((m) => ({
      month: m.label,
      Entradas:
        m.realized.in + m.committed.in + m.estimated.in + m.manual.in,
      Saídas:
        m.realized.out + m.committed.out + m.estimated.out + m.manual.out,
      Saldo: m.cumulative_balance,
      RealIn: m.realized.in,
      RealOut: m.realized.out,
    }));
  }, [q.data]);

  return (
    <div className="space-y-4">
      {(q.data?.alerts.length ?? 0) > 0 && (
        <Card className="p-4 border-red-500/50 bg-red-500/5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-red-500">Atenção — saldo negativo projetado</div>
              <ul className="text-sm space-y-0.5">
                {q.data!.alerts.map((a, i) => (
                  <li key={i}>• {a}</li>
                ))}
              </ul>
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
        <div className="text-xs text-muted-foreground ml-auto">
          Horizonte: mês atual + 6 meses · Estimativa = média dos últimos 3 meses realizados
          por categoria
        </div>
      </div>

      <Card className="p-4">
        {q.isLoading ? (
          <div className="h-[320px] flex items-center justify-center text-muted-foreground">
            Calculando fluxo projetado…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
              <Bar dataKey="Entradas" fill="hsl(142 71% 45%)" />
              <Bar dataKey="Saídas" fill="hsl(0 84% 60%)" />
              <Line
                type="monotone"
                dataKey="Saldo"
                stroke="hsl(221 83% 53%)"
                strokeWidth={2}
                dot
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Detalhamento por mês</h3>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Mês</TableHead>
                <TableHead className="text-right">Realizado</TableHead>
                <TableHead className="text-right">Compromissos</TableHead>
                <TableHead className="text-right">Estimado</TableHead>
                <TableHead className="text-right">Manual</TableHead>
                <TableHead className="text-right">Líquido</TableHead>
                <TableHead className="text-right">Saldo acum.</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(q.data?.months ?? []).map((m) => {
                const isOpen = expanded === m.month;
                const bd: BreakdownItem[] = q.data?.breakdown[m.month] ?? [];
                const layerSum = (l: { in: number; out: number }) => l.in - l.out;
                return (
                  <>
                    <TableRow
                      key={m.month}
                      className={m.negative ? "bg-red-500/5" : m.is_future ? "" : "bg-muted/30"}
                    >
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setExpanded(isOpen ? null : m.month)}
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
                        {m.label} {m.is_future && <Badge variant="outline" className="ml-1">futuro</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(layerSum(m.realized))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(layerSum(m.committed))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs opacity-70 italic">
                        {fmt(layerSum(m.estimated))}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(layerSum(m.manual))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono ${m.net < 0 ? "text-red-600" : "text-emerald-600"}`}
                      >
                        {fmt(m.net)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-mono font-semibold ${m.negative ? "text-red-600" : ""}`}
                      >
                        {fmt(m.cumulative_balance)}
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
                                    .slice()
                                    .sort((a, b) => b.amount - a.amount)
                                    .map((it, idx) => (
                                      <TableRow
                                        key={idx}
                                        className={it.source === "estimated" ? "opacity-70 italic" : ""}
                                      >
                                        <TableCell className="text-xs">{it.account_name}</TableCell>
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
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
