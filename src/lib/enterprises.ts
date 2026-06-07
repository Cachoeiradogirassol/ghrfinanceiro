// Estrutura de empreendimentos: 2 blocos macros + filhos finalísticos.
export type EnterpriseValue =
  | "turismo"
  | "restaurante"
  | "vinhedo"
  | "institucional_fazenda"
  | "impostos"
  | "ghr"
  | "ghr_aldeia"
  | "ghr_jk";

export type EnterpriseGroupKey = "fazenda" | "ghr_grupo";
export type EnterpriseFilterValue = "all" | EnterpriseGroupKey | EnterpriseValue;

export interface Enterprise {
  value: EnterpriseValue;
  label: string;
  masterOnly?: boolean;
  group?: EnterpriseGroupKey;
}

export const ENTERPRISE_GROUPS: { key: EnterpriseGroupKey; label: string; children: EnterpriseValue[] }[] = [
  {
    key: "fazenda",
    label: "FAZENDA SERRA DOS PIRENEUS",
    children: ["turismo", "restaurante", "vinhedo"],
  },
  {
    key: "ghr_grupo",
    label: "GHR EMPREENDIMENTOS",
    children: ["ghr_aldeia", "ghr_jk"],
  },
];

// Apenas finalísticos — usados em selects, restrições de operador e cadastro de conta bancária.
export const ENTERPRISES: Enterprise[] = [
  { value: "turismo", label: "Turismo (Cachoeira do Girassol)", group: "fazenda" },
  { value: "restaurante", label: "Restaurante", group: "fazenda" },
  { value: "vinhedo", label: "Vinhedo Girassol", group: "fazenda" },
  { value: "ghr_aldeia", label: "GHR - Loteamento Aldeia Girassol", group: "ghr_grupo" },
  { value: "ghr_jk", label: "GHR - Loteamento JK", group: "ghr_grupo" },
];

// Legado (mantido para mapear dados antigos / contas existentes, mas oculto na UI).
export const LEGACY_ENTERPRISES: Enterprise[] = [
  { value: "institucional_fazenda", label: "Bloco Fazenda (legado)", masterOnly: true },
  { value: "impostos", label: "Impostos (legado)", masterOnly: true },
  { value: "ghr", label: "GHR (Holding legado)", masterOnly: true },
];

export function enterpriseLabel(v: string | null | undefined) {
  if (!v) return "—";
  const grp = ENTERPRISE_GROUPS.find((g) => g.key === v);
  if (grp) return grp.label;
  const all = [...ENTERPRISES, ...LEGACY_ENTERPRISES];
  return all.find((e) => e.value === v)?.label ?? v;
}

// Expande um filtro para a lista de enterprises finalísticos correspondentes.
// "all" retorna null (sem filtro). Um grupo retorna seus filhos.
export function expandEnterpriseFilter(v: EnterpriseFilterValue | string | null | undefined): Set<string> | null {
  if (!v || v === "all") return null;
  const grp = ENTERPRISE_GROUPS.find((g) => g.key === v);
  if (grp) return new Set<string>(grp.children);
  return new Set<string>([v]);
}
