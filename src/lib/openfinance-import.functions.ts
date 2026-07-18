import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway.server";


// ============================================================================
// PARSER DETERMINÍSTICO (sem IA) para extrato do Meu Pluggy
// ============================================================================

const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, "março": 3, marco: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const WEEKDAYS_PT = new Set([
  "segunda-feira", "terça-feira", "terca-feira", "quarta-feira", "quinta-feira",
  "sexta-feira", "sábado", "sabado", "domingo",
]);

// Bancos reconhecidos textualmente no extrato. Chave = string alvo, valor = alias canônico (para casar com bank_accounts.bank/name).
const BANK_ALIASES: Array<{ match: RegExp; canonical: string }> = [
  { match: /mercado\s*pago/i, canonical: "Mercado Pago" },
  { match: /infinite\s*pay/i, canonical: "InfinitePay" },
  { match: /sicoob/i, canonical: "Sicoob" },
  { match: /c6\s*bank/i, canonical: "C6 Bank" },
  { match: /pagseguro|pagbank/i, canonical: "PagBank" },
  { match: /nubank/i, canonical: "Nubank" },
  { match: /asaas/i, canonical: "Asaas" },
  { match: /banco\s*inter\b|^inter$/i, canonical: "Banco Inter" },
];

const NOISE_PATTERNS = [
  /^despesas\s+futuras/i,
  /^nenhuma/i,
  /^\d+\s*transaç/i,
  /^saldo\s*:/i,
  /^total\b/i,
  /^fluxo\s+de\s+caixa/i,
  /^categorias?\s*:/i,
  /^conta\s*:/i,
  /^filtro/i,
  /^exportar/i,
  /^·+$/,
];

type RawTx = {
  data: string; // YYYY-MM-DD
  descricao: string;
  banco_txt: string; // texto exato do banco encontrado
  banco_canonical: string;
  pluggy_category: string;
  valor: number; // sinal
};

function detectBank(line: string): { canonical: string; text: string } | null {
  for (const b of BANK_ALIASES) {
    if (b.match.test(line)) return { canonical: b.canonical, text: line.trim() };
  }
  return null;
}

// Parse value line: "+R$ 90", "R$ -150,00", "R$ 32 052,98", "-R$ 1.234,56"
const VALUE_LINE_RE = /^([+\-])?\s*R\$\s*(-)?\s*([\d\.\s]+)(?:,(\d{1,2}))?\s*$/;
function parseValue(line: string): number | null {
  const m = line.match(VALUE_LINE_RE);
  if (!m) return null;
  const sign1 = m[1] === "-" ? -1 : 1;
  const sign2 = m[2] === "-" ? -1 : 1;
  const intPart = (m[3] || "").replace(/[\.\s]/g, "");
  const decPart = m[4] || "00";
  if (!intPart) return null;
  const n = parseFloat(`${intPart}.${decPart.padEnd(2, "0")}`);
  if (!Number.isFinite(n)) return null;
  return sign1 * sign2 * n;
}

function parseMonthHeader(line: string): { month: number; year: number } | null {
  const m = line.match(/^([A-Za-zçãéóíúÀ-ÿ]+)\s+de\s+(\d{4})$/i);
  if (!m) return null;
  const monthName = m[1].toLowerCase().normalize("NFC");
  const month = MONTHS_PT[monthName] ?? MONTHS_PT[monthName.replace("ç", "c")];
  if (!month) return null;
  return { month, year: parseInt(m[2], 10) };
}

function toIso(y: number, m: number, d: number): string {
  return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d
    .toString()
    .padStart(2, "0")}`;
}

export function parseStatementText(text: string): RawTx[] {
  const rawLines = text.split(/\r?\n/).map((l) => l.trim());
  const lines: string[] = [];
  for (const l of rawLines) {
    if (!l) continue;
    if (NOISE_PATTERNS.some((r) => r.test(l))) continue;
    lines.push(l);
  }

  let year: number | null = null;
  let month: number | null = null;
  let day: number | null = null;
  let prevDay: number | null = null;

  const results: RawTx[] = [];
  // Buffer: linhas desde o último "evento" (fim de transação ou nova data)
  let buffer: string[] = [];
  let currentBank: { canonical: string; text: string } | null = null;
  let bankIdx = -1; // índice no buffer onde o banco foi detectado

  const flushOnValue = (val: number) => {
    if (!year || !month || !day) return;
    // Precisamos de banco
    if (!currentBank || bankIdx < 0) return;
    // descrição = linhas antes do banco (junte)
    const descLines = buffer.slice(0, bankIdx).filter((l) => l && l !== "·");
    // categoria = linhas depois do banco (ignorando "·")
    const catLines = buffer.slice(bankIdx + 1).filter((l) => l && l !== "·");
    const descricao = descLines.join(" ").replace(/\s+/g, " ").trim();
    const pluggy_category = catLines.join(" ").replace(/\s+/g, " ").trim();
    results.push({
      data: toIso(year, month, day),
      descricao: descricao || currentBank.text,
      banco_txt: currentBank.text,
      banco_canonical: currentBank.canonical,
      pluggy_category,
      valor: val,
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Cabeçalho de mês
    const mh = parseMonthHeader(line);
    if (mh) {
      month = mh.month;
      year = mh.year;
      prevDay = null;
      buffer = [];
      currentBank = null;
      bankIdx = -1;
      continue;
    }

    // Dia + weekday
    const dayMatch = line.match(/^(\d{1,2})$/);
    if (dayMatch) {
      const next = lines[i + 1] ?? "";
      const nextNorm = next.toLowerCase().normalize("NFC");
      if (WEEKDAYS_PT.has(nextNorm) || WEEKDAYS_PT.has(nextNorm.replace("á", "a"))) {
        const d = parseInt(dayMatch[1], 10);
        if (d >= 1 && d <= 31 && month && year) {
          if (prevDay !== null && d > prevDay) {
            // rollover: mês anterior
            month -= 1;
            if (month < 1) {
              month = 12;
              year -= 1;
            }
          }
          day = d;
          prevDay = d;
          i++; // consumir weekday
          buffer = [];
          currentBank = null;
          bankIdx = -1;
          continue;
        }
      }
    }

    // Valor → fecha transação
    const v = parseValue(line);
    if (v !== null && v !== 0) {
      flushOnValue(v);
      buffer = [];
      currentBank = null;
      bankIdx = -1;
      continue;
    }

    // Banco?
    const b = detectBank(line);
    if (b) {
      currentBank = b;
      bankIdx = buffer.length;
      buffer.push(line);
      continue;
    }

    buffer.push(line);
  }

  return results;
}

// ============================================================================
// Server-side: parseOpenFinanceText + confirmOpenFinanceImport
// ============================================================================

// Chave robusta: data + valor_abs + bank_account_id + occurrence_idx (dentro do extrato).
// Preserva duplicatas legítimas (ex: duas diárias de R$ 100 no mesmo dia = idx 0 e 1 = duas txs distintas),
// mas re-importar o mesmo extrato reconhece as mesmas ocorrências e não duplica.
const buildDedupeKey = (data: string, valorAbs: number, bankAccountId: string | null, idx: number) =>
  `${data}|${valorAbs.toFixed(2)}|${bankAccountId ?? "nobank"}|${idx}`;

// Chave legada para fallback contra transações já importadas antes da coluna of_dedupe_key.
const legacyKeyOf = (t: { data: string; valor: number; descricao: string }) =>
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

export type ParsedItem = {
  temp_id: string;
  data: string;
  descricao: string;
  valor: number;
  instituicao: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  pluggy_category: string;
  suggested_account_id: string | null;
  suggested_account_name: string | null;
  dedupe_tag: string;        // "[OFIMP <legacy>]" — mantido p/ descrição
  of_dedupe_key: string;     // chave nova robusta gravada em transactions.of_dedupe_key
  occurrence_idx: number;
  status:
    | "match"
    | "multiple"
    | "new"
    | "duplicate"
    | "no_cost_center"
    | "internal"
    | "aporte"
    | "aporte_incomplete";
  match_transaction_id: string | null;
  candidates: Candidate[];
  // Para aportes
  pair_temp_id: string | null;
  transfer_source_cc_id: string | null;
  transfer_source_cc_name: string | null;
  transfer_source_bank_account_id: string | null;
  transfer_target_cc_id: string | null;
  transfer_target_cc_name: string | null;
  transfer_target_bank_account_id: string | null;
  incomplete_side: "source" | "target" | null;
};


const isSamePersonTransfer = (cat: string) =>
  /same\s*person\s*transfer|transfer[^a-z]*same|transfer[^a-z]*person|transferência\s+entre|entre\s+contas\s+próprias/i.test(
    cat,
  );

const isInvestmentNoise = (cat: string, desc: string) =>
  /investment/i.test(cat) ||
  /libera[çc][ãa]o\s+de\s+dinheiro|resgate|aplica[çc][ãa]o/i.test(desc);

// ============================================================================
// DE-PARA determinístico: Pluggy category -> padrões de conta contábil
// ============================================================================
type MapKind = "revenue" | "expense" | "both";
const CATEGORY_MAP: Array<{ match: RegExp; kind: MapKind; accountPatterns: RegExp[] }> = [
  { match: /groceries|food\s*and\s*drinks|supermercado|mercado|alimento/i, kind: "expense",
    accountPatterns: [/alimento/i, /insumo/i, /mercado/i, /suprimento/i, /alimenta/i] },
  { match: /restaurant|refei[çc]/i, kind: "expense",
    accountPatterns: [/alimenta/i, /restaurante/i, /refei[çc]/i] },
  { match: /^taxes?\b|imposto|tributo|iss\b|icms|pis|cofins|irrf|inss/i, kind: "expense",
    accountPatterns: [/imposto/i, /tributo/i, /^taxa/i, /iss\b|icms|pis|cofins|irrf|inss/i] },
  { match: /non[- ]?recurring\s*income|recurring\s*income|receita|venda|faturamento/i, kind: "revenue",
    accountPatterns: [/faturamento/i, /venda/i, /receita/i] },
  { match: /gas\s*stations?|combust|posto/i, kind: "expense",
    accountPatterns: [/combust/i, /gasolina/i, /diesel/i, /posto/i] },
  { match: /health\s*insurance|plano\s*de\s*sa[uú]de/i, kind: "expense",
    accountPatterns: [/sa[uú]de/i, /plano/i, /benef[ií]cio/i] },
  { match: /pharmacy|farm[aá]cia|drogaria/i, kind: "expense",
    accountPatterns: [/farm[aá]cia/i, /medicamento/i, /sa[uú]de/i] },
  { match: /digital\s*services|software|streaming|subscription|assinatura/i, kind: "expense",
    accountPatterns: [/digital/i, /software/i, /assinatura/i, /internet/i, /tecnologia/i] },
  { match: /marketing|ads?\b|an[uú]ncio/i, kind: "expense",
    accountPatterns: [/marketing/i, /publicidade/i, /an[uú]ncio/i, /propaganda/i] },
  { match: /^services\b|servi[çc]os?/i, kind: "expense",
    accountPatterns: [/servi[çc]os?\s+de\s+terceiros?/i, /servi[çc]o/i, /prestador/i] },
  { match: /shopping|materia(l|is)|escrit[oó]rio|papelaria/i, kind: "expense",
    accountPatterns: [/material/i, /escrit[oó]rio/i, /despesas?\s+gerais/i, /papelaria/i] },
  { match: /salary|sal[aá]rio|folha|payroll/i, kind: "expense",
    accountPatterns: [/sal[aá]rio/i, /folha/i, /pessoal/i, /pr[oó]-labore/i] },
  { match: /utilit|energia|luz|el[eé]trica|[aá]gua|water|electricity/i, kind: "expense",
    accountPatterns: [/energia|luz|el[eé]trica/i, /[aá]gua/i, /utilidade/i, /concession/i] },
  { match: /transport|uber|99\s*pop|taxi|t[aá]xi/i, kind: "expense",
    accountPatterns: [/transporte/i, /viagem/i, /combust/i] },
  { match: /bank\s*fees?|tarifa|taxa\s*banc/i, kind: "expense",
    accountPatterns: [/tarifa/i, /banc[aá]ria/i, /taxa\s*banc/i, /despesa\s*banc/i] },
  { match: /loan|empr[eé]stimo|financ/i, kind: "expense",
    accountPatterns: [/empr[eé]stimo/i, /financ/i, /juros/i] },
  { match: /rent|aluguel/i, kind: "expense",
    accountPatterns: [/aluguel/i, /loca[çc][ãa]o/i] },
  { match: /telecom|celular|telefon|internet/i, kind: "expense",
    accountPatterns: [/telefon/i, /celular/i, /internet/i, /telecom/i] },
];

function matchAccountByDictionary(
  pluggyCategory: string,
  kind: "revenue" | "expense",
  list: Array<{ id: string; name: string; kind: string }>,
): { id: string; name: string } | null {
  if (!pluggyCategory) return null;
  const candidates = list.filter((a) => a.kind === kind);
  if (candidates.length === 0) return null;
  for (const row of CATEGORY_MAP) {
    if (row.kind !== "both" && row.kind !== kind) continue;
    if (!row.match.test(pluggyCategory)) continue;
    for (const pat of row.accountPatterns) {
      const hit = candidates.find((a) => pat.test(a.name));
      if (hit) return { id: hit.id, name: hit.name };
    }
  }
  return null;
}

export const parseOpenFinanceText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(

    (d: { text: string; default_cost_center_id?: string; default_account_id?: string }) =>
      z
        .object({
          text: z.string().trim().min(20).max(500000),
          default_cost_center_id: z.string().uuid().optional(),
          default_account_id: z.string().uuid().optional(),
        })
        .parse(d),
  )
  .handler(async ({ data, context }): Promise<{
    items: ParsedItem[];
    stats: { from_dictionary: number; from_ai: number; pending: number };
  }> => {

    // 1) Contas bancárias
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

    // 2) Centros de custo ativos
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
    const activeCcByEnterprise = new Map<string, (typeof costCenters)[number]>();
    for (const cc of costCenters) {
      if (cc.is_active && cc.enterprise && !activeCcByEnterprise.has(cc.enterprise)) {
        activeCcByEnterprise.set(cc.enterprise, cc);
      }
    }
    const defaultCcForBank = (ba: (typeof bankAccounts)[number]) =>
      ba.enterprise ? activeCcByEnterprise.get(ba.enterprise) ?? null : null;

    // 3) Contas contábeis por CC
    const { data: accountsAll } = await context.supabase
      .from("accounts")
      .select("id, name, kind, cost_center_id, is_active")
      .eq("is_active", true);
    const accByCc = new Map<string, Array<{ id: string; name: string; kind: string }>>();
    for (const a of accountsAll ?? []) {
      if (!a.cost_center_id) continue;
      const arr = accByCc.get(a.cost_center_id) ?? [];
      arr.push({ id: a.id, name: a.name, kind: a.kind });
      accByCc.set(a.cost_center_id, arr);
    }

    // 4) Parser determinístico
    const rawTxs = parseStatementText(data.text);

    if (rawTxs.length === 0)
      return { items: [], stats: { from_dictionary: 0, from_ai: 0, pending: 0 } };


    // 5) Match banco canonical -> bank_account. Sicoob prefere ghr_jk (default), mas mantém.
    const findBankAccount = (canonical: string) => {
      const norm = canonical.trim().toLowerCase();
      // preferência: match exato pelo campo bank
      const exact = bankAccounts.find((ba) => (ba.bank ?? "").trim().toLowerCase() === norm);
      if (exact) return exact;
      return bankAccounts.find((ba) => (ba.name ?? "").trim().toLowerCase() === norm) ?? null;
    };

    // 6) Match banco + occurrence_idx dentro do extrato (para dedupe robusta)
    type WithBank = { raw: RawTx; ba: (typeof bankAccounts)[number] | null; idx: number };
    const withBank: WithBank[] = rawTxs.map((t) => ({ raw: t, ba: findBankAccount(t.banco_canonical), idx: 0 }));
    // Ordena por data para determinismo antes de contar ocorrências
    const orderedIdx = withBank
      .map((_, i) => i)
      .sort((a, b) => {
        const wa = withBank[a], wb = withBank[b];
        if (wa.raw.data !== wb.raw.data) return wa.raw.data < wb.raw.data ? -1 : 1;
        return a - b;
      });
    const occCounter = new Map<string, number>();
    for (const i of orderedIdx) {
      const w = withBank[i];
      const tripleKey = `${w.raw.data}|${Math.abs(w.raw.valor).toFixed(2)}|${w.ba?.id ?? "nobank"}`;
      const n = occCounter.get(tripleKey) ?? 0;
      w.idx = n;
      occCounter.set(tripleKey, n + 1);
    }

    // Contar quantas transações JÁ EXISTENTES no banco compartilham cada triple (data, valor_abs, bank_account_id)
    // dentro do range do extrato — as N primeiras ocorrências do extrato viram duplicatas.
    const dates = rawTxs.map((t) => t.data).sort();
    const rangeStart = dates[0];
    const rangeEnd = dates[dates.length - 1];
    const bankIds = Array.from(new Set(withBank.map((w) => w.ba?.id).filter(Boolean))) as string[];

    // Chaves novas geradas neste extrato — usadas p/ verificar match direto via of_dedupe_key
    const newKeys = withBank.map((w) =>
      buildDedupeKey(w.raw.data, Math.abs(w.raw.valor), w.ba?.id ?? null, w.idx),
    );

    // (a) Match direto por of_dedupe_key
    const { data: existingByKey } = await context.supabase
      .from("transactions")
      .select("of_dedupe_key")
      .in("of_dedupe_key", newKeys);
    const dupKeySet = new Set(
      (existingByKey ?? []).map((r) => (r as { of_dedupe_key: string }).of_dedupe_key),
    );

    // (b) Contagem por triple (legacy + novos) para desempatar duplicatas em quem não tem of_dedupe_key
    const tripleExistingCount = new Map<string, number>();
    if (bankIds.length > 0) {
      const { data: rowsInRange } = await context.supabase
        .from("transactions")
        .select("due_date, amount, bank_account_id, of_dedupe_key, description")
        .in("bank_account_id", bankIds)
        .gte("due_date", rangeStart)
        .lte("due_date", rangeEnd);
      for (const r of (rowsInRange ?? []) as Array<{
        due_date: string; amount: number; bank_account_id: string;
      }>) {
        const k = `${r.due_date}|${Math.abs(Number(r.amount)).toFixed(2)}|${r.bank_account_id}`;
        tripleExistingCount.set(k, (tripleExistingCount.get(k) ?? 0) + 1);
      }
    }

    // Fallback legacy [OFIMP <legacyKey>] — cobre transações antigas sem of_dedupe_key
    const legacyTags = rawTxs.map((t) => `[OFIMP ${legacyKeyOf(t)}]`);
    const legacyDupSet = new Set<string>();
    if (legacyTags.length > 0) {
      const { data: legacy } = await context.supabase
        .from("transactions")
        .select("description")
        .or(legacyTags.map((tag) => `description.ilike.%${tag}%`).join(","))
        .limit(500);
      for (const r of (legacy ?? []) as Array<{ description: string }>) {
        for (const tag of legacyTags) if (r.description?.includes(tag)) legacyDupSet.add(tag);
      }
    }

    // 7) Pendentes para matching (range ±3d)
    const minDate = new Date(rangeStart); minDate.setDate(minDate.getDate() - 3);
    const maxDate = new Date(rangeEnd); maxDate.setDate(maxDate.getDate() + 3);
    const pendRangeStart = minDate.toISOString().slice(0, 10);
    const pendRangeEnd = maxDate.toISOString().slice(0, 10);

    const { data: pendingTx } = await context.supabase
      .from("transactions")
      .select(
        "id, type, amount, due_date, cost_center_id, account_id, description, status, accounts(name)",
      )
      .neq("status", "reconciled")
      .gte("due_date", pendRangeStart)
      .lte("due_date", pendRangeEnd);

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

    // ========================================================================
    // Fase 1: montar items base com bank_account/cc resolvidos + chaves
    // ========================================================================
    type Base = {
      temp_id: string;
      raw: RawTx;
      legacyTag: string;
      dedupeKey: string;
      occurrenceIdx: number;
      isDup: boolean;
      ba: (typeof bankAccounts)[number] | null;
      cc: { id: string; name: string } | null;
      isTransfer: boolean;
      isInvestment: boolean;
    };
    // Contador auxiliar para "consumir" duplicatas restantes por triple no extrato
    const tripleSeen = new Map<string, number>();
    const bases: Base[] = withBank.map((w, i) => {
      const t = w.raw;
      const ba = w.ba;
      const ccRaw = ba ? defaultCcForBank(ba) : null;
      const ccId = ccRaw?.id ?? data.default_cost_center_id ?? null;
      const ccName = ccId ? ccById.get(ccId)?.name ?? null : null;
      const dedupeKey = buildDedupeKey(t.data, Math.abs(t.valor), ba?.id ?? null, w.idx);
      const legacyTag = `[OFIMP ${legacyKeyOf(t)}]`;
      const tripleKey = `${t.data}|${Math.abs(t.valor).toFixed(2)}|${ba?.id ?? "nobank"}`;
      const seenSoFar = tripleSeen.get(tripleKey) ?? 0;
      tripleSeen.set(tripleKey, seenSoFar + 1);
      // dup direto? (match por chave nova) OU legacy? OU (temos ba e a contagem existente cobre esta ocorrência)
      const dupByKey = dupKeySet.has(dedupeKey);
      const dupByLegacy = legacyDupSet.has(legacyTag);
      const existingForTriple = ba ? tripleExistingCount.get(tripleKey) ?? 0 : 0;
      const dupByCount = ba ? seenSoFar < existingForTriple : false;
      const isDup = dupByKey || dupByLegacy || dupByCount;

      return {
        temp_id: `t${i}`,
        raw: t,
        legacyTag,
        dedupeKey,
        occurrenceIdx: w.idx,
        isDup,
        ba,
        cc: ccId && ccName ? { id: ccId, name: ccName } : null,
        isTransfer: isSamePersonTransfer(t.pluggy_category),
        isInvestment: isInvestmentNoise(t.pluggy_category, t.descricao),
      };
    });


    // ========================================================================
    // Fase 2: parear same-person transfers
    // ========================================================================
    const pairedWith = new Map<string, string>(); // temp_id -> par temp_id
    const transferPositives = bases.filter((b) => b.isTransfer && b.raw.valor > 0);
    const transferNegatives = bases.filter((b) => b.isTransfer && b.raw.valor < 0);
    const usedPos = new Set<string>();
    for (const neg of transferNegatives) {
      const negDate = new Date(neg.raw.data).getTime();
      const negAbs = Math.abs(neg.raw.valor);
      const match = transferPositives.find((pos) => {
        if (usedPos.has(pos.temp_id)) return false;
        if (Math.abs(Math.abs(pos.raw.valor) - negAbs) > 0.01) return false;
        const posDate = new Date(pos.raw.data).getTime();
        return Math.abs(posDate - negDate) / 86400000 <= 1;
      });
      if (match) {
        pairedWith.set(neg.temp_id, match.temp_id);
        pairedWith.set(match.temp_id, neg.temp_id);
        usedPos.add(match.temp_id);
      }
    }

    // ========================================================================
    // Fase 3: montar ParsedItem[]
    // ========================================================================
    const items: ParsedItem[] = bases.map((b) => {
      const t = b.raw;
      const instituicao = b.raw.banco_canonical;
      const bankName = b.ba?.name ?? null;

      // categoria sugerida
      let suggestedId: string | null = null;
      let suggestedName: string | null = null;
      if (b.cc) {
        const list = accByCc.get(b.cc.id) ?? [];
        const expectedKind = t.valor >= 0 ? "revenue" : "expense";
        // heurística fraca: sem IA, só sugere se houver 1 única conta desse kind
        const sameKind = list.filter((a) => a.kind === expectedKind);
        if (sameKind.length === 1) {
          suggestedId = sameKind[0].id;
          suggestedName = sameKind[0].name;
        }
      }
      // fallback global (default_account_id) fica para a Fase 6, depois do dicionário + IA



      const base = {
        temp_id: b.temp_id,
        data: t.data,
        descricao: t.descricao,
        valor: t.valor,
        instituicao,
        bank_account_id: b.ba?.id ?? null,
        bank_account_name: bankName,
        cost_center_id: b.cc?.id ?? null,
        cost_center_name: b.cc?.name ?? null,
        pluggy_category: t.pluggy_category,
        suggested_account_id: suggestedId,
        suggested_account_name: suggestedName,
        dedupe_tag: b.legacyTag,
        of_dedupe_key: b.dedupeKey,
        occurrence_idx: b.occurrenceIdx,
        pair_temp_id: null as string | null,
        transfer_source_cc_id: null as string | null,
        transfer_source_cc_name: null as string | null,
        transfer_source_bank_account_id: null as string | null,
        transfer_target_cc_id: null as string | null,
        transfer_target_cc_name: null as string | null,
        transfer_target_bank_account_id: null as string | null,
        incomplete_side: null as "source" | "target" | null,
      };

      // Duplicado (chave nova, legacy ou contagem)
      if (b.isDup) {
        return {
          ...base,
          status: "duplicate" as const,
          match_transaction_id: null,
          candidates: [],
        };
      }


      // Investment noise
      if (b.isInvestment) {
        return {
          ...base,
          status: "internal" as const,
          match_transaction_id: null,
          candidates: [],
        };
      }

      // Same person transfer — SOMENTE se a categoria Pluggy for de transferência entre contas próprias.
      // Qualquer outra categoria (Taxes, Services, etc.) NUNCA pode entrar no ramo de aporte.
      if (b.isTransfer && isSamePersonTransfer(t.pluggy_category)) {
        const pairId = pairedWith.get(b.temp_id) ?? null;
        if (pairId) {
          const partner = bases.find((x) => x.temp_id === pairId)!;
          const negLeg = b.raw.valor < 0 ? b : partner;
          const posLeg = b.raw.valor > 0 ? b : partner;
          const sourceCc = negLeg.cc;
          const targetCc = posLeg.cc;
          const sameCc =
            sourceCc && targetCc && sourceCc.id === targetCc.id;
          if (sameCc) {
            return {
              ...base,
              status: "internal" as const,
              match_transaction_id: null,
              candidates: [],
              pair_temp_id: pairId,
            };
          }
          // Aporte
          return {
            ...base,
            status: "aporte" as const,
            match_transaction_id: null,
            candidates: [],
            pair_temp_id: pairId,
            transfer_source_cc_id: sourceCc?.id ?? null,
            transfer_source_cc_name: sourceCc?.name ?? null,
            transfer_source_bank_account_id: negLeg.ba?.id ?? null,
            transfer_target_cc_id: targetCc?.id ?? null,
            transfer_target_cc_name: targetCc?.name ?? null,
            transfer_target_bank_account_id: posLeg.ba?.id ?? null,
          };
        }
        // Sem par no lote
        const isNeg = b.raw.valor < 0;
        return {
          ...base,
          status: "aporte_incomplete" as const,
          match_transaction_id: null,
          candidates: [],
          transfer_source_cc_id: isNeg ? b.cc?.id ?? null : null,
          transfer_source_cc_name: isNeg ? b.cc?.name ?? null : null,
          transfer_source_bank_account_id: isNeg ? b.ba?.id ?? null : null,
          transfer_target_cc_id: isNeg ? null : b.cc?.id ?? null,
          transfer_target_cc_name: isNeg ? null : b.cc?.name ?? null,
          transfer_target_bank_account_id: isNeg ? null : b.ba?.id ?? null,
          incomplete_side: isNeg ? "source" : "target",
        };
      }


      if (!b.cc) {
        return {
          ...base,
          status: "no_cost_center" as const,
          match_transaction_id: null,
          candidates: [],
        };
      }

      // Matching regular
      const expectedType: "receivable" | "payable" = t.valor >= 0 ? "receivable" : "payable";
      const absVal = Math.abs(t.valor);
      const txDate = new Date(t.data);
      const cands = pendings.filter((p) => {
        if (p.type !== expectedType) return false;
        if (Math.abs(Math.abs(Number(p.amount)) - absVal) > 0.01) return false;
        const d = new Date(p.due_date);
        return Math.abs(d.getTime() - txDate.getTime()) / 86400000 <= 3;
      });
      const sameCc = cands.filter((c) => c.cost_center_id === b.cc!.id);
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
        ...base,
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

    // ========================================================================
    // Fase 4: preencher categoria (suggested_account_id) — de-para determinístico
    // ========================================================================
    let fromDict = 0;
    let fromAi = 0;
    for (const it of items) {
      if (it.status !== "new" && it.status !== "multiple") continue;
      if (!it.cost_center_id || it.suggested_account_id) continue;
      const list = accByCc.get(it.cost_center_id) ?? [];
      const kind: "revenue" | "expense" = it.valor >= 0 ? "revenue" : "expense";
      const hit = matchAccountByDictionary(it.pluggy_category, kind, list);
      if (hit) {
        it.suggested_account_id = hit.id;
        it.suggested_account_name = hit.name;
        fromDict++;
      }
    }

    // ========================================================================
    // Fase 5: IA em LOTES pequenos (≤40) — só para o que sobrou. Nunca manda o
    // extrato bruto; só a linha já estruturada + as contas contábeis do CC dela.
    // ========================================================================
    const needAi = items.filter(
      (it) =>
        (it.status === "new" || it.status === "multiple") &&
        it.cost_center_id &&
        !it.suggested_account_id,
    );
    const apiKey = process.env.LOVABLE_API_KEY;
    if (apiKey && needAi.length > 0) {
      const gateway = createLovableAiGatewayProvider(apiKey);
      const model = gateway("google/gemini-3-flash-preview");
      const BATCH = 40;
      const CONCURRENCY = 8;

      function buildBatch(chunk: typeof needAi, batchIndex: number) {
        const payload = chunk.map((it) => {
          const list = accByCc.get(it.cost_center_id!) ?? [];
          const kind: "revenue" | "expense" = it.valor >= 0 ? "revenue" : "expense";
          const opts = list
            .filter((a) => a.kind === kind)
            .slice(0, 40)
            .map((a) => ({ id: a.id, name: a.name }));
          return {
            temp_id: it.temp_id,
            descricao: it.descricao.slice(0, 160),
            pluggy_category: it.pluggy_category.slice(0, 80),
            kind,
            cost_center: it.cost_center_name,
            options: opts,
          };
        });
        return { batchIndex, payload };
      }

      const batches: Array<ReturnType<typeof buildBatch>> = [];
      for (let i = 0; i < needAi.length; i += BATCH) {
        batches.push(buildBatch(needAi.slice(i, i + BATCH), i / BATCH + 1));
      }

      const runBatch = async (b: ReturnType<typeof buildBatch>) => {
        const { object } = await generateObject({
          model,
          schema: z.object({
            assignments: z.array(
              z.object({
                temp_id: z.string(),
                account_id: z.string().nullable(),
              }),
            ),
          }),
          prompt:
            "Você é um classificador contábil. Para cada item, escolha o UUID da conta contábil mais apropriada entre 'options'. " +
            "Respeite o kind (revenue/expense). Se nenhuma opção couber com confiança, retorne account_id=null. " +
            "Nunca invente UUIDs — copie exatamente de 'options'.\n\n" +
            "ITENS:\n" +
            JSON.stringify(b.payload),
        });
        const validIds = new Set<string>();
        for (const p of b.payload) for (const o of p.options) validIds.add(o.id);
        for (const a of object.assignments ?? []) {
          if (!a.account_id || !validIds.has(a.account_id)) continue;
          const it = items.find((x) => x.temp_id === a.temp_id);
          if (!it || it.suggested_account_id) continue;
          const list = accByCc.get(it.cost_center_id!) ?? [];
          const acc = list.find((x) => x.id === a.account_id);
          if (!acc) continue;
          it.suggested_account_id = acc.id;
          it.suggested_account_name = acc.name;
          fromAi++;
        }
      };

      // Ondas de até CONCURRENCY lotes simultâneos; falha por lote não derruba os demais.
      for (let w = 0; w < batches.length; w += CONCURRENCY) {
        const wave = batches.slice(w, w + CONCURRENCY);
        const results = await Promise.allSettled(wave.map(runBatch));
        results.forEach((r, idx) => {
          if (r.status === "rejected") {
            console.error(
              `[OFIMP] IA batch ${wave[idx].batchIndex} falhou:`,
              r.reason instanceof Error ? r.reason.message : r.reason,
            );
          }
        });
      }
    }

    // ========================================================================
    // Fase 6: fallback global (default_account_id se ainda vazio)
    // ========================================================================
    if (data.default_account_id) {
      const fb = (accountsAll ?? []).find((a) => a.id === data.default_account_id);
      // Contas de "Aporte*" pertencem exclusivamente ao fluxo de aporte — nunca usar como fallback de categoria comum.
      if (fb && !/aporte/i.test(fb.name)) {
        for (const it of items) {
          if ((it.status === "new" || it.status === "multiple") && !it.suggested_account_id) {
            it.suggested_account_id = fb.id;
            it.suggested_account_name = fb.name;
          }
        }
      }
    }


    const pending = items.filter(
      (it) => (it.status === "new" || it.status === "multiple") && !it.suggested_account_id,
    ).length;

    return { items, stats: { from_dictionary: fromDict, from_ai: fromAi, pending } };
  });


// ============================================================================
// confirmOpenFinanceImport
// ============================================================================

const DecisionSchema = z.object({
  temp_id: z.string(),
  action: z.enum(["match", "create", "skip", "aporte"]),
  data: z.string(),
  descricao: z.string(),
  valor: z.number(),
  instituicao: z.string(),
  bank_account_id: z.string().uuid().nullable(),
  cost_center_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
  transaction_id: z.string().uuid().nullable(),
  dedupe_tag: z.string(),
  of_dedupe_key: z.string().optional(),
  // Aporte
  pair_temp_id: z.string().nullable().optional(),
  transfer_source_cc_id: z.string().uuid().nullable().optional(),
  transfer_source_bank_account_id: z.string().uuid().nullable().optional(),
  transfer_target_cc_id: z.string().uuid().nullable().optional(),
  transfer_target_bank_account_id: z.string().uuid().nullable().optional(),
});

export const confirmOpenFinanceImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { decisions: unknown }) =>
    z.object({ decisions: z.array(DecisionSchema).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let reconciled = 0;
    let created = 0;
    let skipped = 0;
    let aportes = 0;
    const errors: string[] = [];

    // Para aportes pareados: só processar uma perna por par
    const processedPair = new Set<string>();

    for (const dec of data.decisions) {
      if (dec.action === "skip") {
        skipped++;
        continue;
      }

      // -------------------- APORTE --------------------
      // Ciclo esperado:
      //  (a) APORTE COMPLETO: temos banco de ORIGEM (perna que saiu). Inserimos UMA payable com
      //      bank_account_id = srcBank, cost_center_id = tgtCc, conta "Aportes Concedidos" do tgtCc.
      //      O trigger public.sync_transaction_intercompany cria o registro em
      //      intercompany_transfers automaticamente (origem = CC do enterprise do srcBank,
      //      destino = tgtCc). NÃO inserimos manualmente em intercompany_transfers.
      //  (b) APORTE INCOMPLETO — perna SAÍDA conhecida (source-side): idêntico ao (a).
      //  (c) APORTE INCOMPLETO — perna ENTRADA conhecida (target-side, origem desconhecida):
      //      o trigger não consegue derivar a origem (não temos banco em outro enterprise).
      //      Criamos uma receivable no banco de entrada e ÚNICO caso em que gravamos
      //      intercompany_transfers manualmente, usando o srcCc escolhido pelo operador.
      if (dec.action === "aporte") {
        if (dec.pair_temp_id) {
          const pairKey = [dec.temp_id, dec.pair_temp_id].sort().join("::");
          if (processedPair.has(pairKey)) {
            skipped++;
            continue;
          }
          processedPair.add(pairKey);
        }
        const srcCc = dec.transfer_source_cc_id;
        const tgtCc = dec.transfer_target_cc_id;
        const srcBank = dec.transfer_source_bank_account_id;
        const tgtBank = dec.transfer_target_bank_account_id;
        if (!srcCc || !tgtCc) {
          errors.push(`${dec.descricao}: linha marcada como aporte sem par válido — revise (falta CC origem/destino).`);
          continue;
        }
        if (srcCc === tgtCc) {
          errors.push(`${dec.descricao}: linha marcada como aporte sem par válido — revise (mesmo CC origem/destino).`);
          continue;
        }
        if (!srcBank && !tgtBank) {
          errors.push(`${dec.descricao}: linha marcada como aporte sem par válido — revise (nenhum banco identificado).`);
          continue;
        }

        // Guarda: aporte legítimo exige CCs de enterprises DIFERENTES.
        const { data: ccPair } = await context.supabase
          .from("cost_centers")
          .select("id, enterprise")
          .in("id", [srcCc, tgtCc]);
        const srcEnt = (ccPair ?? []).find((c) => c.id === srcCc)?.enterprise ?? null;
        const tgtEnt = (ccPair ?? []).find((c) => c.id === tgtCc)?.enterprise ?? null;
        if (!srcEnt || !tgtEnt || srcEnt === tgtEnt) {
          errors.push(
            `${dec.descricao}: linha marcada como aporte sem par válido — revise (CCs precisam ser de empreendimentos diferentes).`,
          );
          continue;
        }

        // Só agora — com aporte legítimo confirmado — é seguro cair na conta "Aportes Concedidos".
        let accountId = dec.account_id;
        if (!accountId) {
          const { data: acc } = await context.supabase
            .from("accounts")
            .select("id, name")
            .eq("cost_center_id", tgtCc)
            .eq("kind", "expense")
            .eq("is_active", true)
            .order("name")
            .limit(50);
          const list = (acc ?? []) as Array<{ id: string; name: string }>;
          accountId =
            list.find((a) => /^aportes\s+concedidos\b/i.test(a.name))?.id ??
            list.find((a) => /aporte/i.test(a.name))?.id ??
            null;
        }
        if (!accountId) {
          errors.push(`${dec.descricao}: sem conta contábil de aporte disponível no CC destino.`);
          continue;
        }


        // Dedupe: por of_dedupe_key (chave nova) OU pela tag legacy
        const tag = dec.dedupe_tag;
        const dupQuery = context.supabase.from("transactions").select("id").limit(1);
        const { data: dup } = dec.of_dedupe_key
          ? await dupQuery.or(
              `of_dedupe_key.eq.${dec.of_dedupe_key},description.ilike.%${tag}%`,
            )
          : await dupQuery.ilike("description", `%${tag}%`);
        if (dup && dup.length > 0) {
          skipped++;
          continue;
        }


        const paidAt = new Date(`${dec.data}T12:00:00Z`).toISOString();
        const description = `${tag} [APORTE] ${dec.instituicao} — ${dec.descricao}`.slice(0, 500);
        const amount = Math.abs(Number(dec.valor.toFixed(2)));

        if (srcBank) {
          // Casos (a) e (b): payable no banco de origem, CC destino → trigger cria intercompany.
          const { error } = await context.supabase.from("transactions").insert({
            cost_center_id: tgtCc,
            account_id: accountId,
            bank_account_id: srcBank,
            type: "payable",
            amount,
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
        } else {
          // Caso (c): apenas perna de ENTRADA visível. Trigger não cobre origem desconhecida.
          // Criamos receivable no banco de entrada e inserimos intercompany_transfers manualmente
          // (ÚNICO caso em que gravamos essa tabela à mão).
          const { data: newTx, error } = await context.supabase
            .from("transactions")
            .insert({
              cost_center_id: tgtCc,
              account_id: accountId,
              bank_account_id: tgtBank,
              type: "receivable",
              amount,
              description,
              due_date: dec.data,
              document_datetime: paidAt,
              status: "reconciled",
              paid_at: paidAt,
              created_by: context.userId,
            })
            .select("id")
            .single();
          if (error || !newTx) {
            errors.push(`${dec.descricao}: ${error?.message ?? "falha ao criar receivable"}`);
            continue;
          }
          const { error: ictErr } = await context.supabase.from("intercompany_transfers").insert({
            transaction_id: newTx.id,
            source_cost_center_id: srcCc,
            target_cost_center_id: tgtCc,
            amount,
            created_by: context.userId,
          });
          if (ictErr) {
            errors.push(`${dec.descricao}: intercompany manual falhou — ${ictErr.message}`);
            continue;
          }
        }
        aportes++;
        continue;
      }

      // -------------------- MATCH --------------------
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

      // -------------------- CREATE --------------------
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

    return { reconciled, created, aportes, skipped, errors };
  });
