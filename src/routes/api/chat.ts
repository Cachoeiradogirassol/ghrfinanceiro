import { createFileRoute } from "@tanstack/react-router";
import { convertToModelMessages, streamText, stepCountIs, tool, type UIMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

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

        // Autentica usuário (token enviado pelo cliente via DefaultChatTransport headers)
        const authHeader = request.headers.get("authorization");
        let userId: string | null = null;
        if (authHeader?.startsWith("Bearer ")) {
          const token = authHeader.replace("Bearer ", "");
          const tmp = createClient<Database>(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_PUBLISHABLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const { data } = await tmp.auth.getClaims(token);
          userId = data?.claims?.sub ?? null;
        }

        const ctx = body.context;
        const ctxSummary = ctx
          ? `\n\nCONTEXTO FINANCEIRO ATUAL:\n- Saldo consolidado atual: R$ ${ctx.currentBalance.toFixed(2)}\n- Saldo projetado em 30d: R$ ${ctx.series[30]?.withGhosts.toFixed(2)}\n- Saldo projetado em 60d: R$ ${ctx.series[60]?.withGhosts.toFixed(2)}\n- Saldo projetado em 90d: R$ ${ctx.series[90]?.withGhosts.toFixed(2)}`
          : "";

        const gateway = createLovableAiGatewayProvider(key);
        const result = streamText({
          model: gateway("google/gemini-3-flash-preview"),
          stopWhen: ({ steps }) => steps.length >= 6,
          system: `Você é o Paulo, assistente financeiro do CONTROLE.GHR (Cachoeira do Girassol, Restaurante, Vinhedo, Fazenda, Impostos, GHR Empreendimentos).
Responda sempre em português brasileiro, com tom direto, simpático e analítico. Assine como "Paulo" quando fizer sentido.

CAPACIDADES:
1. Análise de caixa: use simulate_investment para checar viabilidade de gastos.
2. Lançamentos: quando o usuário descrever uma despesa/recebimento já realizado ou a pagar ("paguei", "recebi", "lançar"), use create_transaction. Mapeie:
   - Empreendimento: turismo (Cachoeira), restaurante, vinhedo, ghr_aldeia, ghr_jk.
   - Categoria por palavras-chave (ex.: "gás de cozinha" → Gás de Cozinha; "energia" → Luz; etc.). Se não tiver certeza, peça confirmação.
   - Banco pelo nome falado (PagBank, InfinitePay, Nubank, Asaas, Banco Inter, Sicoob, Mercado Pago, Banco C6, Caixa Físico).
   - Status: "paid" se pagamento já ocorreu, senão "pending".
   - Não invente valores; se faltar algo essencial (valor, empreendimento, categoria), pergunte.

REGRA CONTÁBIL: Categorias genéricas de "conta compartilhada" estão desativadas. Despesas comuns devem usar a categoria de natureza real e, se necessário, ratear pelo checkbox "Ratear esta despesa".${ctxSummary}`,
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
                if (!ctx) return { ok: false, message: "Sem contexto financeiro" };
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
            create_transaction: tool({
              description:
                "Cria um lançamento financeiro (conta a pagar ou a receber) no banco. Use quando o usuário descrever uma despesa ou recebimento.",
              inputSchema: z.object({
                type: z.enum(["payable", "receivable"]).describe("payable = despesa; receivable = recebimento"),
                enterprise: z.enum(["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"]),
                category_hint: z.string().describe("Texto da categoria/subconta (ex.: 'Gás de Cozinha', 'Luz', 'Internet')"),
                bank_hint: z.string().optional().describe("Nome do banco/conta (ex.: 'PagBank', 'Nubank')"),
                amount: z.number().positive(),
                description: z.string().optional(),
                due_date: z.string().optional().describe("YYYY-MM-DD; padrão = hoje"),
                status: z.enum(["pending", "paid"]).default("pending"),
                payment_method: z.enum(["pix", "boleto", "credit_card", "cash"]).optional(),
                contact_name: z.string().optional().describe("Nome do fornecedor/cliente; se não informado, usa 'Lançamento via Paulo'"),
              }),
              execute: async (input) => {
                try {
                  if (!userId) {
                    return { ok: false, error: "Sessão não autenticada. Faça login novamente." };
                  }
                  const sb = supabaseAdmin;

                  // 1) Cost center pelo enterprise
                  const { data: ccs } = await sb
                    .from("cost_centers")
                    .select("id, name, enterprise")
                    .eq("enterprise", input.enterprise)
                    .eq("is_active", true);
                  const cc = ccs?.[0];
                  if (!cc) return { ok: false, error: `Empreendimento '${input.enterprise}' não encontrado.` };

                  // 2) Account: busca por nome dentro do cost center
                  const { data: accs } = await sb
                    .from("accounts")
                    .select("id, name")
                    .eq("cost_center_id", cc.id)
                    .eq("is_active", true);
                  const hint = input.category_hint.toLowerCase();
                  const account =
                    accs?.find((a) => a.name.toLowerCase() === hint) ||
                    accs?.find((a) => a.name.toLowerCase().includes(hint)) ||
                    accs?.find((a) => hint.split(/\s+/).some((w) => w.length > 2 && a.name.toLowerCase().includes(w)));
                  if (!account) {
                    return {
                      ok: false,
                      error: `Categoria '${input.category_hint}' não encontrada em ${cc.name}. Categorias disponíveis: ${(accs ?? []).map((a) => a.name).slice(0, 15).join(", ")}`,
                    };
                  }

                  // 3) Bank account (opcional, mas se fornecido busca)
                  let bankId: string | null = null;
                  if (input.bank_hint) {
                    const bh = input.bank_hint.toLowerCase();
                    const { data: banks } = await sb
                      .from("bank_accounts")
                      .select("id, name, enterprise");
                    const bank =
                      banks?.find((b) => b.name.toLowerCase() === bh) ||
                      banks?.find((b) => b.name.toLowerCase().includes(bh));
                    if (bank) bankId = bank.id;
                  }

                  // 4) Contato — usa/cria genérico se não informado
                  const contactName = input.contact_name?.trim() || "Lançamento via Paulo";
                  let { data: contact } = await sb
                    .from("contacts")
                    .select("id")
                    .ilike("name", contactName)
                    .maybeSingle();
                  if (!contact) {
                    const docNum = String(Date.now()).padStart(11, "0").slice(-11);
                    const { data: newContact, error: ccErr } = await sb
                      .from("contacts")
                      .insert({
                        name: contactName,
                        type: "FORNECEDOR",
                        document_type: "PF",
                        document_number: docNum,
                        master_only: false,
                      })
                      .select("id")
                      .single();
                    if (ccErr) return { ok: false, error: "Falha ao criar contato: " + ccErr.message };
                    contact = newContact;
                  }

                  const today = new Date().toISOString().slice(0, 10);
                  const dueDate = input.due_date || today;
                  const { data: tx, error } = await sb
                    .from("transactions")
                    .insert({
                      cost_center_id: cc.id,
                      account_id: account.id,
                      bank_account_id: bankId,
                      contact_id: contact!.id,
                      type: input.type,
                      amount: input.amount,
                      description: input.description ?? null,
                      due_date: dueDate,
                      document_datetime: input.status === "paid" ? new Date().toISOString() : null,
                      paid_at: input.status === "paid" ? new Date().toISOString() : null,
                      status: input.status,
                      payment_method: input.payment_method ?? null,
                      created_by: userId,
                      updated_by: userId,
                    })
                    .select("id, amount, status, type, due_date")
                    .single();
                  if (error) return { ok: false, error: error.message };

                  return {
                    ok: true,
                    transaction: tx,
                    summary: {
                      type: input.type === "payable" ? "Despesa" : "Recebimento",
                      enterprise: cc.name,
                      category: account.name,
                      amount: input.amount,
                      status: input.status,
                      due_date: dueDate,
                      bank: input.bank_hint ?? null,
                    },
                  };
                } catch (e) {
                  return { ok: false, error: e instanceof Error ? e.message : "Erro desconhecido" };
                }
              },
            }),
          },
        });

        return result.toUIMessageStreamResponse();
      },
    },
  },
});
