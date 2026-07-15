import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";

const keyOf = (t: { data: string; valor: number; descricao: string }) =>
  `${t.data}_${t.valor.toFixed(2)}_${t.descricao.trim().slice(0, 80).toLowerCase()}`;

type Candidate = {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  cost_center_id: string;
  account_id: string;
  account_name: string | null;
};

type ParsedItem = {
  temp_id: string;
  data: string;
  descricao: string;
  valor: number;
  instituicao: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  suggested_account_id: string | null;
  suggested_account_name: string | null;
  dedupe_tag: string;
  status: "match" | "multiple" | "new" | "duplicate" | "no_cost_center";
  match_transaction_id: string | null;
  candidates: Candidate[];
};

export const parseOpenFinanceText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { text: string; default_cost_center_id?: string; default_account_id?: string }) =>
      z
        .object({
          text: z.string().trim().min(20).max(80000),
          default_cost_center_id: z.string().uuid().optional(),
          default_account_id: z.string().uuid().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: ParsedItem[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("LOVABLE_API_KEY ausente no servidor.");

    // 1) Carrega contas bancárias reais (dinâmico, sem IDs chumbados)
    const { data: bankAccountsRaw, error: baErr } = await context.supabase
      .from("bank_accounts")
      .select("id, name, bank, enterprise");
    if (baErr) throw new Error(baErr.message);
    const bankAccounts = (bankAccountsRaw ?? []) as Array<{
      id: string;
      name: string;
      bank: string | null;
      enterprise: string | null;
    }>;

    // 2) Centros de custo ativos por enterprise
    const { data: costCentersRaw } = await context.supabase
      .from("cost_centers")
      .select("id, name, code, enterprise, is_active");
    const costCenters = (costCentersRaw ?? []) as Array<{
      id: string;
      name: string;
      code: number | string | null;
      enterprise: string | null;
      is_active: boolean;
    }>;
    const ccById = new Map(costCenters.map((c) => [c.id, c]));
    const activeCcByEnterprise = new Map<string, typeof costCenters[number]>();
    for (const cc of costCenters) {
      if (cc.is_active && cc.enterprise && !activeCcByEnterprise.has(cc.enterprise)) {
        activeCcByEnterprise.set(cc.enterprise, cc);
      }
    }

    // Bank → default cost center (via enterprise)
    const defaultCcForBank = (ba: (typeof bankAccounts)[number]) =>
      ba.enterprise ? activeCcByEnterprise.get(ba.enterprise) ?? null : null;

    // 3) Contas contábeis ativas — catálogo por CC envolvido
    const { data: accountsAll, error: accErr } = await context.supabase
      .from("accounts")
      .select("id, name, kind, cost_center_id, is_active")
      .eq("is_active", true);
    if (accErr) throw new Error(accErr.message);
    const accByCc = new Map<string, Array<{ id: string; name: string; kind: string }>>();
    for (const a of accountsAll ?? []) {
      if (!a.cost_center_id) continue;
      const arr = accByCc.get(a.cost_center_id) ?? [];
      arr.push({ id: a.id, name: a.name, kind: a.kind });
      accByCc.set(a.cost_center_id, arr);
    }

    // Catálogo cobre TODOS os CCs ativos referenciados pelas contas bancárias +
    // o CC de fallback opcional
    const relevantCcIds = new Set<string>();
    for (const ba of bankAccounts) {
      const cc = defaultCcForBank(ba);
      if (cc) relevantCcIds.add(cc.id);
    }
    if (data.default_cost_center_id) relevantCcIds.add(data.default_cost_center_id);

    const catalog = Array.from(relevantCcIds)
      .map((ccId) => {
        const cc = ccById.get(ccId);
        const accs = accByCc.get(ccId) ?? [];
        if (!cc || accs.length === 0) return null;
        const lines = accs.map((a) => `  - "${a.name}" (${a.kind})`).join("\n");
        return `Centro de custo "${cc.name}":\n${lines}`;
      })
      .filter(Boolean)
      .join("\n\n");

    // 4) Lista de bancos apresentada à IA (dinâmica).
    const bankLabels = Array.from(
      new Set(
        bankAccounts
          .flatMap((ba) => [ba.bank ?? "", ba.name ?? ""])
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    );
    // "Outro" continua permitido como escape.
    const bankEnumValues = (bankLabels.length > 0
      ? [...bankLabels, "Outro"]
      : ["Outro"]) as unknown as [string, ...string[]];

    const ParsedTxSchema = z.object({
      transactions: z
        .array(
          z.object({
            data: z.string().describe("Data no formato YYYY-MM-DD."),
            descricao: z.string(),
            valor: z
              .number()
              .describe("POSITIVO para entradas/recebimentos; NEGATIVO para saídas."),
            instituicao: z
              .enum(bankEnumValues)
              .describe(
                "Nome EXATO de um dos bancos cadastrados na lista fornecida, ou 'Outro' se não reconhecer.",
              ),
            categoria_sugerida: z
              .string()
              .describe(
                "Nome EXATO de uma conta da lista fornecida para o centro de custo dessa linha. Se não houver correspondência clara, retorne string vazia.",
              )
              .default(""),
          }),
        )
        .max(500),
    });

    const gateway = createLovableAiGatewayProvider(key);
    const today = new Date().toISOString().slice(0, 10);

    const bankList = bankLabels.map((b) => `  - "${b}"`).join("\n");

    const { object } = await generateObject({
      model: gateway("google/gemini-3-flash-preview"),
      schema: ParsedTxSchema,
      system:
        "Você é um parser financeiro de extratos brasileiros do Meu Pluggy (Open Finance) multibancos. Para CADA linha, identifique de forma INDEPENDENTE: data, descrição, valor (positivo=entrada, negativo=saída) e a instituição — retornando o nome EXATO de um dos bancos da lista fornecida (ou 'Outro' se não reconhecer). Além disso, sugira a CATEGORIA usando EXATAMENTE um dos nomes da lista de contas do centro de custo daquele banco. Se não houver conta claramente adequada, retorne categoria_sugerida vazia. Nunca invente nomes de bancos nem de contas. Ignore cabeçalhos, totais e saldos.",
      prompt: `Data de hoje: ${today}.\n\nBANCOS CADASTRADOS (use o nome EXATO):\n${bankList}\n\nCATÁLOGO DE CONTAS POR CENTRO DE CUSTO:\n${catalog}\n\nTEXTO DO EXTRATO:\n${data.text}`,
    });

    const parsed = object.transactions.filter(
      (t) => Number.isFinite(t.valor) && t.valor !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(t.data),
    );

    if (parsed.length === 0) return { items: [] };

    // Match instituição → bank_account por bank ou name (case-insensitive)
    const findBankAccount = (label: string) => {
      if (!label || label === "Outro") return null;
      const norm = label.trim().toLowerCase();
      return (
        bankAccounts.find((ba) => (ba.bank ?? "").trim().toLowerCase() === norm) ||
        bankAccounts.find((ba) => (ba.name ?? "").trim().toLowerCase() === norm) ||
        null
      );
    };

    // Deduplicação por tag [OFIMP]
    const tags = parsed.map((t) => `[OFIMP ${keyOf(t)}]`);
    const { data: existingByTag } = await context.supabase
      .from("transactions")
      .select("description")
      .in("description", tags);
    const dupSet = new Set((existingByTag ?? []).map((r) => r.description as string));

    // Range global de datas ±3d
    const dates = parsed.map((t) => t.data).sort();
    const minDate = new Date(dates[0]);
    minDate.setDate(minDate.getDate() - 3);
    const maxDate = new Date(dates[dates.length - 1]);
    maxDate.setDate(maxDate.getDate() + 3);
    const rangeStart = minDate.toISOString().slice(0, 10);
    const rangeEnd = maxDate.toISOString().slice(0, 10);

    const { data: pendingTx } = await context.supabase
      .from("transactions")
      .select(
        "id, type, amount, due_date, cost_center_id, account_id, description, status, accounts(name)",
      )
      .neq("status", "reconciled")
      .gte("due_date", rangeStart)
      .lte("due_date", rangeEnd);

    type PendingRow = {
      id: string;
      type: "receivable" | "payable";
      amount: number;
      due_date: string;
      cost_center_id: string;
      account_id: string;
      description: string | null;
      status: string;
      accounts: { name: string } | null;
    };
    const pendings = (pendingTx ?? []) as unknown as PendingRow[];

    const items: ParsedItem[] = parsed.map((t, i) => {
      const tag = `[OFIMP ${keyOf(t)}]`;

      const ba = findBankAccount(t.instituicao);
      const cc = ba ? defaultCcForBank(ba) : null;
      const ccId = cc?.id ?? data.default_cost_center_id ?? null;
      const ccName = ccId ? ccById.get(ccId)?.name ?? null : null;

      // Categoria sugerida (por nome dentro do cc)
      let suggestedId: string | null = null;
      let suggestedName: string | null = null;
      if (ccId && t.categoria_sugerida) {
        const norm = t.categoria_sugerida.trim().toLowerCase();
        const list = accByCc.get(ccId) ?? [];
        const expectedKind = t.valor >= 0 ? "revenue" : "expense";
        const match =
          list.find((a) => a.name.toLowerCase() === norm && a.kind === expectedKind) ||
          list.find((a) => a.name.toLowerCase() === norm);
        if (match) {
          suggestedId = match.id;
          suggestedName = match.name;
        }
      }
      if (!suggestedId && data.default_account_id) {
        const fb = (accountsAll ?? []).find((a) => a.id === data.default_account_id);
        if (fb) {
          suggestedId = fb.id;
          suggestedName = fb.name;
        }
      }

      const baseItem = {
        temp_id: `t${i}`,
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        instituicao: t.instituicao,
        bank_account_id: ba?.id ?? null,
        bank_account_name: ba?.name ?? null,
        cost_center_id: ccId,
        cost_center_name: ccName,
        suggested_account_id: suggestedId,
        suggested_account_name: suggestedName,
        dedupe_tag: tag,
      };

      // Duplicado?
      const tagPrefixHit =
        dupSet.has(tag) ||
        (existingByTag ?? []).some((r) => (r.description as string).includes(tag));
      if (tagPrefixHit) {
        return {
          ...baseItem,
          status: "duplicate",
          match_transaction_id: null,
          candidates: [],
        };
      }

      if (!ccId) {
        return {
          ...baseItem,
          status: "no_cost_center",
          match_transaction_id: null,
          candidates: [],
        };
      }

      const expectedType: "receivable" | "payable" = t.valor >= 0 ? "receivable" : "payable";
      const absVal = Math.abs(t.valor);
      const txDate = new Date(t.data);
      const cands = pendings.filter((p) => {
        if (p.type !== expectedType) return false;
        if (Math.abs(Math.abs(Number(p.amount)) - absVal) > 0.01) return false;
        const d = new Date(p.due_date);
        const diff = Math.abs(d.getTime() - txDate.getTime()) / 86400000;
        return diff <= 3;
      });
      const sameCc = cands.filter((c) => c.cost_center_id === ccId);
      const finalCands = sameCc.length > 0 ? sameCc : cands;

      let status: ParsedItem["status"];
      let matchId: string | null = null;
      if (finalCands.length === 1) {
        status = "match";
        matchId = finalCands[0].id;
      } else if (finalCands.length > 1) {
        status = "multiple";
      } else {
        status = "new";
      }

      return {
        ...baseItem,
        status,
        match_transaction_id: matchId,
        candidates: finalCands.map((c) => ({
          id: c.id,
          description: c.description ?? "",
          amount: Number(c.amount),
          due_date: c.due_date,
          cost_center_id: c.cost_center_id,
          account_id: c.account_id,
          account_name: c.accounts?.name ?? null,
        })),
      };
    });

    return { items };
  });

const DecisionSchema = z.object({
  temp_id: z.string(),
  action: z.enum(["match", "create", "skip"]),
  data: z.string(),
  descricao: z.string(),
  valor: z.number(),
  instituicao: z.string(),
  bank_account_id: z.string().uuid().nullable(),
  cost_center_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  transaction_id: z.string().uuid().nullable(),
  dedupe_tag: z.string(),
});

export const confirmOpenFinanceImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { decisions: unknown }) =>
    z.object({ decisions: z.array(DecisionSchema).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let reconciled = 0;
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const dec of data.decisions) {
      if (dec.action === "skip") {
        skipped++;
        continue;
      }
      if (dec.action === "match") {
        if (!dec.transaction_id) {
          errors.push(`${dec.descricao}: sem transação alvo`);
          continue;
        }
        const { data: tx } = await context.supabase
          .from("transactions")
          .select("id, status")
          .eq("id", dec.transaction_id)
          .maybeSingle();
        if (!tx || tx.status === "reconciled") {
          errors.push(`${dec.descricao}: lançamento já conciliado ou inexistente`);
          skipped++;
          continue;
        }
        const paidAt = new Date(`${dec.data}T12:00:00Z`).toISOString();
        const updatePayload: {
          status: "reconciled";
          paid_at: string;
          bank_account_id?: string;
        } = { status: "reconciled", paid_at: paidAt };
        if (dec.bank_account_id) updatePayload.bank_account_id = dec.bank_account_id;
        const { error } = await context.supabase
          .from("transactions")
          .update(updatePayload)
          .eq("id", dec.transaction_id);
        if (error) {
          errors.push(`${dec.descricao}: ${error.message}`);
          continue;
        }
        reconciled++;
        continue;
      }
      // create
      if (!dec.cost_center_id || !dec.account_id) {
        errors.push(`${dec.descricao}: falta centro de custo ou categoria`);
        continue;
      }
      const description = `${dec.dedupe_tag} ${dec.instituicao} — ${dec.descricao}`.slice(0, 500);
      const { data: dup } = await context.supabase
        .from("transactions")
        .select("id")
        .ilike("description", `%${dec.dedupe_tag}%`)
        .limit(1);
      if (dup && dup.length > 0) {
        skipped++;
        continue;
      }
      const paidAt = new Date(`${dec.data}T12:00:00Z`).toISOString();
      const { error } = await context.supabase.from("transactions").insert({
        cost_center_id: dec.cost_center_id,
        account_id: dec.account_id,
        bank_account_id: dec.bank_account_id,
        type: dec.valor >= 0 ? "receivable" : "payable",
        amount: Math.abs(Number(dec.valor.toFixed(2))),
        description,
        due_date: dec.data,
        document_datetime: paidAt,
        status: "reconciled",
        paid_at: paidAt,
        created_by: context.userId,
      });
      if (error) {
        errors.push(`${dec.descricao}: ${error.message}`);
        continue;
      }
      created++;
    }

    return { reconciled, created, skipped, errors };
  });
