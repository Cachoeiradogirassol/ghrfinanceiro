import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listTransactions,
  listBankAccounts,
  buildProjection,
  buildDRE,
} from "@/lib/finance.functions";
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
import { useState, useRef, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  AlertTriangle,
  Send,
  Bot,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  Filter,
} from "lucide-react";
import { ENTERPRISES, type EnterpriseValue } from "@/lib/enterprises";
import { useAuth } from "@/lib/auth";

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
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/" }],
  }),
  component: () => (
    <AppLayout>
      <Dashboard />
    </AppLayout>
  ),
});

type EnterpriseFilter = "all" | EnterpriseValue;

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Dashboard() {
  const { isMaster } = useAuth();
  const nav = useNavigate();
  const [enterprise, setEnterprise] = useState<EnterpriseFilter>("all");

  const txFn = useServerFn(listTransactions);
  const bkFn = useServerFn(listBankAccounts);
  const projFn = useServerFn(buildProjection);
  const dreFn = useServerFn(buildDRE);

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

  const today = new Date().toISOString().slice(0, 10);
  const visibleEnterprises = ENTERPRISES.filter((e) => isMaster || !e.masterOnly);

  // pendências (filtradas por enterprise via cost_center)
  const filterTx = (t: { cost_centers: { enterprise?: string } | null }) =>
    enterprise === "all" || t.cost_centers?.enterprise === enterprise;
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
    (b) => enterprise === "all" || b.enterprise === enterprise,
  );

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
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={enterprise} onValueChange={(v) => setEnterprise(v as EnterpriseFilter)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Consolidado (todos)</SelectItem>
                {visibleEnterprises.map((e) => (
                  <SelectItem key={e.value} value={e.value}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">DRE Dinâmica — últimos 6 meses (realizado)</h2>
            <span className="text-xs text-muted-foreground">
              {enterprise === "all" ? "Consolidado" : ENTERPRISES.find((e) => e.value === enterprise)?.label}
            </span>
          </div>
          <DRETable data={dre.data} />
        </Card>

        {/* Projeção D+90 */}
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Projeção de Caixa D+90</h2>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={proj.data?.series ?? []}>
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const transport = useRef(new DefaultChatTransport({ api: "/api/chat" }));
  const { messages, sendMessage, status } = useChat({ transport: transport.current });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = () => {
    if (!input.trim() || !context) return;
    sendMessage({ text: input }, { body: { context: { ...context, dre } } });
    setInput("");
  };
  const isLoading = status === "submitted" || status === "streaming";

  return (
    <Card className="p-0 flex flex-col h-[calc(100vh-3rem)] sticky top-6 overflow-hidden">
      <div className="p-3 border-b border-border bg-primary text-primary-foreground">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4" /> Copilot Financeiro
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-xs text-muted-foreground space-y-2">
            <p>Olá! Analiso DRE, projeção e simulo cenários.</p>
            <button
              className="block text-left p-2 rounded bg-muted hover:bg-accent w-full"
              onClick={() => setInput("Posso investir R$ 8.000 em uma reforma nos próximos 3 meses?")}
            >
              "Posso investir R$ 8.000 em reforma nos próximos 3 meses?"
            </button>
            <button
              className="block text-left p-2 rounded bg-muted hover:bg-accent w-full"
              onClick={() => setInput("Qual o risco de quebra em 60 dias?")}
            >
              "Qual o risco de quebra em 60 dias?"
            </button>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "assistant" && (
              <div className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Bot className="h-3 w-3" />
              </div>
            )}
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
              }`}
            >
              {m.parts.map((p, i) => {
                if (p.type === "text")
                  return <span key={i} className="whitespace-pre-wrap">{p.text}</span>;
                if (p.type.startsWith("tool-"))
                  return <div key={i} className="text-xs opacity-70 mt-1 italic">🔧 simulação</div>;
                return null;
              })}
            </div>
            {m.role === "user" && (
              <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-3 w-3" />
              </div>
            )}
          </div>
        ))}
        {isLoading && <div className="text-xs text-muted-foreground italic">Pensando...</div>}
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
