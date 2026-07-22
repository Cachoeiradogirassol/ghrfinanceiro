import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTransactions,
  deleteTransaction,
  listAuditUsers,
  listCostCenters,
  listAccounts,
  listBankAccounts,
  bulkCreateTransactions,
} from "@/lib/finance.functions";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Layers, User, Download, Pencil, Grid3x3, Zap, Table as TableIcon, Rows3 } from "lucide-react";
import { SpreadsheetView, type SpreadsheetRow } from "@/components/SpreadsheetView";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useMemo, useState } from "react";
import { EditTransactionDialog } from "@/components/EditTransactionDialog";
import { QuickGrid, type GridColumnDef } from "@/components/QuickGrid";
import { QuickLaunchForm } from "@/components/QuickLaunchForm";
import { deleteRecurringGroup } from "@/lib/quick-launch.functions";
import { groupAccounts } from "@/lib/account-options";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Tx = {
  id: string;
  type: "payable" | "receivable";
  amount: number | string;
  due_date: string;
  document_datetime: string | null;
  paid_at: string | null;
  description: string | null;
  status: string;
  payment_method: string | null;
  contacts?: { name?: string | null } | null;
  cost_centers?: { code?: number | null; name?: string | null } | null;
  accounts?: { name?: string | null } | null;
};

const fmtDateBR = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("pt-BR") : "";
const fmtCompetencia = (s: string | null | undefined) => {
  if (!s) return "";
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};
const fmtNum = (n: number) => n.toFixed(2).replace(".", ",");
const csvField = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const downloadCSV = (filename: string, rows: string[][]) => {
  const csv = rows.map((r) => r.map(csvField).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

function exportPagar(txs: Tx[]) {
  const header = [
    "ID",
    "Fornecedor",
    "Data Emissão",
    "Data Vencimento",
    "Data Liquidação",
    "Valor documento",
    "Saldo",
    "Situação",
    "Número documento",
    "Categoria",
    "Histórico",
    "Pago",
    "Competencia",
    "Forma Pagamento",
    "Chave PIX/Código boleto",
  ];
  const rows = txs
    .filter((t) => t.type === "payable")
    .map((t) => {
      const paid = t.status === "paid" || t.status === "reconciled";
      const amount = Number(t.amount);
      const categoria = [
        t.cost_centers ? `${t.cost_centers.code ?? ""} - ${t.cost_centers.name ?? ""}` : "",
        t.accounts?.name ?? "",
      ]
        .filter(Boolean)
        .join(" / ");
      return [
        t.id,
        t.contacts?.name ?? "",
        fmtDateBR(t.document_datetime),
        fmtDateBR(t.due_date),
        fmtDateBR(t.paid_at),
        fmtNum(amount),
        fmtNum(paid ? 0 : amount),
        paid ? "Paga" : "Em aberto",
        "",
        categoria,
        t.description ?? "",
        paid ? "Sim" : "Não",
        fmtCompetencia(t.document_datetime ?? t.due_date),
        t.payment_method ?? "",
        "",
      ];
    });
  if (!rows.length) {
    toast.info("Sem contas a pagar para exportar");
    return;
  }
  downloadCSV(`contas_pagar_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
}

function exportReceber(txs: Tx[]) {
  const header = [
    "ID",
    "Cliente",
    "Data Emissão",
    "Data Vencimento",
    "Data Liquidação",
    "Valor documento",
    "Saldo",
    "Situação",
    "Número documento",
    "Número no banco",
    "Categoria",
    "Histórico",
    "Forma de recebimento",
    "Meio de recebimento",
    "Taxas",
    "Competência",
  ];
  const rows = txs
    .filter((t) => t.type === "receivable")
    .map((t) => {
      const paid = t.status === "paid" || t.status === "reconciled";
      const amount = Number(t.amount);
      const categoria = [
        t.cost_centers ? `${t.cost_centers.code ?? ""} - ${t.cost_centers.name ?? ""}` : "",
        t.accounts?.name ?? "",
      ]
        .filter(Boolean)
        .join(" / ");
      return [
        t.id,
        t.contacts?.name ?? "",
        fmtDateBR(t.document_datetime),
        fmtDateBR(t.due_date),
        fmtDateBR(t.paid_at),
        fmtNum(amount),
        fmtNum(paid ? 0 : amount),
        paid ? "Paga" : "Em aberto",
        "",
        "",
        categoria,
        t.description ?? "",
        t.payment_method ?? "",
        t.payment_method ?? "",
        fmtNum(0),
        fmtCompetencia(t.document_datetime ?? t.due_date),
      ];
    });
  if (!rows.length) {
    toast.info("Sem contas a receber para exportar");
    return;
  }
  downloadCSV(`contas_receber_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
}

export const Route = createFileRoute("/lancamentos/")({
  head: () => ({
    meta: [
      { title: "Lançamentos — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Liste, filtre e exporte contas a pagar e a receber do Grupo GHR com controle de competência, status e centros de custo.",
      },
      { property: "og:title", content: "Lançamentos — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Liste, filtre e exporte contas a pagar e a receber do Grupo GHR com controle de competência, status e centros de custo.",
      },
      { property: "og:url", content: "https://ghrfinanceiro.lovable.app/lancamentos" },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/lancamentos" }],
  }),
  component: () => (
    <AppLayout>
      <List />
    </AppLayout>
  ),
});

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function List() {
  const fn = useServerFn(listTransactions);
  const del = useServerFn(deleteTransaction);
  const usersFn = useServerFn(listAuditUsers);
  const { isMaster } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["txs"],
    queryFn: () => fn(),
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
  const mut = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["txs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });
  const [editing, setEditing] = useState<null | Record<string, unknown>>(null);
  const [gridMode, setGridMode] = useState(false);
  const [quickMode, setQuickMode] = useState(true);
  const [sheetView, setSheetView] = useState(false);
  const [recDialog, setRecDialog] = useState<{
    tx_id: string;
    group_id: string;
    description: string;
  } | null>(null);

  const delRecFn = useServerFn(deleteRecurringGroup);
  const delRecMut = useMutation({
    mutationFn: (group_id: string) => delRecFn({ data: { group_id, only_future: true } }),
    onSuccess: (res) => {
      toast.success(`${res.deleted} lançamentos futuros do grupo removidos.`);
      qc.invalidateQueries({ queryKey: ["txs"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const extractGroupId = (desc: string | null | undefined): string | null => {
    if (!desc) return null;
    const m = desc.match(/\[REC ([a-zA-Z0-9-]+)\]/);
    return m ? m[1] : null;
  };
  const handleDeleteClick = (tx: Tx) => {
    const gid = extractGroupId(tx.description);
    if (gid) {
      setRecDialog({ tx_id: tx.id, group_id: gid, description: tx.description ?? "" });
    } else {
      mut.mutate(tx.id);
    }
  };

  // Carrega CCs e Accounts apenas quando grade está ativa
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const bankFn = useServerFn(listBankAccounts);
  const bulkFn = useServerFn(bulkCreateTransactions);
  const ccs = useQuery({ queryKey: ["ccs"], queryFn: () => ccFn(), enabled: gridMode });
  const accs = useQuery({ queryKey: ["accs"], queryFn: () => accFn(), enabled: gridMode });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bankFn(), enabled: gridMode });

  const gridColumns = useMemo<GridColumnDef[]>(() => {
    const SELECTABLE = ["turismo", "restaurante", "vinhedo", "ghr_aldeia", "ghr_jk"];
    const selectableCenters = (ccs.data ?? []).filter((c) =>
      SELECTABLE.includes(c.enterprise ?? ""),
    );
    const allAccounts = (accs.data ?? []) as Array<{
      id: string;
      name: string;
      cost_center_id?: string | null;
    }>;
    const centerOptions = selectableCenters.map((center) => ({
      value: center.id,
      label: `${center.code} - ${center.name}`,
    }));
    const bankOptions = (banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }));
    const accountOptions = (row: Record<string, string>) => {
      const bank = (banks.data ?? []).find((item) => item.id === row.bank_account_id);
      return groupAccounts(allAccounts, selectableCenters, bank?.enterprise ?? null);
    };
    return [
      { key: "due_date", label: "Vencimento", type: "date", width: "150px" },
      {
        key: "type",
        label: "Tipo",
        type: "select",
        width: "130px",
        options: [
          { value: "payable", label: "Saída (Pagar)" },
          { value: "receivable", label: "Entrada (Receber)" },
        ],
      },
      {
        key: "cost_center_id",
        label: "Centro de Custo",
        type: "select",
        width: "200px",
        options: centerOptions,
      },
      {
        key: "bank_account_id",
        label: "Conta Bancária",
        type: "select",
        width: "190px",
        options: bankOptions,
      },
      {
        key: "account_id",
        label: "Conta Contábil",
        type: "select",
        width: "200px",
        optionsFor: accountOptions,
        searchPlaceholder: "Buscar em todas as contas…",
        emptyMessage: "Nenhuma conta contábil encontrada.",
      },
      { key: "amount", label: "Valor (R$)", type: "number", width: "130px", placeholder: "0,00" },
      { key: "description", label: "Descrição", type: "text", width: "260px" },
    ];
  }, [ccs.data, accs.data, banks.data]);

  const handleBulkSave = async (rows: Record<string, string>[]) => {
    const parsed = rows.map((r, i) => {
      const amountRaw = (r.amount ?? "").replace(",", ".");
      const amount = Number(amountRaw);
      if (!r.due_date) throw new Error(`Linha ${i + 1}: vencimento obrigatório.`);
      if (!r.cost_center_id) throw new Error(`Linha ${i + 1}: centro de custo obrigatório.`);
      if (!r.account_id) throw new Error(`Linha ${i + 1}: conta contábil obrigatória.`);
      if (!r.type) throw new Error(`Linha ${i + 1}: tipo obrigatório.`);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error(`Linha ${i + 1}: valor inválido.`);
      return {
        cost_center_id: r.cost_center_id,
        account_id: r.account_id,
        bank_account_id: r.bank_account_id || null,
        type: r.type as "payable" | "receivable",
        amount: Math.abs(amount),
        due_date: r.due_date,
        description: r.description?.trim() || null,
      };
    });
    const res = await bulkFn({ data: { rows: parsed } });
    qc.invalidateQueries({ queryKey: ["txs"] });
    return res;
  };

  const sheetRows = useMemo<SpreadsheetRow[]>(() => {
    return ((data ?? []) as unknown as Tx[]).map((t) => ({
      date: (t.paid_at ?? t.due_date).slice(0, 10),
      description: [t.description, t.contacts?.name].filter(Boolean).join(" · ") || "—",
      type: t.type === "receivable" ? "in" : "out",
      category: [t.accounts?.name, t.cost_centers?.name].filter(Boolean).join(" / ") || "—",
      amount: Number(t.amount),
    }));
  }, [data]);

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Lançamentos</h1>
          <p className="text-muted-foreground">Contas a Pagar e Receber</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={quickMode ? "default" : "outline"}
            onClick={() => setQuickMode((v) => !v)}
          >
            <Zap className="h-4 w-4 mr-2" />
            {quickMode ? "Ocultar Rápido" : "Lançamento Rápido"}
          </Button>
          <Button variant={gridMode ? "default" : "outline"} onClick={() => setGridMode((v) => !v)}>
            <Grid3x3 className="h-4 w-4 mr-2" />
            {gridMode ? "Sair da Grade" : "Modo Grade Rápida"}
          </Button>
          <Button
            variant={sheetView ? "default" : "outline"}
            onClick={() => setSheetView((v) => !v)}
          >
            {sheetView ? <Rows3 className="h-4 w-4 mr-2" /> : <TableIcon className="h-4 w-4 mr-2" />}
            {sheetView ? "Ver normal" : "Ver como planilha"}
          </Button>
          <Button
            variant="outline"
            onClick={() => exportPagar((data ?? []) as unknown as Tx[])}
            disabled={isLoading}
          >
            <Download className="h-4 w-4 mr-2" /> Exportar Pagar (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() => exportReceber((data ?? []) as unknown as Tx[])}
            disabled={isLoading}
          >
            <Download className="h-4 w-4 mr-2" /> Exportar Receber (CSV)
          </Button>
          <Link to="/lancamentos/novo">
            <Button>
              <Plus className="h-4 w-4 mr-2" /> Novo Lançamento
            </Button>
          </Link>
        </div>
      </div>

      {quickMode && !gridMode && <QuickLaunchForm />}

      {gridMode && (
        <QuickGrid
          columns={gridColumns}
          initialRows={6}
          onSave={handleBulkSave}
          saveLabel="Salvar Lote no Caixa Real"
        />
      )}

      {!gridMode && sheetView && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Modo planilha · saldo acumulado a partir de{" "}
            <span className="font-mono text-foreground">R$ 0,00</span> (base zero) — reflete apenas
            o impacto das transações listadas, incluindo pendentes.
          </p>
          <SpreadsheetView
            rows={sheetRows}
            startingBalance={0}
            fileName="lancamentos_planilha"
            maxHeight="70vh"
          />
        </div>
      )}

      {!gridMode && !sheetView && (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vencimento</TableHead>
                <TableHead>Bloco</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Beneficiário</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Pgto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                {isMaster && <TableHead className="text-xs">Auditoria</TableHead>}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={isMaster ? 11 : 10}
                    className="text-center text-muted-foreground py-8"
                  >
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {(data ?? []).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono text-xs">
                    {new Date(t.due_date).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {t.cost_centers?.code} - {t.cost_centers?.name}
                  </TableCell>
                  <TableCell className="text-xs">{t.accounts?.name}</TableCell>
                  <TableCell className="text-xs">{t.contacts?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-xs truncate">
                    {t.description}
                    {t.is_batch && (
                      <Badge variant="outline" className="ml-2">
                        <Layers className="h-3 w-3 mr-1" /> Lote
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs capitalize">
                    {t.payment_method?.replace("_", " ") ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={t.type === "receivable" ? "default" : "secondary"}>
                      {t.type === "receivable" ? "Receber" : "Pagar"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono">{fmt(Number(t.amount))}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        t.status === "reconciled"
                          ? "default"
                          : t.status === "paid"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {t.status}
                    </Badge>
                  </TableCell>
                  {isMaster && (
                    <TableCell className="text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span className="truncate max-w-[140px]">
                          {(t as { created_by?: string }).created_by
                            ? (userMap.get((t as { created_by: string }).created_by) ?? "—")
                            : "—"}
                        </span>
                      </div>
                      {(t as { updated_by?: string }).updated_by &&
                        (t as { updated_by?: string }).updated_by !==
                          (t as { created_by?: string }).created_by && (
                          <div className="text-[10px] opacity-70 truncate max-w-[140px]">
                            edit: {userMap.get((t as { updated_by: string }).updated_by) ?? "—"}
                          </div>
                        )}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Editar lançamento"
                        onClick={() => setEditing(t as unknown as Record<string, unknown>)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Excluir lançamento"
                        onClick={() => handleDeleteClick(t as unknown as Tx)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && (data?.length ?? 0) === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={isMaster ? 11 : 10}
                    className="text-center text-muted-foreground py-8"
                  >
                    Nenhum lançamento. Crie o primeiro.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <EditTransactionDialog
        tx={editing as never}
        open={!!editing}
        onOpenChange={(v) => {
          if (!v) setEditing(null);
        }}
      />
      <AlertDialog
        open={!!recDialog}
        onOpenChange={(v) => {
          if (!v) setRecDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Lançamento recorrente</AlertDialogTitle>
            <AlertDialogDescription>
              Este lançamento faz parte de uma recorrência. Deseja excluir apenas este ou todos os
              futuros pendentes do mesmo grupo?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                if (recDialog) {
                  mut.mutate(recDialog.tx_id);
                  setRecDialog(null);
                }
              }}
            >
              Só este
            </Button>
            <AlertDialogAction
              onClick={() => {
                if (recDialog) {
                  delRecMut.mutate(recDialog.group_id);
                  setRecDialog(null);
                }
              }}
            >
              Todos futuros do grupo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
