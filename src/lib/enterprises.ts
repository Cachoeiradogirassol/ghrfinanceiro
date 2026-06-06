export const ENTERPRISES = [
  { value: "turismo", label: "Turismo (Cachoeira)" },
  { value: "restaurante", label: "Restaurante" },
  { value: "vinhedo", label: "Vinhedo" },
  { value: "institucional_fazenda", label: "Fazenda" },
  { value: "impostos", label: "Impostos" },
  { value: "ghr", label: "GHR (Holding)", masterOnly: true },
] as const;

export type EnterpriseValue = (typeof ENTERPRISES)[number]["value"];

export function enterpriseLabel(v: string | null | undefined) {
  return ENTERPRISES.find((e) => e.value === v)?.label ?? v ?? "—";
}
