import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages?: UIMessage[];
          context?: {
            currentBalance: number;
            series: Array<{ date: string; real: number; withGhosts: number }>;
            ghosts: Array<{ date: string; amount: number; reason: string }>;
          };
        };
        const key = process.env.LOVABLE_API_KEY;
        if (!key)
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        if (!Array.isArray(body.messages))
          return new Response("Messages required", { status: 400 });

        const ctx = body.context;
        const ctxSummary = ctx
          ? `\n\nCONTEXTO FINANCEIRO ATUAL:\n- Saldo consolidado atual (6 contas): R$ ${ctx.currentBalance.toFixed(2)}\n- Saldo projetado em 30d: R$ ${ctx.series[30]?.withGhosts.toFixed(2)}\n- Saldo projetado em 60d: R$ ${ctx.series[60]?.withGhosts.toFixed(2)}\n- Saldo projetado em 90d: R$ ${ctx.series[90]?.withGhosts.toFixed(2)}\n- Despesas fantasmas detectadas: ${ctx.ghosts.length} (total estimado R$ ${ctx.ghosts.reduce((s, g) => s + g.amount, 0).toFixed(2)})\n${ctx.ghosts.map((g) => `  • ${g.date}: R$ ${g.amount.toFixed(2)} — ${g.reason}`).join("\n")}`
          : "";

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: `Você é o Copilot do CONTROLE.GHR, um sistema financeiro multi-empresa (Cachoeira do Girassol, Restaurante, Vinhedo, Fazenda, Impostos, GHR Empreendimentos).
Responda sempre em português brasileiro, com tom direto e analítico.
Quando o usuário perguntar sobre viabilidade de gastos/investimentos, use a ferramenta simulate_investment.

REGRA CONTÁBIL IMPORTANTE — CATEGORIAS COMPARTILHADAS DESATIVADAS:
Categorias genéricas de contas compartilhadas (ex.: "Conta Compartilhada VG-CG") foram desativadas no plano de contas. Sempre que um operador perguntar como lançar uma despesa de uso comum entre empreendimentos, oriente-o assim: "Toda despesa de uso comum deve ser lançada sob sua natureza real (Ex: Logística, Manutenção, Materiais de Consumo) e o desmembramento entre os empreendimentos deve ser feito utilizando exclusivamente o checkbox nativo 'Ratear esta despesa' no formulário de Novo Lançamento." Nunca sugira recriar ou reativar categorias genéricas de rateio.${ctxSummary}`,
          messages: await convertToModelMessages(body.messages),
          tools: {
            simulate_investment: tool({
              description:
                "Simula se o caixa aguenta um investimento de X reais distribuído em N meses, comparando com o saldo projetado.",
              inputSchema: z.object({
                amount: z.number().describe("Valor total em reais"),
                months: z.number().describe("Em quantos meses será gasto"),
              }),
              execute: async ({ amount, months }) => {
                if (!ctx)
                  return { ok: false, message: "Sem contexto financeiro" };
                const monthly = amount / months;
                const checkpoints = [30, 60, 90];
                const analysis = checkpoints.map((d) => {
                  const m = Math.ceil(d / 30);
                  const charged = Math.min(m, months) * monthly;
                  const projected = ctx.series[d]?.withGhosts ?? 0;
                  const after = projected - charged;
                  return { day: d, projected, charged, after };
                });
                const minBalance = Math.min(...analysis.map((a) => a.after));
                return {
                  ok: minBalance > 0,
                  monthlyDraw: monthly,
                  analysis,
                  minBalance,
                  verdict:
                    minBalance > 10000
                      ? "Caixa suporta com folga."
                      : minBalance > 0
                        ? "Caixa suporta, mas com margem apertada."
                        : "RISCO DE QUEBRA — caixa fica negativo.",
                };
              },
            }),
          },
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
