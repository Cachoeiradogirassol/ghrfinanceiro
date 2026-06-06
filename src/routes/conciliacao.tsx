import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listStatementLines,
  listTransactions,
  listBankAccounts,
  importStatementLines,
  autoMatch,
  reconcile,
} from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { Sparkles, Upload, Link2, Layers } from "lucide-react";

export const Route = createFileRoute("/conciliacao")({
  head: () => ({ meta: [{ title: "Conciliação — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Conc />
    </AppLayout>
  ),
});

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Conc() {
  const linesFn = useServerFn(listStatementLines);
  const txFn = useServerFn(listTransactions);
  const banksFn = useServerFn(listBankAccounts);
  const importFn = useServerFn(importStatementLines);
  const matchFn = useServerFn(autoMatch);
  const recFn = useServerFn(reconcile);
  const qc = useQueryClient();

  const banks = useQuery({ queryKey: ["banks"], queryFn: () => banksFn() });
  const lines = useQuery({
    queryKey: ["lines"],
    queryFn: () => linesFn(),
  });
  const txs = useQuery({ queryKey: ["txs"], queryFn: () => txFn() });

  const [importBankId, setImportBankId] = useState("");
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());

  const handleCSV = async (file: File) => {
    if (!importBankId) {
      toast.error("Selecione uma conta bancária");
      return;
    }
    const text = await file.text();
    const rows = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(file.name.endsWith(".csv") ? 1 : 0)
      .map((l) => {
        const [date, amount, ...desc] = l.split(/[,;\t]/);
        return {
          statement_date: date,
          amount: parseFloat(amount),
          description: desc.join(",").trim(),
        };
      })
      .filter((r) => !isNaN(r.amount) && r.statement_date);

    try {
      const res = await importFn({
        data: { bank_account_id: importBankId, lines: rows },
      });
      toast.success(`${res.inserted} linhas importadas`);
      qc.invalidateQueries({ queryKey: ["lines"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const runAutoMatch = async () => {
    const r = await matchFn();
    toast.success(`${r.matched} sugestões automáticas`);
    qc.invalidateQueries({ queryKey: ["lines"] });
  };

  const toggleLine = (id: string) => {
    const next = new Set(selectedLines);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedLines(next);
  };

  const doReconcile = async () => {
    if (!selectedTx || selectedLines.size === 0) return;
    try {
      await recFn({
        data: {
          transaction_id: selectedTx,
          statement_line_ids: Array.from(selectedLines),
        },
      });
      toast.success("Conciliação concluída");
      setSelectedTx(null);
      setSelectedLines(new Set());
      qc.invalidateQueries({ queryKey: ["lines"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  };

  const selectedTxObj = (txs.data ?? []).find((t) => t.id === selectedTx);
  const selectedSum = Array.from(selectedLines).reduce((s, id) => {
    const l = (lines.data ?? []).find((x) => x.id === id);
    return s + (l ? Math.abs(Number(l.amount)) : 0);
  }, 0);
  const sumMatches = selectedTxObj
    ? Math.abs(selectedSum - Number(selectedTxObj.amount)) < 0.01
    : false;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Conciliação Bancária</h1>
          <p className="text-muted-foreground">
            Confronte o extrato com os lançamentos do sistema
          </p>
        </div>
        <Button onClick={runAutoMatch}>
          <Sparkles className="h-4 w-4 mr-2" /> Sugerir Matches
        </Button>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Upload className="h-4 w-4 text-muted-foreground" />
        <Select value={importBankId} onValueChange={setImportBankId}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Conta bancária" />
          </SelectTrigger>
          <SelectContent>
            {(banks.data ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <input
          type="file"
          accept=".csv,.ofx,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCSV(f);
            e.target.value = "";
          }}
          className="text-sm"
        />
        <span className="text-xs text-muted-foreground">
          CSV: data,valor,descrição (ex: 2026-06-01,-2800,Folha)
        </span>
      </Card>

      {selectedTx && (
        <Card className="p-4 bg-primary/5 border-primary/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                Conciliando: {selectedTxObj?.description ?? "—"} —{" "}
                {fmt(Number(selectedTxObj?.amount ?? 0))}
              </p>
              <p className="text-xs text-muted-foreground">
                Selecionado: {fmt(selectedSum)} •{" "}
                {selectedLines.size} linha(s){" "}
                {sumMatches && (
                  <span className="text-primary font-medium">✓ Soma confere</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={doReconcile}
                disabled={!sumMatches}
              >
                <Link2 className="h-4 w-4 mr-1" /> Conciliar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSelectedTx(null);
                  setSelectedLines(new Set());
                }}
              >
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">Extrato Bancário</h2>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {(lines.data ?? []).map((l) => (
              <label
                key={l.id}
                className={`flex items-center gap-3 p-2 rounded-md border text-sm cursor-pointer transition ${
                  l.reconciled
                    ? "opacity-50 bg-muted/30"
                    : selectedLines.has(l.id)
                      ? "bg-primary/10 border-primary"
                      : "hover:bg-accent border-border"
                }`}
              >
                <Checkbox
                  checked={selectedLines.has(l.id)}
                  disabled={l.reconciled || !selectedTx}
                  onCheckedChange={() => toggleLine(l.id)}
                />
                <span className="font-mono text-xs w-24">
                  {new Date(l.statement_date).toLocaleDateString("pt-BR")}
                </span>
                <span className="flex-1 truncate text-xs">
                  {l.description}
                </span>
                <span
                  className={`font-mono text-xs ${Number(l.amount) < 0 ? "text-destructive" : "text-primary"}`}
                >
                  {fmt(Number(l.amount))}
                </span>
                {l.reconciled && <Badge variant="outline">conciliado</Badge>}
              </label>
            ))}
            {(lines.data?.length ?? 0) === 0 && (
              <p className="text-muted-foreground text-sm p-4 text-center">
                Importe um extrato CSV/OFX.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-3">Lançamentos do Sistema</h2>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {(txs.data ?? [])
              .filter((t) => t.status !== "reconciled")
              .map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setSelectedTx(t.id);
                    setSelectedLines(new Set());
                  }}
                  className={`w-full text-left flex items-center gap-3 p-2 rounded-md border text-sm transition ${
                    selectedTx === t.id
                      ? "bg-primary/10 border-primary"
                      : "hover:bg-accent border-border"
                  }`}
                >
                  <span className="font-mono text-xs w-24">
                    {new Date(t.due_date).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex-1 truncate text-xs">
                    {t.description ?? t.accounts?.name}
                    {t.is_batch && (
                      <Layers className="h-3 w-3 inline ml-1 text-primary" />
                    )}
                  </span>
                  <span
                    className={`font-mono text-xs ${
                      t.type === "receivable"
                        ? "text-primary"
                        : "text-destructive"
                    }`}
                  >
                    {fmt(Number(t.amount))}
                  </span>
                </button>
              ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
