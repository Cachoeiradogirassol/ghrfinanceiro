import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Sparkles, CheckCircle2, AlertCircle, Copy } from "lucide-react";

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
} from "@/lib/openfinance-import.functions";

type Candidate = {
  id: string;
  description: string;
  amount: number;
  due_date: string;
  cost_center_id: string;
  account_id: string;
  account_name: string | null;
};

type ParsedItem = {
  temp_id: string;
  data: string;
  descricao: string;
  valor: number;
  instituicao: string;
  bank_account_id: string | null;
  bank_account_name: string | null;
  cost_center_id: string | null;
  cost_center_name: string | null;
  suggested_account_id: string | null;
  suggested_account_name: string | null;
  dedupe_tag: string;
  status: "match" | "multiple" | "new" | "duplicate" | "no_cost_center";
  match_transaction_id: string | null;
  candidates: Candidate[];
};

type RowState = {
  include: boolean;
  action: "match" | "create" | "skip";
  account_id: string | null;
  cost_center_id: string | null;
  bank_account_id: string | null;
  transaction_id: string | null;
};

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OpenFinanceImporter({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fallbackCostCenterId, setFallbackCostCenterId] = useState<string>("");
  const [fallbackAccountId, setFallbackAccountId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});

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

  const reset = () => {
    setText("");
    setItems([]);
    setRows({});
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
        initialRows[it.temp_id] = {
          include: it.status !== "duplicate",
          action:
            it.status === "match"
              ? "match"
              : it.status === "duplicate"
                ? "skip"
                : "create",
          account_id: it.suggested_account_id,
          cost_center_id: it.cost_center_id,
          bank_account_id: it.bank_account_id,
          transaction_id: it.match_transaction_id,
        };
      }
      setRows(initialRows);
      toast.success(`${res.items.length} linhas analisadas. Revise abaixo e confirme.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao analisar extrato");
    } finally {
      setLoading(false);
    }
  };

  const doConfirm = async () => {
    const decisions = items
      .map((it) => {
        const row = rows[it.temp_id];
        if (!row || !row.include) {
          return {
            temp_id: it.temp_id,
            action: "skip" as const,
            data: it.data,
            descricao: it.descricao,
            valor: it.valor,
            instituicao: it.instituicao,
            cost_center_id: it.cost_center_id,
            account_id: null,
            transaction_id: null,
            dedupe_tag: it.dedupe_tag,
          };
        }
        return {
          temp_id: it.temp_id,
          action: row.action,
          data: it.data,
          descricao: it.descricao,
          valor: it.valor,
          instituicao: it.instituicao,
          cost_center_id: row.cost_center_id,
          account_id: row.action === "create" ? row.account_id : null,
          transaction_id: row.action === "match" ? row.transaction_id : null,
          dedupe_tag: it.dedupe_tag,
        };
      });

    setLoading(true);
    try {
      const res = await confirmFn({ data: { decisions } });
      toast.success(
        `Concluído: ${res.reconciled} conciliados, ${res.created} criados, ${res.skipped} ignorados${res.errors.length ? `, ${res.errors.length} erros` : ""}.`,
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
    let match = 0, create = 0, dup = 0, multi = 0, noCc = 0;
    for (const it of items) {
      if (it.status === "match") match++;
      else if (it.status === "new") create++;
      else if (it.status === "duplicate") dup++;
      else if (it.status === "multiple") multi++;
      else if (it.status === "no_cost_center") noCc++;
    }
    return { match, create, dup, multi, noCc };
  }, [items]);

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
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>📥 Importador Open Finance</DialogTitle>
          <DialogDescription>
            Cole o extrato do Meu Pluggy. A IA parseia, classifica por categoria e concilia com
            lançamentos pendentes antes de você confirmar.
          </DialogDescription>
        </DialogHeader>

        {items.length === 0 ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">
                  Centro de custo de fallback <span className="opacity-60">(opcional)</span>
                </label>
                <Select
                  value={fallbackCostCenterId}
                  onValueChange={setFallbackCostCenterId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Só se IA não identificar o banco" />
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
                    <SelectValue placeholder="Só se IA não classificar" />
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
              placeholder="Cole aqui o texto copiado do Meu Pluggy (multibancos)…"
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
                Analisar com IA
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="default" className="gap-1">
                <CheckCircle2 className="h-3 w-3" /> {summary.match} match
              </Badge>
              <Badge variant="secondary">{summary.create} novos</Badge>
              {summary.multi > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Copy className="h-3 w-3" /> {summary.multi} múltiplos
                </Badge>
              )}
              {summary.dup > 0 && <Badge variant="outline">{summary.dup} duplicados</Badge>}
              {summary.noCc > 0 && (
                <Badge variant="destructive" className="gap-1">
                  <AlertCircle className="h-3 w-3" /> {summary.noCc} sem CC
                </Badge>
              )}
            </div>

            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Instituição / CC</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Categoria / Lançamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => {
                    const row = rows[it.temp_id];
                    if (!row) return null;
                    const disabled = it.status === "duplicate";
                    const cc = row.cost_center_id;
                    const accountList = cc ? accountsByCc.get(cc) ?? [] : [];
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
                        </TableCell>
                        <TableCell
                          className={`text-right text-xs whitespace-nowrap ${it.valor >= 0 ? "text-emerald-600" : "text-red-600"}`}
                        >
                          {brl(it.valor)}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div>{it.instituicao}</div>
                          <div className="text-muted-foreground">
                            {it.cost_center_name ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {it.status === "duplicate" ? (
                            <Badge variant="outline">duplicado</Badge>
                          ) : (
                            <Select
                              value={row.action}
                              onValueChange={(v: "match" | "create" | "skip") =>
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
                              <SelectTrigger className="h-8 text-xs w-[130px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {it.candidates.length > 0 && (
                                  <SelectItem value="match">Conciliar</SelectItem>
                                )}
                                <SelectItem value="create">Criar novo</SelectItem>
                                <SelectItem value="skip">Ignorar</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.action === "match" ? (
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
