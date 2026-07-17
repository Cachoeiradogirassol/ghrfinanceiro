import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listTransactions,
  listBankAccounts,
  buildProjection,
  buildDRE,
  buildAccountBalances,
} from "@/lib/finance.functions";
import { listProjections } from "@/lib/projections.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, useEffect, useMemo, useRef, Fragment } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  Send,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
  FileDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  ENTERPRISES,
  ENTERPRISE_GROUPS,
  type EnterpriseFilterValue,
  enterpriseLabel,
  expandEnterpriseFilter,
} from "@/lib/enterprises";
import { useAuth } from "@/lib/auth";
import { useMyRestriction } from "@/lib/use-restriction";
import { exportDREPdf } from "@/lib/pdf-export";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import pauloAsset from "@/assets/bot_minipaulo.png.asset.json";

const PAULO_AVATAR = pauloAsset.url;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Painel financeiro do Grupo GHR com indicadores em tempo real, saldos por conta, DRE dinâmico e alertas operacionais.",
      },
      { property: "og:title", content: "Dashboard — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Painel financeiro do Grupo GHR com indicadores em tempo real, saldos por conta, DRE dinâmico e alertas operacionais.",
      },
      { property: "og:url", content: "https://ghrfinanceiro.lovable.app/" },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/" }],
  }),
  component: () => (
    <AppLayout>
      <Dashboard />
    </AppLayout>
  ),
});

type EnterpriseFilter = EnterpriseFilterValue;

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Dashboard() {
  const { isMaster } = useAuth();
  const { restriction } = useMyRestriction();
  const nav = useNavigate();
  const [enterpriseRaw, setEnterprise] = useState<EnterpriseFilter>("all");
  // Operadores com restrição são forçados ao seu empreendimento; ignora o estado.
  const enterprise: EnterpriseFilter = restriction ? (restriction as EnterpriseFilter) : enterpriseRaw;
  const lockedToEnterprise = !!restriction && !isMaster;

  const txFn = useServerFn(listTransactions);
  const bkFn = useServerFn(listBankAccounts);
  const projFn = useServerFn(buildProjection);
  const dreFn = useServerFn(buildDRE);
  const projectionsFn = useServerFn(listProjections);
  const balancesFn = useServerFn(buildAccountBalances);

  const txs = useQuery({ queryKey: ["txs"], queryFn: () => txFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bkFn() });
  const proj = useQuery({
    queryKey: ["proj", enterprise],
    queryFn: () => projFn({ data: { enterprise } }),
  });
  const dre = useQuery({
    queryKey: ["dre", enterprise],
    queryFn: () => dreFn({ data: { enterprise, months: 6 } }),
  });
  const projections = useQuery({
    queryKey: ["projections"],
    queryFn: () => projectionsFn() as never,
  });
  const [showPredictive, setShowPredictive] = useState(false);

  const today = new Date().toISOString().slice(0, 10);
  const visibleEnterprises = ENTERPRISES.filter((e) => isMaster || !e.masterOnly);
  const enterpriseSet = expandEnterpriseFilter(enterprise);

  // pendências (filtradas por enterprise via cost_center)
  const filterTx = (t: { cost_centers: { enterprise?: string } | null }) =>
    !enterpriseSet || (t.cost_centers?.enterprise != null && enterpriseSet.has(t.cost_centers.enterprise));
  const allTxs = (txs.data ?? []).filter(filterTx);
  const pendingPay = allTxs.filter(
    (t) => t.type === "payable" && t.status === "pending" && t.due_date >= today,
  );
  const pendingRec = allTxs.filter(
    (t) => t.type === "receivable" && t.status === "pending" && t.due_date >= today,
  );
  const overdue = allTxs.filter((t) => t.status === "pending" && t.due_date < today);

  const totalPay = pendingPay.reduce((s, t) => s + Number(t.amount), 0);
  const totalRec = pendingRec.reduce((s, t) => s + Number(t.amount), 0);

  const filteredBanks = (banks.data ?? []).filter(
    (b) => !enterpriseSet || enterpriseSet.has(b.enterprise),
  );

  // Predictive overlay: aggregate unrealized projected months by date inside the D+90 window
  const predictiveSeries = useMemo(() => {
    const base = proj.data?.series ?? [];
    if (base.length === 0) return base;
    type Proj = {
      id: string;
      start_date: string;
      initial_amount: number | string;
      monthly_growth_rate: number | string;
      horizon_months: number;
      cost_centers: { enterprise: string } | null;
      realizations: Array<{ month_index: number }>;
    };
    const list = ((projections.data as Proj[] | undefined) ?? []).filter((p) => {
      if (!enterpriseSet) return true;
      const e = p.cost_centers?.enterprise;
      return !!e && enterpriseSet.has(e);
    });
    const additions = new Map<string, number>();
    for (const p of list) {
      const init = Number(p.initial_amount);
      const rate = Number(p.monthly_growth_rate) / 100;
      const realized = new Set(p.realizations.map((r) => r.month_index));
      for (let i = 0; i < p.horizon_months; i++) {
        if (realized.has(i)) continue;
        const d = new Date(p.start_date + "T00:00:00");
        d.setMonth(d.getMonth() + i);
        const ds = d.toISOString().slice(0, 10);
        const amt = init * Math.pow(1 + rate, i);
        additions.set(ds, (additions.get(ds) ?? 0) + amt);
      }
    }
    // Build cumulative predictive line over base series
    let cum = 0;
    return base.map((row) => {
      cum += additions.get(row.date) ?? 0;
      return { ...row, predictive: Math.round((row.real + cum) * 100) / 100 };
    });
  }, [proj.data, projections.data, enterpriseSet]);


  return (
    <div className="p-6 grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
      <div className="space-y-6">
        {/* Header com filtro */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">Saúde Financeira</h1>
            <p className="text-muted-foreground">
              DRE consolidada · projeção D+90 · IA preditiva
            </p>
          </div>
          <div className="flex items-center gap-2">
            {lockedToEnterprise ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded border border-border bg-muted/40">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium" translate="no">
                  {enterpriseLabel(restriction)}
                </span>
              </div>
            ) : (
              <>
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={enterprise} onValueChange={(v) => setEnterprise(v as EnterpriseFilter)}>
                  <SelectTrigger className="w-[260px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Consolidado (todos)</SelectItem>
                    {ENTERPRISE_GROUPS.map((g) => {
                      const children = visibleEnterprises.filter((e) => e.group === g.key);
                      return (
                        <Fragment key={g.key}>
                          <SelectItem value={g.key} className="font-semibold">
                            {g.label}
                          </SelectItem>
                          {children.map((e) => (
                            <SelectItem key={e.value} value={e.value} className="pl-8 text-sm">
                              — {e.label}
                            </SelectItem>
                          ))}
                        </Fragment>
                      );
                    })}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button onClick={() => nav({ to: "/lancamentos/novo" })}>
              + Lançamento
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-4 w-4" /> Saldo Bancário
            </div>
            <p className="text-2xl font-bold mt-1">{fmt(proj.data?.currentBalance ?? 0)}</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingDown className="h-4 w-4 text-destructive" /> A Pagar
            </div>
            <p className="text-xl font-bold mt-1 text-destructive">{fmt(totalPay)}</p>
            <p className="text-xs text-muted-foreground">{pendingPay.length} lanç.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" /> A Receber
            </div>
            <p className="text-xl font-bold mt-1 text-primary">{fmt(totalRec)}</p>
            <p className="text-xs text-muted-foreground">{pendingRec.length} lanç.</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Vencidos
            </div>
            <p className="text-2xl font-bold mt-1">{overdue.length}</p>
          </Card>
        </div>

        {/* DRE Dinâmica */}
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="font-semibold">DRE Dinâmica — últimos 6 meses (realizado)</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {enterprise === "all" ? "Consolidado" : ENTERPRISES.find((e) => e.value === enterprise)?.label}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={!dre.data}
                onClick={() => {
                  if (!dre.data) return;
                  const scope =
                    enterprise === "all"
                      ? "Consolidado (todos)"
                      : enterpriseLabel(enterprise);
                  exportDREPdf(dre.data, {
                    title: "DRE Dinâmica — últimos 6 meses",
                    scope,
                    fileName: `DRE_${enterprise === "all" ? "Consolidada" : enterprise}_GHR_${new Date().toISOString().slice(0, 10)}.pdf`,
                  });
                }}
              >
                <FileDown className="h-4 w-4 mr-2" /> Exportar PDF Oficial
              </Button>
            </div>
          </div>
          <DRETable data={dre.data} />
        </Card>

        {/* Projeção D+90 */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold">Projeção de Caixa D+90</h2>
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <Checkbox
                checked={showPredictive}
                onCheckedChange={(c) => setShowPredictive(!!c)}
              />
              Visualizar Cenário Preditivo (Com Simulações)
            </label>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={showPredictive ? predictiveSeries : (proj.data?.series ?? [])}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
                  }
                  fontSize={11}
                />
                <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} fontSize={11} />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  labelFormatter={(d) => new Date(d).toLocaleDateString("pt-BR")}
                />
                <Legend />
                <Line type="monotone" dataKey="real" name="Saldo Real" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="withGhosts"
                  name="Com Projeção Fantasma (IA)"
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                />
                {showPredictive && (
                  <Line
                    type="monotone"
                    dataKey="predictive"
                    name="Cenário Preditivo (Simulações)"
                    stroke="hsl(var(--chart-2, 142 71% 45%))"
                    strokeWidth={2}
                    strokeDasharray="2 4"
                    dot={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>

        </Card>

        {/* Contas bancárias filtradas */}
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Contas Bancárias</h2>
          <div className="space-y-1">
            {filteredBanks.map((b) => (
              <div key={b.id} className="flex justify-between py-2 border-b border-border last:border-0">
                <span className="text-sm">
                  {b.name} <span className="text-muted-foreground">— {b.bank}</span>
                </span>
                <span className="text-sm font-mono">{fmt(Number(b.initial_balance))}</span>
              </div>
            ))}
            {filteredBanks.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma conta neste filtro.</p>
            )}
          </div>
        </Card>
      </div>

      <div>
        <Copilot context={proj.data} dre={dre.data} />
      </div>
    </div>
  );
}

function DRETable({
  data,
}: {
  data:
    | {
        series: Array<{
          month: string;
          revenue: number;
          expense: number;
          aporteRecebido: number;
          aporteConcedido: number;
          net: number;
        }>;
        totals: {
          revenue: number;
          expense: number;
          aporteRecebido: number;
          aporteConcedido: number;
          net: number;
        };
      }
    | undefined;
}) {
  if (!data || data.series.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados realizados no período.</p>;
  }
  const months = data.series;
  type IconType = React.ComponentType<{ className?: string }>;
  const rows: Array<{ label: string; key: string; positive: boolean; sub?: boolean; icon?: IconType }> = [
    { label: "Receitas", key: "revenue", positive: true },
    { label: "Custos / Despesas", key: "expense", positive: false },
    { label: "Aportes Recebidos", key: "aporteRecebido", positive: true, sub: true, icon: ArrowDownLeft },
    { label: "Aportes Concedidos", key: "aporteConcedido", positive: false, sub: true, icon: ArrowUpRight },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 font-medium">Linha</th>
            {months.map((m) => (
              <th key={m.month} className="text-right py-2 font-medium px-2">
                {m.month}
              </th>
            ))}
            <th className="text-right py-2 font-medium px-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <tr key={r.key} className={`border-b border-border/40 ${r.sub ? "text-muted-foreground" : ""}`}>
                <td className="py-2 flex items-center gap-2">
                  {Icon && <Icon className="h-3 w-3" />}
                  {r.label}
                </td>
                {months.map((m) => (
                  <td
                    key={m.month}
                    className={`text-right font-mono px-2 ${r.positive ? "text-primary" : "text-destructive"}`}
                  >
                    {fmt(m[r.key as keyof typeof m] as number)}
                  </td>
                ))}
                <td className={`text-right font-mono px-2 font-semibold ${r.positive ? "text-primary" : "text-destructive"}`}>
                  {fmt(data.totals[r.key as keyof typeof data.totals] as number)}
                </td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-border">
            <td className="py-2 font-semibold">Resultado Líquido</td>
            {months.map((m) => (
              <td
                key={m.month}
                className={`text-right font-mono font-semibold px-2 ${m.net >= 0 ? "text-primary" : "text-destructive"}`}
              >
                {fmt(m.net)}
              </td>
            ))}
            <td className={`text-right font-mono font-bold px-2 ${data.totals.net >= 0 ? "text-primary" : "text-destructive"}`}>
              {fmt(data.totals.net)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface ProjContext {
  currentBalance: number;
  series: Array<{ date: string; real: number; withGhosts: number }>;
  ghosts: Array<{ date: string; amount: number; reason: string }>;
}

function Copilot({
  context,
  dre,
}: {
  context: ProjContext | undefined;
  dre: { totals: { revenue: number; expense: number; net: number } } | undefined;
}) {
  const [input, setInput] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) =>
      setToken(s?.access_token ?? null),
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    [token],
  );
  const { messages, sendMessage, status } = useChat({ transport });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    // Quando a IA criar um lançamento, invalida listas
    const created = messages.some((m) =>
      m.parts.some(
        (p) =>
          p.type === "tool-create_transaction" &&
          (p as { output?: { ok?: boolean } }).output?.ok,
      ),
    );
    if (created) {
      qc.invalidateQueries({ queryKey: ["txs"] });
      qc.invalidateQueries({ queryKey: ["proj"] });
      qc.invalidateQueries({ queryKey: ["dre"] });
    }
  }, [messages, qc]);

  const send = () => {
    if (!input.trim() || !context) return;
    sendMessage({ text: input }, { body: { context: { ...context, dre } } });
    setInput("");
  };
  const isLoading = status === "submitted" || status === "streaming";

  return (
    <Card className="p-0 flex flex-col h-[calc(100vh-3rem)] sticky top-6 overflow-hidden border-2 border-amber-500/40 shadow-2xl shadow-amber-500/10">
      <div className="p-4 border-b-2 border-amber-500/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 text-white flex items-center gap-3 relative overflow-hidden">
        <div className="absolute inset-0 opacity-25 bg-[radial-gradient(circle_at_top_left,#f59e0b,transparent_60%)] pointer-events-none" />
        <div className="relative shrink-0">
          <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-amber-400 via-yellow-500 to-amber-600 blur-sm animate-pulse" />
          <img
            src={PAULO_AVATAR}
            alt="Paulo, economista austríaco"
            className="relative h-14 w-14 rounded-full object-cover bg-white ring-2 ring-amber-400 shadow-lg shadow-amber-500/40"
          />
        </div>
        <div className="relative flex-1 min-w-0">
          <h2 className="font-bold text-base leading-tight tracking-tight">
            Paulo <span className="opacity-50 font-normal">|</span>{" "}
            <span className="text-amber-300">Inteligência de Mercado</span>
          </h2>
          <div className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-400/40">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] font-bold tracking-wider text-emerald-300 uppercase">
              Online · Escola Austríaca
            </span>
          </div>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-gradient-to-b from-background to-muted/40">
        {messages.length === 0 && (
          <div className="text-xs space-y-2">
            <p className="text-foreground/80 leading-relaxed">
              <span className="text-amber-600 dark:text-amber-400 font-semibold italic">"Imposto é roubo."</span>{" "}
              Sou o Paulo — guerreiro de mercado a serviço do seu capital. Analiso caixa, simulo cenários e lanço despesas direto na base.
            </p>
            <button
              className="block text-left p-2 rounded bg-muted hover:bg-accent w-full text-muted-foreground"
              onClick={() => setInput("Paulo, paguei 150 de gás no Restaurante pelo PagBank hoje")}
            >
              "Paguei 150 de gás no Restaurante pelo PagBank hoje"
            </button>
            <button
              className="block text-left p-2 rounded bg-muted hover:bg-accent w-full text-muted-foreground"
              onClick={() => setInput("Posso investir R$ 8.000 em reforma nos próximos 3 meses?")}
            >
              "Posso investir R$ 8.000 em reforma nos próximos 3 meses?"
            </button>
          </div>
        )}
        {messages.map((m) => {
          const createdOk =
            m.role === "assistant" &&
            m.parts.some(
              (p) =>
                p.type === "tool-create_transaction" &&
                (p as { output?: { ok?: boolean } }).output?.ok,
            );
          return (
            <div
              key={m.id}
              className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}
            >
              {m.role === "assistant" && (
                <img
                  src={PAULO_AVATAR}
                  alt="Paulo"
                  className="h-8 w-8 rounded-full object-cover shrink-0 bg-white ring-2 ring-amber-500/60"
                />
              )}
              <div
                className={`rounded-lg px-3 py-2 text-sm max-w-[85%] space-y-2 shadow-md ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : `bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100 border ${
                        createdOk
                          ? "border-emerald-400 shadow-emerald-500/30 ring-1 ring-emerald-400/50"
                          : "border-slate-700/80"
                      }`
                }`}
              >
                {m.parts.map((p, i) => {
                  if (p.type === "text")
                    return <span key={i} className="whitespace-pre-wrap block">{p.text}</span>;
                  if (p.type === "tool-create_transaction") {
                    const out = (p as { output?: { ok?: boolean; summary?: { type: string; enterprise: string; category: string; amount: number; status: string; due_date: string; bank: string | null }; error?: string } }).output;
                    if (!out) return <div key={i} className="text-xs italic opacity-70">Registrando lançamento…</div>;
                    if (!out.ok) {
                      return (
                        <div key={i} className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs flex gap-2">
                          <XCircle className="h-4 w-4 text-destructive shrink-0" />
                          <div><b>Não consegui lançar.</b><br />{out.error}</div>
                        </div>
                      );
                    }
                    const s = out.summary!;
                    return (
                      <div key={i} className="rounded-md border border-emerald-400/50 bg-emerald-500/10 p-2 text-xs space-y-1">
                        <div className="flex items-center gap-1 font-semibold text-emerald-300">
                          <CheckCircle2 className="h-4 w-4" /> Lançamento criado
                        </div>
                        <div>{s.type} · <b>{s.enterprise}</b></div>
                        <div>Categoria: {s.category}</div>
                        <div>Valor: R$ {s.amount.toFixed(2).replace(".", ",")} · {s.status === "paid" ? "Pago" : "Pendente"}</div>
                        {s.bank && <div>Conta: {s.bank}</div>}
                        <div className="opacity-70">Vencimento: {new Date(s.due_date).toLocaleDateString("pt-BR")}</div>
                      </div>
                    );
                  }
                  if (p.type === "tool-simulate_investment")
                    return <div key={i} className="text-[11px] opacity-70 italic">🔧 simulação executada</div>;
                  return null;
                })}
              </div>
              {m.role === "user" && (
                <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="h-3 w-3" />
                </div>
              )}
            </div>
          );
        })}

        {isLoading && <div className="text-xs text-muted-foreground italic">Paulo está pensando…</div>}
      </div>
      <div className="p-2 border-t border-border space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte sobre o caixa..."
          rows={2}
          className="text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button size="sm" onClick={send} disabled={isLoading || !input.trim()} className="w-full">
          <Send className="h-4 w-4 mr-2" /> Enviar
        </Button>
      </div>
    </Card>
  );
}
