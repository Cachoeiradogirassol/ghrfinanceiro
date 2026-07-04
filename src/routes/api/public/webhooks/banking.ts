import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * Receptor Central de Webhooks Bancários / Adquirentes.
 *
 * URL pública (publicada):
 *   POST https://ghrfinanceiro.lovable.app/api/public/webhooks/banking
 * URL preview:
 *   POST https://project--8cb8c0ab-346e-4e4c-b16a-a8aecb44f63e.lovable.app/api/public/webhooks/banking
 *
 * Observação: usamos o prefixo `/api/public/*` porque ele é o único que
 * bypassa a autenticação da Lovable em sites publicados — é o caminho correto
 * para webhooks externos. O caminho lógico continua sendo "banking".
 *
 * Roteamento por origem (8 fontes previstas):
 *   - infinitepay   -> Restaurante                (IMPLEMENTADO)
 *   - asaas         -> Loteamentos                (stub)
 *   - inter         -> Loteamentos / Vinhedo      (stub)
 *   - sicoob        -> Loteamentos                (stub)
 *   - mercadopago   -> Restaurante / Vinhedo      (stub)
 *   - c6            -> GHR Holding                (stub)
 *   - pagbank       -> Restaurante                (stub)
 *   - nubank        -> Restaurante / Holding      (stub)
 *
 * Identificação de origem:
 *   1) Header `x-banking-source` (preferencial): "infinitepay" | "asaas" | ...
 *   2) Header `x-pdv-signature`  -> assume "infinitepay"
 *   3) Header `user-agent` contendo o nome da adquirente (fallback)
 *
 * Segurança: cada origem possui sua própria secret (HMAC-SHA256 do corpo bruto).
 * Header de assinatura: `x-banking-signature` (ou `x-pdv-signature` para legado).
 *
 * Observação sobre a tabela:
 *   O cadastro real da GHR usa `public.transactions` (não existe
 *   `fluxo_de_caixa_consolidado`). É essa tabela que alimenta o DRE do
 *   Painel Executivo e as Projeções Financeiras, então é onde inserimos.
 */

// -------- Mapeamento Centro de Custo por origem --------
const RESTAURANT_COST_CENTER_ID = "d452db68-3a26-40d4-b0e1-e68001b579af";

const SOURCE_TO_COST_CENTER: Record<string, string> = {
  infinitepay: RESTAURANT_COST_CENTER_ID,
  pagbank: RESTAURANT_COST_CENTER_ID,
  // demais origens serão preenchidas conforme os centros forem confirmados
};

const SOURCE_SECRET_ENV: Record<string, string> = {
  infinitepay: "INFINITEPAY_WEBHOOK_SECRET",
  asaas: "ASAAS_WEBHOOK_SECRET",
  inter: "INTER_WEBHOOK_SECRET",
  sicoob: "SICOOB_WEBHOOK_SECRET",
  mercadopago: "MERCADOPAGO_WEBHOOK_SECRET",
  c6: "C6_WEBHOOK_SECRET",
  pagbank: "PAGBANK_WEBHOOK_SECRET",
  nubank: "NUBANK_WEBHOOK_SECRET",
};

type BankingSource = keyof typeof SOURCE_SECRET_ENV;

function detectSource(request: Request): BankingSource | null {
  const explicit = request.headers.get("x-banking-source")?.toLowerCase().trim();
  if (explicit && explicit in SOURCE_SECRET_ENV) return explicit as BankingSource;

  if (request.headers.get("x-pdv-signature")) return "infinitepay";

  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  for (const src of Object.keys(SOURCE_SECRET_ENV) as BankingSource[]) {
    if (ua.includes(src)) return src;
  }
  return null;
}

function verifySignature(rawBody: string, headerSig: string | null, secret: string) {
  if (!headerSig) return false;
  const provided = headerSig.startsWith("sha256=") ? headerSig.slice(7) : headerSig;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// -------- Schemas por origem --------
const infinitePaySchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  faturamento_bruto: z.number().finite().nonnegative(),
  taxas: z.number().finite().nonnegative().optional().default(0),
  despesas: z
    .array(z.object({ categoria: z.string().min(1).max(120), valor: z.number().finite().nonnegative() }))
    .max(100)
    .optional(),
  observacao: z.string().max(500).optional(),
});

// -------- Handler de InfinitePay (Restaurante) --------
async function handleInfinitePay(raw: string) {
  const parsed = infinitePaySchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return Response.json(
      { error: "Payload InfinitePay inválido.", details: parsed.error.flatten() },
      { status: 422 },
    );
  }
  const payload = parsed.data;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Carrega plano de contas do Restaurante para mapear categorias -> account_id
  const { data: accounts, error: accErr } = await supabaseAdmin
    .from("accounts")
    .select("id, name, kind, is_active")
    .eq("cost_center_id", RESTAURANT_COST_CENTER_ID)
    .eq("is_active", true);

  if (accErr || !accounts) {
    return new Response("Falha ao carregar plano de contas do Restaurante.", { status: 500 });
  }

  const norm = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const byName = new Map(accounts.map((a) => [norm(a.name), a]));
  const defaultRevenue =
    accounts.find((a) => a.kind === "revenue" && norm(a.name).includes("vendas")) ??
    accounts.find((a) => a.kind === "revenue");
  const defaultExpense =
    accounts.find((a) => a.kind === "expense" && norm(a.name).includes("taxa")) ??
    accounts.find((a) => a.kind === "expense" && norm(a.name).includes("outros")) ??
    accounts.find((a) => a.kind === "expense");

  const tag = `[INFINITEPAY ${payload.data}]`;
  const documentDatetime = new Date(`${payload.data}T12:00:00Z`).toISOString();
  const paidAt = new Date().toISOString();

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
  };
  const rows: Row[] = [];

  // Receita bruta
  if (payload.faturamento_bruto > 0 && defaultRevenue) {
    rows.push({
      cost_center_id: RESTAURANT_COST_CENTER_ID,
      account_id: defaultRevenue.id,
      type: "receivable",
      amount: Number(payload.faturamento_bruto.toFixed(2)),
      description: `${tag} Faturamento bruto`,
      due_date: payload.data,
      document_datetime: documentDatetime,
      status: "reconciled",
      paid_at: paidAt,
    });
  }

  // Taxas da adquirente como despesa
  if (payload.taxas && payload.taxas > 0 && defaultExpense) {
    rows.push({
      cost_center_id: RESTAURANT_COST_CENTER_ID,
      account_id: defaultExpense.id,
      type: "payable",
      amount: Number(payload.taxas.toFixed(2)),
      description: `${tag} Taxas InfinitePay`,
      due_date: payload.data,
      document_datetime: documentDatetime,
      status: "reconciled",
      paid_at: paidAt,
    });
  }

  // Despesas detalhadas
  for (const d of payload.despesas ?? []) {
    if (d.valor <= 0) continue;
    const acc = byName.get(norm(d.categoria)) ?? defaultExpense;
    if (!acc) continue;
    rows.push({
      cost_center_id: RESTAURANT_COST_CENTER_ID,
      account_id: acc.id,
      type: "payable",
      amount: Number(d.valor.toFixed(2)),
      description: `${tag} ${d.categoria}`,
      due_date: payload.data,
      document_datetime: documentDatetime,
      status: "reconciled",
      paid_at: paidAt,
    });
  }

  if (rows.length === 0) {
    return Response.json({ ok: true, inserted: 0, source: "infinitepay" });
  }

  // Idempotência por dia/origem
  const { error: delErr } = await supabaseAdmin
    .from("transactions")
    .delete()
    .eq("cost_center_id", RESTAURANT_COST_CENTER_ID)
    .like("description", `${tag}%`);
  if (delErr) {
    return new Response(`Falha ao limpar lançamentos do dia: ${delErr.message}`, { status: 500 });
  }

  const { error: insErr, count } = await supabaseAdmin
    .from("transactions")
    .insert(rows, { count: "exact" });
  if (insErr) {
    return new Response(`Falha ao inserir lançamentos: ${insErr.message}`, { status: 500 });
  }

  return Response.json({
    ok: true,
    source: "infinitepay",
    cost_center_id: RESTAURANT_COST_CENTER_ID,
    date: payload.data,
    inserted: count ?? rows.length,
  });
}

// -------- Route --------
export const Route = createFileRoute("/api/public/webhooks/banking")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const source = detectSource(request);
        if (!source) {
          return new Response(
            "Origem não identificada. Envie header `x-banking-source` com uma das fontes suportadas.",
            { status: 400 },
          );
        }

        const secretEnv = SOURCE_SECRET_ENV[source];
        const secret = process.env[secretEnv];
        if (!secret) {
          return new Response(
            `Webhook ${source} não configurado (${secretEnv} ausente).`,
            { status: 503 },
          );
        }

        const raw = await request.text();
        const signature =
          request.headers.get("x-banking-signature") ??
          request.headers.get("x-pdv-signature");

        if (!verifySignature(raw, signature, secret)) {
          return new Response("Assinatura HMAC inválida.", { status: 401 });
        }

        try {
          switch (source) {
            case "infinitepay":
              return await handleInfinitePay(raw);

            // Stubs prontos para serem implementados nos próximos turnos.
            case "asaas":
            case "inter":
            case "sicoob":
            case "mercadopago":
            case "c6":
            case "pagbank":
            case "nubank":
              return Response.json(
                {
                  ok: true,
                  source,
                  cost_center_id: SOURCE_TO_COST_CENTER[source] ?? null,
                  message: `Handler de ${source} ainda não implementado — payload validado e assinatura OK.`,
                },
                { status: 202 },
              );
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Erro desconhecido";
          return new Response(`Falha ao processar webhook ${source}: ${msg}`, { status: 500 });
        }
      },
    },
  },
});
