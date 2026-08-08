import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * POST /api/public/receber-pdv
 *
 * Recebe notas de compra do PDV do restaurante (projeto DineFlow) agregadas
 * por categoria e grava um lançamento por categoria em public.transactions.
 *
 * Autenticação: header `x-api-token` == secret PDV_SYNC_TOKEN.
 * Idempotência: of_dedupe_key = 'PDV:<chave_acesso|numero-serie>:<categoria>'
 * (índice único parcial em transactions.of_dedupe_key).
 */

const RESTAURANT_COST_CENTER_CODE = 2;

// categoria do PDV -> nome exato da conta contábil no CC RESTAURANTE
const CATEGORY_ACCOUNT_MAP: Record<string, string> = {
  insumos: "Compras A&B",
  material_limpeza: "Materiais de Consumo",
  utensilios: "Equipamentos e Ferramentas",
  pessoal_diarista: "Equipe Terceirizada",
  pessoal_fixo: "Equipe Fixa",
  consumo_equipe: "Consumo Equipe - Conta Corrente Operacao",
  gas: "Gás de Cozinha",
  taxa_cartao: "Taxas de Cartão",
  logistica: "Logística",
};
const FALLBACK_ACCOUNT = "Outros Custos";

const payloadSchema = z.object({
  chave_acesso: z.string().trim().min(1).max(64).nullable().optional(),
  numero: z.string().trim().min(1).max(30),
  serie: z.string().trim().min(1).max(10),
  fornecedor: z.object({
    nome: z.string().trim().min(1).max(200),
    cnpj: z.string().trim().min(1).max(30),
  }),
  data_emissao: z.string().trim().min(8).max(40),
  forma_pagamento: z.string().trim().min(1).max(80).nullable().optional(),
  conta_bancaria: z.string().trim().min(1).max(120),
  itens: z
    .array(
      z.object({
        categoria: z.string().trim().min(1).max(60),
        valor: z.number().finite().positive(),
        descricao: z.string().trim().min(1).max(300),
      }),
    )
    .min(1)
    .max(50),
});

const onlyDigits = (s: string) => s.replace(/\D/g, "");

export const Route = createFileRoute("/api/public/receber-pdv")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = process.env.PDV_SYNC_TOKEN;
        if (!token) {
          console.error("[receber-pdv] PDV_SYNC_TOKEN não configurado");
          return Response.json(
            { ok: false, erro: "Integração não configurada: secret PDV_SYNC_TOKEN ausente." },
            { status: 500 },
          );
        }

        const provided = request.headers.get("x-api-token");
        if (!provided || provided !== token) {
          console.warn("[receber-pdv] token inválido ou ausente");
          return Response.json(
            { ok: false, erro: "Token inválido. Envie o header x-api-token correto." },
            { status: 401 },
          );
        }

        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return Response.json(
            { ok: false, erro: "JSON inválido no corpo da requisição." },
            { status: 400 },
          );
        }

        const parsed = payloadSchema.safeParse(json);
        if (!parsed.success) {
          return Response.json(
            {
              ok: false,
              erro: "Payload malformado. Verifique os campos obrigatórios.",
              detalhes: parsed.error.flatten(),
            },
            { status: 400 },
          );
        }
        const nota = parsed.data;

        const emissao = new Date(nota.data_emissao);
        if (Number.isNaN(emissao.getTime())) {
          return Response.json(
            { ok: false, erro: "data_emissao inválida. Use formato ISO 8601." },
            { status: 400 },
          );
        }
        const documentDatetime = emissao.toISOString();
        const dueDate = documentDatetime.slice(0, 10);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Centro de custo RESTAURANTE
        const { data: costCenter, error: ccErr } = await supabaseAdmin
          .from("cost_centers")
          .select("id")
          .eq("code", RESTAURANT_COST_CENTER_CODE)
          .eq("enterprise", "restaurante")
          .maybeSingle();
        if (ccErr) {
          console.error("[receber-pdv] erro ao buscar centro de custo", ccErr.message);
          return Response.json(
            { ok: false, erro: "Erro ao buscar o centro de custo do Restaurante." },
            { status: 500 },
          );
        }
        if (!costCenter) {
          return Response.json(
            {
              ok: false,
              erro: "Centro de custo RESTAURANTE (código 2) não encontrado. Cadastre-o em Administração.",
            },
            { status: 422 },
          );
        }

        // Conta bancária por nome exato
        const { data: banks, error: bankErr } = await supabaseAdmin
          .from("bank_accounts")
          .select("id, name")
          .eq("is_active", true);
        if (bankErr || !banks) {
          console.error("[receber-pdv] erro ao buscar contas bancárias", bankErr?.message);
          return Response.json(
            { ok: false, erro: "Erro ao buscar as contas bancárias." },
            { status: 500 },
          );
        }
        const bank = banks.find((b) => b.name === nota.conta_bancaria);
        if (!bank) {
          return Response.json(
            {
              ok: false,
              erro: `Conta bancária "${nota.conta_bancaria}" não encontrada. Use exatamente um dos nomes válidos.`,
              contas_validas: banks.map((b) => b.name).sort(),
            },
            { status: 422 },
          );
        }

        // Plano de contas do restaurante
        const { data: accounts, error: accErr } = await supabaseAdmin
          .from("accounts")
          .select("id, name, kind, is_active")
          .eq("cost_center_id", costCenter.id)
          .eq("is_active", true);
        if (accErr || !accounts) {
          console.error("[receber-pdv] erro ao buscar plano de contas", accErr?.message);
          return Response.json(
            { ok: false, erro: "Erro ao buscar o plano de contas do Restaurante." },
            { status: 500 },
          );
        }
        const accountByName = new Map(accounts.map((a) => [a.name, a]));
        const fallbackAccount = accountByName.get(FALLBACK_ACCOUNT);

        // Fornecedor por CNPJ (só dígitos)
        const cnpj = onlyDigits(nota.fornecedor.cnpj);
        let contactId: string | null = null;
        const { data: contacts, error: contactErr } = await supabaseAdmin
          .from("contacts")
          .select("id, document_number");
        if (contactErr) {
          console.error("[receber-pdv] erro ao buscar contatos", contactErr.message);
          return Response.json(
            { ok: false, erro: "Erro ao buscar fornecedores." },
            { status: 500 },
          );
        }
        contactId =
          (contacts ?? []).find(
            (c) => c.document_number && onlyDigits(c.document_number) === cnpj,
          )?.id ?? null;

        if (!contactId && cnpj) {
          const { data: created, error: createErr } = await supabaseAdmin
            .from("contacts")
            .insert({
              name: nota.fornecedor.nome,
              type: "FORNECEDOR",
              document_type: cnpj.length === 11 ? "PF" : "PJ",
              document_number: cnpj,
              master_only: false,
            })
            .select("id")
            .single();
          if (createErr || !created) {
            console.error("[receber-pdv] erro ao criar fornecedor", createErr?.message);
            return Response.json(
              { ok: false, erro: "Não foi possível cadastrar o fornecedor recebido." },
              { status: 500 },
            );
          }
          contactId = created.id;
        }

        const baseKey = nota.chave_acesso
          ? `PDV:${nota.chave_acesso}`
          : `PDV:${nota.numero}-${nota.serie}`;

        const resultados: {
          categoria: string;
          transaction_id: string | null;
          situacao: "criado" | "ja_existia";
          aviso: string | null;
        }[] = [];

        for (const item of nota.itens) {
          const dedupeKey = `${baseKey}:${item.categoria}`;

          const { data: existing, error: existErr } = await supabaseAdmin
            .from("transactions")
            .select("id")
            .eq("of_dedupe_key", dedupeKey)
            .maybeSingle();
          if (existErr) {
            console.error("[receber-pdv] erro ao verificar duplicata", existErr.message);
            return Response.json(
              { ok: false, erro: "Erro ao verificar se a nota já foi importada." },
              { status: 500 },
            );
          }
          if (existing) {
            resultados.push({
              categoria: item.categoria,
              transaction_id: existing.id,
              situacao: "ja_existia",
              aviso: null,
            });
            continue;
          }

          const mappedName = CATEGORY_ACCOUNT_MAP[item.categoria];
          let account = mappedName ? accountByName.get(mappedName) : undefined;
          let aviso: string | null = null;
          if (!account) {
            account = fallbackAccount;
            aviso = mappedName
              ? `Conta "${mappedName}" não encontrada; lançado em "${FALLBACK_ACCOUNT}".`
              : `Categoria "${item.categoria}" não mapeada; lançada em "${FALLBACK_ACCOUNT}".`;
          }
          if (!account) {
            return Response.json(
              {
                ok: false,
                erro: `Conta contábil "${FALLBACK_ACCOUNT}" não existe no Restaurante. Cadastre-a no Plano de Contas.`,
              },
              { status: 422 },
            );
          }

          const { data: inserted, error: insErr } = await supabaseAdmin
            .from("transactions")
            .insert({
              cost_center_id: costCenter.id,
              account_id: account.id,
              bank_account_id: bank.id,
              contact_id: contactId,
              type: "payable",
              amount: Number(item.valor.toFixed(2)),
              description: `${item.descricao} (NFC-e ${nota.numero}/${nota.serie})`,
              document_datetime: documentDatetime,
              due_date: dueDate,
              status: "paid",
              paid_at: documentDatetime,
              payment_method: nota.forma_pagamento ?? null,
              of_dedupe_key: dedupeKey,
              is_batch: false,
              is_recurring: false,
              is_transfer: false,
            })
            .select("id")
            .single();

          if (insErr) {
            // Corrida: outra chamada inseriu a mesma chave (índice único).
            if (insErr.code === "23505") {
              const { data: raced } = await supabaseAdmin
                .from("transactions")
                .select("id")
                .eq("of_dedupe_key", dedupeKey)
                .maybeSingle();
              resultados.push({
                categoria: item.categoria,
                transaction_id: raced?.id ?? null,
                situacao: "ja_existia",
                aviso,
              });
              continue;
            }
            console.error("[receber-pdv] erro ao inserir lançamento", insErr.message);
            return Response.json(
              { ok: false, erro: `Falha ao gravar o lançamento: ${insErr.message}` },
              { status: 500 },
            );
          }

          resultados.push({
            categoria: item.categoria,
            transaction_id: inserted.id,
            situacao: "criado",
            aviso,
          });
        }

        console.log(
          "[receber-pdv]",
          JSON.stringify({
            chave_acesso: nota.chave_acesso ?? `${nota.numero}-${nota.serie}`,
            itens: nota.itens.length,
            criados: resultados.filter((r) => r.situacao === "criado").length,
            ja_existiam: resultados.filter((r) => r.situacao === "ja_existia").length,
          }),
        );

        return Response.json({ ok: true, resultados });
      },
    },
  },
});
