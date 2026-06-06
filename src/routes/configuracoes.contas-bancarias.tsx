import { createFileRoute } from "@tanstack/react-router";
import { BanksTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/contas-bancarias")({
  component: BanksTab,
});
