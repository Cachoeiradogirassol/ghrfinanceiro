import { useMemo, useRef, useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Zap, Loader2, Repeat } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountCombobox } from "@/components/AccountCombobox";
import { listAccounts, listCostCenters } from "@/lib/finance.functions";
import { createQuickTransaction } from "@/lib/quick-launch.functions";

type Account = {
  id: string;
  name: string;
  kind: string;
  cost_center_id?: string | null;
  is_active?: boolean;
};

export function QuickLaunchForm({ onCreated }: { onCreated?: () => void }) {
  const qc = useQueryClient();
  const accFn = useServerFn(listAccounts);
  const ccFn = useServerFn(listCostCenters);
  const createFn = useServerFn(createQuickTransaction);

  const accs = useQuery({ queryKey: ["accs"], queryFn: () => accFn() });
  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });

  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [freq, setFreq] = useState<"monthly" | "weekly">("monthly");
  const [installments, setInstallments] = useState("2");

  const descRef = useRef<HTMLInputElement>(null);

  const activeAccounts = useMemo<Account[]>(
    () => ((accs.data ?? []) as Account[]).filter((a) => a.is_active !== false),
    [accs.data],
  );
  const selectedAcc = activeAccounts.find((a) => a.id === accountId);
  const inferredType: "receivable" | "payable" | null = selectedAcc
    ? selectedAcc.kind === "revenue"
      ? "receivable"
      : "payable"
    : null;

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount.replace(",", "."));
      if (!description.trim()) throw new Error("Descrição obrigatória.");
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Valor inválido.");
      if (!dueDate) throw new Error("Data de vencimento obrigatória.");
      if (!accountId) throw new Error("Selecione a categoria.");
      const n = parseInt(installments, 10);
      if (recurring && (!Number.isFinite(n) || n < 2 || n > 24))
        throw new Error("Parcelas entre 2 e 24.");
      return createFn({
        data: {
          description: description.trim(),
          amount: amt,
          due_date: dueDate,
          account_id: accountId,
          recurrence: recurring
            ? { enabled: true, frequency: freq, installments: n }
            : undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(
        res.created === 1
          ? "Lançamento criado."
          : `${res.created} parcelas criadas.`,
      );
      setDescription("");
      setAmount("");
      // mantém dueDate/account/recorrência para digitação em série
      qc.invalidateQueries({ queryKey: ["txs"] });
      onCreated?.();
      setTimeout(() => descRef.current?.focus(), 30);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    descRef.current?.focus();
  }, []);

  return (
    <Card className="p-4">
      <form
        className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_2fr_auto] items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mut.isPending) mut.mutate();
        }}
      >
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground flex items-center gap-1">
            <Zap className="h-3 w-3" /> Descrição
          </label>
          <Input
            ref={descRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Aluguel restaurante"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Valor (R$)</label>
          <Input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Vencimento</label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">
            Categoria {inferredType ? `→ ${inferredType === "receivable" ? "Receber" : "Pagar"}` : ""}
          </label>
          <AccountCombobox
            accounts={activeAccounts}
            costCenters={(ccs.data ?? []) as never}
            value={accountId}
            onChange={setAccountId}
          />
        </div>
        <div>
          <Button type="submit" disabled={mut.isPending} className="w-full">
            {mut.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Zap className="h-4 w-4 mr-1" /> Salvar
              </>
            )}
          </Button>
        </div>

        <div className="md:col-span-5 flex flex-wrap items-center gap-3 text-sm border-t pt-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={recurring}
              onCheckedChange={(v) => setRecurring(Boolean(v))}
              aria-label="Repetir"
            />
            <span className="flex items-center gap-1">
              <Repeat className="h-3 w-3" /> Repetir
            </span>
          </label>
          {recurring && (
            <>
              <Select value={freq} onValueChange={(v: "monthly" | "weekly") => setFreq(v)}>
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="weekly">Semanal</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Parcelas</span>
                <Input
                  className="w-20 h-8"
                  inputMode="numeric"
                  value={installments}
                  onChange={(e) => setInstallments(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <span className="text-xs text-muted-foreground">
                Gera {installments || "N"} lançamentos pendentes agrupados por tag.
              </span>
            </>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            Enter para salvar · foco volta para descrição
          </span>
        </div>
      </form>
    </Card>
  );
}
