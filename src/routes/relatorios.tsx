import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/auth";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  buildAuditSummary,
  buildComparativeDRE,
} from "@/lib/reports.functions";
import {
  buildDRE,
  buildProjection,
  listAuditUsers,
  listClosedMonths,
  closePeriodMonth,
  reopenPeriodMonth,
} from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  FileBarChart,
  ShieldCheck,
  Sparkles,
  FileDown,
  Bot,
  Send,
  BarChart3,
  Lock,
  Unlock,
  CalendarRange,
} from "lucide-react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { exportDREPdf } from "@/lib/pdf-export";
import { enterpriseLabel } from "@/lib/enterprises";
import { CostsByEnterpriseTab } from "@/components/reports/CostsByEnterpriseTab";

export const Route = createFileRoute("/relatorios")({
  head: () => ({
    meta: [
      { title: "Relatórios Avançados — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Auditoria de operações, DRE comparativa multi-período e insights de IA para o Grupo GHR.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://ghrfinanceiro.lovable.app/relatorios",
      },
    ],
  }),
  component: () => (
    <AppLayout>
      <RelatoriosPage />
    </AppLayout>
  ),
});

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function RelatoriosPage() {
  const { isMaster, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !isMaster) nav({ to: "/" });
  }, [loading, isMaster, nav]);
  if (!isMaster) return null;

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <FileBarChart className="h-6 w-6 text-primary" /> Relatórios Avançados
        </h1>
        <p className="text-muted-foreground">
          Auditoria, comparativos multi-período e insights de IA.
        </p>
      </div>

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">
            <ShieldCheck className="h-4 w-4 mr-2" /> Auditoria
          </TabsTrigger>
          <TabsTrigger value="comparative">
            <FileBarChart className="h-4 w-4 mr-2" /> DRE Comparativa
          </TabsTrigger>
          <TabsTrigger value="costs">
            <BarChart3 className="h-4 w-4 mr-2" /> Custos por Empreendimento
          </TabsTrigger>
          <TabsTrigger value="ia">
            <Sparkles className="h-4 w-4 mr-2" /> Insights de IA
          </TabsTrigger>
        </TabsList>

        <TabsContent value="audit" className="mt-4">
          <AuditTab />
        </TabsContent>
        <TabsContent value="comparative" className="mt-4">
          <ComparativeTab />
        </TabsContent>
        <TabsContent value="costs" className="mt-4">
          <CostsByEnterpriseTab />
        </TabsContent>
        <TabsContent value="ia" className="mt-4">
          <IATab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AuditTab() {
  const [months, setMonths] = useState(6);
  const auditFn = useServerFn(buildAuditSummary);
  const usersFn = useServerFn(listAuditUsers);
  const audit = useQuery({
    queryKey: ["audit-summary", months],
    queryFn: () => auditFn({ data: { months } }),
  });
  const users = useQuery({ queryKey: ["audit-users"], queryFn: () => usersFn() });
  const userMap = new Map((users.data ?? []).map((u) => [u.id, u.email]));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-sm text-muted-foreground">Últimos</label>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="border border-input bg-background rounded-md px-2 py-1 text-sm"
          aria-label="Período"
        >
          {[3, 6, 12, 24].map((m) => (
            <option key={m} value={m}>
              {m} meses
            </option>
          ))}
        </select>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Atividade por Operador</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2">Operador</th>
                <th className="py-2 text-right">Lançou</th>
                <th className="py-2 text-right">Editou</th>
                <th className="py-2 text-right">Conciliou</th>
                <th className="py-2 text-right">Volume total</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.byUser ?? []).map((u) => (
                <tr key={u.user_id} className="border-b border-border/40">
                  <td className="py-2">
                    {userMap.get(u.user_id) ?? u.user_id.slice(0, 8)}
                  </td>
                  <td className="py-2 text-right font-mono">{u.created_count}</td>
                  <td className="py-2 text-right font-mono">{u.updated_count}</td>
                  <td className="py-2 text-right font-mono">
                    {u.reconciled_count}
                  </td>
                  <td className="py-2 text-right font-mono">
                    {fmt(u.total_amount)}
                  </td>
                </tr>
              ))}
              {(audit.data?.byUser ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-muted-foreground">
                    Sem atividade no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Volume por Empreendimento</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2">Empreendimento</th>
                <th className="py-2 text-right">Lançamentos</th>
                <th className="py-2 text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.byEnterprise ?? []).map((e) => (
                <tr key={e.enterprise} className="border-b border-border/40">
                  <td className="py-2">{enterpriseLabel(e.enterprise)}</td>
                  <td className="py-2 text-right font-mono">{e.count}</td>
                  <td className="py-2 text-right font-mono">{fmt(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ComparativeTab() {
  const [months, setMonths] = useState(12);
  const compFn = useServerFn(buildComparativeDRE);
  const dreFn = useServerFn(buildDRE);
  const comp = useQuery({
    queryKey: ["comp-dre", months],
    queryFn: () => compFn({ data: { months } }),
  });
  const dre = useQuery({
    queryKey: ["dre-export", months],
    queryFn: () => dreFn({ data: { enterprise: "all", months } }),
  });

  const exportPdf = () => {
    if (!dre.data) return;
    exportDREPdf(dre.data, {
      title: `DRE Consolidada — últimos ${months} meses`,
      scope: "Consolidado (todos os empreendimentos)",
      fileName: `DRE_Comparativa_GHR_${months}m.pdf`,
    });
  };

  const t = dre.data?.totals;

  return (
    <div className="space-y-4">
      <PeriodLockCard />

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">Últimos</label>
          <select
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
            className="border border-input bg-background rounded-md px-2 py-1 text-sm"
            aria-label="Período comparativo"
          >
            {[6, 12, 24, 36].map((m) => (
              <option key={m} value={m}>
                {m} meses
              </option>
            ))}
          </select>
        </div>
        <Button onClick={exportPdf} disabled={!dre.data}>
          <FileDown className="h-4 w-4 mr-2" /> Exportar PDF Oficial
        </Button>
      </div>

      {t && (
        <Card className="p-5">
          <h2 className="font-semibold mb-3">
            DRE em Cascata — Totais do Período ({months} meses)
          </h2>
          <div className="space-y-1.5 text-sm">
            <WaterfallRow label="(+) Faturamento Bruto (Receitas)" value={t.revenue} tone="positive" />
            <WaterfallRow label="(-) Custos Diretos Operacionais" value={-t.directExpense} tone="negative" />
            <WaterfallRow
              label="(=) MARGEM DE CONTRIBUIÇÃO / LUCRO BRUTO"
              value={t.grossProfit}
              tone={t.grossProfit >= 0 ? "subtotal-positive" : "subtotal-negative"}
              emphasis
            />
            <WaterfallRow label="(-) Despesas Administrativas / Fixas" value={-t.adminExpense} tone="negative" />
            <WaterfallRow
              label="(=) LUCRO LÍQUIDO REALIZADO DO PERÍODO"
              value={t.net}
              tone={t.net >= 0 ? "subtotal-positive" : "subtotal-negative"}
              emphasis
              final
            />
            {(t.aporteRecebido > 0 || t.aporteConcedido > 0) && (
              <div className="pt-2 mt-2 border-t border-border/60 text-xs text-muted-foreground space-y-1">
                <WaterfallRow label="Aportes Recebidos (não operacional)" value={t.aporteRecebido} tone="muted" />
                <WaterfallRow label="Aportes Concedidos (não operacional)" value={-t.aporteConcedido} tone="muted" />
              </div>
            )}
          </div>
        </Card>
      )}


      <Card className="p-5">
        <h2 className="font-semibold mb-3">
          Análise Horizontal — Receita / Despesa / Líquido por mês
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="py-2">Mês</th>
                <th className="py-2 text-right">Receita</th>
                <th className="py-2 text-right">Despesa</th>
                <th className="py-2 text-right">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {(comp.data?.series ?? []).map((r) => (
                <tr key={String(r.month)} className="border-b border-border/40">
                  <td className="py-2">{String(r.month)}</td>
                  <td className="py-2 text-right font-mono text-primary">
                    {fmt(Number(r.total_rev))}
                  </td>
                  <td className="py-2 text-right font-mono text-destructive">
                    {fmt(Number(r.total_exp))}
                  </td>
                  <td
                    className={`py-2 text-right font-mono font-semibold ${Number(r.total_net) >= 0 ? "text-primary" : "text-destructive"}`}
                  >
                    {fmt(Number(r.total_net))}
                  </td>
                </tr>
              ))}
              {(comp.data?.series ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-muted-foreground">
                    Sem dados realizados no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">
          Análise Vertical — Líquido por Empreendimento × Mês
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2">Empreendimento</th>
                {(comp.data?.months ?? []).map((m) => (
                  <th key={m} className="text-right py-2 px-2">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(comp.data?.enterprises ?? []).map((e) => (
                <tr key={e} className="border-b border-border/40">
                  <td className="py-2">{enterpriseLabel(e)}</td>
                  {(comp.data?.months ?? []).map((m) => {
                    const row = comp.data?.series.find((s) => s.month === m);
                    const v = Number(row?.[`${e}_net`] ?? 0);
                    return (
                      <td
                        key={m}
                        className={`text-right font-mono px-2 ${v >= 0 ? "text-primary" : "text-destructive"}`}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function IATab() {
  const compFn = useServerFn(buildComparativeDRE);
  const projFn = useServerFn(buildProjection);
  const comp = useQuery({
    queryKey: ["comp-dre", 24],
    queryFn: () => compFn({ data: { months: 24 } }),
  });
  const proj = useQuery({
    queryKey: ["proj", "all"],
    queryFn: () => projFn({ data: { enterprise: "all" } }),
  });

  const historical = (comp.data?.series ?? []).map((r) => ({
    month: String(r.month),
    total_rev: Number(r.total_rev),
    total_exp: Number(r.total_exp),
    total_net: Number(r.total_net),
  }));

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const transport = useRef(
    new DefaultChatTransport({ api: "/api/chat-reports" }),
  );
  const { messages, sendMessage, status } = useChat({
    transport: transport.current,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const send = () => {
    if (!input.trim()) return;
    sendMessage(
      { text: input },
      {
        body: {
          context: {
            historical,
            projection: {
              currentBalance: proj.data?.currentBalance ?? 0,
              horizon90: proj.data?.series?.[90]?.withGhosts ?? 0,
            },
            enterprises: comp.data?.enterprises ?? [],
          },
        },
      },
    );
    setInput("");
  };
  const isLoading = status === "submitted" || status === "streaming";

  return (
    <Card className="p-0 flex flex-col h-[70vh] overflow-hidden">
      <div className="p-3 border-b border-border bg-primary text-primary-foreground">
        <h2 className="font-semibold flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4" /> Análise de Sazonalidade e Insights da IA
        </h2>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Faça perguntas comparativas usando o histórico de até 24 meses e a
              projeção de 90 dias.
            </p>
            {[
              "Compare o desempenho do Turismo entre este trimestre e o mesmo período do ano passado e me dê insights de redução de custo.",
              "Quais meses do ano mostram sazonalidade negativa para o Restaurante?",
              "Considerando o histórico, qual empreendimento deveria reduzir custo prioritariamente?",
            ].map((s) => (
              <button
                key={s}
                className="block text-left p-2 rounded bg-muted hover:bg-accent w-full"
                onClick={() => setInput(s)}
              >
                "{s}"
              </button>
            ))}
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}
          >
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.parts.map((p, i) =>
                p.type === "text" ? (
                  <span key={i} className="whitespace-pre-wrap">
                    {p.text}
                  </span>
                ) : null,
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="text-xs text-muted-foreground italic">Pensando...</div>
        )}
      </div>
      <div className="p-3 border-t border-border space-y-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Pergunte uma análise comparativa..."
          rows={2}
          className="text-sm resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <Button
          size="sm"
          onClick={send}
          disabled={isLoading || !input.trim()}
          className="w-full"
        >
          <Send className="h-4 w-4 mr-2" /> Enviar
        </Button>
      </div>
    </Card>
  );
}

// ---------- Helpers: Waterfall + PeriodLock ----------
type WaterfallTone =
  | "positive"
  | "negative"
  | "subtotal-positive"
  | "subtotal-negative"
  | "muted";

function WaterfallRow({
  label,
  value,
  tone,
  emphasis,
  final,
}: {
  label: string;
  value: number;
  tone: WaterfallTone;
  emphasis?: boolean;
  final?: boolean;
}) {
  const toneClass =
    tone === "positive"
      ? "text-primary"
      : tone === "negative"
        ? "text-destructive"
        : tone === "subtotal-positive"
          ? "text-primary"
          : tone === "subtotal-negative"
            ? "text-destructive"
            : "text-muted-foreground";
  const rowClass = emphasis
    ? `flex items-center justify-between border-y border-border ${final ? "border-y-2 bg-muted/40" : "bg-muted/20"} px-2 py-2 font-semibold`
    : "flex items-center justify-between py-1 px-2";
  return (
    <div className={rowClass}>
      <span className={emphasis ? "uppercase tracking-wide" : ""}>{label}</span>
      <span className={`font-mono ${toneClass} ${emphasis ? "text-base" : ""}`}>{fmt(value)}</span>
    </div>
  );
}

function PeriodLockCard() {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const listFn = useServerFn(listClosedMonths);
  const closeFn = useServerFn(closePeriodMonth);
  const reopenFn = useServerFn(reopenPeriodMonth);

  const closed = useQuery({
    queryKey: ["closed-months"],
    queryFn: () => listFn(),
  });

  const close = useMutation({
    mutationFn: closeFn,
    onSuccess: () => {
      toast.success(`Período ${String(month).padStart(2, "0")}/${year} encerrado.`);
      qc.invalidateQueries({ queryKey: ["closed-months"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reopen = useMutation({
    mutationFn: reopenFn,
    onSuccess: () => {
      toast.success(`Período ${String(month).padStart(2, "0")}/${year} reaberto.`);
      qc.invalidateQueries({ queryKey: ["closed-months"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const isClosed = (closed.data ?? []).some(
    (p) => (p.start_date as string).slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`,
  );

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);
  const monthNames = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold">Encerramento de Período (Lock Global)</h2>
            <p className="text-xs text-muted-foreground">
              Trava criação/edição/exclusão em transações, conciliações e projeções daquele mês.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="border border-input bg-background rounded-md px-2 py-1 text-sm"
            aria-label="Mês"
          >
            {monthNames.map((n, i) => (
              <option key={n} value={i + 1}>{n}</option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border border-input bg-background rounded-md px-2 py-1 text-sm"
            aria-label="Ano"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {isClosed ? (
            <Button
              variant="outline"
              onClick={() => reopen.mutate({ data: { year, month } })}
              disabled={reopen.isPending}
            >
              <Unlock className="h-4 w-4 mr-2" /> Reabrir Período (Master)
            </Button>
          ) : (
            <Button
              onClick={() => close.mutate({ data: { year, month } })}
              disabled={close.isPending}
            >
              <Lock className="h-4 w-4 mr-2" /> Encerrar Período
            </Button>
          )}
        </div>
      </div>

      {(closed.data ?? []).length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(closed.data ?? []).map((p) => {
            const ym = (p.start_date as string).slice(0, 7);
            return (
              <span
                key={ym}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium"
              >
                <Lock className="h-3 w-3" /> {ym}
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}
