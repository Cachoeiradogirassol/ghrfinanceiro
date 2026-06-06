import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listCostCenters, listAccounts } from "@/lib/finance.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth, MASTER_EMAIL } from "@/lib/auth";
import { useEffect } from "react";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/contas")({
  head: () => ({ meta: [{ title: "Plano de Contas — CONTROLE.GHR" }] }),
  component: () => (
    <AppLayout>
      <Plan />
    </AppLayout>
  ),
});

function Plan() {
  const { isMaster, loading } = useAuth();
  const nav = useNavigate();
  const ccFn = useServerFn(listCostCenters);
  const accFn = useServerFn(listAccounts);
  const ccs = useQuery({ queryKey: ["cc"], queryFn: () => ccFn() });
  const accs = useQuery({ queryKey: ["acc"], queryFn: () => accFn() });

  useEffect(() => {
    if (!loading && !isMaster) nav({ to: "/" });
  }, [loading, isMaster, nav]);

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Lock className="h-6 w-6 text-primary" /> Plano de Contas
        </h1>
        <p className="text-muted-foreground">
          Estrutura completa — acesso restrito ({MASTER_EMAIL})
        </p>
      </div>
      <div className="grid gap-4">
        {(ccs.data ?? []).map((cc) => (
          <Card key={cc.id} className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <h2 className="font-semibold">
                {cc.code} — {cc.name}
              </h2>
              {cc.master_only && (
                <Badge variant="destructive">
                  <Lock className="h-3 w-3 mr-1" /> Master
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(accs.data ?? [])
                .filter((a) => a.cost_center_id === cc.id)
                .map((a) => (
                  <Badge
                    key={a.id}
                    variant={a.kind === "revenue" ? "default" : "secondary"}
                  >
                    {a.name}
                  </Badge>
                ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
