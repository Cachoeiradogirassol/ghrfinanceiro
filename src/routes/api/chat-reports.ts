import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

interface ReportsContext {
  historical?: Array<{
    month: string;
    total_rev: number;
    total_exp: number;
    total_net: number;
  }>;
  projection?: {
    currentBalance: number;
    horizon90: number;
  };
  enterprises?: string[];
}

export const Route = createFileRoute("/api/chat-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json()) as {
          messages?: UIMessage[];
          context?: ReportsContext;
        };
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        if (!Array.isArray(body.messages))
          return new Response("Messages required", { status: 400 });

        const ctx = body.context;
        const hist = (ctx?.historical ?? [])
          .map(
            (m) =>
              `  • ${m.month}: receita R$ ${m.total_rev.toFixed(2)} / despesa R$ ${m.total_exp.toFixed(2)} / líquido R$ ${m.total_net.toFixed(2)}`,
          )
          .join("\n");
        const ctxSummary = ctx
          ? `\n\nCONTEXTO COMPARATIVO HISTÓRICO:\n${hist}\n\nProjeção: saldo atual R$ ${ctx.projection?.currentBalance?.toFixed(2) ?? "—"}, projetado em 90d R$ ${ctx.projection?.horizon90?.toFixed(2) ?? "—"}.\nEmpreendimentos: ${ctx?.enterprises?.join(", ") ?? "—"}`
          : "";

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          system: `Você é o Analista Sênior de IA do CONTROLE.GHR.
Responda em PT-BR com tom executivo e analítico.
Use o histórico para identificar sazonalidade, tendências, oportunidades de
redução de custo e comparações trimestrais/anuais. Cite meses e valores
específicos quando possível.${ctxSummary}`,
          messages: await convertToModelMessages(body.messages),
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
