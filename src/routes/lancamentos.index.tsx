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
import { Plus, Trash2, Layers, User } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useMemo } from "react";

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
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
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
                <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
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
