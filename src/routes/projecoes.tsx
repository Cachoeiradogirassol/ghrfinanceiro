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
  bulkCreateProjections,
} from "@/lib/projections.functions";
import { QuickGrid, type GridColumnDef } from "@/components/QuickGrid";
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
import {
  TrendingUp,
  Trash2,
  CheckCircle2,
  Sparkles,
  FileDown,
  FileSpreadsheet,
  ArrowDownCircle,
  ArrowUpCircle,
  Grid3x3,
} from "lucide-react";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

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
        content: "Simulações preditivas de entradas e saídas com crescimento composto.",
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
  direction?: "inflow" | "outflow" | null;
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
  accounts: { name: string; kind?: string } | null;
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
  const [direction, setDirection] = useState<"inflow" | "outflow">("inflow");
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

  // Fix: accounts kinds in DB are "revenue" / "expense" (not "receivable")
  const filteredAccs = useMemo(() => {
    const wanted = direction === "inflow" ? "revenue" : "expense";
    const all = (accs.data ?? []) as Array<{
      id: string;
      name: string;
      kind: string;
      cost_center_id?: string;
    }>;
    let list = all.filter((a) => a.kind === wanted);
    if (ccId) {
      const scoped = list.filter((a) => a.cost_center_id === ccId);
      if (scoped.length > 0) list = scoped;
    }
    return list;
  }, [accs.data, direction, ccId]);

  const createMut = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Informe um nome para a projeção.");
      if (!ccId) throw new Error("Selecione um centro de custo.");
      if (!accId) throw new Error("Selecione uma conta contábil.");
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
          direction,
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

  // ----- Modo Grade Rápida -----
  const [gridMode, setGridMode] = useState(false);
  const bulkFn = useServerFn(bulkCreateProjections);
  const gridColumns = useMemo<GridColumnDef[]>(() => {
    const ccOpts = selectableCCs.map((c) => ({
      value: c.id,
      label: `${c.code} - ${c.name}`,
    }));
    const accOpts = ((accs.data ?? []) as Array<{ id: string; name: string }>).map((a) => ({
      value: a.id,
      label: a.name,
    }));
    return [
      { key: "name", label: "Nome da Projeção", type: "text", width: "220px" },
      { key: "direction", label: "Tipo", type: "select", width: "130px", options: [
        { value: "inflow", label: "Entrada" },
        { value: "outflow", label: "Saída" },
      ] },
      {
        key: "cost_center_id",
        label: "Centro de Custo",
        type: "select",
        width: "200px",
        options: ccOpts,
        // Em Saídas (Contas a Pagar futuras) o centro de custo é opcional.
        disabledWhen: (row) => row.direction === "outflow",
      },

      { key: "account_id", label: "Conta", type: "select", width: "200px", options: accOpts },
      { key: "start_date", label: "Início (Vencimento)", type: "date", width: "160px" },
      { key: "initial_amount", label: "Valor (R$)", type: "number", width: "130px" },
      { key: "monthly_growth_rate", label: "Taxa %/mês", type: "number", width: "110px" },
      { key: "horizon_months", label: "Horizonte (m)", type: "number", width: "110px" },
    ];
  }, [selectableCCs, accs.data]);

  const handleBulkSave = async (rows: Record<string, string>[]) => {
    const parsed = rows.map((r, i) => {
      const init = Number((r.initial_amount ?? "").replace(",", "."));
      const rate = r.monthly_growth_rate
        ? Number(r.monthly_growth_rate.replace(",", "."))
        : 0;
      const horizon = r.horizon_months ? parseInt(r.horizon_months, 10) : 12;
      if (!r.name?.trim()) throw new Error(`Linha ${i + 1}: nome obrigatório.`);
      if (!r.cost_center_id) throw new Error(`Linha ${i + 1}: centro de custo obrigatório.`);
      if (!r.account_id) throw new Error(`Linha ${i + 1}: conta obrigatória.`);
      if (!r.start_date) throw new Error(`Linha ${i + 1}: data de início obrigatória.`);
      if (!Number.isFinite(init) || init < 0)
        throw new Error(`Linha ${i + 1}: valor inválido.`);
      return {
        name: r.name.trim(),
        direction: (r.direction || "inflow") as "inflow" | "outflow",
        cost_center_id: r.cost_center_id,
        account_id: r.account_id,
        initial_amount: init,
        monthly_growth_rate: rate,
        start_date: r.start_date,
        horizon_months: horizon,
      };
    });
    const res = await bulkFn({ data: { rows: parsed } });
    qc.invalidateQueries({ queryKey: ["projections"] });
    return res;
  };

  const consolidated = useMemo(() => {
    type Row = {
      mes: string;
      entradas: number;
      saidas: number;
      liquido: number;
      acumulado: number;
    };
    const rows = projs.data ?? [];
    if (rows.length === 0) return [] as Row[];
    const buckets = new Map<string, Row>();
    for (const p of rows) {
      const init = Number(p.initial_amount);
      const r = Number(p.monthly_growth_rate) / 100;
      const sign = (p.direction ?? "inflow") === "outflow" ? -1 : 1;
      for (let i = 0; i < p.horizon_months; i++) {
        const iso = addMonthsISO(p.start_date, i);
        const key = iso.slice(0, 7);
        const v = sign * init * Math.pow(1 + r, i);
        let row = buckets.get(key);
        if (!row) {
          row = { mes: key, entradas: 0, saidas: 0, liquido: 0, acumulado: 0 };
          buckets.set(key, row);
        }
        if (sign > 0) row.entradas += v;
        else row.saidas += Math.abs(v);
        row.liquido += v;
      }
    }
    const arr = Array.from(buckets.values()).sort((a, b) => a.mes.localeCompare(b.mes));
    let acc = 0;
    for (const r of arr) {
      acc += r.liquido;
      r.acumulado = acc;
    }
    return arr;
  }, [projs.data]);

  function handleExportPDF() {
    const rows = projs.data ?? [];
    if (rows.length === 0) {
      toast.error("Nenhuma projeção para exportar.");
      return;
    }
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const now = new Date();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text("CONTROLE.GHR — Projeções e Cenário Preditivo", 40, 50);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Emitido em: ${now.toLocaleString("pt-BR")}`, 40, 68);

    autoTable(doc, {
      startY: 90,
      head: [["Nome", "Tipo", "Centro de Custo", "Conta", "Inicial", "Taxa m.", "Horiz."]],
      body: rows.map((p) => [
        p.name,
        (p.direction ?? "inflow") === "outflow" ? "Saída" : "Entrada",
        p.cost_centers?.name ?? "—",
        p.accounts?.name ?? "—",
        fmt(Number(p.initial_amount)),
        `${Number(p.monthly_growth_rate).toFixed(2)}%`,
        `${p.horizon_months}m`,
      ]),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [60, 60, 60] },
    });

    if (consolidated.length > 0) {
      autoTable(doc, {
        startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20,
        head: [["Mês", "Entradas", "Saídas", "Líquido", "Acumulado"]],
        body: consolidated.map((c) => [
          String(c.mes),
          fmt(c.entradas as number),
          fmt(c.saidas as number),
          fmt(c.liquido as number),
          fmt(c.acumulado as number),
        ]),
        styles: { fontSize: 8 },
        headStyles: { fillColor: [40, 90, 160] },
      });
    }
    doc.save(`Projecoes_GHR_${now.toISOString().slice(0, 10)}.pdf`);
  }

  function handleExportXLSX() {
    const rows = projs.data ?? [];
    if (rows.length === 0) {
      toast.error("Nenhuma projeção para exportar.");
      return;
    }
    const wb = XLSX.utils.book_new();

    // Sheet 1: projections list
    const sheet1 = XLSX.utils.json_to_sheet(
      rows.map((p) => ({
        Nome: p.name,
        Tipo: (p.direction ?? "inflow") === "outflow" ? "Saída" : "Entrada",
        "Centro de Custo": p.cost_centers?.name ?? "",
        "Conta Contábil": p.accounts?.name ?? "",
        "Valor Inicial": Number(p.initial_amount),
        "Taxa Mensal (%)": Number(p.monthly_growth_rate),
        "Mês Inicial": p.start_date,
        Horizonte: p.horizon_months,
      })),
    );
    XLSX.utils.book_append_sheet(wb, sheet1, "Projeções");

    // Sheet 2: monthly grid per projection
    const monthSet = new Set<string>();
    const perProj: Array<Record<string, number | string>> = rows.map((p) => {
      const init = Number(p.initial_amount);
      const r = Number(p.monthly_growth_rate) / 100;
      const sign = (p.direction ?? "inflow") === "outflow" ? -1 : 1;
      const row: Record<string, number | string> = {
        Projeção: p.name,
        Tipo: sign > 0 ? "Entrada" : "Saída",
      };
      for (let i = 0; i < p.horizon_months; i++) {
        const key = addMonthsISO(p.start_date, i).slice(0, 7);
        monthSet.add(key);
        row[key] = Number((sign * init * Math.pow(1 + r, i)).toFixed(2));
      }
      return row;
    });
    const months = Array.from(monthSet).sort();
    const sheet2 = XLSX.utils.json_to_sheet(perProj, {
      header: ["Projeção", "Tipo", ...months],
    });
    XLSX.utils.book_append_sheet(wb, sheet2, "Competências");

    // Sheet 3: consolidated
    if (consolidated.length > 0) {
      const sheet3 = XLSX.utils.json_to_sheet(
        consolidated.map((c) => ({
          Mês: c.mes,
          Entradas: Number((c.entradas as number).toFixed(2)),
          Saídas: Number((c.saidas as number).toFixed(2)),
          Líquido: Number((c.liquido as number).toFixed(2)),
          Acumulado: Number((c.acumulado as number).toFixed(2)),
        })),
      );
      XLSX.utils.book_append_sheet(wb, sheet3, "Consolidado");
    }

    XLSX.writeFile(wb, `Projecoes_GHR_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-primary" />
            Projeções e Simulador Preditivo
          </h1>
          <p className="text-muted-foreground">
            Simulações multilistas de entradas e saídas com crescimento composto · isoladas do
            fluxo real
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={gridMode ? "default" : "outline"}
            onClick={() => setGridMode((v) => !v)}
          >
            <Grid3x3 className="h-4 w-4 mr-1" />
            {gridMode ? "Sair da Grade" : "Modo Grade Rápida"}
          </Button>
          <Button variant="outline" onClick={handleExportPDF}>
            <FileDown className="h-4 w-4 mr-1" /> Exportar Cenário (PDF)
          </Button>
          <Button variant="outline" onClick={handleExportXLSX}>
            <FileSpreadsheet className="h-4 w-4 mr-1" /> Exportar Planilha (Excel)
          </Button>
          <Button variant="outline" onClick={() => nav({ to: "/" })}>
            ← Dashboard
          </Button>
        </div>
      </div>

      {gridMode && (
        <Card className="p-4">
          <QuickGrid
            columns={gridColumns}
            initialRows={5}
            onSave={handleBulkSave}
            saveLabel="Salvar Projeções em Lote"
            emptyRow={{
              direction: "inflow",
              monthly_growth_rate: "0.7",
              horizon_months: "12",
            }}
          />
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">Nova Projeção</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Tipo da Projeção *</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={direction === "inflow" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setDirection("inflow");
                  setAccId("");
                }}
              >
                <ArrowUpCircle className="h-4 w-4 mr-1" /> Entrada (Recebimento)
              </Button>
              <Button
                type="button"
                variant={direction === "outflow" ? "default" : "outline"}
                className="flex-1"
                onClick={() => {
                  setDirection("outflow");
                  setAccId("");
                  setContactId("");
                  setBankId("");
                }}

              >
                <ArrowDownCircle className="h-4 w-4 mr-1" /> Saída (Pagamento)
              </Button>
            </div>
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Nome da Projeção *</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                direction === "inflow"
                  ? "Ex: Dividendos Loteamento JK"
                  : "Ex: Pagamento Recorrente Fornecedor"
              }
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
            <Select value={ccId} onValueChange={(v) => { setCcId(v); setAccId(""); }}>
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
            <Label>
              Conta Contábil ({direction === "inflow" ? "Receita" : "Despesa"}) *
            </Label>
            <Select value={accId} onValueChange={setAccId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    filteredAccs.length === 0
                      ? "Nenhuma conta disponível"
                      : "Selecione…"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {filteredAccs.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filteredAccs.length === 0 && (
              <p className="text-xs text-destructive">
                Nenhuma conta {direction === "inflow" ? "de receita" : "de despesa"}{" "}
                cadastrada{ccId ? " neste centro de custo" : ""}. Cadastre no Plano de Contas.
              </p>
            )}
          </div>
          {direction === "inflow" ? (
            <>
              <div className="space-y-2">
                <Label>Cliente/Pagador (obrigatório p/ realizar)</Label>
                <Select value={contactId} onValueChange={setContactId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const all = (contacts.data ?? []) as Array<{ id: string; name: string }>;
                      const generals = all.filter((c) => /^CLIENTE GERAL|^VENDAS CONSOLIDADAS/i.test(c.name));
                      const others = all.filter((c) => !/^CLIENTE GERAL|^VENDAS CONSOLIDADAS/i.test(c.name));
                      return (
                        <>
                          {generals.length > 0 && (
                            <>
                              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Clientes Gerais
                              </div>
                              {generals.map((c) => (
                                <SelectItem key={c.id} value={c.id}>
                                  {c.name}
                                </SelectItem>
                              ))}
                              <div className="px-2 py-1 mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Demais Contatos
                              </div>
                            </>
                          )}
                          {others.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Banco de Destino (opcional)</Label>
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
            </>
          ) : (
            <div className="space-y-2 md:col-span-2">
              <Label>Caixa de Origem</Label>
              <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                <strong className="text-foreground">Definir por Liquidez (Automático)</strong> — o
                banco de origem será escolhido somente no momento do pagamento efetivo, quando
                você clicar em <em>Pagar do Caixa</em>. Pagador não é exigido: quem paga é a
                própria estrutura conforme a saúde financeira do período.
              </div>
            </div>
          )}

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

      {consolidated.length > 0 && (
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold">Curva Consolidada de Capital Futuro</h2>
          <p className="text-xs text-muted-foreground">
            Soma de todas as projeções ativas · entradas somam, saídas subtraem
          </p>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={consolidated}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) =>
                    Number(v).toLocaleString("pt-BR", { notation: "compact" })
                  }
                />
                <Tooltip
                  formatter={(v: number) => fmt(Number(v))}
                  labelFormatter={(l) => `Mês ${l}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="entradas"
                  stroke="hsl(142 71% 45%)"
                  name="Entradas"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="saidas"
                  stroke="hsl(0 72% 51%)"
                  name="Saídas"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="acumulado"
                  stroke="hsl(var(--primary))"
                  name="Líquido Acumulado"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

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
  const isOutflow = (proj.direction ?? "inflow") === "outflow";
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
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-lg">{proj.name}</h3>
            <Badge variant={isOutflow ? "destructive" : "secondary"} className="gap-1">
              {isOutflow ? (
                <>
                  <ArrowDownCircle className="h-3 w-3" /> Saída
                </>
              ) : (
                <>
                  <ArrowUpCircle className="h-3 w-3" /> Entrada
                </>
              )}
            </Badge>
          </div>
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
          <Badge variant="outline">Projetado: {fmt(totalProjected)}</Badge>
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
                <TableCell className="text-right font-mono">{fmt(m.projected)}</TableCell>
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
                      {isOutflow ? "Pagar do Caixa" : "Realizar no Caixa"}
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
  const isOutflow = (proj.direction ?? "inflow") === "outflow";

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
          <DialogTitle>
            {isOutflow ? "Pagar do Caixa" : "Realizar no Caixa"} — {fmtMonthLabel(dueDate)}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Projeção: <strong>{proj.name}</strong>
            <br />
            Valor projetado: <strong>{fmt(projected)}</strong>
          </div>
          <div className="space-y-2">
            <Label>{isOutflow ? "Valor Real Pago (R$)" : "Valor Real Recebido (R$)"}</Label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </div>
          <div className="space-y-2">
            <Label>{isOutflow ? "Banco de Origem" : "Banco de Destino"}</Label>
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
            <Label>Data {isOutflow ? "do débito" : "do crédito"}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
            {mut.isPending ? "Salvando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
