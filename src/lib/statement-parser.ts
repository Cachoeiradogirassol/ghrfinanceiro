// Parses bank statement files (CSV/OFX) into a canonical line shape.
export type ParsedLine = {
  statement_date: string; // YYYY-MM-DD
  amount: number;
  description: string | null;
  external_id?: string | null;
};

function toIsoDate(s: string): string | null {
  s = s.trim();
  // OFX YYYYMMDD[HHMMSS][.fff][TZ]
  const ofx = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (ofx) return `${ofx[1]}-${ofx[2]}-${ofx[3]}`;
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // BR DD/MM/YYYY
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function toNumber(s: string): number {
  const cleaned = s.trim().replace(/\s/g, "").replace(/R\$/i, "");
  // Detect BR format: 1.234,56 vs US 1,234.56
  if (/,\d{1,2}$/.test(cleaned)) {
    return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
  }
  return parseFloat(cleaned.replace(/,/g, ""));
}

export function parseOFX(text: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  // Split by <STMTTRN> blocks (case-insensitive)
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const grab = (tag: string) => {
      const m = new RegExp(`<${tag}>([^<\\r\\n]+)`, "i").exec(block);
      return m ? m[1].trim() : "";
    };
    const date = toIsoDate(grab("DTPOSTED"));
    const amount = toNumber(grab("TRNAMT"));
    const memo = grab("MEMO") || grab("NAME");
    const fitid = grab("FITID");
    if (date && !Number.isNaN(amount)) {
      lines.push({
        statement_date: date,
        amount,
        description: memo || null,
        external_id: fitid || null,
      });
    }
  }
  return lines;
}

export function parseCSV(text: string): ParsedLine[] {
  const rows = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (rows.length === 0) return [];
  // Skip header if the first row has a non-numeric "amount"-like cell
  const firstCells = rows[0].split(/[,;\t]/);
  const looksLikeHeader =
    firstCells.length >= 2 &&
    firstCells.some((c) => /data|date|valor|amount|desc|hist/i.test(c));
  const body = looksLikeHeader ? rows.slice(1) : rows;
  const out: ParsedLine[] = [];
  for (const r of body) {
    const cols = r.split(/[,;\t]/);
    if (cols.length < 2) continue;
    const date = toIsoDate(cols[0] ?? "");
    const amount = toNumber(cols[1] ?? "");
    const description = cols.slice(2).join(",").trim() || null;
    if (date && !Number.isNaN(amount)) {
      out.push({ statement_date: date, amount, description });
    }
  }
  return out;
}

export async function parseStatementFile(file: File): Promise<ParsedLine[]> {
  const text = await file.text();
  const name = file.name.toLowerCase();
  if (name.endsWith(".ofx") || /<OFX>/i.test(text)) return parseOFX(text);
  return parseCSV(text);
}
