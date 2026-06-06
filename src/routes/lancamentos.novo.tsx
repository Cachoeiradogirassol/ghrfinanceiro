import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  listCostCenters,
  listAccounts,
  listBankAccounts,
  createTransaction,
} from "@/lib/finance.functions";
import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { toast } from "sonner";
import { Layers } from "lucide-react";

export const Route = createFileRoute("/lancamentos/novo")({
  head: () => ({ meta: [{ title: "Novo Lançamento — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Form />
    </AppLayout>
  ),
});

function Form() {
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const bkFn = useServerFn(listBankAccounts);
  const createFn = useServerFn(createTransaction);
  const nav = useNavigate();

  const ccs = useQuery({ queryKey: ["cc"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["acc"], queryFn: () => accFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bkFn() });

  const [type, setType] = useState<"payable" | "receivable">("payable");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [bankId, setBankId] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [docDt, setDocDt] = useState("");
  const [dueDate, setDueDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [isBatch, setIsBatch] = useState(false);

  const filteredAccounts = useMemo(
    () => (accs.data ?? []).filter((a) => a.cost_center_id === costCenterId),
    [accs.data, costCenterId],
  );

  const mut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          cost_center_id: costCenterId,
          account_id: accountId,
          bank_account_id: bankId || null,
          type,
          amount: parseFloat(amount),
          description: description || null,
          document_datetime: docDt ? new Date(docDt).toISOString() : null,
          due_date: dueDate,
          is_batch: isBatch,
          status: "pending",
        },
      }),
    onSuccess: () => {
      toast.success("Lançamento criado");
      nav({ to: "/lancamentos" });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-6">Novo Lançamento</h1>
      <Card className="p-6 space-y-5">
        <div>
          <Label>Tipo</Label>
          <RadioGroup
            value={type}
            onValueChange={(v) => setType(v as "payable" | "receivable")}
            className="flex gap-6 mt-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="payable" id="r1" />
              <Label htmlFor="r1">Conta a Pagar</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="receivable" id="r2" />
              <Label htmlFor="r2">Conta a Receber</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Bloco (Centro de Custo)</Label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {(ccs.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} - {c.name}
                    {c.master_only && " 🔒"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subcategoria</Label>
            <Select
              value={accountId}
              onValueChange={setAccountId}
              disabled={!costCenterId}
            >
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {filteredAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Valor (R$)</Label>
            <Input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div>
            <Label>Conta Bancária</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>
                {(banks.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Data/Hora da Nota</Label>
            <Input
              type="datetime-local"
              value={docDt}
              onChange={(e) => setDocDt(e.target.value)}
            />
          </div>
          <div>
            <Label>Vencimento</Label>
            <Input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <Label>Descrição</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Equipe Terceirizada — pagamento semanal"
          />
        </div>

        <label className="flex items-start gap-3 p-3 rounded-md border border-border bg-muted/30 cursor-pointer">
          <Checkbox
            checked={isBatch}
            onCheckedChange={(c) => setIsBatch(Boolean(c))}
          />
          <div>
            <span className="text-sm font-medium flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Este pagamento será fracionado no banco (Lote)
            </span>
            <p className="text-xs text-muted-foreground mt-1">
              Permite conciliar este lançamento contra múltiplas saídas
              menores no extrato bancário.
            </p>
          </div>
        </label>

        <div className="flex gap-2">
          <Button
            onClick={() => mut.mutate()}
            disabled={!costCenterId || !accountId || !amount || mut.isPending}
          >
            {mut.isPending ? "Salvando..." : "Salvar"}
          </Button>
          <Button variant="outline" onClick={() => nav({ to: "/lancamentos" })}>
            Cancelar
          </Button>
        </div>
      </Card>
    </div>
  );
}
