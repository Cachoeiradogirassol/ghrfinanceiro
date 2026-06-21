import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

/**
 * Webhook POST /api/public/webhooks/pdv-restaurante
 *
 * Recebe o resumo diário consolidado do PDV do Restaurante e grava lançamentos
 * em `public.transactions` ligados ao cost center "RESTAURANTE" (enterprise=restaurante).
 *
 * Segurança: assinatura HMAC-SHA256 do corpo bruto no header `x-pdv-signature`
 * (suporta prefixo "sha256="). Secret: env var PDV_WEBHOOK_SECRET.
 *
 * Idempotência: descrição prefixada com `[PDV ${date}]` + nome da categoria.
 * Reenvios do mesmo dia substituem os lançamentos anteriores daquele dia.
 */

const RESTAURANT_COST_CENTER_ID = "d452db68-3a26-40d4-b0e1-e68001b579af";

const itemSchema = z.object({
  categoria: z.string().trim().min(1).max(120),
  valor: z.number().finite().nonnegative(),
});

const payloadSchema = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "data deve estar no formato YYYY-MM-DD"),
  faturamento_bruto: z.number().finite().nonnegative().optional(),
  faturamento_liquido: z.number().finite().nonnegative(),
  receitas: z.array(itemSchema).max(50).optional(),
  despesas: z.array(itemSchema).max(100).optional(),
  observacao: z.string().trim().max(500).optional(),
});

function verifySignature(rawBody: string, headerSig: string | null, secret: string) {
  if (!headerSig) return false;
  const provided = headerSig.startsWith("sha256=") ? headerSig.slice(7) : headerSig;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/webhooks/pdv-restaurante")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PDV_WEBHOOK_SECRET;
        if (!secret) {
          return new Response("Webhook não configurado (PDV_WEBHOOK_SECRET ausente).", {
            status: 503,
          });
        }

        const raw = await request.text();
        const signature = request.headers.get("x-pdv-signature");
        if (!verifySignature(raw, signature, secret)) {
          return new Response("Assinatura HMAC inválida.", { status: 401 });
        }

        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          return new Response("JSON inválido.", { status: 400 });
        }

        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            { error: "Payload inválido.", details: parsed.error.flatten() },
            { status: 422 },
          );
        }
        const payload = parsed.data;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Carrega catálogo de contas do Restaurante para mapear nomes -> account_id
        const { data: accounts, error: accErr } = await supabaseAdmin
          .from("accounts")
          .select("id, name, kind, is_active")
          .eq("cost_center_id", RESTAURANT_COST_CENTER_ID)
          .eq("is_active", true);

        if (accErr || !accounts) {
          return new Response("Falha ao carregar plano de contas do Restaurante.", {
            status: 500,
          });
        }

        const norm = (s: string) =>
          s
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .trim();

        const byName = new Map(accounts.map((a) => [norm(a.name), a]));
        const defaultRevenue = accounts.find(
          (a) => a.kind === "revenue" && norm(a.name).includes("vendas"),
        );
        const defaultExpense = accounts.find(
          (a) => a.kind === "expense" && norm(a.name).includes("outros"),
        );

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
        const tag = `[PDV ${payload.data}]`;
        const documentDatetime = new Date(`${payload.data}T12:00:00Z`).toISOString();
        const paidAt = new Date().toISOString();

        const pushItem = (
          kind: "revenue" | "expense",
          categoria: string,
          valor: number,
        ) => {
          if (valor <= 0) return;
          const acc =
            byName.get(norm(categoria)) ??
            (kind === "revenue" ? defaultRevenue : defaultExpense);
          if (!acc) return;
          rows.push({
            cost_center_id: RESTAURANT_COST_CENTER_ID,
            account_id: acc.id,
            type: kind === "revenue" ? "receivable" : "payable",
            amount: Number(valor.toFixed(2)),
            description: `${tag} ${categoria}`,
            due_date: payload.data,
            document_datetime: documentDatetime,
            status: "reconciled",
            paid_at: paidAt,
          });
        };

        // Receita consolidada (faturamento líquido) se não houver detalhamento
        if (!payload.receitas || payload.receitas.length === 0) {
          pushItem("revenue", "Faturamento Vendas", payload.faturamento_liquido);
        } else {
          for (const r of payload.receitas) pushItem("revenue", r.categoria, r.valor);
        }

        if (payload.despesas) {
          for (const d of payload.despesas) pushItem("expense", d.categoria, d.valor);
        }

        if (rows.length === 0) {
          return Response.json(
            { ok: true, inserted: 0, message: "Nenhum lançamento gerado." },
            { status: 200 },
          );
        }

        // Idempotência: remove lançamentos anteriores do mesmo dia/cost center
        // marcados com a mesma tag [PDV YYYY-MM-DD] antes de reinserir.
        const { error: delErr } = await supabaseAdmin
          .from("transactions")
          .delete()
          .eq("cost_center_id", RESTAURANT_COST_CENTER_ID)
          .like("description", `${tag}%`);
        if (delErr) {
          return new Response(`Falha ao limpar lançamentos do dia: ${delErr.message}`, {
            status: 500,
          });
        }

        const { error: insErr, count } = await supabaseAdmin
          .from("transactions")
          .insert(rows, { count: "exact" });
        if (insErr) {
          return new Response(`Falha ao inserir lançamentos: ${insErr.message}`, {
            status: 500,
          });
        }

        return Response.json({
          ok: true,
          inserted: count ?? rows.length,
          date: payload.data,
        });
      },
    },
  },
});
