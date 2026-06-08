import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listStatementLines,
  listTransactions,
  listBankAccounts,
  smartImportStatement,

  autoMatch,
  reconcile,
  listReconciliationPeriods,
  createReconciliationPeriod,
  closeReconciliationPeriod,
  reopenReconciliationPeriod,
  listAuditUsers,
  consolidateStatementRevenues,
  createUnverifiedExpenseDrafts,
} from "@/lib/finance.functions";
import { parseStatementFile } from "@/lib/statement-parser";
import { PromoteLineDialog, type PendingLine } from "@/components/PromoteLineDialog";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Upload,
  Link2,
  Layers,
  Lock,
  Unlock,
  CalendarRange,
  User,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/conciliacao")({
  head: () => ({
    meta: [
      { title: "Conciliação Bancária — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Concilie extratos bancários com lançamentos do CONTROLE.GHR usando sugestões automáticas de correspondência por data e valor.",
      },
      { property: "og:title", content: "Conciliação Bancária — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Concilie extratos bancários com lançamentos do CONTROLE.GHR usando sugestões automáticas de correspondência por data e valor.",
      },
      { property: "og:url", content: "https://ghrfinanceiro.lovable.app/conciliacao" },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/conciliacao" }],
  }),
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
  const importFn = useServerFn(smartImportStatement);
  const matchFn = useServerFn(autoMatch);
  const recFn = useServerFn(reconcile);
  const periodsFn = useServerFn(listReconciliationPeriods);
  const createPeriodFn = useServerFn(createReconciliationPeriod);
  const closePeriodFn = useServerFn(closeReconciliationPeriod);
  const reopenPeriodFn = useServerFn(reopenReconciliationPeriod);
  const usersFn = useServerFn(listAuditUsers);
  const consolidateFn = useServerFn(consolidateStatementRevenues);
  const draftsFn = useServerFn(createUnverifiedExpenseDrafts);
  const { isMaster } = useAuth();
  const qc = useQueryClient();

  const banks = useQuery({ queryKey: ["banks"], queryFn: () => banksFn() });
  const lines = useQuery({ queryKey: ["lines"], queryFn: () => linesFn() });
  const txs = useQuery({ queryKey: ["txs"], queryFn: () => txFn() });
  const periods = useQuery({
    queryKey: ["periods"],
    queryFn: () => periodsFn(),
  });
  const usersQ = useQuery({
    queryKey: ["audit-users"],
    queryFn: () => usersFn(),
    enabled: isMaster,
  });
  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    (usersQ.data ?? []).forEach((u) => m.set(u.id, u.email));
    return m;
  }, [usersQ.data]);
  const userLabel = (id?: string | null) =>
    id ? (userMap.get(id) ?? id.slice(0, 8)) : "—";

  const [importBankId, setImportBankId] = useState("");
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [highlightLineIds, setHighlightLineIds] = useState<Set<string>>(new Set());
  const [promoting, setPromoting] = useState<PendingLine | null>(null);


  // Filtro de período
  const todayIso = new Date().toISOString().slice(0, 10);
  const monthAgoIso = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  })();
  const [rangeStart, setRangeStart] = useState(monthAgoIso);
  const [rangeEnd, setRangeEnd] = useState(todayIso);

  const inRange = (iso: string) => iso >= rangeStart && iso <= rangeEnd;

  const filteredLines = (lines.data ?? []).filter((l) =>
    inRange(l.statement_date as string),
  );
  const filteredTxs = (txs.data ?? []).filter((t) => {
    const d =
      (t as { document_datetime?: string | null }).document_datetime?.slice(0, 10) ??
      (t.due_date as string);
    return inRange(d);
  });

  const handleCSV = async (file: File) => {
    if (!importBankId) {
      toast.error("Selecione uma conta bancária");
      return;
    }
    try {
      const rows = await parseStatementFile(file);
      if (rows.length === 0) {
        toast.error("Não foi possível extrair linhas do arquivo");
        return;
      }
      const res = await importFn({
        data: { bank_account_id: importBankId, lines: rows },
      });
      const parts = [
        `${res.matched_existing} conciliada(s) com lançamento existente`,
        `${res.pending_categorization} nova(s) aguardando categoria`,
        res.duplicates ? `${res.duplicates} duplicada(s) ignorada(s)` : null,
      ].filter(Boolean);
      toast.success(`Extrato processado: ${parts.join(" • ")}`);
      setHighlightLineIds(new Set(res.line_ids));
      qc.invalidateQueries({ queryKey: ["lines"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
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

  const closePeriod = useMutation({
    mutationFn: async () => {
      const created = await createPeriodFn({
        data: { start_date: rangeStart, end_date: rangeEnd },
      });
      await closePeriodFn({ data: { id: (created as { id: string }).id } });
    },
    onSuccess: () => {
      toast.success("Período encerrado. Lançamentos no intervalo estão bloqueados.");
      qc.invalidateQueries({ queryKey: ["periods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const reopenPeriod = useMutation({
    mutationFn: (id: string) => reopenPeriodFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Período reaberto");
      qc.invalidateQueries({ queryKey: ["periods"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const rangeLocked = (periods.data ?? []).some(
    (p) =>
      p.status === "CLOSED" &&
      !((p.end_date as string) < rangeStart || (p.start_date as string) > rangeEnd),
  );

  const selectedTxObj = filteredTxs.find((t) => t.id === selectedTx);
  const selectedSum = Array.from(selectedLines).reduce((s, id) => {
    const l = filteredLines.find((x) => x.id === id);
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

      {/* Filtro de período + encerramento */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground">De</label>
            <Input
              type="date"
              value={rangeStart}
              onChange={(e) => setRangeStart(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground">Até</label>
            <Input
              type="date"
              value={rangeEnd}
              onChange={(e) => setRangeEnd(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
        <div className="flex-1" />
        {rangeLocked ? (
          <Badge variant="destructive" className="gap-1">
            <Lock className="h-3 w-3" /> Período fechado
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <Unlock className="h-3 w-3" /> Aberto
          </Badge>
        )}
        {isMaster && !rangeLocked && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  `Encerrar período de ${rangeStart} a ${rangeEnd}? Lançamentos no intervalo ficarão BLOQUEADOS para edição.`,
                )
              )
                closePeriod.mutate();
            }}
            disabled={closePeriod.isPending}
          >
            <Lock className="h-4 w-4 mr-1" /> Encerrar Período
          </Button>
        )}
      </Card>

      {/* Períodos existentes */}
      {(periods.data?.length ?? 0) > 0 && (
        <Card className="p-4">
          <h2 className="font-semibold text-sm mb-2">Períodos</h2>
          <div className="space-y-1">
            {(periods.data ?? []).map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 text-xs border rounded px-2 py-1"
              >
                <Badge
                  variant={p.status === "CLOSED" ? "destructive" : "outline"}
                >
                  {p.status === "CLOSED" ? (
                    <Lock className="h-3 w-3 mr-1" />
                  ) : (
                    <Unlock className="h-3 w-3 mr-1" />
                  )}
                  {p.status}
                </Badge>
                <span className="font-mono">
                  {p.start_date} → {p.end_date}
                </span>
                {p.status === "CLOSED" && (
                  <span className="text-muted-foreground">
                    fechado por {userLabel(p.closed_by as string)} em{" "}
                    {p.closed_at
                      ? new Date(p.closed_at as string).toLocaleDateString("pt-BR")
                      : "—"}
                  </span>
                )}
                <div className="flex-1" />
                {isMaster && p.status === "CLOSED" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reopenPeriod.mutate(p.id as string)}
                  >
                    <Unlock className="h-3 w-3 mr-1" /> Reabrir
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

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
          accept=".csv,.ofx,.txt,.pdf,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleCSV(f);
            e.target.value = "";
          }}
          className="text-sm"
        />
        <span className="text-xs text-muted-foreground">
          Aceita <b>OFX</b>, <b>CSV</b> (BR: ; separador, vírgula decimal) ou{" "}
          <b>PDF</b> de extrato. O sistema detecta sinais (+/D = entrada, -/D =
          saída), preserva a data real de cada linha e ignora duplicidades.
        </span>
      </Card>

      {(() => {
        const pending = filteredLines.filter(
          (l) => !l.reconciled && !(l as { matched_transaction_id?: string | null }).matched_transaction_id,
        );
        if (pending.length === 0) return null;
        const credits = pending.filter((l) => Number(l.amount) > 0);
        const debits = pending.filter((l) => Number(l.amount) < 0);
        const creditsSum = credits.reduce((s, l) => s + Number(l.amount), 0);
        const debitsSum = debits.reduce((s, l) => s + Math.abs(Number(l.amount)), 0);
        const runBulk = async (fn: () => Promise<void>) => {
          try {
            await fn();
            qc.invalidateQueries({ queryKey: ["lines"] });
            qc.invalidateQueries({ queryKey: ["txs"] });
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
          }
        };
        return (
          <Card className="p-4 border-amber-500/40 bg-amber-500/5">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <h2 className="font-semibold text-sm flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-600" />
                Movimentos do extrato aguardando categorização ({pending.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="default"
                  disabled={credits.length === 0}
                  onClick={() =>
                    runBulk(async () => {
                      const r = await consolidateFn({
                        data: {
                          bank_account_id: importBankId || null,
                          start_date: rangeStart,
                          end_date: rangeEnd,
                        },
                      });
                      toast.success(
                        `Consolidação criada: ${r.created} lançamento(s) unificando ${r.lines} linha(s) — ${fmt(r.total)}`,
                      );
                    })
                  }
                  title={`${credits.length} crédito(s) • ${fmt(creditsSum)}`}
                >
                  Consolidar Entradas em Massa ({credits.length})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={debits.length === 0}
                  onClick={() =>
                    runBulk(async () => {
                      const r = await draftsFn({
                        data: {
                          bank_account_id: importBankId || null,
                          start_date: rangeStart,
                          end_date: rangeEnd,
                        },
                      });
                      toast.success(
                        `${r.created} rascunho(s) "Saída Sem Comprovação" criados — ${fmt(debitsSum)} aguardando justificativa.`,
                      );
                    })
                  }
                  title={`${debits.length} saída(s) sem nota • ${fmt(debitsSum)}`}
                >
                  Gerar Rascunhos de Saídas s/ Comprovação ({debits.length})
                </Button>
              </div>
            </div>

            <div className="space-y-1 max-h-64 overflow-y-auto">
              {pending.map((l) => {
                const isNew = highlightLineIds.has(l.id as string);
                return (
                  <div
                    key={l.id}
                    className={`flex items-center gap-3 p-2 rounded-md border text-sm bg-background ${
                      isNew ? "border-amber-500 ring-1 ring-amber-500/40" : "border-border"
                    }`}
                  >
                    <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700 dark:text-amber-300">
                      <Sparkles className="h-3 w-3" /> extrato
                    </Badge>
                    <span className="font-mono text-xs w-24">
                      {new Date(l.statement_date as string).toLocaleDateString("pt-BR")}
                    </span>
                    <span className="flex-1 truncate text-xs">{l.description ?? "(sem descrição)"}</span>
                    <span
                      className={`font-mono text-xs ${Number(l.amount) < 0 ? "text-destructive" : "text-primary"}`}
                    >
                      {fmt(Number(l.amount))}
                    </span>
                    <Button
                      size="sm"
                      onClick={() =>
                        setPromoting({
                          id: l.id as string,
                          statement_date: l.statement_date as string,
                          amount: l.amount as number,
                          description: (l.description ?? null) as string | null,
                          bank_accounts: (l as { bank_accounts?: { name?: string | null } | null }).bank_accounts ?? null,
                        })
                      }
                    >
                      Categorizar
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })()}



      {selectedTx && (
        <Card className="p-4 bg-primary/5 border-primary/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                Conciliando: {selectedTxObj?.description ?? "—"} —{" "}
                {fmt(Number(selectedTxObj?.amount ?? 0))}
              </p>
              <p className="text-xs text-muted-foreground">
                Selecionado: {fmt(selectedSum)} • {selectedLines.size} linha(s){" "}
                {sumMatches && (
                  <span className="text-primary font-medium">✓ Soma confere</span>
                )}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={doReconcile} disabled={!sumMatches}>
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
          <h2 className="font-semibold mb-3">
            Extrato Bancário{" "}
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredLines.length})
            </span>
          </h2>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {filteredLines.map((l) => (
              <label
                key={l.id}
                className={`flex items-center gap-3 p-2 rounded-md border text-sm cursor-pointer transition ${
                  l.reconciled
                    ? "opacity-60 bg-muted/30"
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
                  {new Date(l.statement_date as string).toLocaleDateString("pt-BR")}
                </span>
                <span className="flex-1 truncate text-xs">{l.description}</span>
                <span
                  className={`font-mono text-xs ${Number(l.amount) < 0 ? "text-destructive" : "text-primary"}`}
                >
                  {fmt(Number(l.amount))}
                </span>
                {l.reconciled && <Badge variant="outline">conciliado</Badge>}
                {isMaster &&
                  (l as { matched_by?: string }).matched_by && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <User className="h-3 w-3" />
                      {userLabel((l as { matched_by: string }).matched_by)}
                    </span>
                  )}
              </label>
            ))}
            {filteredLines.length === 0 && (
              <p className="text-muted-foreground text-sm p-4 text-center">
                Nenhuma linha no período.
              </p>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold mb-3">
            Lançamentos do Sistema{" "}
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredTxs.length})
            </span>
          </h2>
          <div className="space-y-1 max-h-[600px] overflow-y-auto">
            {filteredTxs
              .filter((t) => t.status !== "reconciled")
              .map((t) => {
                const competence =
                  (t as { document_datetime?: string | null }).document_datetime ??
                  (t.due_date as string);
                return (
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
                      {new Date(competence).toLocaleDateString("pt-BR")}
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
                    {isMaster && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <User className="h-3 w-3" />
                        {userLabel((t as { created_by?: string }).created_by)}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        </Card>
      </div>
      <PromoteLineDialog
        line={promoting}
        open={!!promoting}
        onOpenChange={(v) => { if (!v) setPromoting(null); }}
      />
    </div>
  );

}
