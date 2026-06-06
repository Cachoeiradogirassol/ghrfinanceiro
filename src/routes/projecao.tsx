import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { buildProjection } from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
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
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Bot, User, Sparkles, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/projecao")({
  head: () => ({ meta: [{ title: "Projeção + IA — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Projection />
    </AppLayout>
  ),
});

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Projection() {
  const projFn = useServerFn(buildProjection);
  const { data } = useQuery({
    queryKey: ["proj"],
    queryFn: () => projFn(),
  });

  return (
    <div className="p-8 grid grid-cols-1 xl:grid-cols-3 gap-6">
      <div className="xl:col-span-2 space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Projeção de Caixa D+90</h1>
          <p className="text-muted-foreground">
            Linha real + projeção fantasma (despesas recorrentes estimadas)
          </p>
        </div>

        <Card className="p-6">
          <p className="text-sm text-muted-foreground">Saldo atual</p>
          <p className="text-3xl font-bold">{fmt(data?.currentBalance ?? 0)}</p>
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold mb-4">Fluxo de Caixa Projetado</h2>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.series ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) =>
                    new Date(d).toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })
                  }
                  fontSize={11}
                />
                <YAxis
                  tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                  fontSize={11}
                />
                <Tooltip
                  formatter={(v: number) => fmt(v)}
                  labelFormatter={(d) =>
                    new Date(d).toLocaleDateString("pt-BR")
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="real"
                  name="Saldo Real Projetado"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
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

        {(data?.ghosts.length ?? 0) > 0 && (
          <Card className="p-6">
            <h2 className="font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-destructive" />
              Despesas Fantasmas Detectadas
            </h2>
            <p className="text-xs text-muted-foreground mb-3">
              Recorrências não lançadas. Cálculo: média dos últimos 3 meses.
            </p>
            <div className="space-y-1">
              {data?.ghosts.map((g, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0"
                >
                  <span className="flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-destructive" />
                    {g.reason}
                  </span>
                  <span className="font-mono text-destructive">
                    {fmt(g.amount)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(g.date).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <div className="xl:col-span-1">
        <Copilot context={data} />
      </div>
    </div>
  );
}

interface ProjContext {
  currentBalance: number;
  series: Array<{ date: string; real: number; withGhosts: number }>;
  ghosts: Array<{ date: string; amount: number; reason: string }>;
}

function Copilot({ context }: { context: ProjContext | undefined }) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const transport = useRef(new DefaultChatTransport({ api: "/api/chat" }));

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
    if (!input.trim() || !context) return;
    sendMessage(
      { text: input },
      { body: { context } },
    );
    setInput("");
  };

  const isLoading = status === "submitted" || status === "streaming";

  return (
    <Card className="p-0 flex flex-col h-[calc(100vh-4rem)] sticky top-8 overflow-hidden">
      <div className="p-4 border-b border-border bg-primary text-primary-foreground">
        <h2 className="font-semibold flex items-center gap-2">
          <Bot className="h-5 w-5" /> Copilot Financeiro
        </h2>
        <p className="text-xs opacity-80 mt-0.5">
          IA preditiva — analisa saldo e projeções
        </p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground space-y-3">
            <p>Olá! Posso analisar o caixa para você.</p>
            <p className="text-xs">Tente perguntar:</p>
            <button
              className="block text-left text-xs p-2 rounded bg-muted hover:bg-accent w-full"
              onClick={() =>
                setInput(
                  "Posso investir R$ 8.000 em uma reforma nos próximos 3 meses?",
                )
              }
            >
              "Posso investir R$ 8.000 em uma reforma nos próximos 3 meses?"
            </button>
            <button
              className="block text-left text-xs p-2 rounded bg-muted hover:bg-accent w-full"
              onClick={() => setInput("Qual o risco de quebra nos próximos 60 dias?")}
            >
              "Qual o risco de quebra nos próximos 60 dias?"
            </button>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}
          >
            {m.role === "assistant" && (
              <div className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div
              className={`rounded-lg px-3 py-2 text-sm max-w-[85%] ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.parts.map((p, i) => {
                if (p.type === "text")
                  return <span key={i} className="whitespace-pre-wrap">{p.text}</span>;
                if (p.type.startsWith("tool-"))
                  return (
                    <div key={i} className="text-xs opacity-70 mt-1 italic">
                      🔧 simulação executada
                    </div>
                  );
                return null;
              })}
            </div>
            {m.role === "user" && (
              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="text-xs text-muted-foreground italic">
            Pensando...
          </div>
        )}
      </div>

      <div className="p-3 border-t border-border space-y-2">
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
