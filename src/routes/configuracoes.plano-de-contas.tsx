import { createFileRoute } from "@tanstack/react-router";
import { PlanTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/plano-de-contas")({
  component: PlanTab,
});
