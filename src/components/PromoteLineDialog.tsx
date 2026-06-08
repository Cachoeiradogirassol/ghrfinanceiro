import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listCostCenters,
  listAccounts,
  promoteStatementLineToTransaction,
} from "@/lib/finance.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, FileDown } from "lucide-react";

const FINALISTIC = new Set([
  "turismo",
  "restaurante",
  "vinhedo",
  "ghr_aldeia",
  "ghr_jk",
]);

export type PendingLine = {
  id: string;
  statement_date: string;
  amount: number | string;
  description: string | null;
  bank_accounts?: { name?: string | null } | null;
};

export function PromoteLineDialog({
  line,
  open,
  onOpenChange,
}: {
  line: PendingLine | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const promoteFn = useServerFn(promoteStatementLineToTransaction);

  const ccQ = useQuery({
    queryKey: ["cost-centers"],
    queryFn: () => ccFn(),
    enabled: open,
  });
  const accQ = useQuery({
    queryKey: ["accounts"],
    queryFn: () => accFn(),
    enabled: open,
  });

  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [description, setDescription] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("__none__");

  useEffect(() => {
    if (!line) return;
    setCostCenterId("");
    setAccountId("");
    setDescription(line.description ?? "");
    setPaymentMethod("__none__");
  }, [line]);

  const amt = line ? Number(line.amount) : 0;
  const isPayable = amt < 0;
  const filteredAccounts = (accQ.data ?? []).filter((a) => {
    if (costCenterId && a.cost_center_id !== costCenterId) return false;
    if (a.is_active === false) return false;
    return isPayable ? a.kind === "expense" : a.kind === "revenue";
  });


  const mut = useMutation({
    mutationFn: async () => {
      if (!line) return;
      if (!costCenterId) throw new Error("Selecione o centro de custo");
      if (!accountId) throw new Error("Selecione a categoria");
      await promoteFn({
        data: {
          statement_line_id: line.id,
          cost_center_id: costCenterId,
          account_id: accountId,
          description: description || null,
          payment_method:
            paymentMethod === "__none__"
              ? null
              : (paymentMethod as "pix" | "boleto" | "credit_card" | "cash"),
        },
      });
    },
    onSuccess: () => {
      toast.success("Lançamento criado e conciliado");
      qc.invalidateQueries({ queryKey: ["lines"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-4 w-4" /> Categorizar movimento do extrato
          </DialogTitle>
          <DialogDescription>
            Movimento detectado no extrato bancário sem correspondente no sistema.
            Selecione o centro de custo finalístico e a categoria do plano de
            contas para consolidar o fluxo de caixa.
          </DialogDescription>
        </DialogHeader>

        {line && (
          <div className="rounded-md border bg-amber-500/5 border-amber-500/40 p-3 text-sm space-y-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-300">
                <Sparkles className="h-3 w-3" /> via extrato bancário
              </Badge>
              <span className="text-xs text-muted-foreground">
                {line.bank_accounts?.name ?? "—"}
              </span>
            </div>
            <div className="font-mono text-xs">
              {new Date(line.statement_date).toLocaleDateString("pt-BR")} •{" "}
              <span className={amt < 0 ? "text-destructive" : "text-primary"}>
                {amt.toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {line.description ?? "(sem descrição no extrato)"}
            </div>
          </div>
        )}

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Centro de Custo (finalístico)</Label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {(ccQ.data ?? [])
                  .filter((c) => FINALISTIC.has(c.enterprise ?? ""))
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} - {c.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Categoria ({isPayable ? "Despesa" : "Receita"})</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {filteredAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Descrição</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Beneficiário / histórico"
            />
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Salvando..." : "Consolidar lançamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
