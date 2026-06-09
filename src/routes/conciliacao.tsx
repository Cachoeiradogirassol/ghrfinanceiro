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
import { parseStatementDocument } from "@/lib/statement-parser";
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
  FileUp,
  Loader2,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
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

function cents(n: number) {
  return Math.round(n * 100) / 100;
}

type CashAudit = {
  fileName: string;
  bankName: string;
  systemBalance: number;
  finalBalance: number;
  importedEntries: number;
  importedExits: number;
  calculatedFinalBalance: number;
  difference: number;
};

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
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [processingFileName, setProcessingFileName] = useState<string | null>(null);
  const [cashAudit, setCashAudit] = useState<CashAudit | null>(null);


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

  const handleStatementFile = async (file: File) => {
    // Reset all previous state (cache purge)
    setHighlightLineIds(new Set());
    setSelectedLines(new Set());
    setCashAudit(null);
    setProcessingFileName(file.name);

    const toastId = `import-${Date.now()}`;
    toast.loading(`Recebi "${file.name}". Paulo está auditando o extrato…`, { id: toastId });

    if (!importBankId) {
      toast.error("Selecione uma conta bancária antes de enviar o arquivo", { id: toastId });
      setProcessingFileName(null);
      return;
    }

    setIsProcessing(true);

    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
    const isPdf = ext === ".pdf" || file.type === "application/pdf";
    const isCsv = ext === ".csv" || file.type === "text/csv" || file.type === "application/vnd.ms-excel";
    const isOfx = ext === ".ofx";

    if (!isPdf && !isCsv && !isOfx) {
      toast.error(`Formato "${ext || file.type || "desconhecido"}" não suportado. Envie PDF, CSV ou OFX.`, { id: toastId });
      setIsProcessing(false);
      setProcessingFileName(null);
      return;
    }

    let parsed: Awaited<ReturnType<typeof parseStatementDocument>>;
    try {
      parsed = await parseStatementDocument(file);
    } catch (e) {
      console.error("[Conciliação] Falha ao ler o arquivo", e);
      toast.error(
        `Falha ao ler "${file.name}": ${e instanceof Error ? e.message : String(e)}`,
        { id: toastId, duration: 8000 },
      );
      setIsProcessing(false);
      setProcessingFileName(null);
      return;
    }

    const rows = parsed.lines;
    if (rows.length === 0) {
      toast.error(
        `Nenhuma linha de transação foi encontrada em "${file.name}". Confira se o PDF é digital (não escaneado) ou se o CSV tem o formato esperado.`,
        { id: toastId, duration: 8000 },
      );
      setIsProcessing(false);
      setProcessingFileName(null);
      return;
    }

    try {
      const res = await importFn({
        data: { bank_account_id: importBankId, lines: rows },
      });
      const parts = [
        `${res.matched_existing} conciliada(s) com lançamento existente`,
        `${res.pending_categorization} nova(s) aguardando categoria`,
        res.duplicates ? `${res.duplicates} duplicada(s) ignorada(s)` : null,
      ].filter(Boolean);
      toast.success(`Extrato processado: ${parts.join(" • ")}`, { id: toastId });
      setHighlightLineIds(new Set(res.line_ids));
      const selectedBank = (banks.data ?? []).find((b) => b.id === importBankId);
      if (isPdf && parsed.finalBalance !== null && selectedBank) {
        const importedEntries = rows
          .filter((row) => row.amount > 0)
          .reduce((sum, row) => sum + row.amount, 0);
        const importedExits = rows
          .filter((row) => row.amount < 0)
          .reduce((sum, row) => sum + Math.abs(row.amount), 0);
        const systemBalance = getSystemBalanceForBank(importBankId);
        const calculatedFinalBalance = systemBalance + importedEntries - importedExits;
        setCashAudit({
          fileName: file.name,
          bankName: selectedBank.name,
          systemBalance,
          finalBalance: parsed.finalBalance,
          importedEntries: cents(importedEntries),
          importedExits: cents(importedExits),
          calculatedFinalBalance: cents(calculatedFinalBalance),
          difference: cents(calculatedFinalBalance - parsed.finalBalance),
        });
      } else if (isPdf) {
        toast.warning("PDF importado, mas o Saldo Final não foi localizado no texto do extrato.");
      }
      qc.invalidateQueries({ queryKey: ["lines"] });
      qc.invalidateQueries({ queryKey: ["txs"] });
    } catch (e) {
      console.error("[Conciliação] Falha ao importar linhas", e);
      toast.error(
        `Erro ao importar para o banco: ${e instanceof Error ? e.message : String(e)}`,
        { id: toastId, duration: 8000 },
      );
    } finally {
      setIsProcessing(false);
      setProcessingFileName(null);
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

  const getSystemBalanceForBank = (bankId: string) => {
    const bank = (banks.data ?? []).find((b) => b.id === bankId);
    let balance = Number(bank?.initial_balance ?? 0);
    for (const tx of txs.data ?? []) {
      if ((tx as { bank_account_id?: string | null }).bank_account_id !== bankId) continue;
      if (tx.status !== "paid" && tx.status !== "reconciled") continue;
      balance += tx.type === "receivable" ? Number(tx.amount) : -Number(tx.amount);
    }
    return cents(balance);
  };

  return (
    <div className="relative p-8 space-y-6">
      {isProcessing && (
        <div className="absolute inset-0 z-50 flex items-start justify-center rounded-xl bg-background/75 p-8 pt-40 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-xl">
            <Loader2 className="mx-auto mb-3 h-9 w-9 animate-spin text-primary" />
            <p className="text-base font-semibold">Processando PDF do extrato…</p>
            <p className="mt-1 text-sm text-muted-foreground">
              A conciliação ficará bloqueada até a leitura terminar{processingFileName ? `: ${processingFileName}` : ""}.
            </p>
          </div>
        </div>
      )}
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

      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Upload className="h-3 w-3" /> Conta bancária de destino
            </label>
            <Select value={importBankId} onValueChange={setImportBankId} disabled={isProcessing}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Selecione a conta…" />
              </SelectTrigger>
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

        <label
          htmlFor="statement-file-input"
          onDragOver={(e) => {
            e.preventDefault();
            if (!isProcessing) setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (isProcessing) return;
            const f = e.dataTransfer.files?.[0];
            if (f) handleStatementFile(f);
          }}
          className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
            isProcessing
              ? "border-muted bg-muted/30 cursor-not-allowed pointer-events-none"
              : isDragging
                ? "border-primary bg-primary/10 ring-2 ring-primary/30 cursor-pointer"
                : "border-border bg-muted/20 hover:border-primary/60 hover:bg-primary/5 cursor-pointer"
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
              <div className="space-y-1">
                <p className="text-base font-semibold">Processando extrato bancário…</p>
                <p className="text-sm text-muted-foreground">
                  Extraindo dados de fluxo de caixa{processingFileName ? ` de "${processingFileName}"` : ""}.
                </p>
              </div>
              <div className="w-full max-w-md space-y-2 pt-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-4/6" />
              </div>
            </>
          ) : (
            <>
              <div className={`rounded-full p-4 ${isDragging ? "bg-primary/20" : "bg-primary/10"}`}>
                <FileUp className={`h-10 w-10 ${isDragging ? "text-primary" : "text-primary/80"}`} />
              </div>
              <div className="space-y-1">
                <p className="text-lg font-semibold">
                  Arraste e solte seu extrato (PDF, CSV ou OFX) aqui
                </p>
                <p className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                  <FileText className="h-3.5 w-3.5" /> Saídas: enviado/pago/tarifa • Entradas: recebido/crédito/depósito
                </p>
              </div>
              <Button type="button" variant="default" className="mt-1 pointer-events-none">
                <Upload className="h-4 w-4 mr-2" /> Ou clique para selecionar o arquivo
              </Button>
            </>
          )}
          <input
            id="statement-file-input"
            type="file"
            accept=".pdf,application/pdf,.csv,text/csv,.ofx"
            disabled={isProcessing}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleStatementFile(f);
              e.target.value = "";
            }}
            className="sr-only"
          />
        </label>
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
                  disabled={credits.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
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
                  ▲ Consolidar Entradas em Massa ({credits.length})
                </Button>
                <Button
                  size="sm"
                  disabled={debits.length === 0}
                  className="bg-rose-600 hover:bg-rose-700 text-white"
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
                  ▼ Gerar Rascunhos de Saídas s/ Comprovação ({debits.length})
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 max-h-[520px] overflow-y-auto pr-1">
              {pending.map((l) => {
                const isNew = highlightLineIds.has(l.id as string);
                const isCredit = Number(l.amount) > 0;
                return (
                  <div
                    key={l.id}
                    className={`rounded-xl border-2 bg-card p-5 shadow-sm transition hover:shadow-md ${
                      isNew
                        ? "ring-2 ring-amber-500/60 border-amber-500/60"
                        : isCredit
                          ? "border-emerald-500/30"
                          : "border-rose-500/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <Badge
                        className={
                          isCredit
                            ? "bg-emerald-600 hover:bg-emerald-600 text-white border-0"
                            : "bg-rose-600 hover:bg-rose-600 text-white border-0"
                        }
                      >
                        {isCredit ? "ENTRADA" : "SAÍDA"}
                      </Badge>
                      <span className="font-mono text-sm font-medium text-muted-foreground">
                        {new Date(l.statement_date as string).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                    <p className="text-sm font-medium leading-snug mb-3 line-clamp-2 min-h-[2.5rem]">
                      {l.description ?? "(sem descrição)"}
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={`text-xl font-bold tabular-nums ${
                          isCredit ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {isCredit ? "+ " : "- "}
                        {fmt(Math.abs(Number(l.amount)))}
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

      {cashAudit && (() => {
        const audited = Math.abs(cashAudit.difference) < 0.01;
        return (
          <Card className={`p-5 border-2 ${audited ? "border-emerald-500/60 bg-emerald-500/5" : "border-rose-500/60 bg-rose-500/5"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold">Auditoria de Batimento de Caixa</h2>
                <p className="text-sm text-muted-foreground">
                  {cashAudit.bankName} • {cashAudit.fileName}
                </p>
              </div>
              <Badge
                className={
                  audited
                    ? "bg-emerald-600 hover:bg-emerald-600 text-white border-0 text-sm px-3 py-1"
                    : "bg-rose-600 hover:bg-rose-600 text-white border-0 text-sm px-3 py-1"
                }
              >
                {audited ? "CONCILIAÇÃO DO SEED AUDITADA (100% CORRETA)" : `Diferença: ${fmt(Math.abs(cashAudit.difference))}`}
              </Badge>
            </div>

            {audited && (
              <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="text-sm font-medium text-emerald-700">
                  Paulo: A precisão cirúrgica da gestão privada é a salvaguarda do capital real contra as distorções monetárias — aqui o caixa protege o capital de verdade.
                </p>
              </div>
            )}

            {!audited && (
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-rose-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="text-sm font-medium">
                  O cálculo importado não bateu com o saldo final do PDF. Revise lançamentos duplicados, ausentes ou com sinal invertido.
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Saldo atual no sistema</p>
                <p className="text-base font-bold tabular-nums">{fmt(cashAudit.systemBalance)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Entradas importadas</p>
                <p className="text-base font-bold tabular-nums text-emerald-600">+ {fmt(cashAudit.importedEntries)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Saídas importadas</p>
                <p className="text-base font-bold tabular-nums text-rose-600">− {fmt(cashAudit.importedExits)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Resultado calculado</p>
                <p className="text-base font-bold tabular-nums">{fmt(cashAudit.calculatedFinalBalance)}</p>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <p className="text-xs text-muted-foreground">Saldo final real do PDF</p>
                <p className="text-base font-bold tabular-nums">{fmt(cashAudit.finalBalance)}</p>
              </div>
            </div>
          </Card>
        );
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h2 className="font-semibold mb-3">
            Extrato Bancário{" "}
            <span className="text-xs text-muted-foreground font-normal">
              ({filteredLines.length})
            </span>
          </h2>
          <div className="space-y-3 max-h-[600px] pr-1 overflow-y-auto">
            {filteredLines.map((l) => {
              const isCredit = Number(l.amount) > 0;
              return (
                <label
                  key={l.id}
                  className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition ${
                    l.reconciled
                      ? "opacity-60 bg-muted/30 border-border"
                      : selectedLines.has(l.id)
                        ? "bg-primary/10 border-primary"
                        : `hover:bg-accent ${isCredit ? "border-emerald-500/30" : "border-rose-500/30"}`
                  }`}
                >
                  <Checkbox
                    checked={selectedLines.has(l.id)}
                    disabled={l.reconciled || !selectedTx}
                    onCheckedChange={() => toggleLine(l.id)}
                  />
                  <Badge
                    className={
                      isCredit
                        ? "bg-emerald-600 hover:bg-emerald-600 text-white border-0"
                        : "bg-rose-600 hover:bg-rose-600 text-white border-0"
                    }
                  >
                    {isCredit ? "+" : "−"}
                  </Badge>
                  <span className="font-mono text-sm w-24 font-medium">
                    {new Date(l.statement_date as string).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex-1 truncate text-sm">{l.description}</span>
                  <span
                    className={`font-mono text-base font-bold tabular-nums ${isCredit ? "text-emerald-600" : "text-rose-600"}`}
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
              );
            })}
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
          <div className="space-y-3 max-h-[600px] pr-1 overflow-y-auto">
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
