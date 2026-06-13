import { enterpriseLabel } from "@/lib/enterprises";

type Account = { id: string; name: string; cost_center_id?: string | null };
type CostCenter = { id: string; code?: string | number | null; enterprise?: string | null };

export function groupAccounts(
  accounts: Account[],
  costCenters: CostCenter[],
  localEnterprise?: string | null,
) {
  const centerById = new Map(costCenters.map((center) => [center.id, center]));
  const decorated = accounts.map((account) => {
    const center = account.cost_center_id ? centerById.get(account.cost_center_id) : undefined;
    const enterprise = center?.enterprise ?? "sem_empresa";
    return {
      value: account.id,
      label: center?.code ? `${account.name} · ${center.code}` : account.name,
      enterprise,
      group:
        enterprise === localEnterprise
          ? `Contas Operacionais Locais (${enterpriseLabel(localEnterprise)})`
          : enterprise === "sem_empresa"
            ? "Contas Gerais da Holding"
            : `Contas ${enterpriseLabel(enterprise)}`,
    };
  });
  return decorated.sort((a, b) => {
    const localDelta =
      Number(b.enterprise === localEnterprise) - Number(a.enterprise === localEnterprise);
    return (
      localDelta ||
      a.group.localeCompare(b.group, "pt-BR") ||
      a.label.localeCompare(b.label, "pt-BR")
    );
  });
}
