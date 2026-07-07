import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, Wand2, FileSpreadsheet, Trash2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  interpretProjectionText,
  type AiInterpretedItem,
} from "@/lib/ai-projections.functions";
import { bulkCreateProjections } from "@/lib/projections.functions";
import {
  listCostCenters,
  listAccounts,
} from "@/lib/finance.functions";
import { AccountCombobox } from "@/components/AccountCombobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SELECTABLE_CC = ["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"];

type Row = AiInterpretedItem;

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AiProjectionTab() {
  const qc = useQueryClient();
  const interpretFn = useServerFn(interpretProjectionText);
  const bulkFn = useServerFn(bulkCreateProjections);
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);

  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["accs"], queryFn: () => accFn() });

  const selectableCCs = useMemo(
    () => (ccs.data ?? []).filter((c) => SELECTABLE_CC.includes(c.enterprise ?? "")),
    [ccs.data],
  );

  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const interpretMut = useMutation({
    mutationFn: async () => {
      if (text.trim().length < 3) throw new Error("Escreva o que deseja projetar.");
      return interpretFn({ data: { text: text.trim() } });
    },
    onSuccess: ({ items }) => {
      setRows(items);
      toast.success(`IA interpretou ${items.length} item(ns). Revise antes de confirmar.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const confirmMut = useMutation({
    mutationFn: async () => {
      const payload = rows.map((r, i) => {
        if (!r.name?.trim()) throw new Error(`Item ${i + 1}: nome obrigatório.`);
        if (!r.account_id) throw new Error(`Item ${i + 1}: selecione uma conta contábil.`);
        if (r.direction === "inflow" && !r.cost_center_id)
          throw new Error(`Item ${i + 1}: entradas exigem centro de custo.`);
        if (!Number.isFinite(r.initial_amount) || r.initial_amount <= 0)
          throw new Error(`Item ${i + 1}: valor inválido.`);
        return {
          name: r.name.trim(),
          direction: r.direction,
          cost_center_id: r.cost_center_id,
          account_id: r.account_id,
          default_bank_account_id: null,
          initial_amount: r.initial_amount,
          monthly_growth_rate: r.monthly_growth_rate ?? 0,
          start_date: r.start_date,
          horizon_months: r.horizon_months,
        };
      });
      return bulkFn({ data: { rows: payload } });
    },
    onSuccess: (res) => {
      toast.success(`${res.created} projeção(ões) criadas via IA.`);
      setRows([]);
      setText("");
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setConfirmOpen(false);
    },
  });

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const totals = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const r of rows) {
      const total = r.initial_amount * r.horizon_months;
      if (r.direction === "inflow") inflow += total;
      else outflow += total;
    }
    return { inflow, outflow, count: rows.length };
  }, [rows]);

  function handleExportXLSX() {
    if (rows.length === 0) {
      toast.error("Nada para exportar.");
      return;
    }
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(
      rows.map((r) => {
        const cc = (ccs.data ?? []).find((c) => c.id === r.cost_center_id);
        const acc = (accs.data ?? []).find((a) => a.id === r.account_id);
        return {
          Nome: r.name,
          Tipo: r.direction === "inflow" ? "Entrada" : "Saída",
          "Centro de Custo": cc ? `${cc.code} — ${cc.name}` : "",
          "Conta Contábil": acc?.name ?? "",
          "Valor (R$)": r.initial_amount,
          "Taxa %/mês": r.monthly_growth_rate,
          "Data Início": r.start_date,
          Horizonte: r.horizon_months,
          Confiança: r.confidence,
          Observação: r.observacao,
        };
      }),
    );
    XLSX.utils.book_append_sheet(wb, sheet, "Prévia IA");
    XLSX.writeFile(
      wb,
      `Projecoes_IA_Previa_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  }

  const accountsAll = (accs.data ?? []) as Array<{
    id: string;
    name: string;
    kind: string;
    cost_center_id?: string;
  }>;

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Projeção por IA — Linguagem Natural</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Descreva o que quer projetar, uma ideia por linha. Ex.: "Pneu do carro, despesa de 5 mil
          mês que vem"; "Entrada do loteamento JK vai entrar 30 mil"; "Projeto entrada de 32 mil e
          saída de 22 mil por mês de folha salarial pelos próximos 12 meses". A IA usa seu plano de
          contas e centros de custo reais para sugerir a classificação — nada é gravado até você
          confirmar.
        </p>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Descreva livremente as projeções que deseja criar…"
        />
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => interpretMut.mutate()}
            disabled={interpretMut.isPending || text.trim().length < 3}
          >
            <Wand2 className="h-4 w-4 mr-1" />
            {interpretMut.isPending ? "Interpretando…" : "Interpretar com IA"}
          </Button>
        </div>
      </Card>

      {rows.length > 0 && (
        <Card className="p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold">Prévia (revise antes de confirmar)</h3>
              <p className="text-xs text-muted-foreground">
                {totals.count} item(ns) · Entradas totais: {fmtBRL(totals.inflow)} · Saídas totais:{" "}
                {fmtBRL(totals.outflow)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleExportXLSX}>
                <FileSpreadsheet className="h-4 w-4 mr-1" /> Exportar prévia (Excel)
              </Button>
              <Button onClick={() => setConfirmOpen(true)}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Confirmar e criar projeções
              </Button>
            </div>
          </div>

          <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[180px]">Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="min-w-[180px]">Centro de Custo</TableHead>
                  <TableHead className="min-w-[240px]">Conta Contábil</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Taxa %/m</TableHead>
                  <TableHead>Início</TableHead>
                  <TableHead>Horiz.</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead className="min-w-[220px]">Observação IA</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, idx) => {
                  const wanted = row.direction === "inflow" ? "revenue" : "expense";
                  const accountsForRow = accountsAll.filter((a) => a.kind === wanted);
                  return (
                    <TableRow key={idx}>
                      <TableCell>
                        <Input
                          value={row.name}
                          onChange={(e) => updateRow(idx, { name: e.target.value })}
                          className="h-8"
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.direction}
                          onValueChange={(v) =>
                            updateRow(idx, {
                              direction: v as "inflow" | "outflow",
                              account_id: null,
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inflow">Entrada</SelectItem>
                            <SelectItem value="outflow">Saída</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.cost_center_id ?? ""}
                          onValueChange={(v) =>
                            updateRow(idx, { cost_center_id: v || null })
                          }
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="— selecione —" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectableCCs.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.code} — {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <AccountCombobox
                          accounts={accountsForRow}
                          costCenters={ccs.data ?? []}
                          localEnterprise={null}
                          value={row.account_id ?? ""}
                          onChange={(v) => updateRow(idx, { account_id: v || null })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={row.initial_amount}
                          onChange={(e) =>
                            updateRow(idx, { initial_amount: Number(e.target.value) })
                          }
                          className="h-8 w-[110px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.1"
                          value={row.monthly_growth_rate}
                          onChange={(e) =>
                            updateRow(idx, {
                              monthly_growth_rate: Number(e.target.value),
                            })
                          }
                          className="h-8 w-[90px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          value={row.start_date}
                          onChange={(e) => updateRow(idx, { start_date: e.target.value })}
                          className="h-8 w-[150px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          max={120}
                          value={row.horizon_months}
                          onChange={(e) =>
                            updateRow(idx, {
                              horizon_months: Math.max(
                                1,
                                Math.min(120, Number(e.target.value) || 1),
                              ),
                            })
                          }
                          className="h-8 w-[80px]"
                        />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.confidence === "alta"
                              ? "default"
                              : row.confidence === "media"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {row.confidence}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[260px]">
                        <div className="whitespace-normal">{row.observacao}</div>
                        {(!row.account_id || (row.direction === "inflow" && !row.cost_center_id)) && (
                          <div className="text-destructive mt-1">
                            ⚠ Preencha manualmente os campos em branco.
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => removeRow(idx)}
                          className="h-7 w-7"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar criação de projeções</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <p>
              Serão criadas <strong>{totals.count}</strong> projeção(ões):
            </p>
            <ul className="list-disc pl-5 text-muted-foreground">
              <li>Entradas totais projetadas: {fmtBRL(totals.inflow)}</li>
              <li>Saídas totais projetadas: {fmtBRL(totals.outflow)}</li>
              <li>Líquido: {fmtBRL(totals.inflow - totals.outflow)}</li>
            </ul>
            <p className="text-xs text-muted-foreground">
              As projeções serão salvas em <code>cash_projections</code>. Você pode ajustá-las
              depois na aba "Projeções Manuais".
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}>
              {confirmMut.isPending ? "Salvando…" : "Confirmar e criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
