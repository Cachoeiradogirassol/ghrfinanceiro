import { createFileRoute } from "@tanstack/react-router";
import { PlanTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/plano-de-contas")({
  head: () => ({
    meta: [
      { title: "Plano de Contas — Configurações — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Configure o plano de contas hierárquico utilizado em lançamentos e relatórios do CONTROLE.GHR.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://ghrfinanceiro.lovable.app/configuracoes/plano-de-contas",
      },
    ],
  }),
  component: PlanTab,
});
