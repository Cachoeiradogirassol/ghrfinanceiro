import { createFileRoute, Outlet, useNavigate, redirect } from "@tanstack/react-router";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/lib/auth";
import { useEffect } from "react";
import { Settings } from "lucide-react";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Área administrativa do CONTROLE.GHR para gestão de usuários, contas bancárias e plano de contas.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "canonical", href: "https://ghrfinanceiro.lovable.app/configuracoes" }],
  }),
  beforeLoad: ({ location }) => {
    if (location.pathname === "/configuracoes") {
      throw redirect({ to: "/configuracoes/usuarios" });
    }
  },
  component: ConfigLayout,
});

function ConfigLayout() {
  const { isMaster, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && !isMaster) nav({ to: "/" });
  }, [loading, isMaster, nav]);
  if (!isMaster) return null;

  return (
    <AppLayout>
      <div className="p-8 space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Settings className="h-6 w-6 text-primary" /> Configurações
          </h1>
          <p className="text-muted-foreground">
            Gestão interna — acesso restrito ao Usuário Master.
          </p>
        </div>
        <Outlet />
      </div>
    </AppLayout>
  );
}
