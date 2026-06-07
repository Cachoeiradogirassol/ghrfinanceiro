export interface Enterprise {
  value:
    | "turismo"
    | "restaurante"
    | "vinhedo"
    | "institucional_fazenda"
    | "impostos"
    | "ghr"
    | "ghr_aldeia"
    | "ghr_jk";
  label: string;
  masterOnly?: boolean;
}

export const ENTERPRISES: Enterprise[] = [
  { value: "turismo", label: "Turismo (Cachoeira do Girassol)" },
  { value: "restaurante", label: "Restaurante" },
  { value: "vinhedo", label: "Vinhedo Girassol" },
  { value: "ghr_aldeia", label: "GHR - Loteamento Aldeia Girassol" },
  { value: "ghr_jk", label: "GHR - Loteamento JK" },
  { value: "institucional_fazenda", label: "Bloco Fazenda" },
  { value: "impostos", label: "Impostos" },
  { value: "ghr", label: "GHR (Holding)", masterOnly: true },
];

export type EnterpriseValue = (typeof ENTERPRISES)[number]["value"];

export function enterpriseLabel(v: string | null | undefined) {
  return ENTERPRISES.find((e) => e.value === v)?.label ?? v ?? "—";
}
