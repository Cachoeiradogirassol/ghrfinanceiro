import { createFileRoute } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listTransactions,
  listBankAccounts,
  buildProjection,
} from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Wallet, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Dashboard — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Dashboard />
    </AppLayout>
  ),
});

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function Dashboard() {
  const txFn = useServerFn(listTransactions);
  const bkFn = useServerFn(listBankAccounts);
  const projFn = useServerFn(buildProjection);
  const txs = useQuery({ queryKey: ["txs"], queryFn: () => txFn() });
  const banks = useQuery({ queryKey: ["banks"], queryFn: () => bkFn() });
  const proj = useQuery({ queryKey: ["proj"], queryFn: () => projFn() });

  const today = new Date().toISOString().slice(0, 10);
  const pendingPay = (txs.data ?? []).filter(
    (t) => t.type === "payable" && t.status === "pending" && t.due_date >= today,
  );
  const pendingRec = (txs.data ?? []).filter(
    (t) => t.type === "receivable" && t.status === "pending" && t.due_date >= today,
  );
  const overdue = (txs.data ?? []).filter(
    (t) => t.status === "pending" && t.due_date < today,
  );

  const totalPay = pendingPay.reduce((s, t) => s + Number(t.amount), 0);
  const totalRec = pendingRec.reduce((s, t) => s + Number(t.amount), 0);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Visão consolidada das operações</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wallet className="h-4 w-4" /> Saldo Consolidado
          </div>
          <p className="text-2xl font-bold mt-2">
            {fmt(proj.data?.currentBalance ?? 0)}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingDown className="h-4 w-4 text-destructive" /> A Pagar
          </div>
          <p className="text-2xl font-bold mt-2 text-destructive">
            {fmt(totalPay)}
          </p>
          <p className="text-xs text-muted-foreground">
            {pendingPay.length} lançamentos
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <TrendingUp className="h-4 w-4 text-primary" /> A Receber
          </div>
          <p className="text-2xl font-bold mt-2 text-primary">
            {fmt(totalRec)}
          </p>
          <p className="text-xs text-muted-foreground">
            {pendingRec.length} lançamentos
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4 text-destructive" /> Vencidos
          </div>
          <p className="text-2xl font-bold mt-2">{overdue.length}</p>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="font-semibold mb-4">Contas Bancárias</h2>
        <div className="space-y-2">
          {(banks.data ?? []).map((b) => (
            <div
              key={b.id}
              className="flex justify-between py-2 border-b border-border last:border-0"
            >
              <span className="text-sm">
                {b.name}{" "}
                <span className="text-muted-foreground">— {b.bank}</span>
              </span>
              <span className="text-sm font-mono">
                {fmt(Number(b.initial_balance))}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
