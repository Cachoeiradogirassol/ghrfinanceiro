import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/projecao")({
  component: () => <Navigate to="/" replace />,
});
