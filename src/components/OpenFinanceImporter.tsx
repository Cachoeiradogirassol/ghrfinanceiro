import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Copy,
  ArrowRightLeft,
  EyeOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listAccounts, listCostCenters } from "@/lib/finance.functions";
import {
  parseOpenFinanceText,
  confirmOpenFinanceImport,
  type ParsedItem,
} from "@/lib/openfinance-import.functions";

type RowState = {
  include: boolean;
  action: "match" | "create" | "skip" | "aporte";
  account_id: string | null;
  cost_center_id: string | null;
  bank_account_id: string | null;
  transaction_id: string | null;
  // Aporte
  transfer_source_cc_id: string | null;
  transfer_source_bank_account_id: string | null;
  transfer_target_cc_id: string | null;
  transfer_target_bank_account_id: string | null;
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PAGE_SIZE = 100;

type WizardStep = 1 | 2 | 3;

export function OpenFinanceImporter({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fallbackCostCenterId, setFallbackCostCenterId] = useState<string>("");
  const [fallbackAccountId, setFallbackAccountId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [page, setPage] = useState(0);
  const [step, setStep] = useState<WizardStep>(1);
  const [filter, setFilter] = useState<
    "all" | "match" | "new" | "aporte" | "aporte_incomplete" | "internal" | "duplicate" | "no_cost_center"
  >("all");

  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const parseFn = useServerFn(parseOpenFinanceText);
  const confirmFn = useServerFn(confirmOpenFinanceImport);

  const ccs = useQuery({ queryKey: ["cost-centers"], queryFn: () => ccFn(), enabled: open });
  const accs = useQuery({ queryKey: ["accounts"], queryFn: () => accFn(), enabled: open });

  const accountsByCc = useMemo(() => {
    const map = new Map<string, Array<{ id: string; name: string; kind: string }>>();
    for (const a of accs.data ?? []) {
      if (!a.cost_center_id || !a.is_active) continue;
      const arr = map.get(a.cost_center_id) ?? [];
      arr.push({ id: a.id, name: a.name, kind: a.kind });
      map.set(a.cost_center_id, arr);
    }
    return map;
  }, [accs.data]);

  const ccNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of ccs.data ?? []) m.set(c.id, `${c.code} — ${c.name}`);
    return m;
  }, [ccs.data]);

  const reset = () => {
    setText("");
    setItems([]);
    setRows({});
    setPage(0);
    setFilter("all");
  };

  const doParse = async () => {
    if (text.trim().length < 20) {
      toast.error("Cole o conteúdo do extrato do Meu Pluggy antes de processar.");
      return;
    }
    setLoading(true);
    try {
      const res = await parseFn({
        data: {
          text,
          default_cost_center_id: fallbackCostCenterId || undefined,
          default_account_id: fallbackAccountId || undefined,
        },
      });
      setItems(res.items);
      const initialRows: Record<string, RowState> = {};
      for (const it of res.items) {
        const defaultAction: RowState["action"] =
          it.status === "match"
            ? "match"
            : it.status === "aporte" || it.status === "aporte_incomplete"
              ? "aporte"
              : it.status === "duplicate" || it.status === "internal"
                ? "skip"
                : "create";
        initialRows[it.temp_id] = {
          include: it.status !== "duplicate" && it.status !== "internal",
          action: defaultAction,
          account_id: it.suggested_account_id,
          cost_center_id: it.cost_center_id,
          bank_account_id: it.bank_account_id,
          transaction_id: it.match_transaction_id,
          transfer_source_cc_id: it.transfer_source_cc_id,
          transfer_source_bank_account_id: it.transfer_source_bank_account_id,
          transfer_target_cc_id: it.transfer_target_cc_id,
          transfer_target_bank_account_id: it.transfer_target_bank_account_id,
        };
      }
      setRows(initialRows);
      const s = res.stats;
      toast.success(
        `${res.items.length} linhas analisadas. Categoria: ${s.from_dictionary} via de-para · ${s.from_ai} via IA · ${s.pending} pendentes.`,
      );

    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar extrato");
    } finally {
      setLoading(false);
    }
  };

  const doConfirm = async () => {
    const decisions = items.map((it) => {
      const row = rows[it.temp_id];
      if (!row || !row.include) {
        return {
          temp_id: it.temp_id,
          action: "skip" as const,
          data: it.data,
          descricao: it.descricao,
          valor: it.valor,
          instituicao: it.instituicao,
          bank_account_id: it.bank_account_id,
          cost_center_id: it.cost_center_id,
          account_id: null,
          transaction_id: null,
          dedupe_tag: it.dedupe_tag,
          pair_temp_id: it.pair_temp_id,
          transfer_source_cc_id: null,
          transfer_source_bank_account_id: null,
          transfer_target_cc_id: null,
          transfer_target_bank_account_id: null,
        };
      }
      return {
        temp_id: it.temp_id,
        action: row.action,
        data: it.data,
        descricao: it.descricao,
        valor: it.valor,
        instituicao: it.instituicao,
        bank_account_id: row.bank_account_id,
        cost_center_id: row.cost_center_id,
        account_id: row.action === "create" ? row.account_id : row.action === "aporte" ? row.account_id : null,
        transaction_id: row.action === "match" ? row.transaction_id : null,
        dedupe_tag: it.dedupe_tag,
        pair_temp_id: it.pair_temp_id,
        transfer_source_cc_id: row.transfer_source_cc_id,
        transfer_source_bank_account_id: row.transfer_source_bank_account_id,
        transfer_target_cc_id: row.transfer_target_cc_id,
        transfer_target_bank_account_id: row.transfer_target_bank_account_id,
      };
    });

    setLoading(true);
    try {
      const res = await confirmFn({ data: { decisions } });
      toast.success(
        `Concluído: ${res.reconciled} conciliados, ${res.created} criados, ${res.aportes} aportes, ${res.skipped} ignorados${res.errors.length ? `, ${res.errors.length} erros` : ""}.`,
      );
      if (res.errors.length > 0) {
        console.warn("Erros de importação Open Finance:", res.errors);
      }
      reset();
      setOpen(false);
      onImported?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao confirmar importação");
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    let match = 0, create = 0, dup = 0, multi = 0, noCc = 0, internal = 0, aporte = 0, aporteInc = 0;
    for (const it of items) {
      if (it.status === "match") match++;
      else if (it.status === "new") create++;
      else if (it.status === "duplicate") dup++;
      else if (it.status === "multiple") multi++;
      else if (it.status === "no_cost_center") noCc++;
      else if (it.status === "internal") internal++;
      else if (it.status === "aporte") aporte++;
      else if (it.status === "aporte_incomplete") aporteInc++;
    }
    return { match, create, dup, multi, noCc, internal, aporte, aporteInc };
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    if (filter === "new") return items.filter((i) => i.status === "new" || i.status === "multiple");
    return items.filter((i) => i.status === filter);
  }, [items, filter]);

  const pageItems = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  const toggleAllInternals = (include: boolean) => {
    setRows((r) => {
      const next = { ...r };
      for (const it of items) {
        if (it.status === "internal") next[it.temp_id] = { ...next[it.temp_id], include };
      }
      return next;
    });
  };

  const togglePageAll = (include: boolean) => {
    setRows((r) => {
      const next = { ...r };
      for (const it of pageItems) {
        next[it.temp_id] = { ...next[it.temp_id], include };
      }
      return next;
    });
  };

  const statusBadge = (s: ParsedItem["status"]) => {
    const map: Record<ParsedItem["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
      match: { label: "match", variant: "default" },
      new: { label: "novo", variant: "secondary" },
      multiple: { label: "múltiplos", variant: "outline" },
      duplicate: { label: "duplicado", variant: "outline" },
      no_cost_center: { label: "sem CC", variant: "destructive" },
      internal: { label: "interna", variant: "outline" },
      aporte: { label: "APORTE", variant: "default" },
      aporte_incomplete: { label: "aporte ½", variant: "destructive" },
    };
    const m = map[s];
    return <Badge variant={m.variant}>{m.label}</Badge>;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          📥 Importador Open Finance
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📥 Importador Open Finance</DialogTitle>
          <DialogDescription>
            Cole o extrato completo do Meu Pluggy. O parser lê linha a linha (sem IA), concilia com
            lançamentos pendentes e identifica aportes entre centros de custo.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Centro de custo de fallback <span className="opacity-60">(opcional)</span>
                </label>
                <Select value={fallbackCostCenterId} onValueChange={setFallbackCostCenterId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Só se banco não for reconhecido" />
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
                <label className="text-xs text-muted-foreground">
                  Categoria de fallback <span className="opacity-60">(opcional)</span>
                </label>
                <Select value={fallbackAccountId} onValueChange={setFallbackAccountId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Só se não houver sugestão" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accs.data ?? []).map((a) => (
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
              placeholder="Cole aqui o texto copiado do Meu Pluggy (Ctrl+A / Ctrl+C na aba Fluxo de Caixa)…"
              className="min-h-[260px] font-mono text-xs"
            />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={doParse} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-2" />
                )}
                Processar extrato
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm items-center">
              <button onClick={() => { setFilter("all"); setPage(0); }}>
                <Badge variant={filter === "all" ? "default" : "outline"}>{items.length} total</Badge>
              </button>
              <button onClick={() => { setFilter("match"); setPage(0); }}>
                <Badge variant={filter === "match" ? "default" : "outline"} className="gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {summary.match} match
                </Badge>
              </button>
              <button onClick={() => { setFilter("new"); setPage(0); }}>
                <Badge variant={filter === "new" ? "default" : "outline"}>
                  {summary.create + summary.multi} novos
                </Badge>
              </button>
              <button onClick={() => { setFilter("aporte"); setPage(0); }}>
                <Badge variant={filter === "aporte" ? "default" : "outline"} className="gap-1">
                  <ArrowRightLeft className="h-3 w-3" /> {summary.aporte} aportes
                </Badge>
              </button>
              {summary.aporteInc > 0 && (
                <button onClick={() => { setFilter("aporte_incomplete"); setPage(0); }}>
                  <Badge variant={filter === "aporte_incomplete" ? "destructive" : "outline"} className="gap-1">
                    <AlertCircle className="h-3 w-3" /> {summary.aporteInc} aportes ½
                  </Badge>
                </button>
              )}
              <button onClick={() => { setFilter("internal"); setPage(0); }}>
                <Badge variant={filter === "internal" ? "default" : "outline"} className="gap-1">
                  <EyeOff className="h-3 w-3" /> {summary.internal} internas
                </Badge>
              </button>
              {summary.dup > 0 && (
                <button onClick={() => { setFilter("duplicate"); setPage(0); }}>
                  <Badge variant={filter === "duplicate" ? "default" : "outline"}>
                    {summary.dup} duplicados
                  </Badge>
                </button>
              )}
              {summary.noCc > 0 && (
                <button onClick={() => { setFilter("no_cost_center"); setPage(0); }}>
                  <Badge variant={filter === "no_cost_center" ? "destructive" : "outline"}>
                    {summary.noCc} sem CC
                  </Badge>
                </button>
              )}
              {summary.multi > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Copy className="h-3 w-3" /> {summary.multi} múltiplos
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Button size="sm" variant="outline" onClick={() => togglePageAll(true)}>
                Marcar página
              </Button>
              <Button size="sm" variant="outline" onClick={() => togglePageAll(false)}>
                Desmarcar página
              </Button>
              <Button size="sm" variant="outline" onClick={() => toggleAllInternals(false)}>
                Pular todas internas
              </Button>
              <Button size="sm" variant="outline" onClick={() => toggleAllInternals(true)}>
                Reincluir internas
              </Button>
              <span className="ml-auto flex items-center gap-2">
                Página {page + 1}/{totalPages}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  ‹
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  ›
                </Button>
              </span>
            </div>

            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Banco / CC</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Detalhe</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageItems.map((it) => {
                    const row = rows[it.temp_id];
                    if (!row) return null;
                    const disabled = it.status === "duplicate";
                    const cc = row.cost_center_id;
                    const accountList = cc ? accountsByCc.get(cc) ?? [] : [];
                    const isAporte = row.action === "aporte";
                    const isIncomplete = it.status === "aporte_incomplete";

                    return (
                      <TableRow key={it.temp_id} className={disabled ? "opacity-50" : ""}>
                        <TableCell>
                          <Checkbox
                            checked={row.include}
                            disabled={disabled}
                            onCheckedChange={(v) =>
                              setRows((r) => ({
                                ...r,
                                [it.temp_id]: { ...row, include: Boolean(v) },
                              }))
                            }
                          />
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{it.data}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate" title={it.descricao}>
                          {it.descricao}
                          {it.pluggy_category && (
                            <div className="text-[10px] text-muted-foreground italic">
                              {it.pluggy_category}
                            </div>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs whitespace-nowrap ${it.valor >= 0 ? "text-emerald-600" : "text-red-600"}`}
                        >
                          {brl(it.valor)}
                        </TableCell>
                        <TableCell>{statusBadge(it.status)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{it.instituicao}</div>
                          <div className="text-muted-foreground text-[10px]">
                            {it.bank_account_name ?? "banco não reconhecido"}
                          </div>
                          {!isAporte && (
                            <Select
                              value={row.cost_center_id ?? ""}
                              onValueChange={(v) =>
                                setRows((r) => ({
                                  ...r,
                                  [it.temp_id]: {
                                    ...row,
                                    cost_center_id: v,
                                    account_id: null,
                                  },
                                }))
                              }
                              disabled={disabled}
                            >
                              <SelectTrigger className="h-7 text-xs w-[220px] mt-1">
                                <SelectValue placeholder="Centro de custo" />
                              </SelectTrigger>
                              <SelectContent>
                                {(ccs.data ?? [])
                                  .filter((c) => c.is_active)
                                  .map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.code} — {c.name}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          {it.status === "duplicate" ? (
                            <Badge variant="outline">duplicado</Badge>
                          ) : (
                            <Select
                              value={row.action}
                              onValueChange={(v: "match" | "create" | "skip" | "aporte") =>
                                setRows((r) => ({
                                  ...r,
                                  [it.temp_id]: {
                                    ...row,
                                    action: v,
                                    transaction_id:
                                      v === "match"
                                        ? row.transaction_id ?? it.candidates[0]?.id ?? null
                                        : null,
                                  },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs w-[140px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {it.candidates.length > 0 && (
                                  <SelectItem value="match">Conciliar</SelectItem>
                                )}
                                <SelectItem value="create">Criar novo</SelectItem>
                                {(it.status === "aporte" || it.status === "aporte_incomplete") && (
                                  <SelectItem value="aporte">Registrar aporte</SelectItem>
                                )}
                                <SelectItem value="skip">Ignorar</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          {isAporte ? (
                            <div className="space-y-1 text-xs">
                              <div className="font-medium text-primary">
                                APORTE: {ccNameById.get(row.transfer_source_cc_id ?? "") ?? "?"} →{" "}
                                {ccNameById.get(row.transfer_target_cc_id ?? "") ?? "?"}
                              </div>
                              {isIncomplete && it.incomplete_side === "source" && (
                                <div>
                                  <label className="text-[10px] text-muted-foreground">
                                    CC destino:
                                  </label>
                                  <Select
                                    value={row.transfer_target_cc_id ?? ""}
                                    onValueChange={(v) =>
                                      setRows((r) => ({
                                        ...r,
                                        [it.temp_id]: { ...row, transfer_target_cc_id: v },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="h-7 text-xs w-[220px]">
                                      <SelectValue placeholder="Escolher CC destino" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(ccs.data ?? [])
                                        .filter(
                                          (c) =>
                                            c.is_active && c.id !== row.transfer_source_cc_id,
                                        )
                                        .map((c) => (
                                          <SelectItem key={c.id} value={c.id}>
                                            {c.code} — {c.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                              {isIncomplete && it.incomplete_side === "target" && (
                                <div>
                                  <label className="text-[10px] text-muted-foreground">
                                    CC origem (+ banco):
                                  </label>
                                  <Select
                                    value={row.transfer_source_cc_id ?? ""}
                                    onValueChange={(v) => {
                                      const banks = (accs.data ?? []) as never;
                                      void banks;
                                      setRows((r) => ({
                                        ...r,
                                        [it.temp_id]: { ...row, transfer_source_cc_id: v },
                                      }));
                                    }}
                                  >
                                    <SelectTrigger className="h-7 text-xs w-[220px]">
                                      <SelectValue placeholder="Escolher CC origem" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {(ccs.data ?? [])
                                        .filter(
                                          (c) =>
                                            c.is_active && c.id !== row.transfer_target_cc_id,
                                        )
                                        .map((c) => (
                                          <SelectItem key={c.id} value={c.id}>
                                            {c.code} — {c.name}
                                          </SelectItem>
                                        ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            </div>
                          ) : row.action === "match" ? (
                            <Select
                              value={row.transaction_id ?? ""}
                              onValueChange={(v) =>
                                setRows((r) => ({
                                  ...r,
                                  [it.temp_id]: { ...row, transaction_id: v },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs w-[320px]">
                                <SelectValue placeholder="Escolher lançamento" />
                              </SelectTrigger>
                              <SelectContent>
                                {it.candidates.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {c.due_date} · {brl(Number(c.amount))} ·{" "}
                                    {c.account_name ?? "s/ cat"} · {c.description.slice(0, 40)}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : row.action === "create" ? (
                            <Select
                              value={row.account_id ?? ""}
                              onValueChange={(v) =>
                                setRows((r) => ({
                                  ...r,
                                  [it.temp_id]: { ...row, account_id: v },
                                }))
                              }
                            >
                              <SelectTrigger className="h-8 text-xs w-[280px]">
                                <SelectValue placeholder="Categoria" />
                              </SelectTrigger>
                              <SelectContent>
                                {accountList.length === 0 ? (
                                  <SelectItem value="__none" disabled>
                                    Sem contas no centro de custo
                                  </SelectItem>
                                ) : (
                                  accountList.map((a) => (
                                    <SelectItem key={a.id} value={a.id}>
                                      {a.name} ({a.kind})
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={reset} disabled={loading}>
                Voltar / colar outro
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={loading}>
                  Cancelar
                </Button>
                <Button onClick={doConfirm} disabled={loading}>
                  {loading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                  )}
                  Confirmar importação
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
