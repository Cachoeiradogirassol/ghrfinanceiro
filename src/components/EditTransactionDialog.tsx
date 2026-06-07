import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { updateTransaction, listBankAccounts } from "@/lib/finance.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

type Tx = {
  id: string;
  amount: number | string;
  due_date: string;
  document_datetime: string | null;
  description: string | null;
  bank_account_id: string | null;
  payment_method: string | null;
  status: string;
  cost_center_id: string;
};

export function EditTransactionDialog({
  tx,
  open,
  onOpenChange,
}: {
  tx: Tx | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateTransaction);
  const banksFn = useServerFn(listBankAccounts);
  const banksQ = useQuery({
    queryKey: ["bank-accounts-edit"],
    queryFn: () => banksFn(),
    enabled: open,
  });

  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [docDate, setDocDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("");
  const [status, setStatus] = useState<string>("pending");

  useEffect(() => {
    if (!tx) return;
    setBankAccountId(tx.bank_account_id ?? "__none__");
    setDescription(tx.description ?? "");
    setAmount(String(tx.amount));
    setDueDate(tx.due_date?.slice(0, 10) ?? "");
    setDocDate(tx.document_datetime ? tx.document_datetime.slice(0, 10) : "");
    setPaymentMethod(tx.payment_method ?? "__none__");
    setStatus(tx.status ?? "pending");
  }, [tx]);

  const mut = useMutation({
    mutationFn: async () => {
      if (!tx) return;
      const patch: Record<string, unknown> = {};
      const newBank = bankAccountId === "__none__" ? null : bankAccountId;
      if (newBank !== (tx.bank_account_id ?? null)) patch.bank_account_id = newBank;
      if (description !== (tx.description ?? "")) patch.description = description || null;
      const amt = Number(amount.replace(",", "."));
      if (!Number.isNaN(amt) && amt > 0 && amt !== Number(tx.amount)) patch.amount = amt;
      if (dueDate && dueDate !== tx.due_date?.slice(0, 10)) patch.due_date = dueDate;
      const currentDoc = tx.document_datetime ? tx.document_datetime.slice(0, 10) : "";
      if (docDate !== currentDoc) patch.document_datetime = docDate ? new Date(docDate).toISOString() : null;
      const pm = paymentMethod === "__none__" ? null : paymentMethod;
      if (pm !== (tx.payment_method ?? null)) patch.payment_method = pm;
      if (status !== tx.status) patch.status = status;
      if (Object.keys(patch).length === 0) {
        toast.info("Nenhuma alteração para salvar");
        return;
      }
      await updateFn({ data: { id: tx.id, patch } });
    },
    onSuccess: () => {
      toast.success("Lançamento atualizado");
      qc.invalidateQueries({ queryKey: ["txs"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Lançamento</DialogTitle>
          <DialogDescription>
            Centro de custo e categoria não são alterados aqui — para mudá-los, exclua e recrie o lançamento.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Conta Bancária</Label>
            <Select value={bankAccountId} onValueChange={setBankAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhuma —</SelectItem>
                {(banksQ.data ?? [])
                  .filter((b) => b.is_active !== false)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Vencimento</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Competência</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Valor (R$)</Label>
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="paid">Pago</SelectItem>
                  <SelectItem value="reconciled">Conciliado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Forma de Pagamento</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                <SelectItem value="pix">PIX</SelectItem>
                <SelectItem value="boleto">Boleto</SelectItem>
                <SelectItem value="credit_card">Cartão de Crédito</SelectItem>
                <SelectItem value="cash">Dinheiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
