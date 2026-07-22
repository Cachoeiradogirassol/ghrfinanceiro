import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export type SpreadsheetRow = {
  date: string; // ISO YYYY-MM-DD
  description: string;
  type: "in" | "out";
  category: string;
  amount: number; // sempre positivo; sinal vem do type
  isEstimate?: boolean;
  sourceLabel?: string;
};

const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDateBR = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const csvField = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function SpreadsheetView({
  rows,
  startingBalance,
  title,
  fileName = "planilha",
  maxHeight = "60vh",
}: {
  rows: SpreadsheetRow[];
  startingBalance: number;
  title?: string;
  fileName?: string;
  maxHeight?: string;
}) {
  const { computed, endBalance } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    let saldo = startingBalance;
    const out = sorted.map((r) => {
      const signed = r.type === "in" ? r.amount : -r.amount;
      saldo += signed;
      return { ...r, signed, saldo };
    });
    return { computed: out, endBalance: saldo };
  }, [rows, startingBalance]);

  const exportCSV = () => {
    const header = ["Data", "Descrição", "Tipo", "Categoria", "Valor", "Saldo"];
    const body = computed.map((r) => [
      fmtDateBR(r.date),
      r.description,
      r.type === "in" ? "Receita" : "Despesa",
      r.category,
      r.signed.toFixed(2).replace(".", ","),
      r.saldo.toFixed(2).replace(".", ","),
    ]);
    const csv = [header, ...body]
      .map((row) => row.map(csvField).join(";"))
      .join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
        <div>
          {title && <span className="font-medium text-foreground">{title} · </span>}
          Saldo inicial:{" "}
          <span className="font-mono text-foreground">{fmt(startingBalance)}</span>
          {"  "}·{"  "}Saldo final:{" "}
          <span
            className={`font-mono font-semibold ${
              endBalance < 0 ? "text-red-600" : "text-foreground"
            }`}
          >
            {fmt(endBalance)}
          </span>
          {"  "}·{"  "}
          {computed.length} linha{computed.length === 1 ? "" : "s"}
        </div>
        <Button size="sm" variant="outline" onClick={exportCSV} disabled={computed.length === 0}>
          <Download className="h-3.5 w-3.5 mr-1" /> Exportar CSV
        </Button>
      </div>
      <div
        className="rounded-md border overflow-auto"
        style={{ maxHeight }}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background z-10">
            <TableRow>
              <TableHead className="w-[95px]">Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="w-[95px]">Tipo</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right w-[130px]">Valor</TableHead>
              <TableHead className="text-right w-[140px]">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {computed.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-6 text-sm">
                  Sem lançamentos para exibir.
                </TableCell>
              </TableRow>
            )}
            {computed.map((r, i) => (
              <TableRow key={i} className="h-8">
                <TableCell className="font-mono text-xs py-1">
                  {fmtDateBR(r.date)}
                  {r.isEstimate && (
                    <span
                      className="ml-1 text-[9px] text-muted-foreground italic"
                      title="Estimativa mensal — sem dia exato"
                    >
                      ~
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-xs py-1 max-w-[320px] truncate" title={r.description}>
                  {r.description}
                  {r.sourceLabel && (
                    <Badge variant="outline" className="ml-1 text-[9px] px-1 py-0">
                      {r.sourceLabel}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="py-1">
                  <span
                    className={`text-xs font-medium ${
                      r.type === "in" ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {r.type === "in" ? "Receita" : "Despesa"}
                  </span>
                </TableCell>
                <TableCell
                  className="text-xs py-1 max-w-[240px] truncate text-muted-foreground"
                  title={r.category}
                >
                  {r.category}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs py-1 ${
                    r.type === "in" ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {r.type === "in" ? "+" : "−"}
                  {fmt(r.amount)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono text-xs py-1 font-semibold ${
                    r.saldo < 0 ? "text-red-600" : ""
                  }`}
                >
                  {fmt(r.saldo)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
