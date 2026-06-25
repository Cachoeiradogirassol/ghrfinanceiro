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
  const [fallbackCostCenterId, setFallbackCostCenterId] = useState<string>("");
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(false);

  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const importFn = useServerFn(importOpenFinanceText);

  const ccs = useQuery({ queryKey: ["cost-centers"], queryFn: () => ccFn(), enabled: open });
  const accs = useQuery({ queryKey: ["accounts"], queryFn: () => accFn(), enabled: open });

  const availableAccounts = useMemo(() => accs.data ?? [], [accs.data]);

  const process = async () => {
    if (text.trim().length < 20) {
      toast.error("Cole o conteúdo do extrato do Meu Pluggy antes de processar.");
      return;
    }
    if (!accountId) {
      toast.error("Selecione a conta de destino.");
      return;
    }
    setLoading(true);
    try {
      const res = await importFn({
        data: {
          text,
          default_cost_center_id: fallbackCostCenterId || undefined,
          default_account_id: accountId,
        },
      });
      toast.success(
        `Importação concluída: ${res.inserted} criados, ${res.skipped} ignorados de ${res.total} detectados.`,
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
            Pluggy e cole o conteúdo abaixo. A IA classifica <strong>linha por linha</strong>:
            <br />• <strong>InfinitePay</strong> → Restaurante
            <br />• <strong>Mercado Pago</strong> → Cachoeira do Girassol
            <br />• <strong>C6 Bank</strong> → Cachoeira do Girassol
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Conta de destino <span className="text-destructive">*</span>
            </label>
            <Select value={accountId} onValueChange={setAccountId}>
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
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">
              Centro de custo de fallback <span className="opacity-60">(opcional)</span>
            </label>
            <Select value={fallbackCostCenterId} onValueChange={setFallbackCostCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Só usado se IA não identificar o banco" />
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
        </div>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Cole aqui o texto copiado da página de fluxo de caixa do Meu Pluggy (pode misturar InfinitePay, Mercado Pago e C6 — a IA separa)…"
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
