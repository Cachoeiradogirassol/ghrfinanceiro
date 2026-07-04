import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RecurrenceSchema = z
  .object({
    enabled: z.boolean(),
    frequency: z.enum(["monthly", "weekly"]),
    installments: z.number().int().min(2).max(24),
  })
  .partial()
  .optional();

const QuickInput = z.object({
  description: z.string().trim().min(1).max(300),
  amount: z.number().positive(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  account_id: z.string().uuid(),
  recurrence: RecurrenceSchema,
});

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function getOrCreateDefaultContact(supabase: {
  from: (t: string) => {
    select: (
      cols: string,
    ) => {
      ilike: (
        col: string,
        val: string,
      ) => { maybeSingle: () => Promise<{ data: { id: string } | null }> };
    };
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => {
        single: () => Promise<{ data: { id: string } | null; error: { message: string } | null }>;
      };
    };
  };
}): Promise<string> {
  const existing = await supabase
    .from("contacts")
    .select("id")
    .ilike("name", "Lançamento Rápido")
    .maybeSingle();
  if (existing.data) return existing.data.id;

  const docNum = String(Date.now()).padStart(11, "0").slice(-11);
  const created = await supabase
    .from("contacts")
    .insert({
      name: "Lançamento Rápido",
      type: "FORNECEDOR",
      document_type: "PF",
      document_number: docNum,
      master_only: false,
    })
    .select("id")
    .single();
  if (created.error || !created.data)
    throw new Error("Falha ao criar contato padrão: " + (created.error?.message ?? ""));
  return created.data.id;
}

export const createQuickTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => QuickInput.parse(d))
  .handler(async ({ context, data }) => {
    // Resolve conta → cost_center + tipo
    const { data: acc, error: aErr } = await context.supabase
      .from("accounts")
      .select("id, name, kind, cost_center_id, is_active")
      .eq("id", data.account_id)
      .maybeSingle();
    if (aErr) throw new Error(aErr.message);
    if (!acc || !acc.is_active) throw new Error("Conta inválida ou inativa.");
    if (!acc.cost_center_id) throw new Error("Conta sem centro de custo definido.");
    const type: "receivable" | "payable" = acc.kind === "revenue" ? "receivable" : "payable";

    const contactId = await getOrCreateDefaultContact(
      context.supabase as unknown as Parameters<typeof getOrCreateDefaultContact>[0],
    );

    const rec = data.recurrence;
    const useRec = rec?.enabled && rec.frequency && rec.installments && rec.installments >= 2;
    const groupId = useRec
      ? (globalThis.crypto?.randomUUID?.() ?? String(Date.now()))
      : null;
    const total = useRec ? (rec!.installments as number) : 1;

    type TxInsert = {
      cost_center_id: string;
      account_id: string;
      contact_id: string;
      type: "receivable" | "payable";
      amount: number;
      due_date: string;
      description: string;
      status: "pending";
      is_batch: boolean;
      created_by: string;
    };
    const rows: TxInsert[] = [];
    for (let i = 0; i < total; i++) {
      const dueDate =
        !useRec || i === 0
          ? data.due_date
          : rec!.frequency === "weekly"
            ? addDays(data.due_date, 7 * i)
            : addMonths(data.due_date, i);
      const baseDesc = data.description.trim();
      const suffix = useRec ? ` (${i + 1}/${total})` : "";
      const tag = useRec ? `[REC ${groupId}] ` : "";
      const description = `${tag}${baseDesc}${suffix}`.slice(0, 500);
      rows.push({
        cost_center_id: acc.cost_center_id,
        account_id: acc.id,
        contact_id: contactId,
        type,
        amount: data.amount,
        due_date: dueDate,
        description,
        status: "pending",
        is_batch: false,
        created_by: context.userId,
      });
    }

    const { data: inserted, error } = await context.supabase
      .from("transactions")
      .insert(rows)
      .select("id");
    if (error) throw new Error("Falha ao criar lançamento: " + error.message);
    return { created: inserted?.length ?? 0, group_id: groupId };
  });

export const deleteRecurringGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ group_id: z.string().min(4), only_future: z.boolean().default(true) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const today = new Date().toISOString().slice(0, 10);
    let q = context.supabase
      .from("transactions")
      .delete({ count: "exact" })
      .ilike("description", `%[REC ${data.group_id}]%`)
      .neq("status", "reconciled");
    if (data.only_future) q = q.gte("due_date", today);
    const { error, count } = await q;
    if (error) throw new Error(error.message);
    return { deleted: count ?? 0 };
  });
