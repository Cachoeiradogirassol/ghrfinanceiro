import { createFileRoute } from "@tanstack/react-router";
import { AccountBalancesPanel } from "@/components/AccountBalancesPanel";

export const Route = createFileRoute("/configuracoes/saldos-iniciais")({
  head: () => ({
    meta: [
      { title: "Saldo Inicial das Contas — Configurações — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Informe o saldo atual de cada conta bancária para ancorar a projeção de fluxo de caixa no caixa real do CONTROLE.GHR.",
      },
      { property: "og:title", content: "Saldo Inicial das Contas — CONTROLE.GHR" },
      {
        property: "og:description",
        content:
          "Cadastro manual do saldo atual por conta bancária, agrupado por empreendimento.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://ghrfinanceiro.lovable.app/configuracoes/saldos-iniciais",
      },
    ],
  }),
  component: AccountBalancesPanel,
});
