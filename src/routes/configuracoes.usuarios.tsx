import { createFileRoute } from "@tanstack/react-router";
import { UsersTab } from "@/components/config/panels";

export const Route = createFileRoute("/configuracoes/usuarios")({
  component: UsersTab,
});
