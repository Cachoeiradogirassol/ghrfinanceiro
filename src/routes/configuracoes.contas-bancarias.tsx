import { createFileRoute } from "@tanstack/react-router";
import { BanksTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/contas-bancarias")({
  head: () => ({
    meta: [
      { title: "Contas Bancárias — Configurações — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Cadastre e gerencie as contas bancárias dos empreendimentos do Grupo GHR no CONTROLE.GHR.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://ghrfinanceiro.lovable.app/configuracoes/contas-bancarias",
      },
    ],
  }),
  component: BanksTab,
});
