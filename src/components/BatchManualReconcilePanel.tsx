import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listTransactions,
  listStatementLines,
  listBankAccounts,
  listCostCenters,
  batchManualReconcile,
} from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Layers,
  ScanLine,
} from "lucide-react";

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

type Tx = {
  id: string;
  amount: number;
  status: string;
  type: string;
  description: string | null;
  due_date: string;
  document_datetime?: string | null;
  cost_center_id: string | null;
  bank_account_id: string | null;
  cost_centers?: { name?: string | null; enterprise?: string | null } | null;
};

type Line = {
  id: string;
  amount: number;
  reconciled: boolean;
  statement_date: string;
  description: string | null;
  bank_account_id: string;
  bank_accounts?: { name?: string | null; enterprise?: string | null } | null;
};

export function BatchManualReconcilePanel({
  rangeStart,
  rangeEnd,
}: {
  rangeStart: string;
  rangeEnd: string;
}) {
  const txFn = useServerFn(listTransactions);
  const linesFn = useServerFn(listStatementLines);
  const banksFn = useServerFn(listBankAccounts);
  const ccFn = useServerFn(listCostCenters);
  const reconcileFn = useServerFn(batchManualReconcile);
  const qc = useQueryClient();

  const txs = useQuery({ queryKey: ["txs"], queryFn: () => txFn() });
  const lines = useQuery({ queryKey: ["lines"], queryFn: () => linesFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => banksFn() });
  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });

  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [selectedLineIds, setSelectedLineIds] = useState<Set<string>>(new Set());
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [refBankId, setRefBankId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [mixedPrompt, setMixedPrompt] = useState<null | {
    cost_centers: { id: string; name: string; enterprise: string | null }[];
  }>(null);
  const [chosenTargetCc, setChosenTargetCc] = useState<string>("");

  const inRange = (iso: string) => iso >= rangeStart && iso <= rangeEnd;
  const searchLower = search.trim().toLowerCase();

  const pendingTxs = useMemo(
    () =>
      ((txs.data ?? []) as Tx[]).filter((t) => {
        if (t.status === "reconciled") return false;
        const d = (t.document_datetime ?? t.due_date ?? "").slice(0, 10);
        if (!inRange(d)) return false;
        if (searchLower && !(t.description ?? "").toLowerCase().includes(searchLower)) return false;
        return true;
      }),
    [txs.data, rangeStart, rangeEnd, searchLower],
  );

  const pendingLines = useMemo(
    () =>
      ((lines.data ?? []) as Line[]).filter((l) => {
        if (l.reconciled) return false;
        if (!inRange(l.statement_date)) return false;
        if (bankFilter !== "all" && l.bank_account_id !== bankFilter) return false;
        if (searchLower && !(l.description ?? "").toLowerCase().includes(searchLower)) return false;
        return true;
      }),
    [lines.data, rangeStart, rangeEnd, bankFilter, searchLower],
  );

  const sumTxs = Array.from(selectedTxIds).reduce((s, id) => {
    const t = (txs.data as Tx[] | undefined)?.find((x) => x.id === id);
    return s + (t ? Math.abs(Number(t.amount)) : 0);
  }, 0);
  const sumLines = Array.from(selectedLineIds).reduce((s, id) => {
    const l = (lines.data as Line[] | undefined)?.find((x) => x.id === id);
    return s + (l ? Math.abs(Number(l.amount)) : 0);
  }, 0);

  const hasLines = selectedLineIds.size > 0;
  const sumMatches = hasLines
    ? Math.abs(sumTxs - sumLines) < 0.01 && sumTxs > 0
    : sumTxs > 0 && !!refBankId;

  // Detecta banco automaticamente pelas linhas.
  const linesBankId = useMemo(() => {
    const ids = new Set(
      Array.from(selectedLineIds)
        .map((id) => (lines.data as Line[] | undefined)?.find((l) => l.id === id)?.bank_account_id)
        .filter(Boolean),
    );
    return ids.size === 1 ? (Array.from(ids)[0] as string) : "";
  }, [selectedLineIds, lines.data]);

  const effectiveBankId = linesBankId || refBankId;
  const effectiveBank = (banks.data ?? []).find((b) => b.id === effectiveBankId);

  // Analisa enterprises dos CCs selecionados vs banco → prevê aporte.
  const selectedTxObjs = ((txs.data ?? []) as Tx[]).filter((t) => selectedTxIds.has(t.id));
  const txEnts = new Set(
    selectedTxObjs.map((t) => t.cost_centers?.enterprise ?? null).filter(Boolean),
  );
  const bankEnt = effectiveBank?.enterprise ?? null;
  const willBeAporte = Boolean(
    effectiveBankId && txEnts.size === 1 && bankEnt && Array.from(txEnts)[0] !== bankEnt,
  );
  const mixedEnts = txEnts.size > 1;

  const reset = () => {
    setSelectedTxIds(new Set());
    setSelectedLineIds(new Set());
    setMixedPrompt(null);
    setChosenTargetCc("");
  };

  const submit = async (confirmMixed = false, targetCcId?: string) => {
    if (!sumMatches) return;
    setBusy(true);
    try {
      const res = await reconcileFn({
        data: {
          transaction_ids: Array.from(selectedTxIds),
          statement_line_ids: hasLines ? Array.from(selectedLineIds) : [],
          bank_account_id: hasLines ? undefined : effectiveBankId,
          confirm_mixed: confirmMixed,
          target_cost_center_id: targetCcId,
        },
      });
      if ("requires_confirmation" in res && res.requires_confirmation) {
        setMixedPrompt({ cost_centers: res.cost_centers });
        toast.warning("Vários empreendimentos misturados. Escolha o CC de destino do aporte.");
        setBusy(false);
        return;
      }
      const parts = [
        `${res.reconciled_transactions} lanç. conciliados`,
        res.reconciled_lines ? `${res.reconciled_lines} linha(s) do extrato` : null,
        res.aporte_created ? `APORTE de ${fmt(res.aporte_amount)} registrado` : null,
      ].filter(Boolean);
      toast.success(parts.join(" • "));
      reset();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["txs"] }),
        qc.invalidateQueries({ queryKey: ["lines"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao conciliar em lote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5 space-y-4 border-2 border-primary/30">
      <div className="flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-primary" />
        <div>
          <h2 className="font-semibold">Conciliação manual em lote</h2>
          <p className="text-xs text-muted-foreground">
            Selecione N lançamentos + M linhas do extrato que <b>somam o mesmo valor</b>. Se o banco
            pertencer a outro empreendimento, o sistema registra um APORTE automático.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground">Filtrar por banco</label>
          <Select value={bankFilter} onValueChange={setBankFilter}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os bancos</SelectItem>
              {(banks.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-muted-foreground">Buscar descrição</label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ex: 200"
            className="w-56"
          />
        </div>
        {!hasLines && (
          <div className="flex flex-col">
            <label className="text-xs text-muted-foreground">
              Banco de referência (sem linhas)
            </label>
            <Select value={refBankId} onValueChange={setRefBankId}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Selecione…" />
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
        )}
        <Button variant="outline" size="sm" onClick={reset}>
          Limpar seleção
        </Button>
      </div>

      {/* Duas colunas */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lançamentos */}
        <div className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 text-xs">
            <span className="font-medium">
              Lançamentos ({pendingTxs.length}) — selecionados: {selectedTxIds.size}
            </span>
            <span className="font-mono font-semibold">{fmt(sumTxs)}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {pendingTxs.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center">Nada pendente.</p>
            )}
            {pendingTxs.map((t) => {
              const checked = selectedTxIds.has(t.id);
              const d = (t.document_datetime ?? t.due_date ?? "").slice(0, 10);
              return (
                <label
                  key={t.id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent/40 ${checked ? "bg-primary/10" : ""}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      const next = new Set(selectedTxIds);
                      if (next.has(t.id)) next.delete(t.id);
                      else next.add(t.id);
                      setSelectedTxIds(next);
                    }}
                  />
                  <span className="font-mono text-xs w-20 shrink-0">
                    {d ? new Date(d).toLocaleDateString("pt-BR") : "—"}
                  </span>
                  <span className="flex-1 truncate text-xs">
                    {t.description ?? "—"}{" "}
                    <span className="text-muted-foreground">
                      · {t.cost_centers?.name ?? "?"}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-xs w-24 text-right tabular-nums ${
                      t.type === "receivable" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {fmt(Number(t.amount))}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Linhas do extrato */}
        <div className="rounded-md border">
          <div className="flex items-center justify-between px-3 py-2 bg-muted/50 text-xs">
            <span className="font-medium">
              Extrato ({pendingLines.length}) — selecionados: {selectedLineIds.size}
            </span>
            <span className="font-mono font-semibold">{fmt(sumLines)}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto divide-y">
            {pendingLines.length === 0 && (
              <p className="text-xs text-muted-foreground p-4 text-center">
                Nenhuma linha pendente no período (opcional — dá para conciliar sem elas).
              </p>
            )}
            {pendingLines.map((l) => {
              const checked = selectedLineIds.has(l.id);
              const isCredit = Number(l.amount) > 0;
              return (
                <label
                  key={l.id}
                  className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-accent/40 ${checked ? "bg-primary/10" : ""}`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      const next = new Set(selectedLineIds);
                      if (next.has(l.id)) next.delete(l.id);
                      else next.add(l.id);
                      setSelectedLineIds(next);
                    }}
                  />
                  <span className="font-mono text-xs w-20 shrink-0">
                    {new Date(l.statement_date).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex-1 truncate text-xs">
                    {l.description ?? "(sem descrição)"}{" "}
                    <span className="text-muted-foreground">
                      · {l.bank_accounts?.name ?? ""}
                    </span>
                  </span>
                  <span
                    className={`font-mono text-xs w-24 text-right tabular-nums ${isCredit ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {fmt(Number(l.amount))}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* Status barra */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <span>
          Soma lançamentos: <b className="font-mono">{fmt(sumTxs)}</b>
        </span>
        <span className="text-muted-foreground">•</span>
        <span>
          Soma extrato: <b className="font-mono">{fmt(sumLines)}</b>
        </span>
        {sumMatches ? (
          <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white border-0 gap-1">
            <CheckCircle2 className="h-3 w-3" /> Soma confere
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="h-3 w-3" />
            {selectedTxIds.size === 0
              ? "Selecione ao menos 1 lançamento"
              : hasLines
                ? "Soma diverge"
                : "Selecione as linhas OU informe o banco de referência"}
          </Badge>
        )}
        {willBeAporte && (
          <Badge variant="secondary" className="gap-1 ml-auto">
            <ArrowLeftRight className="h-3 w-3" />
            APORTE detectado: {bankEnt} → {Array.from(txEnts)[0]}
          </Badge>
        )}
        {mixedEnts && (
          <Badge variant="destructive" className="gap-1 ml-auto">
            <AlertTriangle className="h-3 w-3" />
            CCs de empreendimentos diferentes
          </Badge>
        )}
      </div>

      {/* Prompt de mistura */}
      {mixedPrompt && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
          <p className="text-sm font-medium">
            Lançamentos selecionados envolvem empreendimentos diferentes. Escolha o CC de destino
            para o aporte:
          </p>
          <Select value={chosenTargetCc} onValueChange={setChosenTargetCc}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Selecione o CC de destino…" />
            </SelectTrigger>
            <SelectContent>
              {mixedPrompt.cost_centers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name} · {c.enterprise ?? "—"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!chosenTargetCc || busy}
              onClick={() => submit(true, chosenTargetCc)}
            >
              Confirmar com este CC
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMixedPrompt(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => submit(false)}
          disabled={!sumMatches || busy || !!mixedPrompt}
          size="lg"
        >
          {busy
            ? "Processando…"
            : willBeAporte
              ? "Conciliar em lote + registrar APORTE"
              : "Conciliar em lote"}
        </Button>
      </div>
    </Card>
  );
}
