import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const EnterpriseFilter = z
  .enum([
    "all",
    // Grupos macro
    "fazenda",
    "ghr_grupo",
    // Finalísticos
    "turismo",
    "restaurante",
    "vinhedo",
    "ghr_aldeia",
    "ghr_jk",
    // Legados (mantidos por compatibilidade)
    "ghr",
    "institucional_fazenda",
    "impostos",
  ])
  .default("all");

// Expande "fazenda" → {turismo, restaurante, vinhedo}; "ghr_grupo" → {ghr_aldeia, ghr_jk}.
// Retorna null para "all".
function enterpriseSet(filter: string): Set<string> | null {
  if (filter === "all") return null;
  if (filter === "fazenda") return new Set(["turismo", "restaurante", "vinhedo"]);
  if (filter === "ghr_grupo") return new Set(["ghr_aldeia", "ghr_jk"]);
  return new Set([filter]);
}
function matchesFilter(set: Set<string> | null, value: string | null | undefined) {
  return !set || (value != null && set.has(value));
}

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
      recurring_months: z.number().int().min(1).max(60).default(12).optional(),
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
    // Guard: bloqueia centros de custo macro/holding (apenas agrupadores).
    const { data: ccRow } = await context.supabase
      .from("cost_centers")
      .select("enterprise, name")
      .eq("id", data.cost_center_id)
      .maybeSingle();
    const SELECTABLE = ["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"];
    if (!ccRow || !SELECTABLE.includes(ccRow.enterprise ?? "")) {
      throw new Error(
        `Bloco "${ccRow?.name ?? "desconhecido"}" é apenas agrupador; selecione um centro de custo finalístico (Turismo, Restaurante, Vinhedo, Aldeia ou JK).`,
      );
    }

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
        description: `${baseRow.description ?? ""} - Recorrente ${i + 1}/${months}`.trim(),
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

// ---------- BULK CREATE TRANSACTIONS (Modo Grade Rápida) ----------
const BulkTxRow = z.object({
  cost_center_id: z.string().uuid(),
  account_id: z.string().uuid(),
  contact_id: z.string().uuid().nullable().optional(),
  type: z.enum(["payable", "receivable"]),
  amount: z.number().positive(),
  due_date: z.string(),
  description: z.string().max(500).nullable().optional(),
});

export const bulkCreateTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ rows: z.array(BulkTxRow).min(1).max(500) }).parse(d))
  .handler(async ({ context, data }) => {
    // Resolve default contact for rows missing one
    let defaultContactId: string | null = null;
    const needsDefault = data.rows.some((r) => !r.contact_id);
    if (needsDefault) {
      const { data: existing } = await context.supabase
        .from("contacts")
        .select("id")
        .ilike("name", "Lançamento via Grade")
        .maybeSingle();
      if (existing) {
        defaultContactId = existing.id;
      } else {
        const docNum = String(Date.now()).padStart(11, "0").slice(-11);
        const { data: created, error: cErr } = await context.supabase
          .from("contacts")
          .insert({
            name: "Lançamento via Grade",
            type: "FORNECEDOR",
            document_type: "PF",
            document_number: docNum,
            master_only: false,
          } as never)
          .select("id")
          .single();
        if (cErr) throw new Error("Falha ao criar contato padrão: " + cErr.message);
        defaultContactId = created.id;
      }
    }

    const rows = data.rows.map((r) => ({
      cost_center_id: r.cost_center_id,
      account_id: r.account_id,
      contact_id: r.contact_id ?? defaultContactId!,
      type: r.type,
      amount: r.amount,
      due_date: r.due_date,
      description: r.description ?? null,
      status: "pending" as const,
      is_batch: false,
      created_by: context.userId,
    }));
    const { data: inserted, error } = await context.supabase
      .from("transactions")
      .insert(rows)
      .select("id");
    if (error) throw new Error("Falha no bulk insert: " + error.message);
    return { created: inserted?.length ?? 0 };
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

const UpdateTxInput = z.object({
  id: z.string().uuid(),
  patch: z
    .object({
      bank_account_id: z.string().uuid().nullable().optional(),
      description: z.string().max(500).nullable().optional(),
      amount: z.number().positive().optional(),
      due_date: z.string().optional(),
      document_datetime: z.string().nullable().optional(),
      payment_method: z.enum(["pix", "boleto", "credit_card", "cash"]).nullable().optional(),
      status: z.enum(["pending", "paid", "reconciled"]).optional(),
    })
    .refine((o) => Object.keys(o).length > 0, "Nada para atualizar"),
});

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => UpdateTxInput.parse(d))
  .handler(async ({ context, data }) => {
    // Atualiza estritamente os campos enviados; jamais toca cost_center_id ou account_id.
    const { error } = await context.supabase
      .from("transactions")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
      .update({
        matched_transaction_id: data.transaction_id,
        reconciled: true,
        matched_by: context.userId,
        matched_at: new Date().toISOString(),
      })
      .in("id", data.statement_line_ids);
    await context.supabase
      .from("transactions")
      .update({ status: "reconciled", paid_at: new Date().toISOString() })
      .eq("id", data.transaction_id);
    return { ok: true, sum: sumLines };
  });

// ---------- SMART IMPORT (dedupe + auto-create skeleton) ----------
const SmartImportInput = z.object({
  bank_account_id: z.string().uuid(),
  match_window_days: z.number().int().min(0).max(30).default(7),
  lines: z
    .array(
      z.object({
        statement_date: z.string(),
        amount: z.number(),
        description: z.string().optional().nullable(),
        external_id: z.string().optional().nullable(),
      }),
    )
    .min(1)
    .max(2000),
});

export const smartImportStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SmartImportInput.parse(d))
  .handler(async ({ context, data }) => {
    const windowMs = data.match_window_days * 24 * 60 * 60 * 1000;
    const isValidIsoDate = (s: unknown): s is string =>
      typeof s === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !isNaN(new Date(s + "T00:00:00Z").getTime());
    const validLines = data.lines.filter((l) => isValidIsoDate(l.statement_date));
    const skippedInvalid = data.lines.length - validLines.length;
    if (validLines.length === 0) {
      return {
        total: data.lines.length,
        duplicates: 0,
        matched_existing: 0,
        pending_categorization: 0,
        line_ids: [] as string[],
        skipped_invalid: skippedInvalid,
      };
    }
    const dates = validLines.map((l) => l.statement_date).sort();
    const minDate = dates[0];
    const maxDate = dates[dates.length - 1];
    const padDate = (iso: string, days: number) => {
      const d = new Date(iso + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };

    // Avoid re-importing the same line (by bank + date + amount + description)
    const { data: existing } = await context.supabase
      .from("bank_statement_lines")
      .select("statement_date, amount, description")
      .eq("bank_account_id", data.bank_account_id)
      .gte("statement_date", padDate(minDate, -1))
      .lte("statement_date", padDate(maxDate, 1));
    const existKey = new Set(
      (existing ?? []).map(
        (l) =>
          `${l.statement_date}|${Number(l.amount).toFixed(2)}|${(l.description ?? "").trim().toLowerCase()}`,
      ),
    );

    const { data: txs } = await context.supabase
      .from("transactions")
      .select("id, amount, due_date, document_datetime, status")
      .neq("status", "reconciled")
      .gte("due_date", padDate(minDate, -data.match_window_days))
      .lte("due_date", padDate(maxDate, data.match_window_days));
    const usedTxIds = new Set<string>();

    let duplicates = 0;
    let matchedExisting = 0;
    let createdSkeleton = 0;
    const skeletonIds: string[] = [];

    for (const line of validLines) {
      const key = `${line.statement_date}|${Number(line.amount).toFixed(2)}|${(line.description ?? "").trim().toLowerCase()}`;
      if (existKey.has(key)) {
        duplicates++;
        continue;
      }

      const lineMs = new Date(line.statement_date + "T00:00:00Z").getTime();
      const absAmount = Math.abs(line.amount);
      const candidate = (txs ?? []).find((t) => {
        if (usedTxIds.has(t.id)) return false;
        if (Math.abs(Number(t.amount) - absAmount) > 0.01) return false;
        const ref = t.document_datetime
          ? new Date(t.document_datetime).getTime()
          : new Date(t.due_date + "T00:00:00Z").getTime();
        return Math.abs(ref - lineMs) <= windowMs;
      });

      if (candidate) {
        usedTxIds.add(candidate.id);
        const paidAt = new Date(line.statement_date + "T12:00:00Z").toISOString();
        const { data: inserted, error: insErr } = await context.supabase
          .from("bank_statement_lines")
          .insert({
            bank_account_id: data.bank_account_id,
            statement_date: line.statement_date,
            amount: line.amount,
            description: line.description ?? null,
            matched_transaction_id: candidate.id,
            reconciled: true,
            matched_by: context.userId,
            matched_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        await context.supabase
          .from("transactions")
          .update({ status: "paid", paid_at: paidAt })
          .eq("id", candidate.id);
        matchedExisting++;
        existKey.add(key);
        skeletonIds.push(inserted!.id);
      } else {
        const { data: inserted, error: insErr } = await context.supabase
          .from("bank_statement_lines")
          .insert({
            bank_account_id: data.bank_account_id,
            statement_date: line.statement_date,
            amount: line.amount,
            description: line.description ?? null,
          })
          .select("id")
          .single();
        if (insErr) throw new Error(insErr.message);
        createdSkeleton++;
        existKey.add(key);
        skeletonIds.push(inserted!.id);
      }
    }

    return {
      total: data.lines.length,
      duplicates,
      matched_existing: matchedExisting,
      pending_categorization: createdSkeleton,
      line_ids: skeletonIds,
    };
  });

const PromoteLineInput = z.object({
  statement_line_id: z.string().uuid(),
  cost_center_id: z.string().uuid(),
  account_id: z.string().uuid(),
  contact_id: z.string().uuid().nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  payment_method: z.enum(["pix", "boleto", "credit_card", "cash"]).nullable().optional(),
});

export const promoteStatementLineToTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PromoteLineInput.parse(d))
  .handler(async ({ context, data }) => {
    const { data: line, error: lineErr } = await context.supabase
      .from("bank_statement_lines")
      .select("id, bank_account_id, statement_date, amount, description, matched_transaction_id, reconciled")
      .eq("id", data.statement_line_id)
      .single();
    if (lineErr || !line) throw new Error("Linha de extrato não encontrada");
    if (line.reconciled || line.matched_transaction_id)
      throw new Error("Linha já está conciliada");

    const { data: cc } = await context.supabase
      .from("cost_centers")
      .select("enterprise, name")
      .eq("id", data.cost_center_id)
      .maybeSingle();
    const SELECTABLE = ["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"];
    if (!cc || !SELECTABLE.includes(cc.enterprise ?? "")) {
      throw new Error(
        `Bloco "${cc?.name ?? "desconhecido"}" é apenas agrupador; selecione um centro de custo finalístico.`,
      );
    }

    const amt = Number(line.amount);
    const type = amt < 0 ? "payable" : "receivable";
    const absAmt = Math.abs(amt);
    const dueDate = line.statement_date as string;
    const paidAt = new Date(dueDate + "T12:00:00Z").toISOString();

    const { data: tx, error: txErr } = await context.supabase
      .from("transactions")
      .insert({
        cost_center_id: data.cost_center_id,
        account_id: data.account_id,
        bank_account_id: line.bank_account_id,
        contact_id: data.contact_id ?? null,
        type,
        amount: absAmt,
        description: data.description ?? line.description ?? null,
        document_datetime: paidAt,
        due_date: dueDate,
        status: "reconciled",
        paid_at: paidAt,
        payment_method: data.payment_method ?? null,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (txErr || !tx) throw new Error(txErr?.message ?? "Falha ao criar lançamento");

    await context.supabase
      .from("bank_statement_lines")
      .update({
        matched_transaction_id: tx.id,
        reconciled: true,
        matched_by: context.userId,
        matched_at: new Date().toISOString(),
      })
      .eq("id", line.id);

    return { ok: true, transaction_id: tx.id };
  });

const BulkRangeInput = z.object({
  bank_account_id: z.string().uuid().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
});

// Pick the native cost center + a default account for a bank, based on bank.enterprise
async function pickBankDefaults(
  supabase: { from: (t: string) => unknown },
  bankId: string,
  kind: "revenue" | "expense",
): Promise<{ cost_center_id: string; account_id: string; bank_name: string } | null> {
  const supa = supabase as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        eq: (c: string, v: unknown) => {
          maybeSingle?: () => Promise<{ data: unknown }>;
          order?: (c: string) => { limit: (n: number) => Promise<{ data: unknown }> };
        };
      };
    };
  };
  const bankRes = (await supa
    .from("bank_accounts")
    .select("id, name, enterprise")
    .eq("id", bankId)
    .maybeSingle!()) as { data: { id: string; name: string; enterprise: string } | null };
  if (!bankRes.data) return null;
  const ent = bankRes.data.enterprise;
  const ccRes = (await supa
    .from("cost_centers")
    .select("id")
    .eq("enterprise", ent)
    .order!("code")
    .limit(1)) as { data: Array<{ id: string }> };
  const ccId = ccRes.data?.[0]?.id;
  if (!ccId) return null;
  const accRes = (await supa.from("accounts").select("id, name, kind").eq("cost_center_id", ccId)) as unknown as {
    data: Array<{ id: string; name: string; kind: string }> | null;
  };
  const accs = (accRes.data ?? []).filter((a) => a.kind === kind);
  if (accs.length === 0) return null;
  const preferred = accs.find((a) => /outros/i.test(a.name)) ?? accs[0];
  return { cost_center_id: ccId, account_id: preferred.id, bank_name: bankRes.data.name };
}

// 1) Consolidate all pending positive (revenue) statement lines per bank into a single transaction
export const consolidateStatementRevenues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BulkRangeInput.parse(d))
  .handler(async ({ context, data }) => {
    let query = context.supabase
      .from("bank_statement_lines")
      .select("id, bank_account_id, statement_date, amount, description, reconciled, matched_transaction_id")
      .gte("statement_date", data.start_date)
      .lte("statement_date", data.end_date)
      .eq("reconciled", false)
      .is("matched_transaction_id", null)
      .gt("amount", 0);
    if (data.bank_account_id) query = query.eq("bank_account_id", data.bank_account_id);
    const { data: lines, error } = await query;
    if (error) throw new Error(error.message);
    if (!lines || lines.length === 0) return { ok: true, created: 0, lines: 0, total: 0 };

    const byBank = new Map<string, typeof lines>();
    for (const l of lines) {
      const arr = byBank.get(l.bank_account_id as string) ?? [];
      arr.push(l);
      byBank.set(l.bank_account_id as string, arr);
    }

    let created = 0;
    let lineCount = 0;
    let total = 0;

    for (const [bankId, group] of byBank) {
      const defaults = await pickBankDefaults(
        context.supabase as unknown as { from: (t: string) => unknown },
        bankId,
        "revenue",
      );
      if (!defaults) continue;
      const sum = group.reduce((s, l) => s + Number(l.amount), 0);
      const lastDate = group.reduce(
        (acc, l) => ((l.statement_date as string) > acc ? (l.statement_date as string) : acc),
        group[0].statement_date as string,
      );
      const paidAt = new Date(lastDate + "T12:00:00Z").toISOString();
      const { data: tx, error: txErr } = await context.supabase
        .from("transactions")
        .insert({
          cost_center_id: defaults.cost_center_id,
          account_id: defaults.account_id,
          bank_account_id: bankId,
          type: "receivable",
          amount: sum,
          description: `Receita Operacional Consolidada via Extrato - ${defaults.bank_name} (${data.start_date} a ${data.end_date})`,
          document_datetime: paidAt,
          due_date: lastDate,
          status: "paid",
          paid_at: paidAt,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (txErr || !tx) throw new Error(txErr?.message ?? "Falha ao criar receita consolidada");
      const ids = group.map((l) => l.id as string);
      await context.supabase
        .from("bank_statement_lines")
        .update({
          matched_transaction_id: tx.id,
          reconciled: true,
          matched_by: context.userId,
          matched_at: new Date().toISOString(),
        })
        .in("id", ids);
      created++;
      lineCount += group.length;
      total += sum;
    }

    return { ok: true, created, lines: lineCount, total };
  });

// 2) Create "Saída Sem Comprovação" drafts for unmatched negative lines so balance reflects reality
export const createUnverifiedExpenseDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => BulkRangeInput.parse(d))
  .handler(async ({ context, data }) => {
    let query = context.supabase
      .from("bank_statement_lines")
      .select("id, bank_account_id, statement_date, amount, description, reconciled, matched_transaction_id")
      .gte("statement_date", data.start_date)
      .lte("statement_date", data.end_date)
      .eq("reconciled", false)
      .is("matched_transaction_id", null)
      .lt("amount", 0);
    if (data.bank_account_id) query = query.eq("bank_account_id", data.bank_account_id);
    const { data: lines, error } = await query;
    if (error) throw new Error(error.message);
    if (!lines || lines.length === 0) return { ok: true, created: 0 };

    const cache = new Map<string, { cost_center_id: string; account_id: string; bank_name: string } | null>();
    let created = 0;
    for (const l of lines) {
      const bankId = l.bank_account_id as string;
      if (!cache.has(bankId)) {
        cache.set(
          bankId,
          await pickBankDefaults(
            context.supabase as unknown as { from: (t: string) => unknown },
            bankId,
            "expense",
          ),
        );
      }
      const defaults = cache.get(bankId);
      if (!defaults) continue;
      const amt = Math.abs(Number(l.amount));
      const dueDate = l.statement_date as string;
      const paidAt = new Date(dueDate + "T12:00:00Z").toISOString();
      const favorecido = ((l.description ?? "") as string).trim().slice(0, 120) || "Sem descrição";
      const { data: tx, error: txErr } = await context.supabase
        .from("transactions")
        .insert({
          cost_center_id: defaults.cost_center_id,
          account_id: defaults.account_id,
          bank_account_id: bankId,
          type: "payable",
          amount: amt,
          description: `Saída Sem Comprovação - ${favorecido}`,
          document_datetime: paidAt,
          due_date: dueDate,
          status: "paid",
          paid_at: paidAt,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (txErr || !tx) throw new Error(txErr?.message ?? "Falha ao criar rascunho de saída");
      await context.supabase
        .from("bank_statement_lines")
        .update({
          matched_transaction_id: tx.id,
          reconciled: true,
          matched_by: context.userId,
          matched_at: new Date().toISOString(),
        })
        .eq("id", l.id as string);
      created++;
    }
    return { ok: true, created };
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
        "id, type, amount, due_date, document_datetime, status, account_id, cost_center_id, bank_account_id, accounts(name)",
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
        document_datetime: string | null;
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

    const set = enterpriseSet(filter);

    for (const tx of txs) {
      if (tx.status === "pending") continue; // DRE = realizado
      // Data de competência: prioriza document_datetime (data do fato/nota)
      const competenceIso = (tx as { document_datetime?: string | null }).document_datetime ?? tx.due_date;
      const d = new Date(competenceIso);
      if (d < from || d > today) continue;
      const key = competenceIso.slice(0, 7);

      const bank = tx.bank_account_id ? bankById.get(tx.bank_account_id) : undefined;
      const bankEnt = bank?.enterprise ?? null;
      const allocs = effectiveAllocs(tx, ccById, allocByTx);
      for (const a of allocs) {
        const include = matchesFilter(set, a.cc_enterprise);
        if (include) {
          const b = ensure(key);
          if (tx.type === "receivable") b.revenue += a.amount;
          else b.expense += a.amount;
        }
        // Aportes cruzados
        if (bankEnt && bankEnt !== a.cc_enterprise && tx.type === "payable") {
          // CC enterprise recebeu aporte de bankEnt
          if (matchesFilter(set, a.cc_enterprise)) {
            ensure(key).aporteRecebido += a.amount;
          }
          // bankEnt concedeu aporte
          if (matchesFilter(set, bankEnt)) {
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
    const set = enterpriseSet(filter);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 90);

    // Saldo: para filtro, conta apenas bancos cujo enterprise pertence ao grupo
    const filteredBanks = set ? banks.filter((b) => set.has(b.enterprise)) : banks;
    let balance = filteredBanks.reduce((s, b) => s + Number(b.initial_balance), 0);

    // Filtro por enterprise via banco da transação
    function txAffectsBalance(tx: { bank_account_id: string | null }) {
      if (!set) return true;
      if (!tx.bank_account_id) return false;
      const b = bankById.get(tx.bank_account_id);
      return !!b && set.has(b.enterprise);
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

// ---------- RECONCILIATION PERIODS ----------
export const listReconciliationPeriods = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("reconciliation_periods")
      .select("*")
      .order("start_date", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  });

export const createReconciliationPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ start_date: z.string(), end_date: z.string() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.end_date < data.start_date) throw new Error("Intervalo inválido.");
    const { data: row, error } = await context.supabase
      .from("reconciliation_periods")
      .insert({
        start_date: data.start_date,
        end_date: data.end_date,
        status: "OPEN",
        created_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const closeReconciliationPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("reconciliation_periods")
      .update({
        status: "CLOSED",
        closed_by: context.userId,
        closed_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reopenReconciliationPeriod = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("reconciliation_periods")
      .update({ status: "OPEN", closed_by: null, closed_at: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- AUDIT USERS MAP (master only) ----------
const MASTER_EMAIL_AUDIT = "drs.cachoeira@gmail.com";
export const listAuditUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const isMaster = context.claims?.email === MASTER_EMAIL_AUDIT;
    if (!isMaster) {
      const { data: roleRow } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId)
        .eq("role", "master")
        .maybeSingle();
      if (!roleRow) return [] as Array<{ id: string; email: string }>;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
    if (error) throw new Error(error.message);
    return data.users.map((u) => ({ id: u.id, email: u.email ?? "" }));
  });
