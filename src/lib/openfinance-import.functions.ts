import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const RESTAURANT_COST_CENTER_ID = "d452db68-3a26-40d4-b0e1-e68001b579af";

const InstitutionEnum = z.enum(["InfinitePay", "C6 Bank", "Mercado Pago", "Outro"]);

const ParsedTxSchema = z.object({
  transactions: z
    .array(
      z.object({
        data: z
          .string()
          .describe("Data no formato YYYY-MM-DD. Se vier 'hoje' ou abreviado, infira o ano atual."),
        descricao: z.string().describe("Descrição original da transação."),
        valor: z
          .number()
          .describe(
            "Valor numérico. POSITIVO para entradas/recebimentos/vendas/pix recebido; NEGATIVO para saídas/pix enviado/pagamentos.",
          ),
        instituicao: InstitutionEnum,
      }),
    )
    .max(500),
});

export const importOpenFinanceText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { text: string; default_cost_center_id: string; default_account_id: string }) =>
    z
      .object({
        text: z.string().trim().min(20).max(80000),
        default_cost_center_id: z.string().uuid(),
        default_account_id: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    const gateway = createLovableAiGatewayProvider(key);
    const today = new Date().toISOString().slice(0, 10);

    const { object } = await generateObject({
      model: gateway("google/gemini-3-flash-preview"),
      schema: ParsedTxSchema,
      system:
        "Você é um parser financeiro especialista em extratos brasileiros do Meu Pluggy (Open Finance). Extraia cada lançamento com data, descrição, valor (positivo entrada, negativo saída) e a instituição (InfinitePay, C6 Bank, Mercado Pago). Ignore cabeçalhos, totais e linhas de saldo.",
      prompt: `Data de hoje: ${today}.\n\nTexto colado do Meu Pluggy:\n\n${data.text}`,
    });

    const parsed = object.transactions.filter(
      (t) => Number.isFinite(t.valor) && t.valor !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.data),
    );

    if (parsed.length === 0) {
      return { inserted: 0, skipped: 0, total: 0, items: [] as Array<{ ok: boolean; reason?: string }> };
    }

    // Helper: gera chave única determinística por transação
    const keyOf = (t: { data: string; valor: number; descricao: string }) =>
      `${t.data}_${t.valor.toFixed(2)}_${t.descricao.trim().slice(0, 80).toLowerCase()}`;

    // Busca lançamentos existentes que já foram importados via este canal (por descrição com tag)
    const tags = parsed.map((t) => `[OFIMP ${keyOf(t)}]`);
    const { data: existing } = await context.supabase
      .from("transactions")
      .select("description")
      .in(
        "description",
        // PostgREST .in tem limite, mas até 500 itens é viável
        tags,
      );
    const existingSet = new Set((existing ?? []).map((r) => r.description as string));

    type Row = {
      cost_center_id: string;
      account_id: string;
      type: "receivable" | "payable";
      amount: number;
      description: string;
      due_date: string;
      document_datetime: string;
      status: "reconciled";
      paid_at: string;
      created_by: string;
    };

    const rows: Row[] = [];
    const items: Array<{ ok: boolean; reason?: string; description: string }> = [];
    const nowIso = new Date().toISOString();

    for (const t of parsed) {
      const tag = `[OFIMP ${keyOf(t)}]`;
      const description = `${tag} ${t.instituicao} — ${t.descricao}`.slice(0, 500);
      if (existingSet.has(description)) {
        items.push({ ok: false, reason: "duplicado", description });
        continue;
      }
      const cc =
        t.instituicao === "InfinitePay" ? RESTAURANT_COST_CENTER_ID : data.default_cost_center_id;
      rows.push({
        cost_center_id: cc,
        account_id: data.default_account_id,
        type: t.valor >= 0 ? "receivable" : "payable",
        amount: Math.abs(Number(t.valor.toFixed(2))),
        description,
        due_date: t.data,
        document_datetime: new Date(`${t.data}T12:00:00Z`).toISOString(),
        status: "reconciled",
        paid_at: nowIso,
        created_by: context.userId,
      });
      items.push({ ok: true, description });
    }

    let inserted = 0;
    if (rows.length > 0) {
      const { error, count } = await context.supabase
        .from("transactions")
        .insert(rows, { count: "exact" });
      if (error) throw new Error("Falha ao inserir transações: " + error.message);
      inserted = count ?? rows.length;
    }

    return {
      inserted,
      skipped: parsed.length - rows.length,
      total: parsed.length,
      items,
    };
  });
