import { createFileRoute, Link } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTransactions,
  deleteTransaction,
  listAuditUsers,
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
import { Plus, Trash2, Layers, User, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useMemo } from "react";

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
    "ID","Fornecedor","Data Emissão","Data Vencimento","Data Liquidação",
    "Valor documento","Saldo","Situação","Número documento","Categoria",
    "Histórico","Pago","Competencia","Forma Pagamento","Chave PIX/Código boleto",
  ];
  const rows = txs.filter((t) => t.type === "payable").map((t) => {
    const paid = t.status === "paid" || t.status === "reconciled";
    const amount = Number(t.amount);
    const categoria = [
      t.cost_centers ? `${t.cost_centers.code ?? ""} - ${t.cost_centers.name ?? ""}` : "",
      t.accounts?.name ?? "",
    ].filter(Boolean).join(" / ");
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
  if (!rows.length) { toast.info("Sem contas a pagar para exportar"); return; }
  downloadCSV(`contas_pagar_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
}

function exportReceber(txs: Tx[]) {
  const header = [
    "ID","Cliente","Data Emissão","Data Vencimento","Data Liquidação",
    "Valor documento","Saldo","Situação","Número documento","Número no banco",
    "Categoria","Histórico","Forma de recebimento","Meio de recebimento","Taxas","Competência",
  ];
  const rows = txs.filter((t) => t.type === "receivable").map((t) => {
    const paid = t.status === "paid" || t.status === "reconciled";
    const amount = Number(t.amount);
    const categoria = [
      t.cost_centers ? `${t.cost_centers.code ?? ""} - ${t.cost_centers.name ?? ""}` : "",
      t.accounts?.name ?? "",
    ].filter(Boolean).join(" / ");
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
  if (!rows.length) { toast.info("Sem contas a receber para exportar"); return; }
  downloadCSV(`contas_receber_${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
}

export const Route = createFileRoute("/lancamentos/")({
  head: () => ({ meta: [{ title: "Lançamentos — CONTROLE.GHR" }] }),
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


  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Lançamentos</h1>
          <p className="text-muted-foreground">Contas a Pagar e Receber</p>
        </div>
        <Link to="/lancamentos/novo">
          <Button>
            <Plus className="h-4 w-4 mr-2" /> Novo Lançamento
          </Button>
        </Link>
      </div>

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
                <TableCell colSpan={isMaster ? 11 : 10} className="text-center text-muted-foreground py-8">
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
                <TableCell className="text-xs">
                  {t.contacts?.name ?? "—"}
                </TableCell>
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
                  <Badge
                    variant={t.type === "receivable" ? "default" : "secondary"}
                  >
                    {t.type === "receivable" ? "Receber" : "Pagar"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {fmt(Number(t.amount))}
                </TableCell>
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
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => mut.mutate(t.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>

              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={isMaster ? 11 : 10} className="text-center text-muted-foreground py-8">
                  Nenhum lançamento. Crie o primeiro.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
