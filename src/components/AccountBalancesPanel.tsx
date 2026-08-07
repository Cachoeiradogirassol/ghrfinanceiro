import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Wallet, Save, Loader2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  listAccountBalances,
  saveAccountBalances,
} from "@/lib/account-balances.functions";
import { ENTERPRISES, enterpriseLabel } from "@/lib/enterprises";

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const HOLDING_GROUP = "Contas gerais da Holding";

function groupOf(enterprise: string | null) {
  if (!enterprise) return HOLDING_GROUP;
  const known = ENTERPRISES.find((e) => e.value === enterprise);
  return known ? known.label : enterpriseLabel(enterprise);
}

export function AccountBalancesPanel() {
  const listFn = useServerFn(listAccountBalances);
  const saveFn = useServerFn(saveAccountBalances);
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState<string>(today);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const q = useQuery({ queryKey: ["account-balances"], queryFn: () => listFn() });

  useEffect(() => {
    if (!q.data) return;
    const next: Record<string, string> = {};
    let maxAsOf: string | null = null;
    for (const r of q.data) {
      next[r.account_id] = r.balance == null ? "" : String(r.balance);
      if (r.as_of_date && (!maxAsOf || r.as_of_date > maxAsOf)) maxAsOf = r.as_of_date;
    }
    setValues(next);
    if (maxAsOf) setAsOf(maxAsOf);
  }, [q.data]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    const rows = q.data ?? [];
    for (const r of rows) {
      const key = groupOf(r.enterprise);
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === HOLDING_GROUP) return 1;
      if (b === HOLDING_GROUP) return -1;
      return a.localeCompare(b, "pt-BR");
    });
  }, [q.data]);

  const parse = (v: string | undefined) => {
    if (!v || v.trim() === "") return null;
    const n = Number(v.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  const subtotal = (accountIds: string[]) =>
    accountIds.reduce((s, id) => s + (parse(values[id]) ?? 0), 0);

  const total = useMemo(
    () => Object.keys(values).reduce((s, id) => s + (parse(values[id]) ?? 0), 0),
    [values],
  );

  const handleSave = async () => {
    const items = Object.entries(values)
      .map(([account_id, v]) => ({ account_id, balance: parse(v) }))
      .filter((it): it is { account_id: string; balance: number } => it.balance !== null);
    if (items.length === 0) {
      toast.error("Informe o saldo de ao menos uma conta.");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: { as_of_date: asOf, items } });
      toast.success(`Saldos salvos (${items.length} conta(s)).`);
      await qc.invalidateQueries({ queryKey: ["account-balances"] });
      await qc.invalidateQueries({ queryKey: ["manual-opening-balance"] });
    } catch (e) {
      toast.error(`Erro ao salvar: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-semibold flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" />
            Saldo inicial das contas
          </div>
          <p className="text-xs text-muted-foreground max-w-2xl">
            Informe o saldo atual de cada conta bancária. A projeção de fluxo de caixa passa
            a ancorar o caixa inicial nesses valores (em vez do saldo derivado das
            conciliações). Contas não preenchidas ficam de fora da soma.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="as-of" className="text-xs">
              Data de referência
            </Label>
            <Input
              id="as-of"
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value)}
              className="w-40"
            />
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            Salvar
          </Button>
        </div>
      </Card>

      {q.isLoading && (
        <Card className="p-6 text-sm text-muted-foreground">Carregando contas...</Card>
      )}

      {groups.map(([groupName, rows]) => (
        <Card key={groupName} className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">{groupName}</div>
            <div className="text-xs text-muted-foreground">
              Subtotal:{" "}
              <span className="font-mono font-semibold text-foreground">
                {fmt(subtotal(rows.map((r) => r.account_id)))}
              </span>
            </div>
          </div>
          <div className="divide-y">
            {rows.map((r) => (
              <div
                key={r.account_id}
                className="flex flex-wrap items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {r.account_name}
                    {!r.is_active && (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        inativa
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.bank ?? "—"}
                    {r.as_of_date && ` · informado em ${r.as_of_date.split("-").reverse().slice(0, 2).join("/")}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">R$</span>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    value={values[r.account_id] ?? ""}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [r.account_id]: e.target.value }))
                    }
                    className="w-36 text-right font-mono"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      <Card className="p-4 flex items-center justify-between">
        <div className="text-sm font-semibold">Total do caixa informado</div>
        <div className="font-mono text-lg font-bold">{fmt(total)}</div>
      </Card>
    </div>
  );
}
