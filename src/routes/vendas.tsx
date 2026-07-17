import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ShoppingBag, CheckCheck, Trash2 } from "lucide-react";
import { listCostCenters } from "@/lib/finance.functions";
import {
  createSalesBatch,
  listSalesBatches,
  closeSalesBatch,
  deleteSalesBatch,
} from "@/lib/sales.functions";

export const Route = createFileRoute("/vendas")({
  head: () => ({
    meta: [
      { title: "Vendas Consolidadas — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Registre lotes de vendas consolidadas (débito, crédito e pix) do Restaurante e Cachoeira, acompanhe o recebimento e apure a taxa de cartão no fechamento.",
      },
      { property: "og:title", content: "Vendas Consolidadas — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Registre lotes de vendas consolidadas do Restaurante e Cachoeira, acompanhe o recebimento e apure a taxa de cartão.",
      },
    ],
  }),
  component: () => (
    <AppLayout>
      <VendasPage />
    </AppLayout>
  ),
});

const SUPPORTED_ENTERPRISES = new Set(["turismo", "restaurante"]);

function fmt(n: number) {
  return Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(n: number) {
  return `${(n * 100).toFixed(2).replace(".", ",")}%`;
}

function VendasPage() {
  const ccFn = useServerFn(listCostCenters);
  const listFn = useServerFn(listSalesBatches);
  const createFn = useServerFn(createSalesBatch);
  const closeFn = useServerFn(closeSalesBatch);
  const deleteFn = useServerFn(deleteSalesBatch);
  const qc = useQueryClient();

  const costCenters = useQuery({ queryKey: ["cost-centers"], queryFn: () => ccFn() });
  const batches = useQuery({ queryKey: ["sales-batches"], queryFn: () => listFn() });

  const validCcs = useMemo(
    () =>
      (costCenters.data ?? []).filter(
        (c) => SUPPORTED_ENTERPRISES.has(String(c.enterprise)) && c.is_active,
      ),
    [costCenters.data],
  );
  const ccById = useMemo(() => {
    const m = new Map<string, { name: string; enterprise: string | null }>();
    for (const c of costCenters.data ?? []) {
      m.set(c.id, { name: c.name, enterprise: c.enterprise });
    }
    return m;
  }, [costCenters.data]);

  const today = new Date().toISOString().slice(0, 10);
  const [costCenterId, setCostCenterId] = useState<string>("");
  const [refDate, setRefDate] = useState<string>(today);
  const [grossDebit, setGrossDebit] = useState<string>("");
  const [grossCredit, setGrossCredit] = useState<string>("");
  const [grossPix, setGrossPix] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);

  const num = (s: string) => {
    const v = Number(String(s).replace(",", "."));
    return Number.isFinite(v) ? v : 0;
  };
  const total = num(grossDebit) + num(grossCredit) + num(grossPix);

  const handleCreate = async () => {
    if (!costCenterId) return toast.error("Escolha o centro de custo.");
    if (total <= 0) return toast.error("Informe pelo menos um valor bruto.");
    setSaving(true);
    try {
      await createFn({
        data: {
          cost_center_id: costCenterId,
          reference_date: refDate,
          gross_debit: num(grossDebit),
          gross_credit: num(grossCredit),
          gross_pix: num(grossPix),
        },
      });
      toast.success("Lote de vendas registrado. Receita bruta lançada como recebível.");
      setGrossDebit("");
      setGrossCredit("");
      setGrossPix("");
      qc.invalidateQueries({ queryKey: ["sales-batches"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar lote.");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = async (id: string) => {
    setClosingId(id);
    try {
      const res = await closeFn({ data: { id } });
      if (res.divergence) {
        toast.warning(res.divergence);
      } else if (res.fee > 0) {
        toast.success(`Lote fechado. Taxa apurada: ${fmt(res.fee)}.`);
      } else {
        toast.success("Lote fechado sem taxa (recebido = bruto).");
      }
      qc.invalidateQueries({ queryKey: ["sales-batches"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao fechar lote.");
    } finally {
      setClosingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Apagar este lote? A receita e a taxa vinculadas também serão removidas.")) return;
    try {
      await deleteFn({ data: { id } });
      toast.success("Lote apagado.");
      qc.invalidateQueries({ queryKey: ["sales-batches"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao apagar lote.");
    }
  };

  const list = batches.data ?? [];
  const open = list.filter((b) => b.status === "open");
  const closed = list.filter((b) => b.status === "closed");

  return (
    <div className="p-6 md:p-8 space-y-6">
      <header className="flex items-center gap-3">
        <ShoppingBag className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vendas Consolidadas</h1>
          <p className="text-sm text-muted-foreground">
            Registre o bruto vendido (débito, crédito e pix) por dia. As entradas nas maquininhas
            abatem o lote na conciliação; ao fechar, a diferença vira Taxa de Cartão.
          </p>
        </div>
      </header>

      {/* FORMULÁRIO */}
      <Card className="p-5 space-y-4">
        <h2 className="text-lg font-semibold">Registrar novo lote</h2>
        <div className="grid gap-4 md:grid-cols-5">
          <div className="space-y-1.5 md:col-span-2">
            <Label>Centro de custo</Label>
            <Select value={costCenterId} onValueChange={setCostCenterId}>
              <SelectTrigger>
                <SelectValue placeholder="Escolha…" />
              </SelectTrigger>
              <SelectContent>
                {validCcs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.enterprise ? ` · ${c.enterprise}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Data</Label>
            <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Bruto débito</Label>
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={grossDebit}
              onChange={(e) => setGrossDebit(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Bruto crédito</Label>
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={grossCredit}
              onChange={(e) => setGrossCredit(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Bruto pix</Label>
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={grossPix}
              onChange={(e) => setGrossPix(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Total bruto: </span>
            <span className="text-lg font-semibold">{fmt(total)}</span>
          </div>
          <Button onClick={handleCreate} disabled={saving || total <= 0 || !costCenterId}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Registrar lote
          </Button>
        </div>
      </Card>

      {/* LOTES ABERTOS */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Lotes em aberto
          <Badge variant="secondary">{open.length}</Badge>
        </h2>
        {batches.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : open.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nenhum lote em aberto.</Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {open.map((b) => {
              const cc = ccById.get(b.cost_center_id);
              const missing = Math.max(0, Number(b.gross_total) - Number(b.received_amount));
              return (
                <Card key={b.id} className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{cc?.name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        Referência: {b.reference_date}
                      </p>
                    </div>
                    <Badge>ABERTO</Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Débito</p>
                      <p>{fmt(Number(b.gross_debit))}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Crédito</p>
                      <p>{fmt(Number(b.gross_credit))}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Pix</p>
                      <p>{fmt(Number(b.gross_pix))}</p>
                    </div>
                  </div>
                  <div className="border-t pt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Declarado</p>
                      <p className="font-medium">{fmt(Number(b.gross_total))}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Recebido</p>
                      <p className="font-medium">{fmt(Number(b.received_amount))}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Falta</p>
                      <p className="font-medium text-amber-600">{fmt(missing)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => handleClose(b.id)}
                      disabled={closingId === b.id}
                    >
                      {closingId === b.id ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <CheckCheck className="h-4 w-4 mr-2" />
                      )}
                      Marcar como recebido por completo
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(b.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* LOTES FECHADOS */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          Lotes fechados
          <Badge variant="outline">{closed.length}</Badge>
        </h2>
        {closed.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">Nenhum lote fechado ainda.</Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-3 text-left">Centro de custo</th>
                    <th className="p-3 text-left">Data</th>
                    <th className="p-3 text-right">Bruto</th>
                    <th className="p-3 text-right">Recebido</th>
                    <th className="p-3 text-right">Taxa</th>
                    <th className="p-3 text-right">Taxa efetiva</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {closed.map((b) => {
                    const gross = Number(b.gross_total);
                    const fee = Number(b.fee_amount ?? 0);
                    const eff = gross > 0 ? fee / gross : 0;
                    const cc = ccById.get(b.cost_center_id);
                    return (
                      <tr key={b.id} className="border-t">
                        <td className="p-3">{cc?.name ?? "—"}</td>
                        <td className="p-3">{b.reference_date}</td>
                        <td className="p-3 text-right">{fmt(gross)}</td>
                        <td className="p-3 text-right">{fmt(Number(b.received_amount))}</td>
                        <td className="p-3 text-right">{fmt(fee)}</td>
                        <td className="p-3 text-right">{pct(eff)}</td>
                        <td className="p-3 text-right">
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(b.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}
