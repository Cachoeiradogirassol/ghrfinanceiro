// Parses bank statement files (CSV/OFX/PDF) into a canonical line shape.
// Designed for Brazilian bank exports: BRL decimal comma, DD/MM/YYYY dates,
// and D/C (Débito/Crédito) sign indicators.
export type ParsedLine = {
  statement_date: string; // YYYY-MM-DD (date from the statement line, NOT upload date)
  amount: number; // negative = debit/saída, positive = credit/entrada
  description: string | null;
  external_id?: string | null;
};

export type ParsedStatement = {
  lines: ParsedLine[];
  finalBalance: number | null;
};

// ---------- Primitive parsers ----------

const DATE_REGEXES: RegExp[] = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/, // ISO 2025-06-07
  /\b(\d{2})\/(\d{2})\/(\d{4})\b/, // BR 07/06/2025
  /\b(\d{2})\/(\d{2})\/(\d{2})\b/, // short BR 07/06/25
  /\b(\d{2})-(\d{2})-(\d{4})\b/, // 07-06-2025
  /\b(\d{8})\b/, // OFX 20250607
];

function moneyTokenRegex() {
  return /([+-]?[ \t]*(?:R\$[ \t]*)?[+-]?[ \t]*(?:\d{1,3}(?:\.\d{3})*|\d+)(?:,\d{2}|\.\d{2}))[ \t]*([DC])?/gi;
}

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
    /\bted\s+enviad[oa]\b/.test(text) ||
    /\btransferencia\s+enviad[oa]\b/.test(text) ||
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

function extractLeadingDate(s: string): string | null {
  const br = /^\s*(\d{2})[/-](\d{2})[/-](\d{2,4})\b/.exec(s);
  if (br) {
    const yyyy = br[3].length === 2 ? (parseInt(br[3], 10) < 70 ? `20${br[3]}` : `19${br[3]}`) : br[3];
    return `${yyyy}-${br[2]}-${br[1]}`;
  }
  const iso = /^\s*(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function parseMoneyMatch(match: RegExpMatchArray): { value: number; sign: -1 | 1 | 0 } {
  return parseAmountCell(`${match[1]}${match[2] ?? ""}`);
}

function isBalanceSummaryText(text: string) {
  const normalized = normalizeText(text);
  return (
    /\bsaldo\s+(inicial|anterior|final|disponivel|disponível|atual|total|em\s+conta)\b/.test(normalized) ||
    /\bsaldo\s+em\s+\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/.test(normalized)
  );
}

function isPriorityBalanceLabel(normalized: string) {
  return /\bsaldo\s+(disponivel|disponível|total|atual|em\s+conta)\b/.test(normalized);
}

// Strip CPF (000.000.000-00) and CNPJ (00.000.000/0000-00) tokens so their
// digits cannot be mistaken for monetary values by the money regex.
function stripCpfCnpjTokens(text: string): string {
  return text
    .replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-?\d{2}\b/g, " ")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-?\d{2}\b/g, " ")
    .replace(/\b\d{14}\b/g, " ")
    .replace(/\b\d{11}\b/g, " ");
}

function containsCpfCnpjLabel(text: string): boolean {
  return /\b(cpf|cnpj)\b/i.test(normalizeText(text));
}

export function extractFinalBalanceFromText(text: string): number | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Pass 1 (priority): scan top→bottom for "Saldo disponível / Saldo total" header (Banco Inter style).
  for (let i = 0; i < lines.length; i++) {
    const scope = `${lines[i]} ${lines[i + 1] ?? ""} ${lines[i + 2] ?? ""}`.trim();
    const normalized = normalizeText(scope);
    if (!isPriorityBalanceLabel(normalized)) continue;
    if (/\bsaldo\s+(inicial|anterior)\b/.test(normalized)) continue;
    const matches = Array.from(scope.matchAll(moneyTokenRegex()));
    if (matches.length === 0) continue;
    const parsed = parseMoneyMatch(matches[0]);
    if (Number.isNaN(parsed.value)) continue;
    const sign = parsed.sign === -1 || /\b(devedor|negativo)\b/.test(normalized) ? -1 : 1;
    return sign * Math.abs(parsed.value);
  }

  // Pass 2 (fallback): scan bottom→top for any "Saldo final/atual/etc." line.
  for (let i = lines.length - 1; i >= 0; i--) {
    const current = lines[i];
    const next = lines[i + 1] ?? "";
    const scope = `${current} ${next}`.trim();
    const normalized = normalizeText(scope);
    const isBalanceLine = isBalanceSummaryText(scope) && !/\bsaldo\s+(inicial|anterior)\b/.test(normalized);

    if (!isBalanceLine) continue;

    const matches = Array.from(scope.matchAll(moneyTokenRegex()));
    if (matches.length === 0) continue;

    const parsed = parseMoneyMatch(matches[matches.length - 1]);
    if (Number.isNaN(parsed.value)) continue;

    const sign = parsed.sign === -1 || /\b(devedor|negativo)\b/.test(normalized) ? -1 : 1;
    return sign * Math.abs(parsed.value);
  }

  return null;
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
    const description =
      cols.desc.map((i) => r[i] ?? "").join(" ").replace(/\s+/g, " ").trim() ||
      null;
    let amount: number | null = null;

    if (cols.credit !== undefined && cols.debit !== undefined) {
      const credit = parseAmountCell(r[cols.credit] ?? "");
      const debit = parseAmountCell(r[cols.debit] ?? "");
      if (Number.isNaN(credit.value) && Number.isNaN(debit.value)) continue;
      const forcedSign = signFromDescription(description);
      const creditValue = Number.isNaN(credit.value) ? 0 : credit.value;
      const debitValue = Number.isNaN(debit.value) ? 0 : debit.value;
      if (forcedSign === -1) amount = -Math.abs(debitValue || creditValue);
      else if (forcedSign === 1) amount = Math.abs(creditValue || debitValue);
      else amount = debitValue > 0 ? -debitValue : creditValue;
    } else if (cols.amount !== undefined) {
      const { value, sign } = parseAmountCell(r[cols.amount] ?? "");
      if (Number.isNaN(value)) continue;
      let finalSign: -1 | 1 = sign === -1 ? -1 : sign === 1 ? 1 : 1;
      if (sign === 0 && cols.dc !== undefined) {
        const dc = (r[cols.dc] ?? "").trim().toUpperCase();
        if (dc.startsWith("D")) finalSign = -1;
        else if (dc.startsWith("C")) finalSign = 1;
      }
      amount = applyDescriptionSign(value, description, finalSign);
    }

    if (amount === null || Math.abs(amount) < 0.005) continue;
    out.push({ statement_date: date, amount, description });
  }
  return out;
}

// ---------- PDF (browser-only via pdfjs-dist) ----------

async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs out of any SSR bundle.
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs" as string);
  try {
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.mjs`;
  } catch {
    /* noop */
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
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
  // PDF digital: pick the FIRST monetary token on the line ("Valor" column).
  // Banco Inter and most BR statements render: <data> <descrição> <Valor> <Saldo por transação>.
  // The last token is the running balance — using it inflates totals and corrupts the audit.
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isBalanceSummaryText(line)) continue;
    const date = extractLeadingDate(line) ?? extractDate(line);
    if (!date) continue;
    const matches = Array.from(line.matchAll(moneyTokenRegex()));
    if (matches.length === 0) continue;
    // Use the FIRST money token = Valor da transação. Ignore "Saldo por transação" entirely.
    const am = matches[0];
    const { value, sign } = parseMoneyMatch(am);
    if (Number.isNaN(value)) continue;
    // Description = line minus date and amount token
    let desc = line
      .replace(am[0], "")
      .replace(/^\s*\d{2}[/-]\d{2}[/-]\d{2,4}\b|^\s*\d{4}-\d{2}-\d{2}\b/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!desc) desc = "(sem descrição)";
    const forcedSign = signFromDescription(line);
    const finalSign: -1 | 1 = forcedSign === -1 ? -1 : forcedSign === 1 ? 1 : sign === -1 ? -1 : 1;
    out.push({
      statement_date: date,
      amount: finalSign * Math.abs(value),
      description: desc,
    });
  }
  return out;
}

// ---------- Public entry ----------

export async function parseStatementFile(file: File): Promise<ParsedLine[]> {
  const parsed = await parseStatementDocument(file);
  return parsed.lines;
}

export async function parseStatementDocument(file: File): Promise<ParsedStatement> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const text = await extractPdfText(file);
    return {
      lines: parsePDFText(text),
      finalBalance: extractFinalBalanceFromText(text),
    };
  }
  const text = await file.text();
  return {
    lines: name.endsWith(".ofx") || /<OFX>/i.test(text) ? parseOFX(text) : parseCSV(text),
    finalBalance: null,
  };
}
