import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listCostCenters,
  listAccounts,
  listBankAccounts,
  listContacts,
} from "@/lib/finance.functions";
import {
  listProjections,
  createProjection,
  deleteProjection,
  realizeProjectionMonth,
} from "@/lib/projections.functions";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Trash2, CheckCircle2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/projecoes")({
  head: () => ({
    meta: [
      { title: "Projeções e Simulador — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Projeções de caixa preditivas com juros compostos: simule dividendos, recebimentos recorrentes e cenários macro sem poluir o fluxo real.",
      },
      { property: "og:title", content: "Projeções e Simulador — CONTROLE.GHR" },
      {
        property: "og:description",
        content: "Simulações preditivas de receitas com crescimento composto mês a mês.",
      },
    ],
  }),
  component: () => (
    <AppLayout>
      <ProjectionsPage />
    </AppLayout>
  ),
});

const SELECTABLE_CC = ["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"];

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function addMonthsISO(iso: string, months: number) {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function fmtMonthLabel(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", {
    month: "short",
    year: "numeric",
  });
}

type ProjectionRow = {
  id: string;
  name: string;
  cost_center_id: string;
  account_id: string;
  contact_id: string | null;
  default_bank_account_id: string | null;
  initial_amount: number | string;
  monthly_growth_rate: number | string;
  start_date: string;
  horizon_months: number;
  notes: string | null;
  cost_centers: { code: string; name: string; enterprise: string } | null;
  accounts: { name: string } | null;
  contacts: { name: string } | null;
  bank_accounts: { name: string; bank: string } | null;
  realizations: Array<{
    id: string;
    month_index: number;
    transaction_id: string | null;
    realized_amount: number | string;
    realized_at: string;
  }>;
};

function ProjectionsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const bankFn = useServerFn(listBankAccounts);
  const contactFn = useServerFn(listContacts);
  const listFn = useServerFn(listProjections);
  const createFn = useServerFn(createProjection);
  const deleteFn = useServerFn(deleteProjection);

  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["accs"], queryFn: () => accFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bankFn() });
  const contacts = useQuery({ queryKey: ["contacts"], queryFn: () => contactFn() });
  const projs = useQuery<ProjectionRow[]>({
    queryKey: ["projections"],
    queryFn: () => listFn() as never,
  });

  // Form state
  const [name, setName] = useState("");
  const [ccId, setCcId] = useState("");
  const [accId, setAccId] = useState("");
  const [contactId, setContactId] = useState("");
  const [bankId, setBankId] = useState("");
  const [initial, setInitial] = useState("");
  const [rate, setRate] = useState("0.7");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().slice(0, 7) + "-01",
  );
  const [horizon, setHorizon] = useState("24");
  const [notes, setNotes] = useState("");

  const selectableCCs = useMemo(
    () => (ccs.data ?? []).filter((c) => SELECTABLE_CC.includes(c.enterprise ?? "")),
    [ccs.data],
  );
  const receivableAccs = useMemo(
    () => (accs.data ?? []).filter((a) => a.kind === "receivable"),
    [accs.data],
  );

  const createMut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe um nome para a projeção.");
      if (!ccId) throw new Error("Selecione um centro de custo.");
      if (!accId) throw new Error("Selecione uma conta contábil (receita).");
      const init = Number(initial.replace(",", "."));
      const r = Number(rate.replace(",", "."));
      if (!Number.isFinite(init) || init < 0) throw new Error("Valor inicial inválido.");
      if (!Number.isFinite(r)) throw new Error("Taxa de crescimento inválida.");
      const h = parseInt(horizon, 10);
      if (!Number.isFinite(h) || h < 1 || h > 120)
        throw new Error("Horizonte deve estar entre 1 e 120 meses.");
      return createFn({
        data: {
          name: name.trim(),
          cost_center_id: ccId,
          account_id: accId,
          contact_id: contactId || null,
          default_bank_account_id: bankId || null,
          initial_amount: init,
          monthly_growth_rate: r,
          start_date: startDate,
          horizon_months: h,
          notes: notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("Projeção criada com sucesso.");
      setName("");
      setInitial("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Projeção removida.");
      qc.invalidateQueries({ queryKey: ["projections"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            Projeções e Simulador Preditivo
          </h1>
          <p className="text-muted-foreground">
            Simulações de dividendos e recebimentos com crescimento composto · isoladas do
            fluxo real
          </p>
        </div>
        <Button variant="outline" onClick={() => nav({ to: "/" })}>
          ← Dashboard
        </Button>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Nova Projeção</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Nome da Projeção *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Dividendos Loteamento JK"
            />
          </div>
          <div className="space-y-2">
            <Label>Valor Inicial Estimado (R$) *</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={initial}
              onChange={(e) => setInitial(e.target.value)}
              placeholder="50000,00"
            />
          </div>
          <div className="space-y-2">
            <Label>Taxa de Crescimento Mensal (%) *</Label>
            <Input
              type="text"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0,7"
            />
            <p className="text-xs text-muted-foreground">
              Juros compostos aplicados mês a mês sobre o valor anterior.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Centro de Custo *</Label>
            <Select value={ccId} onValueChange={setCcId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {selectableCCs.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Conta Contábil (Receita) *</Label>
            <Select value={accId} onValueChange={setAccId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {receivableAccs.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Contato/Pagador (opcional, obrigatório p/ realizar)</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(contacts.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Banco padrão (opcional)</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {(banks.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} — {b.bank}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Mês inicial *</Label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Horizonte (meses) *</Label>
            <Input
              type="number"
              min={1}
              max={120}
              value={horizon}
              onChange={(e) => setHorizon(e.target.value)}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Observações</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Cenário, premissas Austrian, contexto da projeção…"
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
            {createMut.isPending ? "Salvando…" : "Criar Projeção"}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Projeções Ativas</h2>
        {projs.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (projs.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma projeção criada. Use o formulário acima para começar.
          </p>
        ) : (
          <div className="space-y-6">
            {(projs.data ?? []).map((p) => (
              <ProjectionDetail
                key={p.id}
                proj={p}
                onDelete={() => deleteMut.mutate(p.id)}
                onChanged={() => qc.invalidateQueries({ queryKey: ["projections"] })}
                banks={(banks.data ?? []) as Array<{ id: string; name: string; bank: string }>}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function ProjectionDetail({
  proj,
  onDelete,
  onChanged,
  banks,
}: {
  proj: ProjectionRow;
  onDelete: () => void;
  onChanged: () => void;
  banks: Array<{ id: string; name: string; bank: string }>;
}) {
  const [dialogMonth, setDialogMonth] = useState<number | null>(null);

  const initial = Number(proj.initial_amount);
  const rate = Number(proj.monthly_growth_rate) / 100;
  const realizedMap = new Map(
    proj.realizations.map((r) => [r.month_index, Number(r.realized_amount)]),
  );

  const months = Array.from({ length: proj.horizon_months }, (_, i) => {
    const projected = initial * Math.pow(1 + rate, i);
    return {
      index: i,
      date: addMonthsISO(proj.start_date, i),
      projected,
      realized: realizedMap.get(i) ?? null,
    };
  });

  const totalProjected = months.reduce((s, m) => s + m.projected, 0);
  const totalRealized = months.reduce((s, m) => s + (m.realized ?? 0), 0);

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-lg">{proj.name}</h3>
          <p className="text-xs text-muted-foreground">
            {proj.cost_centers?.name} · {proj.accounts?.name} ·{" "}
            <span className="text-primary font-medium">
              {Number(proj.monthly_growth_rate).toFixed(2)}% a.m. composto
            </span>
          </p>
          {proj.notes && (
            <p className="text-xs text-muted-foreground mt-1 italic">{proj.notes}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">
            Projetado: {fmt(totalProjected)}
          </Badge>
          <Badge>Realizado: {fmt(totalRealized)}</Badge>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm(`Remover projeção "${proj.name}"?`)) onDelete();
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto max-h-96">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Projetado</TableHead>
              <TableHead className="text-right">Realizado</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => (
              <TableRow key={m.index}>
                <TableCell className="capitalize">{fmtMonthLabel(m.date)}</TableCell>
                <TableCell className="text-right font-mono">
                  {fmt(m.projected)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {m.realized != null ? (
                    <span className="text-primary">{fmt(m.realized)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {m.realized != null ? (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Realizado
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialogMonth(m.index)}
                    >
                      Realizar no Caixa
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {dialogMonth != null && (
        <RealizeDialog
          proj={proj}
          monthIndex={dialogMonth}
          projected={months[dialogMonth].projected}
          dueDate={months[dialogMonth].date}
          banks={banks}
          onClose={() => setDialogMonth(null)}
          onDone={() => {
            setDialogMonth(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function RealizeDialog({
  proj,
  monthIndex,
  projected,
  dueDate,
  banks,
  onClose,
  onDone,
}: {
  proj: ProjectionRow;
  monthIndex: number;
  projected: number;
  dueDate: string;
  banks: Array<{ id: string; name: string; bank: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(projected.toFixed(2));
  const [bankId, setBankId] = useState(proj.default_bank_account_id ?? "");
  const [date, setDate] = useState(dueDate);
  const realizeFn = useServerFn(realizeProjectionMonth);

  const mut = useMutation({
    mutationFn: async () => {
      const amt = Number(amount.replace(",", "."));
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Valor inválido.");
      if (!bankId) throw new Error("Selecione o banco de destino.");
      return realizeFn({
        data: {
          projection_id: proj.id,
          month_index: monthIndex,
          realized_amount: amt,
          bank_account_id: bankId,
          due_date: date,
        },
      });
    },
    onSuccess: () => {
      toast.success("Realização registrada e lançamento conciliado criado.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Realizar no Caixa — {fmtMonthLabel(dueDate)}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Projeção: <strong>{proj.name}</strong>
            <br />
            Valor projetado: <strong>{fmt(projected)}</strong>
          </div>
          <div className="space-y-2">
            <Label>Valor Real Recebido (R$)</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label>Banco de Destino</Label>
            <Select value={bankId} onValueChange={setBankId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione…" />
              </SelectTrigger>
              <SelectContent>
                {banks.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name} — {b.bank}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Data do crédito</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Salvando…" : "Confirmar Realização"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
