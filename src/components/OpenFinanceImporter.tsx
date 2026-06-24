import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listAccounts, listCostCenters } from "@/lib/finance.functions";
import { importOpenFinanceText } from "@/lib/openfinance-import.functions";

export function OpenFinanceImporter({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [costCenterId, setCostCenterId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);

  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const importFn = useServerFn(importOpenFinanceText);

  const ccs = useQuery({ queryKey: ["cost-centers"], queryFn: () => ccFn(), enabled: open });
  const accs = useQuery({ queryKey: ["accounts"], queryFn: () => accFn(), enabled: open });

  const availableAccounts = useMemo(
    () => (accs.data ?? []).filter((a) => !costCenterId || a.cost_center_id === costCenterId),
    [accs.data, costCenterId],
  );

  const process = async () => {
    if (text.trim().length < 20) {
      toast.error("Cole o conteúdo do extrato do Meu Pluggy antes de processar.");
      return;
    }
    if (!costCenterId || !accountId) {
      toast.error("Selecione um centro de custo e uma conta padrão.");
      return;
    }
    setLoading(true);
    try {
      const res = await importFn({
        data: {
          text,
          default_cost_center_id: costCenterId,
          default_account_id: accountId,
        },
      });
      toast.success(
        `Importação concluída: ${res.inserted} criados, ${res.skipped} duplicados de ${res.total} detectados.`,
      );
      setText("");
      setOpen(false);
      onImported?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha na importação";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          📥 Importador Rápido Open Finance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>📥 Importador Rápido Open Finance</DialogTitle>
          <DialogDescription>
            Dê <kbd className="px-1 rounded border">Ctrl+A</kbd> e{" "}
            <kbd className="px-1 rounded border">Ctrl+C</kbd> na página de fluxo de caixa do Meu
            Pluggy e cole o conteúdo abaixo. A IA vai identificar data, valor, descrição e
            instituição (InfinitePay → Restaurante automaticamente).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Centro de custo padrão</label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {(ccs.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Conta padrão</label>
            <Select value={accountId} onValueChange={setAccountId} disabled={!costCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Cole aqui o texto copiado da página de fluxo de caixa do Meu Pluggy…"
          className="min-h-[260px] font-mono text-xs"
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={process} disabled={loading}>
            {loading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 mr-2" />
            )}
            Processar Transações com IA
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
