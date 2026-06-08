// Parses bank statement files (CSV/OFX/PDF) into a canonical line shape.
// Designed for Brazilian bank exports: BRL decimal comma, DD/MM/YYYY dates,
// and D/C (Débito/Crédito) sign indicators.
export type ParsedLine = {
  statement_date: string; // YYYY-MM-DD (date from the statement line, NOT upload date)
  amount: number; // negative = debit/saída, positive = credit/entrada
  description: string | null;
  external_id?: string | null;
};

// ---------- Primitive parsers ----------

const DATE_REGEXES: RegExp[] = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/, // ISO 2025-06-07
  /\b(\d{2})\/(\d{2})\/(\d{4})\b/, // BR 07/06/2025
  /\b(\d{2})\/(\d{2})\/(\d{2})\b/, // short BR 07/06/25
  /\b(\d{2})-(\d{2})-(\d{4})\b/, // 07-06-2025
  /\b(\d{8})\b/, // OFX 20250607
];

export function extractDate(s: string): string | null {
  s = s.trim();
  for (const re of DATE_REGEXES) {
    const m = re.exec(s);
    if (!m) continue;
    if (re === DATE_REGEXES[0]) return `${m[1]}-${m[2]}-${m[3]}`;
    if (re === DATE_REGEXES[1] || re === DATE_REGEXES[3])
      return `${m[3]}-${m[2]}-${m[1]}`;
    if (re === DATE_REGEXES[2]) {
      const yy = parseInt(m[3], 10);
      const yyyy = yy < 70 ? 2000 + yy : 1900 + yy;
      return `${yyyy}-${m[2]}-${m[1]}`;
    }
    if (re === DATE_REGEXES[4])
      return `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
  }
  return null;
}

// Parse a Brazilian or US monetary string. Returns { value, sign } where sign
// reflects any explicit -, +, D, or C suffix/prefix detected on the cell.
export function parseAmountCell(raw: string): { value: number; sign: -1 | 1 | 0 } {
  let s = raw.trim();
  if (!s) return { value: NaN, sign: 0 };
  let sign: -1 | 1 | 0 = 0;
  // Detect parens accounting style: (123,45) => negative
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  // Detect trailing D / C indicator (common in BR bank CSVs)
  const tail = s.match(/[\s]?([DC])\s*$/i);
  if (tail) {
    sign = tail[1].toUpperCase() === "D" ? -1 : 1;
    s = s.slice(0, tail.index).trim();
  }
  // Strip currency, spaces
  s = s.replace(/R\$\s*/gi, "").replace(/\s/g, "");
  if (s.startsWith("-")) {
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    if (sign === 0) sign = 1;
    s = s.slice(1);
  }
  // BR format: "1.234,56" (comma decimal), US/simple format: "1,234.56" or "40.00".
  let num: number;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    num =
      lastComma > lastDot
        ? parseFloat(s.replace(/\./g, "").replace(",", "."))
        : parseFloat(s.replace(/,/g, ""));
  } else if (lastComma >= 0) {
    num = /,\d{1,2}$/.test(s)
      ? parseFloat(s.replace(/\./g, "").replace(",", "."))
      : parseFloat(s.replace(/,/g, ""));
  } else if (lastDot >= 0) {
    num = /\.\d{1,2}$/.test(s)
      ? parseFloat(s)
      : parseFloat(s.replace(/\./g, ""));
  } else {
    num = parseFloat(s);
  }
  if (Number.isNaN(num)) return { value: NaN, sign };
  return { value: Math.abs(num), sign };
}

function normalizeText(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function signFromDescription(description: string | null | undefined): -1 | 1 | 0 {
  const text = normalizeText(description ?? "");
  const income =
    /\bpix\s+recebid[oa]\b/.test(text) ||
    /\brecebid[oa]\b/.test(text) ||
    /\bcredito\b/.test(text) ||
    /\bestorno\b/.test(text) ||
    /\bdeposito\b/.test(text);
  const expense =
    /\bdoc\s*\/?\s*ted\s+enviad[oa]\b/.test(text) ||
    /\bpix\s+enviad[oa]\b/.test(text) ||
    /\benviad[oa]\b/.test(text) ||
    /\bpago\b|\bpaga\b|\bpagamento\b/.test(text) ||
    /\bdebito\b/.test(text) ||
    /\btarifa\b/.test(text) ||
    /\bsaque\b/.test(text);
  if (income && !expense) return 1;
  if (expense && !income) return -1;
  if (income) return 1;
  if (expense) return -1;
  return 0;
}

function applyDescriptionSign(value: number, description: string | null | undefined, fallback: -1 | 1) {
  const forced = signFromDescription(description);
  return (forced === 0 ? fallback : forced) * Math.abs(value);
}

// ---------- OFX ----------

export function parseOFX(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const grab = (tag: string) => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i").exec(block);
      return m ? m[1].trim() : "";
    };
    const date = extractDate(grab("DTPOSTED"));
    const trnType = grab("TRNTYPE").toUpperCase(); // DEBIT/CREDIT
    const amountRaw = grab("TRNAMT");
    const memo = grab("MEMO") || grab("NAME");
    const fitid = grab("FITID");

    const { value, sign } = parseAmountCell(amountRaw);
    if (!date || Number.isNaN(value)) continue;

    let finalSign: -1 | 1 = sign === -1 ? -1 : sign === 1 ? 1 : 1;
    if (sign === 0) {
      if (trnType === "DEBIT") finalSign = -1;
      else if (trnType === "CREDIT") finalSign = 1;
    }
    lines.push({
      statement_date: date,
      amount: applyDescriptionSign(value, memo, finalSign),
      description: memo || null,
      external_id: fitid || null,
    });
  }
  return lines;
}

// ---------- CSV ----------

function detectDelimiter(sample: string): string {
  // Prefer ; (BR standard, since , is decimal); fall back to tab then comma.
  const counts = {
    ";": (sample.match(/;/g) ?? []).length,
    "\t": (sample.match(/\t/g) ?? []).length,
    ",": (sample.match(/,/g) ?? []).length,
  };
  if (counts[";"] > 0) return ";";
  if (counts["\t"] > 0) return "\t";
  return ",";
}

function splitCSVLine(line: string, delim: string): string[] {
  // Naive CSV split with quote support.
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQ = !inQ;
      continue;
    }
    if (c === delim && !inQ) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

type ColMap = {
  date: number;
  amount?: number;
  credit?: number;
  debit?: number;
  desc: number[];
  dc?: number;
};

function inferColumns(rows: string[][]): ColMap {
  // Score each column for date-ness and amount-ness across body rows.
  const ncols = Math.max(...rows.map((r) => r.length));
  const scores = Array.from({ length: ncols }, () => ({ date: 0, amount: 0, dc: 0 }));
  for (const r of rows) {
    for (let i = 0; i < r.length; i++) {
      const cell = r[i] ?? "";
      if (extractDate(cell)) scores[i].date++;
      const { value } = parseAmountCell(cell);
      if (!Number.isNaN(value) && /\d/.test(cell) && /[.,]/.test(cell))
        scores[i].amount++;
      if (/^[DC]$/i.test(cell.trim())) scores[i].dc++;
    }
  }
  let dateCol = 0,
    dcCol: number | undefined;
  scores.forEach((s, i) => {
    if (s.date > scores[dateCol].date) dateCol = i;
  });
  scores.forEach((s, i) => {
    if (s.dc > 0 && (dcCol === undefined || s.dc > scores[dcCol].dc)) dcCol = i;
  });
  const amountCols = scores
    .map((s, i) => ({ i, score: s.amount }))
    .filter((c) => c.i !== dateCol && c.i !== dcCol && c.score > 0)
    .sort((a, b) => a.i - b.i);
  const valueCols = amountCols.length >= 2
    ? { credit: amountCols[amountCols.length - 2].i, debit: amountCols[amountCols.length - 1].i }
    : { amount: amountCols[0]?.i };
  const desc: number[] = [];
  for (let i = 0; i < ncols; i++) {
    if (i !== dateCol && i !== valueCols.amount && i !== valueCols.credit && i !== valueCols.debit && i !== dcCol) desc.push(i);
  }
  return { date: dateCol, ...valueCols, desc, dc: dcCol };
}

export function parseCSV(text: string): ParsedLine[] {
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length === 0) return [];
  const delim = detectDelimiter(rows.slice(0, 5).join("\n"));
  const cells = rows.map((r) => splitCSVLine(r, delim));
  // Drop header rows (no date detectable in the would-be date column).
  const body = cells.filter((r) => r.some((c) => extractDate(c)));
  if (body.length === 0) return [];
  const cols = inferColumns(body);
  const out: ParsedLine[] = [];
  for (const r of body) {
    const dateCell = r[cols.date] ?? "";
    const date = extractDate(dateCell);
    if (!date) continue;
    if (cols.amount < 0) continue;
    const { value, sign } = parseAmountCell(r[cols.amount] ?? "");
    if (Number.isNaN(value)) continue;
    let finalSign: -1 | 1 = sign === -1 ? -1 : sign === 1 ? 1 : 1;
    if (sign === 0 && cols.dc !== undefined) {
      const dc = (r[cols.dc] ?? "").trim().toUpperCase();
      if (dc.startsWith("D")) finalSign = -1;
      else if (dc.startsWith("C")) finalSign = 1;
    }
    const description =
      cols.desc.map((i) => r[i] ?? "").join(" ").replace(/\s+/g, " ").trim() ||
      null;
    out.push({ statement_date: date, amount: finalSign * value, description });
  }
  return out;
}

// ---------- PDF (browser-only via pdfjs-dist) ----------

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs out of any SSR bundle.
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs" as string);
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  } catch {
    /* noop */
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const allLines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Group items by approximate Y to reconstruct lines.
    const items = content.items as Array<{ str: string; transform: number[] }>;
    const byY = new Map<number, { x: number; str: string }[]>();
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!byY.has(y)) byY.set(y, []);
      byY.get(y)!.push({ x, str: it.str });
    }
    const ys = Array.from(byY.keys()).sort((a, b) => b - a); // top → bottom
    for (const y of ys) {
      const parts = byY.get(y)!.sort((a, b) => a.x - b.x);
      const line = parts.map((p) => p.str).join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    }
  }
  return allLines.join("\n");
}

export function parsePDFText(text: string): ParsedLine[] {
  const lines = text.split("\n");
  const out: ParsedLine[] = [];
  // Match the LAST amount on the line (typical bank PDF: ... description ... 1.234,56 D)
  const amountRe =
    /(-?\s*R?\$?\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})|-?\s*\d+,\d{2})\s*([DC])?\b\s*$/i;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const date = extractDate(line);
    if (!date) continue;
    const am = amountRe.exec(line);
    if (!am) continue;
    const amountToken = am[1] + (am[2] ?? "");
    const { value, sign } = parseAmountCell(amountToken);
    if (Number.isNaN(value)) continue;
    // Description = line minus date and amount token
    let desc = line
      .replace(am[0], "")
      .replace(/\b\d{2}\/\d{2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!desc) desc = "(sem descrição)";
    const finalSign: -1 | 1 = sign === -1 ? -1 : sign === 1 ? 1 : 1;
    out.push({ statement_date: date, amount: finalSign * value, description: desc });
  }
  return out;
}

// ---------- Public entry ----------

export async function parseStatementFile(file: File): Promise<ParsedLine[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const text = await extractPdfText(file);
    return parsePDFText(text);
  }
  const text = await file.text();
  if (name.endsWith(".ofx") || /<OFX>/i.test(text)) return parseOFX(text);
  return parseCSV(text);
}
