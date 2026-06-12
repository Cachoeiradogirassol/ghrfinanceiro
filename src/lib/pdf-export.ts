import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface DRESeriesRow {
  month: string;
  revenue: number;
  expense: number;
  directExpense: number;
  adminExpense: number;
  grossProfit: number;
  aporteRecebido: number;
  aporteConcedido: number;
  net: number;
}

export interface DREExportData {
  series: DRESeriesRow[];
  totals: {
    revenue: number;
    expense: number;
    directExpense: number;
    adminExpense: number;
    grossProfit: number;
    aporteRecebido: number;
    aporteConcedido: number;
    net: number;
  };
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export interface DREExportOptions {
  title: string;
  scope: string;
  periodClosed?: boolean;
  fileName?: string;
}

export function exportDREPdf(data: DREExportData, opts: DREExportOptions) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const now = new Date();
  const stamp = now.toLocaleString("pt-BR");

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(30);
  doc.text("CONTROLE.GHR", 40, 50);
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80);
  doc.text("Relatório Oficial Auditado", 40, 68);

  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(`Emitido em: ${stamp}`, pageW - 40, 50, { align: "right" });
  doc.text(
    `Período: ${opts.periodClosed ? "FECHADO (CLOSED)" : "ABERTO"}`,
    pageW - 40,
    64,
    { align: "right" },
  );

  doc.setDrawColor(180);
  doc.line(40, 80, pageW - 40, 80);

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text(opts.title, 40, 105);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`Escopo: ${opts.scope}`, 40, 122);

  // Table
  const head = [["Linha", ...data.series.map((m) => m.month), "Total"]];
  const rowDefs: Array<{
    label: string;
    key: keyof DRESeriesRow;
    tkey: keyof DREExportData["totals"];
  }> = [
    { label: "Receitas", key: "revenue", tkey: "revenue" },
    { label: "Custos / Despesas", key: "expense", tkey: "expense" },
    {
      label: "Aportes Recebidos",
      key: "aporteRecebido",
      tkey: "aporteRecebido",
    },
    {
      label: "Aportes Concedidos",
      key: "aporteConcedido",
      tkey: "aporteConcedido",
    },
  ];
  const body = rowDefs.map((r) => [
    r.label,
    ...data.series.map((m) => fmt(m[r.key] as number)),
    fmt(data.totals[r.tkey] as number),
  ]);
  body.push([
    "Resultado Líquido",
    ...data.series.map((m) => fmt(m.net)),
    fmt(data.totals.net),
  ]);

  autoTable(doc, {
    head,
    body,
    startY: 140,
    theme: "grid",
    styles: {
      font: "helvetica",
      fontSize: 9,
      textColor: 30,
      lineColor: 200,
      lineWidth: 0.4,
    },
    headStyles: {
      fillColor: [60, 60, 60],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: { 0: { fontStyle: "bold", textColor: 50 } },
    didParseCell: (h) => {
      if (h.row.index === body.length - 1) {
        h.cell.styles.fontStyle = "bold";
        h.cell.styles.fillColor = [225, 225, 225];
      }
    },
  });

  // Footer: stamp + page numbers
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      "Relatório Oficial Auditado — CONTROLE.GHR",
      40,
      doc.internal.pageSize.getHeight() - 20,
    );
    doc.text(
      `Página ${i} de ${pageCount}`,
      pageW - 40,
      doc.internal.pageSize.getHeight() - 20,
      { align: "right" },
    );
  }

  const fname =
    opts.fileName ??
    `DRE_${opts.scope.replace(/[^A-Za-z0-9]+/g, "_")}_${now
      .toISOString()
      .slice(0, 10)}.pdf`;
  doc.save(fname);
}
