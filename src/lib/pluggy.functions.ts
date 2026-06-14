import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertMaster(context: {
  supabase: { rpc: (name: "has_role", args: { _user_id: string; _role: "master" }) => PromiseLike<{ data: boolean | null }> };
  userId: string;
}) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "master",
  });
  if (!data) throw new Error("Apenas o Master pode gerenciar conexões Open Finance.");
}

export const createPluggyToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertMaster(context);
    const { createPluggyConnectToken } = await import("./pluggy.server");
    return { connectToken: await createPluggyConnectToken(context.userId) };
  });

export const completePluggyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ bank_account_id: z.string().uuid(), item_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context);
    const { listPluggyAccounts } = await import("./pluggy.server");
    const accounts = await listPluggyAccounts(data.item_id);
    const eligible = accounts.filter((account) => account.type !== "CREDIT");
    if (eligible.length === 0) throw new Error("Nenhuma conta transacional foi encontrada no Pluggy.");

    const selected = eligible[0];
    const { error } = await context.supabase
      .from("bank_accounts")
      .update({ pluggy_item_id: data.item_id, pluggy_account_id: selected.id })
      .eq("id", data.bank_account_id);
    if (error) throw new Error(error.message);
    return { accountName: selected.name, accountId: selected.id };
  });

const SyncInput = z.object({
  bank_account_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const syncPluggyExtracts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ context, data }) => {
    await assertMaster(context);
    const query = context.supabase
      .from("bank_accounts")
      .select("id, pluggy_account_id")
      .not("pluggy_account_id", "is", null);
    const { data: banks, error: banksError } = data.bank_account_id
      ? await query.eq("id", data.bank_account_id)
      : await query;
    if (banksError) throw new Error(banksError.message);

    const { listPluggyTransactions } = await import("./pluggy.server");
    let imported = 0;
    let ignored = 0;
    for (const bank of banks ?? []) {
      if (!bank.pluggy_account_id) continue;
      const remote = await listPluggyTransactions(bank.pluggy_account_id, data.from, data.to);
      const posted = remote.filter(
        (transaction) => transaction.status === "POSTED" && Number(transaction.amount) !== 0,
      );
      if (posted.length === 0) continue;
      const rows = posted.map((transaction) => ({
        bank_account_id: bank.id,
        transaction_date: transaction.date.slice(0, 10),
        description: transaction.description?.trim() || "Movimentação bancária",
        amount:
          transaction.direction === "DEBIT"
            ? -Math.abs(Number(transaction.amount))
            : transaction.direction === "CREDIT"
              ? Math.abs(Number(transaction.amount))
              : Number(transaction.amount),
        pluggy_transaction_id: transaction.id,
        status: "pending",
      }));
      const { data: inserted, error } = await context.supabase
        .from("bank_statement_extracts")
        .upsert(rows, { onConflict: "pluggy_transaction_id", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error(error.message);
      imported += inserted?.length ?? 0;
      ignored += rows.length - (inserted?.length ?? 0);
    }
    return { imported, ignored, connectedAccounts: banks?.length ?? 0 };
  });

export const suggestPluggyMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ context, data }) => {
    const extractsQuery = context.supabase
      .from("bank_statement_extracts")
      .select("id, bank_account_id, transaction_date, description, amount")
      .eq("status", "pending")
      .gte("transaction_date", data.from)
      .lte("transaction_date", data.to)
      .order("transaction_date");
    const { data: extracts, error: extractError } = data.bank_account_id
      ? await extractsQuery.eq("bank_account_id", data.bank_account_id)
      : await extractsQuery;
    if (extractError) throw new Error(extractError.message);

    const { data: transactions, error: txError } = await context.supabase
      .from("transactions")
      .select("id, bank_account_id, due_date, document_datetime, description, amount, type")
      .neq("status", "reconciled");
    if (txError) throw new Error(txError.message);

    const used = new Set<string>();
    const suggestions = (extracts ?? []).flatMap((extract) => {
      const extractTime = new Date(`${extract.transaction_date}T00:00:00Z`).getTime();
      const candidates = (transactions ?? [])
        .filter((transaction) => {
          if (used.has(transaction.id) || transaction.bank_account_id !== extract.bank_account_id) return false;
          if (Math.abs(Math.abs(Number(transaction.amount)) - Math.abs(Number(extract.amount))) > 0.01) return false;
          if ((Number(extract.amount) > 0) !== (transaction.type === "receivable")) return false;
          const date = transaction.document_datetime?.slice(0, 10) ?? transaction.due_date;
          return Math.abs(new Date(`${date}T00:00:00Z`).getTime() - extractTime) <= 3 * 86_400_000;
        })
        .sort((a, b) => {
          const aDate = a.document_datetime?.slice(0, 10) ?? a.due_date;
          const bDate = b.document_datetime?.slice(0, 10) ?? b.due_date;
          return Math.abs(new Date(`${aDate}T00:00:00Z`).getTime() - extractTime) - Math.abs(new Date(`${bDate}T00:00:00Z`).getTime() - extractTime);
        });
      const transaction = candidates[0];
      if (!transaction) return [];
      used.add(transaction.id);
      return [{
        extractId: extract.id,
        transactionId: transaction.id,
        bankAccountId: extract.bank_account_id,
        date: extract.transaction_date,
        description: extract.description,
        transactionDescription: transaction.description,
        amount: Number(extract.amount),
        type: transaction.type,
      }];
    });
    return { suggestions };
  });

export const confirmPluggyMatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ matches: z.array(z.object({ extract_id: z.string().uuid(), transaction_id: z.string().uuid() })).min(1).max(200) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertMaster(context);
    const { data: confirmed, error } = await context.supabase.rpc(
      "confirm_bank_statement_extract_matches",
      { _matches: data.matches },
    );
    if (error) throw new Error(error.message);
    return { confirmed: confirmed ?? 0 };
  });