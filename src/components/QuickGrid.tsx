import { useState, useRef, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type GridColumnDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  width?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Optional per-row dynamic options. When provided, overrides `options` for that row. */
  optionsFor?: (row: GridRow) => Array<{ value: string; label: string }>;
  /** Optional per-row disabled rule. Returning true greys out the cell and clears its value on save. */
  disabledWhen?: (row: GridRow) => boolean;
};


export type GridRow = Record<string, string>;

type QuickGridProps = {
  columns: GridColumnDef[];
  initialRows?: number;
  onSave: (rows: GridRow[]) => Promise<{ created: number }>;
  saveLabel?: string;
  emptyRow?: GridRow;
};

function makeEmpty(columns: GridColumnDef[], template?: GridRow): GridRow {
  const r: GridRow = {};
  for (const c of columns) r[c.key] = template?.[c.key] ?? "";
  return r;
}

export function QuickGrid({
  columns,
  initialRows = 5,
  onSave,
  saveLabel = "Salvar Alterações em Lote",
  emptyRow,
}: QuickGridProps) {
  const [rows, setRows] = useState<GridRow[]>(() =>
    Array.from({ length: initialRows }, () => makeEmpty(columns, emptyRow)),
  );
  const [saving, setSaving] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  // Ensure rows always include keys for any added columns
  useEffect(() => {
    setRows((prev) =>
      prev.map((r) => {
        const out = { ...r };
        for (const c of columns) if (!(c.key in out)) out[c.key] = "";
        return out;
      }),
    );
  }, [columns]);

  const updateCell = useCallback((rowIdx: number, key: string, value: string) => {
    setRows((prev) => {
      const next = prev.slice();
      next[rowIdx] = { ...next[rowIdx], [key]: value };
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [...prev, makeEmpty(columns, emptyRow)]);
  }, [columns, emptyRow]);

  const removeRow = useCallback((idx: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }, []);

  const focusCell = (rowIdx: number, colIdx: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
      `[data-cell="${rowIdx}-${colIdx}"]`,
    );
    el?.focus();
    if (el && "select" in el) (el as HTMLInputElement).select?.();
  };

  const handleKey = (
    e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIdx: number,
    colIdx: number,
  ) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const nextRow = rowIdx + 1;
      if (nextRow >= rows.length) {
        setRows((prev) => [...prev, makeEmpty(columns, emptyRow)]);
        setTimeout(() => focusCell(nextRow, colIdx), 0);
      } else {
        focusCell(nextRow, colIdx);
      }
    }
    // Tab is native — let browser handle natural left-to-right flow.
  };

  const isRowFilled = (r: GridRow) =>
    columns.some((c) => (r[c.key] ?? "").toString().trim() !== "");

  const handleSave = async () => {
    const filled = rows.filter(isRowFilled);
    if (filled.length === 0) {
      toast.error("Nenhuma linha preenchida.");
      return;
    }
    setSaving(true);
    const tId = toast.loading(`Salvando ${filled.length} linha(s)...`);
    try {
      const result = await onSave(filled);
      toast.success(`${result.created} lançamento(s) salvos com sucesso.`, {
        id: tId,
        duration: 8000,
      });
      setRows(Array.from({ length: initialRows }, () => makeEmpty(columns, emptyRow)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro desconhecido";
      toast.error("Falha ao salvar grade: " + msg, { id: tId, duration: 12000 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3" ref={gridRef}>
      <div className="flex items-center justify-between gap-2 sticky top-0 z-10 bg-background py-2 border-b">
        <div className="text-sm text-muted-foreground">
          Modo Grade Rápida — Tab muda de coluna, Enter desce e cria nova linha.
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4 mr-1" /> Linha
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4 mr-1" />
            {saving ? "Salvando..." : saveLabel}
          </Button>
        </div>
      </div>

      <div className="overflow-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="w-10 px-2 py-2 text-left text-xs text-muted-foreground">#</th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-2 py-2 text-left text-xs font-medium text-muted-foreground"
                  style={{ minWidth: c.width ?? "140px" }}
                >
                  {c.label}
                </th>
              ))}
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rIdx) => (
              <tr key={rIdx} className={cn("border-t", isRowFilled(row) && "bg-primary/[0.02]")}>
                <td className="px-2 py-1 text-xs text-muted-foreground">{rIdx + 1}</td>
                {columns.map((c, cIdx) => {
                  const isDisabled = c.disabledWhen?.(row) ?? false;
                  return (
                  <td key={c.key} className="px-1 py-1">
                    {c.type === "select" ? (
                      <select
                        data-cell={`${rIdx}-${cIdx}`}
                        value={isDisabled ? "" : (row[c.key] ?? "")}
                        disabled={isDisabled}
                        onChange={(e) => updateCell(rIdx, c.key, e.target.value)}
                        onKeyDown={(e) => handleKey(e, rIdx, cIdx)}
                        className={cn(
                          "h-8 w-full rounded border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
                          isDisabled && "bg-muted/40 text-muted-foreground cursor-not-allowed",
                        )}
                      >
                        <option value="">{isDisabled ? "—  (opcional)" : "—"}</option>
                        {(c.options ?? []).map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        data-cell={`${rIdx}-${cIdx}`}
                        type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"}
                        step={c.type === "number" ? "0.01" : undefined}
                        value={isDisabled ? "" : (row[c.key] ?? "")}
                        disabled={isDisabled}
                        placeholder={isDisabled ? "(opcional)" : c.placeholder}
                        onChange={(e) => updateCell(rIdx, c.key, e.target.value)}
                        onKeyDown={(e) => handleKey(e, rIdx, cIdx)}
                        className={cn("h-8", isDisabled && "bg-muted/40 text-muted-foreground")}
                      />
                    )}
                  </td>
                  );
                })}

                <td className="px-1 py-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeRow(rIdx)}
                    aria-label="Remover linha"
                    className="h-7 w-7"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
