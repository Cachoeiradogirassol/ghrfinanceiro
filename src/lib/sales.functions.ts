import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Contas contábeis fixas (por nome dentro de cada centro de custo)
const REVENUE_ACCOUNT_NAME = "faturamento vendas";
const FEE_ACCOUNT_NAME = "taxas de cartão";

type SalesBatchRow = {
  id: string;
  cost_center_id: string;
  reference_date: string;
  gross_debit: number;
  gross_credit: number;
  gross_pix: number;
  gross_total: number;
  status: "open" | "closed";
  received_amount: number;
  fee_amount: number | null;
  revenue_transaction_id: string | null;
  fee_transaction_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// -------------------- LISTAR LOTES --------------------
export const listSalesBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          order: (
            col: string,
            opts?: { ascending?: boolean },
          ) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
    const { data, error } = await db
      .from("sales_batches")
      .select(
        "*, cost_centers(id, name, code, enterprise), revenue_transaction:transactions!sales_batches_revenue_transaction_id_fkey(id, status), fee_transaction:transactions!sales_batches_fee_transaction_id_fkey(id, status)",
      )
      .order("reference_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<
      SalesBatchRow & {
        cost_centers: { id: string; name: string; code: string | null; enterprise: string | null };
      }
    >;
  });

// -------------------- CRIAR LOTE --------------------
const CreateInput = z.object({
  cost_center_id: z.string().uuid(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gross_debit: z.number().finite().nonnegative().default(0),
  gross_credit: z.number().finite().nonnegative().default(0),
  gross_pix: z.number().finite().nonnegative().default(0),
});

export const createSalesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const total = data.gross_debit + data.gross_credit + data.gross_pix;
    if (total <= 0) throw new Error("Informe pelo menos um valor bruto (débito, crédito ou pix).");

    // Localizar conta contábil de receita "Faturamento Vendas" no centro de custo
    const { data: accs, error: accErr } = await context.supabase
      .from("accounts")
      .select("id, name, kind")
      .eq("cost_center_id", data.cost_center_id)
      .eq("kind", "revenue")
      .eq("is_active", true);
    if (accErr) throw new Error(accErr.message);
    const revenueAcc = (accs ?? []).find((a) => norm(a.name) === REVENUE_ACCOUNT_NAME);
    if (!revenueAcc) {
      throw new Error(
        'Conta de receita "Faturamento Vendas" não encontrada nesse centro de custo.',
      );
    }

    // 1) Cria o lote
    const db = context.supabase as unknown as {
      from: (t: string) => {
        insert: (row: unknown) => {
          select: (s: string) => {
            single: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
        update: (row: unknown) => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { data: batchIns, error: batchErr } = await db
      .from("sales_batches")
      .insert({
        cost_center_id: data.cost_center_id,
        reference_date: data.reference_date,
        gross_debit: data.gross_debit,
        gross_credit: data.gross_credit,
        gross_pix: data.gross_pix,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (batchErr) throw new Error(batchErr.message);
    const batchId = (batchIns as { id: string }).id;

    // 2) Lança receita bruta como recebível pendente
    const { data: txIns, error: txErr } = await context.supabase
      .from("transactions")
      .insert({
        cost_center_id: data.cost_center_id,
        account_id: revenueAcc.id,
        type: "receivable",
        amount: Number(total.toFixed(2)),
        description: `Vendas consolidadas ${data.reference_date} [LOTE ${batchId.slice(0, 8)}]`,
        due_date: data.reference_date,
        document_datetime: `${data.reference_date}T12:00:00Z`,
        status: "pending",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (txErr) throw new Error(txErr.message);

    // 3) Vincula
    const { error: linkErr } = await db
      .from("sales_batches")
      .update({ revenue_transaction_id: (txIns as { id: string }).id })
      .eq("id", batchId);
    if (linkErr) throw new Error(linkErr.message);

    return { id: batchId };
  });

// -------------------- VINCULAR LINHAS DE EXTRATO --------------------
const AttachInput = z.object({
  sales_batch_id: z.string().uuid(),
  statement_line_ids: z.array(z.string().uuid()).min(1).max(500),
});

export const attachLinesToBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => AttachInput.parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as {
      from: (t: string) => {
        update: (row: unknown) => {
          in: (col: string, v: string[]) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await db
      .from("bank_statement_lines")
      .update({
        sales_batch_id: data.sales_batch_id,
        reconciled: true,
        matched_by: context.userId,
        matched_at: new Date().toISOString(),
      })
      .in("id", data.statement_line_ids);
    if (error) throw new Error(error.message);
    return { attached: data.statement_line_ids.length };
  });

// -------------------- DESVINCULAR --------------------
export const detachLinesFromBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ statement_line_ids: z.array(z.string().uuid()).min(1).max(500) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as {
      from: (t: string) => {
        update: (row: unknown) => {
          in: (col: string, v: string[]) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { error } = await db
      .from("bank_statement_lines")
      .update({ sales_batch_id: null, reconciled: false, matched_by: null, matched_at: null })
      .in("id", data.statement_line_ids);
    if (error) throw new Error(error.message);
    return { detached: data.statement_line_ids.length };
  });

// -------------------- FECHAR LOTE (APURA TAXA) --------------------
export const closeSalesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (col: string, v: string) => {
            single: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
        update: (row: unknown) => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { data: batchRaw, error: bErr } = await db
      .from("sales_batches")
      .select("*")
      .eq("id", data.id)
      .single();
    if (bErr) throw new Error(bErr.message);
    const batch = batchRaw as SalesBatchRow;
    if (batch.status === "closed") throw new Error("Este lote já está fechado.");

    const gross = Number(batch.gross_total);
    const received = Number(batch.received_amount);
    const fee = Number((gross - received).toFixed(2));
    let feeTxId: string | null = null;
    let divergence: string | null = null;

    if (fee > 0.005) {
      // Localizar conta de despesa "Taxas de Cartão"
      const { data: accs, error: accErr } = await context.supabase
        .from("accounts")
        .select("id, name")
        .eq("cost_center_id", batch.cost_center_id)
        .eq("kind", "expense")
        .eq("is_active", true);
      if (accErr) throw new Error(accErr.message);
      const feeAcc = (accs ?? []).find((a) => norm(a.name) === FEE_ACCOUNT_NAME);
      if (!feeAcc) {
        throw new Error('Conta de despesa "Taxas de Cartão" não encontrada nesse centro de custo.');
      }
      const today = new Date().toISOString().slice(0, 10);
      const { data: txIns, error: txErr } = await context.supabase
        .from("transactions")
        .insert({
          cost_center_id: batch.cost_center_id,
          account_id: feeAcc.id,
          type: "payable",
          amount: fee,
          description: `Taxa de cartão apurada — lote ${batch.reference_date} [${batch.id.slice(0, 8)}]`,
          due_date: today,
          document_datetime: `${today}T12:00:00Z`,
          status: "reconciled",
          paid_at: new Date().toISOString(),
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (txErr) throw new Error(txErr.message);
      feeTxId = (txIns as { id: string }).id;
    } else if (received - gross > 0.005) {
      divergence = `Recebido (${received.toFixed(2)}) maior que o bruto declarado (${gross.toFixed(2)}). Nenhuma taxa foi lançada.`;
    }

    const { error: updErr } = await db
      .from("sales_batches")
      .update({
        status: "closed",
        fee_amount: fee > 0.005 ? fee : 0,
        fee_transaction_id: feeTxId,
        closed_at: new Date().toISOString(),
        closed_by: context.userId,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    return { fee, divergence };
  });

// -------------------- APAGAR LOTE (limpa vínculos e reverte lançamento) --------
export const deleteSalesBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as {
      from: (t: string) => {
        select: (s: string) => {
          eq: (col: string, v: string) => {
            single: () => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
        update: (row: unknown) => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
        delete: () => {
          eq: (col: string, v: string) => Promise<{ error: { message: string } | null }>;
        };
      };
    };
    const { data: batchRaw, error: bErr } = await db
      .from("sales_batches")
      .select("*")
      .eq("id", data.id)
      .single();
    if (bErr) throw new Error(bErr.message);
    const batch = batchRaw as SalesBatchRow;

    // Solta os vínculos das linhas
    await db
      .from("bank_statement_lines")
      .update({ sales_batch_id: null, reconciled: false, matched_by: null, matched_at: null })
      .eq("sales_batch_id" as string, data.id);

    // Apaga transações vinculadas
    if (batch.revenue_transaction_id) {
      await context.supabase.from("transactions").delete().eq("id", batch.revenue_transaction_id);
    }
    if (batch.fee_transaction_id) {
      await context.supabase.from("transactions").delete().eq("id", batch.fee_transaction_id);
    }

    const { error: delErr } = await db.from("sales_batches").delete().eq("id", data.id);
    if (delErr) throw new Error(delErr.message);
    return { ok: true };
  });
