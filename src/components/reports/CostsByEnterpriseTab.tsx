import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
  LineChart,
  Line,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAccounts } from "@/lib/finance.functions";
import { buildCostAnalytics } from "@/lib/reports.functions";
import { ENTERPRISES, enterpriseLabel } from "@/lib/enterprises";
import { TrendingUp, Wallet, PieChart as PieIcon } from "lucide-react";

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--destructive))",
  "#10b981",
  "#f59e0b",
  "#6366f1",
  "#ec4899",
  "#14b8a6",
];

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function monthsAgoIso(m: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return d.toISOString().slice(0, 10);
}

export function CostsByEnterpriseTab() {
  const [from, setFrom] = useState(monthsAgoIso(12));
  const [to, setTo] = useState(todayIso());
  const [enterprise, setEnterprise] = useState<string>("all");
  const [accountId, setAccountId] = useState<string>("__all__");

  const accountsFn = useServerFn(listAccounts);
  const accountsQ = useQuery({
    queryKey: ["accounts-all"],
    queryFn: () => accountsFn(),
  });

  const analyticsFn = useServerFn(buildCostAnalytics);
  const analytics = useQuery({
    queryKey: ["cost-analytics", from, to, enterprise, accountId],
    queryFn: () =>
      analyticsFn({
        data: {
          from,
          to,
          enterprise: enterprise as never,
          accountId: accountId === "__all__" ? undefined : accountId,
        },
      }),
  });

  const accounts = accountsQ.data ?? [];
  const accountName = useMemo(() => {
    if (accountId === "__all__") return "Todas as categorias";
    return (
      accounts.find((a) => a.id === accountId)?.name ?? "Categoria selecionada"
    );
  }, [accounts, accountId]);

  const distribution = (analytics.data?.distribution ?? []).map((d) => ({
    name: enterpriseLabel(d.enterprise),
    enterprise: d.enterprise,
    value: d.amount,
  }));
  const timeline = analytics.data?.timeline ?? [];
  const kpis = analytics.data?.kpis;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="p-4">
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-full border border-input bg-background rounded-md px-2 py-1.5 text-sm"
              aria-label="Data inicial"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full border border-input bg-background rounded-md px-2 py-1.5 text-sm"
              aria-label="Data final"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Empreendimento
            </label>
            <Select value={enterprise} onValueChange={setEnterprise}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Consolidado</SelectItem>
                {ENTERPRISES.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">
              Categoria / Subcategoria
            </label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all__">Todas as categorias</SelectItem>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Wallet className="h-3 w-3" /> Total Gasto no Período
          </div>
          <div className="text-2xl font-bold mt-1">
            {fmt(kpis?.total ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{accountName}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp className="h-3 w-3" /> Média Mensal
          </div>
          <div className="text-2xl font-bold mt-1">
            {fmt(kpis?.monthlyAvg ?? 0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {timeline.length} mês(es) com movimento
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <PieIcon className="h-3 w-3" /> Impacto sobre Custos do Empreendimento
          </div>
          <div className="mt-1">
            {enterprise === "all" ? (
              <Badge variant="secondary">Selecione um empreendimento</Badge>
            ) : (
              <Badge
                className={
                  (kpis?.impactPct ?? 0) > 20
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }
              >
                {accountName} representa{" "}
                {(kpis?.impactPct ?? 0).toFixed(1)}% dos custos de{" "}
                {enterpriseLabel(enterprise)}
              </Badge>
            )}
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3 text-sm">
            Distribuição por Empreendimento
          </h3>
          {distribution.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Sem dados realizados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={distribution}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(e) => `${(((e.value ?? 0) / (kpis?.total || 1)) * 100).toFixed(0)}%`}
                >
                  {distribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3 text-sm">
            Barras Empilhadas — Valor por Empreendimento
          </h3>
          {distribution.length === 0 ? (
            <div className="text-sm text-muted-foreground py-12 text-center">
              Sem dados realizados no período.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis
                  fontSize={11}
                  tickFormatter={(v) =>
                    v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                  }
                />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="value" name="Valor">
                  {distribution.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold mb-3 text-sm">
          Curva Histórica Mensal — {accountName}
        </h3>
        {timeline.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">
            Sem movimentações para exibir.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timeline}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis
                fontSize={11}
                tickFormatter={(v) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
              />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Line
                type="monotone"
                dataKey="amount"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
