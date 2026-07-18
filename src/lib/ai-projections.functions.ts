import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";
import { generateText } from "ai";
import { z } from "zod";

const InterpretInput = z.object({
  text: z.string().trim().min(3).max(4000),
});

export type AiInterpretedItem = {
  name: string;
  direction: "inflow" | "outflow";
  initial_amount: number;
  monthly_growth_rate: number;
  start_date: string;
  horizon_months: number;
  cost_center_id: string | null;
  account_id: string | null;
  confidence: "alta" | "media" | "baixa";
  observacao: string;
};

function nextMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function extractJson(raw: string): unknown {
  // Try direct parse; else strip markdown fences; else find first [ ... ] block.
  const trimmed = raw.trim();
  const attempts: string[] = [trimmed];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) attempts.push(fenceMatch[1].trim());
  const arrMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrMatch) attempts.push(arrMatch[0]);
  const objMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objMatch) attempts.push(objMatch[0]);
  for (const a of attempts) {
    try {
      return JSON.parse(a);
    } catch {
      /* keep trying */
    }
  }
  throw new Error("A IA não retornou um JSON válido. Refine o texto e tente novamente.");
}

export const interpretProjectionText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => InterpretInput.parse(d))
  .handler(async ({ context, data }): Promise<{ items: AiInterpretedItem[]; raw: string }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente.");

    // Carrega contexto real
    const [ccRes, accRes, bankRes] = await Promise.all([
      context.supabase.from("cost_centers").select("id, code, name, enterprise").order("code"),
      context.supabase
        .from("accounts")
        .select("id, name, kind, cost_center_id")
        .order("name"),
      context.supabase.from("bank_accounts").select("id, name, bank, enterprise, opening_balance"),
    ]);
    if (ccRes.error) throw new Error(ccRes.error.message);
    if (accRes.error) throw new Error(accRes.error.message);

    const costCenters = ccRes.data ?? [];
    const accounts = accRes.data ?? [];
    const banks = bankRes.data ?? [];

    // Saldo aproximado
    let currentBalance = 0;
    try {
      const openingSum = banks.reduce(
        (s, b) => s + Number((b as { opening_balance?: number | string }).opening_balance ?? 0),
        0,
      );
      const { data: txSum } = await context.supabase
        .from("transactions")
        .select("amount, type, status")
        .eq("status", "reconciled");
      const txDelta = (txSum ?? []).reduce((s, t) => {
        const amt = Number((t as { amount: number | string }).amount);
        const sign = (t as { type: string }).type === "receivable" ? 1 : -1;
        return s + sign * amt;
      }, 0);
      currentBalance = openingSum + txDelta;
    } catch {
      /* saldo é apenas contexto */
    }

    const ccCatalog = costCenters
      .map((c) => `- ${c.id} | ${c.code} — ${c.name} (empresa: ${c.enterprise ?? "—"})`)
      .join("\n");
    const accCatalog = accounts
      .map(
        (a) =>
          `- ${a.id} | [${a.kind === "revenue" ? "RECEITA" : a.kind === "expense" ? "DESPESA" : a.kind}] ${a.name}${a.cost_center_id ? ` (CC: ${a.cost_center_id})` : ""}`,
      )
      .join("\n");

    const nextMonth = nextMonthISO();

    const system = `Você é o PAULO — assistente financeiro do CONTROLE.GHR e economista da ESCOLA AUSTRÍACA (Mises, Rothbard, Hayek). Sua tarefa AQUI é ÚNICA: converter descrições em linguagem natural em uma LISTA JSON estruturada de projeções de caixa. Nunca escreva texto fora do JSON, nunca use markdown, nunca comente. No campo "observacao" você pode (e deve) usar um tom austríaco-libertário curto: fale em "preservação de capital", "fuga da inflação fiat", "acumulação de poupança produtiva", ironizar impostos ao lançar tributos. Assine internamente as observações mais relevantes com "— Paulo". Se um mapeamento (centro de custo ou conta) não for claro com alta confiança, retorne null nesse campo e explique na "observacao".`;

    const user = `CONTEXTO REAL DO SISTEMA:
- Saldo consolidado atual: R$ ${currentBalance.toFixed(2)}
- Data de referência (próximo mês): ${nextMonth}

CENTROS DE CUSTO DISPONÍVEIS (use exatamente o UUID à esquerda):
${ccCatalog}

CONTAS CONTÁBEIS DISPONÍVEIS (use exatamente o UUID à esquerda; combine kind com direction):
${accCatalog}

REGRAS DE MAPEAMENTO:
- direction "inflow" = entrada/recebimento → account.kind deve ser "revenue".
- direction "outflow" = saída/pagamento/despesa → account.kind deve ser "expense".
- "folha salarial", "salários", "pró-labore" → conta de DESPESA com nome semelhante.
- Nomes de loteamentos ("JK", "Aldeia", "Girassol") → centro de custo GHR correspondente.
- Se não houver conta/CC com boa correspondência, use null. NÃO invente UUIDs.
- horizon_months: 1 se for evento único ("mês que vem", "pneu do carro"); 12+ se for "por N meses" ou "recorrente".
- start_date: se não especificado, use ${nextMonth}. Formato AAAA-MM-DD, sempre dia 01 salvo indicação clara.
- monthly_growth_rate: 0 salvo se o operador citar reajuste/crescimento explícito.
- Cada frase/linha do operador pode gerar 1 ou 2 itens (ex.: "entrada X e saída Y" → dois itens).

FORMATO DE SAÍDA (apenas isto, sem texto ao redor):
[
  {
    "name": "string curto e claro",
    "direction": "inflow" | "outflow",
    "initial_amount": number,
    "monthly_growth_rate": number,
    "start_date": "YYYY-MM-DD",
    "horizon_months": number,
    "cost_center_id": "uuid" | null,
    "account_id": "uuid" | null,
    "confidence": "alta" | "media" | "baixa",
    "observacao": "string explicando a interpretação e o que ficou incerto"
  }
]

TEXTO DO OPERADOR:
"""
${data.text}
"""`;

    const gateway = createLovableAiGatewayProvider(key);
    const model = gateway("google/gemini-3-flash-preview");
    const { text } = await generateText({
      model,
      system,
      prompt: user,
    });

    const parsed = extractJson(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : null;
    if (!arr) throw new Error("A IA retornou um formato inesperado.");

    // Sanitiza + valida contra catálogos
    const ccIds = new Set(costCenters.map((c) => c.id));
    const accById = new Map(accounts.map((a) => [a.id, a]));
    const items: AiInterpretedItem[] = [];
    for (const raw of arr) {
      const r = raw as Record<string, unknown>;
      const direction = r.direction === "outflow" ? "outflow" : "inflow";
      const amount = Number(r.initial_amount ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const startDate =
        typeof r.start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.start_date)
          ? r.start_date
          : nextMonth;
      const horizon = Math.max(
        1,
        Math.min(120, Math.floor(Number(r.horizon_months ?? 1)) || 1),
      );
      const growth = Number(r.monthly_growth_rate ?? 0);
      const ccIdRaw = typeof r.cost_center_id === "string" ? r.cost_center_id : null;
      const accIdRaw = typeof r.account_id === "string" ? r.account_id : null;
      const ccId = ccIdRaw && ccIds.has(ccIdRaw) ? ccIdRaw : null;
      let accId = accIdRaw && accById.has(accIdRaw) ? accIdRaw : null;
      // Coerência kind ↔ direction
      if (accId) {
        const acc = accById.get(accId)!;
        const wanted = direction === "inflow" ? "revenue" : "expense";
        if (acc.kind !== wanted) accId = null;
      }
      const confidence =
        r.confidence === "alta" || r.confidence === "media" || r.confidence === "baixa"
          ? r.confidence
          : "media";
      items.push({
        name: String(r.name ?? "Projeção sem nome").slice(0, 120),
        direction,
        initial_amount: Number(amount.toFixed(2)),
        monthly_growth_rate: Number.isFinite(growth) ? growth : 0,
        start_date: startDate,
        horizon_months: horizon,
        cost_center_id: ccId,
        account_id: accId,
        confidence,
        observacao: String(r.observacao ?? "").slice(0, 500),
      });
    }

    if (items.length === 0) throw new Error("A IA não conseguiu extrair nenhuma projeção do texto.");
    return { items, raw: text };
  });
