import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const EnterpriseFilter = z
  .enum(["all", "turismo", "restaurante", "vinhedo", "ghr", "institucional_fazenda", "impostos"])
  .default("all");

// ---------- LISTS ----------
export const listCostCenters = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cost_centers")
      .select("*")
      .order("code");
    if (error) throw new Error(error.message);
    return data;
  });

export const listAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("accounts")
      .select("*, cost_centers(code, name, master_only, enterprise)")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  });

export const listBankAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bank_accounts")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  });

export const listTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("transactions")
      .select(
        "*, accounts(name, kind), cost_centers(code, name, master_only, enterprise), bank_accounts(name, enterprise), contacts(name, type, document_number), transaction_allocations(id, cost_center_id, amount, percent, cost_centers(code, name, enterprise))",
      )
      .order("due_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data;
  });


// ---------- CREATE TRANSACTION (com rateio) ----------
const AllocationInput = z.object({
  cost_center_id: z.string().uuid(),
  amount: z.number().positive(),
  percent: z.number().min(0).max(100).optional().nullable(),
});

const TxInput = z.object({
  cost_center_id: z.string().uuid(),
  account_id: z.string().uuid(),
  bank_account_id: z.string().uuid().nullable().optional(),
  contact_id: z.string().uuid(),
  type: z.enum(["payable", "receivable"]),
  amount: z.number().positive(),
  description: z.string().max(500).optional().nullable(),
  document_datetime: z.string().nullable().optional(),
  due_date: z.string(),
  is_batch: z.boolean().default(false),
  status: z.enum(["pending", "paid", "reconciled"]).default("pending"),
  payment_method: z.enum(["pix", "boleto", "credit_card", "cash"]).nullable().optional(),
  allocations: z.array(AllocationInput).optional(),
  schedule: z
    .object({
      kind: z.enum(["single", "installment", "recurring"]).default("single"),
      installments: z.number().int().min(2).max(120).optional(),
      recurring_months: z.number().int().min(1).max(36).default(12).optional(),
    })
    .default({ kind: "single" }),
});

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

export const createTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => TxInput.parse(data))
  .handler(async ({ context, data }) => {
    // Validar rateio
    const allocations = data.allocations ?? [];
    if (allocations.length > 0) {
      const sum = allocations.reduce((s, a) => s + a.amount, 0);
      if (Math.abs(sum - data.amount) > 0.01) {
        throw new Error(
          `Rateio inconsistente: soma das partes (R$ ${sum.toFixed(2)}) ≠ valor total (R$ ${data.amount.toFixed(2)}).`,
        );
      }
    }

    const baseRow = {
      cost_center_id: data.cost_center_id,
      account_id: data.account_id,
      bank_account_id: data.bank_account_id ?? null,
      contact_id: data.contact_id,
      type: data.type,
      amount: data.amount,
      description: data.description ?? null,
      document_datetime: data.document_datetime ?? null,
      due_date: data.due_date,
      is_batch: data.is_batch,
      status: data.status,
      payment_method: data.payment_method ?? null,
      created_by: context.userId,
    };

    const schedule = data.schedule;

    async function insertAllocationsFor(txIds: string[]) {
      if (allocations.length === 0) return;
      const rows = txIds.flatMap((tid) =>
        allocations.map((a) => ({
          transaction_id: tid,
          cost_center_id: a.cost_center_id,
          amount: a.amount,
          percent: a.percent ?? null,
        })),
      );
      const { error } = await context.supabase.from("transaction_allocations").insert(rows);
      if (error) throw new Error("Falha ao salvar rateio: " + error.message);
    }

    if (schedule.kind === "installment" && schedule.installments) {
      const n = schedule.installments;
      const groupId = crypto.randomUUID();
      const rows = Array.from({ length: n }, (_, i) => ({
        ...baseRow,
        description: `${baseRow.description ?? ""} - Parc ${i + 1}/${n}`.trim(),
        due_date: addDays(baseRow.due_date, 30 * i),
        installment_number: i + 1,
        installment_total: n,
        recurrence_group_id: groupId,
      }));
      const { data: rs, error } = await context.supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      if (error) throw new Error(error.message);
      await insertAllocationsFor((rs ?? []).map((r) => r.id));
      return { created: rs?.length ?? 0, group_id: groupId };
    }

    if (schedule.kind === "recurring") {
      const months = schedule.recurring_months ?? 12;
      const groupId = crypto.randomUUID();
      const rows = Array.from({ length: months }, (_, i) => ({
        ...baseRow,
        due_date: addMonths(baseRow.due_date, i),
        is_recurring: true,
        recurrence_group_id: groupId,
      }));
      const { data: rs, error } = await context.supabase
        .from("transactions")
        .insert(rows)
        .select("id");
      if (error) throw new Error(error.message);
      await insertAllocationsFor((rs ?? []).map((r) => r.id));
      return { created: rs?.length ?? 0, group_id: groupId };
    }

    const { data: row, error } = await context.supabase
      .from("transactions")
      .insert(baseRow)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await insertAllocationsFor([row.id]);
    return row;
  });

// ---------- CONTACTS ----------
export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contacts")
      .select("*")
      .order("name");
    if (error) throw new Error(error.message);
    return data;
  });

const ContactInput = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(["FORNECEDOR", "COLABORADOR"]),
  document_type: z.enum(["PF", "PJ"]),
  document_number: z
    .string()
    .trim()
    .min(11)
    .max(20)
    .regex(/^[0-9./-]+$/, "Documento inválido"),
  master_only: z.boolean().default(false),
});

export const createContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ContactInput.parse(d))
  .handler(async ({ context, data }) => {
    const digits = data.document_number.replace(/\D/g, "");
    if (data.document_type === "PF" && digits.length !== 11) {
      throw new Error("CPF deve ter 11 dígitos");
    }
    if (data.document_type === "PJ" && digits.length !== 14) {
      throw new Error("CNPJ deve ter 14 dígitos");
    }
    const { data: existing } = await context.supabase
      .from("contacts")
      .select("id, name")
      .eq("document_number", digits)
      .maybeSingle();
    if (existing) {
      throw new Error(
        `Atenção: Este documento já está cadastrado para o contato "${existing.name}". Use o cadastro existente.`,
      );
    }
    const { data: row, error } = await context.supabase
      .from("contacts")
      .insert({ ...data, document_number: digits })
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        throw new Error("Atenção: Este documento já está cadastrado. Use o cadastro existente.");
      }
      throw new Error(error.message);
    }
    return row;
  });

export const deleteTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("transactions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- BANK STATEMENT ----------
const StatementLineInput = z.object({
  bank_account_id: z.string().uuid(),
  lines: z
    .array(
      z.object({
        statement_date: z.string(),
        amount: z.number(),
        description: z.string().optional().nullable(),
      }),
    )
    .max(1000),
});

export const importStatementLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => StatementLineInput.parse(data))
  .handler(async ({ context, data }) => {
    const rows = data.lines.map((l) => ({
      bank_account_id: data.bank_account_id,
      statement_date: l.statement_date,
      amount: l.amount,
      description: l.description ?? null,
    }));
    const { error } = await context.supabase.from("bank_statement_lines").insert(rows);
    if (error) throw new Error(error.message);
    return { inserted: rows.length };
  });

export const listStatementLines = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bank_statement_lines")
      .select("*, bank_accounts(name)")
      .order("statement_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data;
  });

export const autoMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: lines } = await context.supabase
      .from("bank_statement_lines")
      .select("*")
      .eq("reconciled", false)
      .is("matched_transaction_id", null);
    const { data: txs } = await context.supabase
      .from("transactions")
      .select("*")
      .neq("status", "reconciled");
    if (!lines || !txs) return { matched: 0 };

    let matched = 0;
    for (const line of lines) {
      const lineDate = new Date(line.statement_date).getTime();
      const candidate = txs.find((t) => {
        if (Math.abs(Number(t.amount) - Math.abs(Number(line.amount))) > 0.01) return false;
        const ref = t.document_datetime
          ? new Date(t.document_datetime).getTime()
          : new Date(t.due_date).getTime();
        return Math.abs(ref - lineDate) <= 3 * 24 * 60 * 60 * 1000;
      });
      if (candidate) {
        await context.supabase
          .from("bank_statement_lines")
          .update({ matched_transaction_id: candidate.id })
          .eq("id", line.id);
        matched++;
      }
    }
    return { matched };
  });

const ReconcileInput = z.object({
  transaction_id: z.string().uuid(),
  statement_line_ids: z.array(z.string().uuid()).min(1).max(50),
});

export const reconcile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ReconcileInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: tx, error: txErr } = await context.supabase
      .from("transactions")
      .select("id, amount, is_batch")
      .eq("id", data.transaction_id)
      .single();
    if (txErr || !tx) throw new Error("Lançamento não encontrado");
    const { data: lines, error: linesErr } = await context.supabase
      .from("bank_statement_lines")
      .select("id, amount")
      .in("id", data.statement_line_ids);
    if (linesErr) throw new Error(linesErr.message);
    if (!lines || lines.length !== data.statement_line_ids.length) {
      throw new Error("Linhas de extrato inválidas");
    }
    if (data.statement_line_ids.length > 1 && !tx.is_batch) {
      throw new Error("Múltiplas linhas só podem conciliar lançamentos marcados como lote (is_batch).");
    }
    const sumLines = lines.reduce((s, l) => s + Math.abs(Number(l.amount)), 0);
    const txAmount = Math.abs(Number(tx.amount));
    if (Math.abs(sumLines - txAmount) > 0.01) {
      throw new Error(
        `Inconsistência no lote: soma das linhas (R$ ${sumLines.toFixed(2)}) ≠ valor do lançamento (R$ ${txAmount.toFixed(2)}).`,
      );
    }
    await context.supabase
      .from("bank_statement_lines")
      .update({ matched_transaction_id: data.transaction_id, reconciled: true })
      .in("id", data.statement_line_ids);
    await context.supabase
      .from("transactions")
      .update({ status: "reconciled", paid_at: new Date().toISOString() })
      .eq("id", data.transaction_id);
    return { ok: true, sum: sumLines };
  });

// ---------- DRE + PROJECTION (com filtro de empreendimento) ----------
type EnterpriseValue =
  | "turismo"
  | "restaurante"
  | "vinhedo"
  | "ghr"
  | "institucional_fazenda"
  | "impostos";

interface AllocRow {
  amount: number;
  cc_enterprise: EnterpriseValue;
}

async function loadFinanceData(supabase: {
  from: (t: string) => {
    select: (s: string) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
}) {
  const [{ data: banks }, { data: ccs }, { data: txs }, { data: allocs }] = (await Promise.all([
    supabase.from("bank_accounts").select("id, name, initial_balance, enterprise"),
    supabase.from("cost_centers").select("id, enterprise"),
    supabase
      .from("transactions")
      .select(
        "id, type, amount, due_date, status, account_id, cost_center_id, bank_account_id, accounts(name)",
      ),
    supabase
      .from("transaction_allocations")
      .select("transaction_id, cost_center_id, amount"),
  ])) as unknown as [
    { data: Array<{ id: string; name: string; initial_balance: number; enterprise: EnterpriseValue }> },
    { data: Array<{ id: string; enterprise: EnterpriseValue }> },
    {
      data: Array<{
        id: string;
        type: "payable" | "receivable";
        amount: number;
        due_date: string;
        status: string;
        account_id: string;
        cost_center_id: string;
        bank_account_id: string | null;
        accounts: { name?: string } | null;
      }>;
    },
    { data: Array<{ transaction_id: string; cost_center_id: string; amount: number }> },
  ];

  const ccById = new Map(ccs?.map((c) => [c.id, c.enterprise]) ?? []);
  const bankById = new Map(banks?.map((b) => [b.id, b]) ?? []);

  // Para cada transação, gerar lista de alocações efetivas
  const allocByTx = new Map<string, AllocRow[]>();
  for (const a of allocs ?? []) {
    const e = ccById.get(a.cost_center_id);
    if (!e) continue;
    const arr = allocByTx.get(a.transaction_id) ?? [];
    arr.push({ amount: Number(a.amount), cc_enterprise: e });
    allocByTx.set(a.transaction_id, arr);
  }

  return { banks: banks ?? [], txs: txs ?? [], ccById, bankById, allocByTx };
}

function effectiveAllocs(
  tx: { id: string; cost_center_id: string; amount: number },
  ccById: Map<string, EnterpriseValue>,
  allocByTx: Map<string, AllocRow[]>,
): AllocRow[] {
  const a = allocByTx.get(tx.id);
  if (a && a.length > 0) return a;
  const e = ccById.get(tx.cost_center_id);
  if (!e) return [];
  return [{ amount: Number(tx.amount), cc_enterprise: e }];
}

export const buildDRE = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        enterprise: EnterpriseFilter,
        months: z.number().int().min(1).max(24).default(6),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { txs, ccById, bankById, allocByTx } = await loadFinanceData(
      context.supabase as never,
    );
    const filter = data.enterprise;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setMonth(from.getMonth() - data.months);

    // Estrutura por mês (YYYY-MM)
    type Bucket = {
      revenue: number;
      expense: number;
      aporteRecebido: number;
      aporteConcedido: number;
    };
    const months = new Map<string, Bucket>();
    const ensure = (k: string) => {
      let b = months.get(k);
      if (!b) {
        b = { revenue: 0, expense: 0, aporteRecebido: 0, aporteConcedido: 0 };
        months.set(k, b);
      }
      return b;
    };

    for (const tx of txs) {
      if (tx.status === "pending") continue; // DRE = realizado
      const d = new Date(tx.due_date);
      if (d < from || d > today) continue;
      const key = tx.due_date.slice(0, 7);
      const bank = tx.bank_account_id ? bankById.get(tx.bank_account_id) : undefined;
      const bankEnt = bank?.enterprise ?? null;
      const allocs = effectiveAllocs(tx, ccById, allocByTx);
      for (const a of allocs) {
        const include = filter === "all" || a.cc_enterprise === filter;
        if (include) {
          const b = ensure(key);
          if (tx.type === "receivable") b.revenue += a.amount;
          else b.expense += a.amount;
        }
        // Aportes cruzados
        if (bankEnt && bankEnt !== a.cc_enterprise && tx.type === "payable") {
          // CC enterprise recebeu aporte de bankEnt
          if (filter === "all" || a.cc_enterprise === filter) {
            ensure(key).aporteRecebido += a.amount;
          }
          // bankEnt concedeu aporte
          if (filter === "all" || bankEnt === filter) {
            ensure(key).aporteConcedido += a.amount;
          }
        }
      }
    }

    const series = Array.from(months.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, b]) => ({
        month,
        ...b,
        net: b.revenue - b.expense,
      }));

    const totals = series.reduce(
      (acc, m) => ({
        revenue: acc.revenue + m.revenue,
        expense: acc.expense + m.expense,
        aporteRecebido: acc.aporteRecebido + m.aporteRecebido,
        aporteConcedido: acc.aporteConcedido + m.aporteConcedido,
      }),
      { revenue: 0, expense: 0, aporteRecebido: 0, aporteConcedido: 0 },
    );

    return { series, totals: { ...totals, net: totals.revenue - totals.expense } };
  });

export const buildProjection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ enterprise: EnterpriseFilter }).parse(d ?? { enterprise: "all" }),
  )
  .handler(async ({ context, data }) => {
    const { banks, txs, ccById, bankById, allocByTx } = await loadFinanceData(
      context.supabase as never,
    );
    const filter = data.enterprise;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 90);

    // Saldo: para filtro, conta apenas bancos do empreendimento
    const filteredBanks =
      filter === "all" ? banks : banks.filter((b) => b.enterprise === filter);
    let balance = filteredBanks.reduce((s, b) => s + Number(b.initial_balance), 0);

    // Função: impacto líquido (saldo do banco) para uma transação dada o filtro
    // Para projeção de caixa, o que importa é o saldo bancário; allocations não
    // afetam saldo (afetam DRE). Filtro por enterprise: só contabiliza tx cujo
    // bank_account.enterprise = filter (ou all).
    function txAffectsBalance(tx: { bank_account_id: string | null }) {
      if (filter === "all") return true;
      if (!tx.bank_account_id) return false;
      const b = bankById.get(tx.bank_account_id);
      return b?.enterprise === filter;
    }

    const future: Array<{ date: string; amount: number }> = [];
    for (const t of txs) {
      if (!txAffectsBalance(t)) continue;
      const d = new Date(t.due_date);
      const amt = t.type === "receivable" ? Number(t.amount) : -Number(t.amount);
      if (d < today) {
        if (t.status === "paid" || t.status === "reconciled") balance += amt;
      } else if (d <= horizon) {
        future.push({ date: t.due_date, amount: amt });
      }
    }

    // GHOST projection
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const recurringNames = [
      "Simples Nacional",
      "Honorários (Contador)",
      "Logística (Luz / Internet / Telefone)",
      "Adiantamentos Dr. Guilherme",
      "Adiantamentos Dr. Diego",
      "GPS",
      "FGTS",
    ];
    const ghosts: Array<{ date: string; amount: number; reason: string }> = [];
    for (const name of recurringNames) {
      const past = txs.filter(
        (t) =>
          t.accounts?.name === name &&
          new Date(t.due_date) >= threeMonthsAgo &&
          new Date(t.due_date) < today &&
          txAffectsBalance(t),
      );
      if (past.length === 0) continue;
      const avg = past.reduce((s, t) => s + Number(t.amount), 0) / past.length;
      for (let m = 1; m <= 3; m++) {
        const futureDate = new Date(today);
        futureDate.setMonth(futureDate.getMonth() + m);
        const dayStr = futureDate.toISOString().slice(0, 10);
        const exists = txs.some(
          (t) =>
            t.accounts?.name === name &&
            t.due_date.slice(0, 7) === dayStr.slice(0, 7) &&
            txAffectsBalance(t),
        );
        if (!exists) {
          ghosts.push({ date: dayStr, amount: -avg, reason: `Média ${name} últimos 3 meses` });
        }
      }
    }

    const series: Array<{ date: string; real: number; withGhosts: number }> = [];
    let running = balance;
    let runningGhost = balance;
    for (let i = 0; i <= 90; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      const dayReal = future.filter((f) => f.date === ds).reduce((s, x) => s + x.amount, 0);
      const dayGhost = ghosts.filter((g) => g.date === ds).reduce((s, x) => s + x.amount, 0);
      running += dayReal;
      runningGhost += dayReal + dayGhost;
      series.push({
        date: ds,
        real: Math.round(running * 100) / 100,
        withGhosts: Math.round(runningGhost * 100) / 100,
      });
    }

    // Suppress unused warning for ccById/allocByTx — kept for parity with DRE loader
    void ccById;
    void allocByTx;

    return {
      currentBalance: Math.round(balance * 100) / 100,
      series,
      ghosts,
    };
  });
