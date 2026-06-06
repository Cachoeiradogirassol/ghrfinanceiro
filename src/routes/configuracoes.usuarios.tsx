import { createFileRoute } from "@tanstack/react-router";
import { UsersTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/usuarios")({
  head: () => ({
    meta: [
      { title: "Usuários — Configurações — CONTROLE.GHR" },
      {
        name: "description",
        content:
          "Gerencie usuários, papéis e permissões de acesso ao CONTROLE.GHR.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      { rel: "canonical", href: "https://ghrfinanceiro.lovable.app/configuracoes/usuarios" },
    ],
  }),
  component: UsersTab,
});
