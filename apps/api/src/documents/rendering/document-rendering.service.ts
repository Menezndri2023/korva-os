import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export interface DocumentTemplate {
  documentType:
    'invoice' | 'quote' | 'certificate' | 'statement' | 'donation_receipt';
  title: string;
  /** The issuer. `lines` are extra grey lines under the address — phone, legal identifiers
   *  (RCCM, NCC, ICE…): what makes an invoice an invoice rather than a receipt. */
  organizationHeader: { name: string; address?: string; lines?: string[] };
  metadata: { label: string; value: string }[];
  /** Invoice/quote shape — a line-item table plus a totals block. */
  table?: {
    columns: string[];
    rows: string[][];
    totals: { label: string; value: string }[];
  };
  /** Certificate shape — prose; drawn after the table when a template has both. */
  body?: { heading?: string; paragraphs: string[] };
  footer?: string;
}

const PAGE_WIDTH = 595.28; // A4 at 72dpi
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 16;
const TITLE_SIZE = 20;
const HEADING_SIZE = 13;
const BODY_SIZE = 10;

/**
 * One generic PDF renderer shared by every document type (invoice/quote/certificate) — never
 * forked per type. A DocumentTemplate is a plain data manifest (built by the *-document.template
 * mappers, which never touch pdf-lib directly); this service is the only thing that actually
 * draws. Deliberately no pagination: the page height is computed to fit the content instead of
 * using a fixed A4 height, which is correct for the short, bounded documents this renders
 * (invoices/quotes with a practical number of line items, a one-paragraph certificate) and avoids
 * a meaningfully larger layout engine that nothing in this codebase currently needs.
 */
@Injectable()
export class DocumentRenderingService {
  async renderPdf(input: DocumentTemplate): Promise<Buffer> {
    let template = input;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
    template = pdfSafeTemplate(template, font);

    const height = estimateHeight(template);
    const page = doc.addPage([PAGE_WIDTH, height]);
    let cursorY = height - MARGIN;

    cursorY = drawText(page, template.organizationHeader.name, {
      x: MARGIN,
      y: cursorY,
      font: boldFont,
      size: HEADING_SIZE,
    });
    for (const line of headerLines(template)) {
      for (const wrapped of wrapText(line, font, BODY_SIZE, CONTENT_WIDTH)) {
        cursorY = drawText(page, wrapped, {
          x: MARGIN,
          y: cursorY,
          font,
          size: BODY_SIZE,
          color: rgb(0.4, 0.4, 0.4),
        });
      }
    }
    cursorY -= LINE_HEIGHT / 2;

    cursorY = drawText(page, template.title, {
      x: MARGIN,
      y: cursorY,
      font: boldFont,
      size: TITLE_SIZE,
    });
    cursorY -= LINE_HEIGHT / 2;

    for (const { label, value } of template.metadata) {
      cursorY = drawText(page, `${label}: ${value}`, {
        x: MARGIN,
        y: cursorY,
        font,
        size: BODY_SIZE,
      });
    }
    cursorY -= LINE_HEIGHT;

    if (template.table) {
      cursorY = drawTable(page, template.table, {
        x: MARGIN,
        y: cursorY,
        font,
        boldFont,
      });
    }
    // A donation receipt has both: the gifts, then the sentence attesting them.
    if (template.body) {
      if (template.table) cursorY -= LINE_HEIGHT;
      cursorY = drawBody(page, template.body, {
        x: MARGIN,
        y: cursorY,
        font,
        boldFont,
      });
    }

    if (template.footer) {
      // Wrapped, bottom-up: a long footer (an invoice's notes) used to run off the page edge.
      const lines = wrapText(
        template.footer,
        font,
        BODY_SIZE - 1,
        CONTENT_WIDTH,
      );
      lines.forEach((line, i) => {
        drawText(page, line, {
          x: MARGIN,
          y: MARGIN / 2 + (lines.length - 1 - i) * (LINE_HEIGHT - 4),
          font,
          size: BODY_SIZE - 1,
          color: rgb(0.5, 0.5, 0.5),
        });
      });
    }

    return Buffer.from(await doc.save());
  }
}

/** Spaces Intl puts in French numbers and dates ("15 000 F CFA") that the standard PDF fonts
 *  (WinAnsi) cannot encode — mapped to the no-break space they can. Anything else outside
 *  WinAnsi (an emoji in a product name, a ≈) becomes "?" instead of failing the whole document:
 *  before this, every French invoice of 1 000 or more answered 500. */
const PDF_CHARACTER_FALLBACKS: Record<string, string> = {
  '\u202f': '\u00a0',
  '\u2009': ' ',
  '\u2007': ' ',
  '\u2212': '-',
};

function pdfSafeText(
  text: string,
  font: PDFFont,
  cache: Map<string, string>,
): string {
  let out = '';
  for (const char of text) {
    let safe = cache.get(char);
    if (safe === undefined) {
      const candidate = PDF_CHARACTER_FALLBACKS[char] ?? char;
      try {
        font.encodeText(candidate);
        safe = candidate;
      } catch {
        safe = '?';
      }
      cache.set(char, safe);
    }
    out += safe;
  }
  return out;
}

function pdfSafeTemplate(
  template: DocumentTemplate,
  font: PDFFont,
): DocumentTemplate {
  const cache = new Map<string, string>();
  const safe = (text: string) => pdfSafeText(text, font, cache);
  return {
    ...template,
    title: safe(template.title),
    organizationHeader: {
      name: safe(template.organizationHeader.name),
      ...(template.organizationHeader.address
        ? { address: safe(template.organizationHeader.address) }
        : {}),
      ...(template.organizationHeader.lines
        ? { lines: template.organizationHeader.lines.map(safe) }
        : {}),
    },
    metadata: template.metadata.map((entry) => ({
      label: safe(entry.label),
      value: safe(entry.value),
    })),
    ...(template.table
      ? {
          table: {
            columns: template.table.columns.map(safe),
            rows: template.table.rows.map((row) => row.map(safe)),
            totals: template.table.totals.map((total) => ({
              label: safe(total.label),
              value: safe(total.value),
            })),
          },
        }
      : {}),
    ...(template.body
      ? {
          body: {
            ...(template.body.heading
              ? { heading: safe(template.body.heading) }
              : {}),
            paragraphs: template.body.paragraphs.map(safe),
          },
        }
      : {}),
    ...(template.footer ? { footer: safe(template.footer) } : {}),
  };
}

interface DrawTextOptions {
  x: number;
  y: number;
  font: PDFFont;
  size: number;
  color?: ReturnType<typeof rgb>;
}

/** Draws one line and returns the new cursor y (moved down by one line). */
function drawText(
  page: PDFPage,
  text: string,
  options: DrawTextOptions,
): number {
  page.drawText(text, {
    x: options.x,
    y: options.y,
    font: options.font,
    size: options.size,
    color: options.color ?? rgb(0, 0, 0),
  });
  return options.y - LINE_HEIGHT;
}

function drawTable(
  page: PDFPage,
  table: NonNullable<DocumentTemplate['table']>,
  options: { x: number; y: number; font: PDFFont; boldFont: PDFFont },
): number {
  let y = options.y;
  const { starts, widths } = columnLayout(table.columns.length);

  table.columns.forEach((column, i) => {
    page.drawText(fitText(column, options.boldFont, BODY_SIZE, widths[i]!), {
      x: options.x + starts[i]!,
      y,
      font: options.boldFont,
      size: BODY_SIZE,
    });
  });
  y -= LINE_HEIGHT;
  page.drawLine({
    start: { x: options.x, y: y + LINE_HEIGHT / 2 },
    end: { x: options.x + CONTENT_WIDTH, y: y + LINE_HEIGHT / 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  });

  for (const row of table.rows) {
    // Each cell wraps inside its own column; the row is as tall as its tallest cell. An invoice
    // line is printed whole — never cut — because it is what the customer is paying for.
    const cells = row.map((cell, i) =>
      wrapText(cell, options.font, BODY_SIZE, widths[i]! - 8),
    );
    const height = Math.max(1, ...cells.map((lines) => lines.length));
    cells.forEach((lines, i) => {
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: options.x + starts[i]!,
          y: y - lineIndex * (LINE_HEIGHT - 3),
          font: options.font,
          size: BODY_SIZE,
        });
      });
    });
    y -= LINE_HEIGHT + (height - 1) * (LINE_HEIGHT - 3);
  }

  y -= LINE_HEIGHT / 2;
  for (const { label, value } of table.totals) {
    const text = `${label}: ${value}`;
    page.drawText(text, {
      x:
        options.x +
        CONTENT_WIDTH -
        options.boldFont.widthOfTextAtSize(text, BODY_SIZE),
      y,
      font: options.boldFont,
      size: BODY_SIZE,
    });
    y -= LINE_HEIGHT;
  }

  return y;
}

function drawBody(
  page: PDFPage,
  body: NonNullable<DocumentTemplate['body']>,
  options: { x: number; y: number; font: PDFFont; boldFont: PDFFont },
): number {
  let y = options.y;
  if (body.heading) {
    page.drawText(body.heading, {
      x: options.x,
      y,
      font: options.boldFont,
      size: HEADING_SIZE,
    });
    y -= LINE_HEIGHT * 1.5;
  }
  for (const paragraph of body.paragraphs) {
    for (const line of wrapText(
      paragraph,
      options.font,
      BODY_SIZE,
      CONTENT_WIDTH,
    )) {
      page.drawText(line, {
        x: options.x,
        y,
        font: options.font,
        size: BODY_SIZE,
      });
      y -= LINE_HEIGHT;
    }
    y -= LINE_HEIGHT / 2;
  }
  return y;
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Rough line-count estimate to size the page — generous on purpose (a little blank space at
 *  the bottom costs nothing; running out of page height would clip content, which is the
 *  failure mode worth avoiding). */
/** The grey lines under the issuer's name: its address, then any extra line (wrapped when drawn). */
function headerLines(template: DocumentTemplate): string[] {
  return [
    template.organizationHeader.address,
    ...(template.organizationHeader.lines ?? []),
  ].filter((line): line is string => Boolean(line && line.trim()));
}

/** Column positions: with three columns or more the first one — the description — gets 40 % of
 *  the width, the others share the rest. Equal columns made "Abonnement KORVA OS Starter (1 an)"
 *  or any real product name run over the quantity column. */
function columnLayout(count: number): { starts: number[]; widths: number[] } {
  const widths =
    count >= 3
      ? [
          CONTENT_WIDTH * 0.4,
          ...Array<number>(count - 1).fill((CONTENT_WIDTH * 0.6) / (count - 1)),
        ]
      : Array<number>(count).fill(CONTENT_WIDTH / count);
  const starts = widths.map((_, i) =>
    widths.slice(0, i).reduce((sum, width) => sum + width, 0),
  );
  return { starts, widths };
}

/** Cuts a cell to its column, with "..." — the renderer draws one line per row. */
function fitText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string {
  const room = maxWidth - 8;
  if (font.widthOfTextAtSize(text, size) <= room) return text;
  let cut = text;
  while (cut.length > 1 && font.widthOfTextAtSize(`${cut}...`, size) > room) {
    cut = cut.slice(0, -1);
  }
  return `${cut.trimEnd()}...`;
}

function estimateHeight(template: DocumentTemplate): number {
  // header + title + spacing, each header line counted as up to two once wrapped
  let lines =
    6 +
    headerLines(template).reduce(
      (sum, line) => sum + Math.ceil(line.length / 95),
      0,
    );
  if (template.footer) lines += Math.ceil(template.footer.length / 105);
  lines += template.metadata.length;
  if (template.table) {
    lines += 2 + template.table.totals.length;
    // A wrapped cell takes several lines: the first column holds ~40 characters a line, the
    // others ~20 — counted generously.
    for (const row of template.table.rows) {
      lines += Math.max(
        1,
        ...row.map((cell, i) => Math.ceil(cell.length / (i === 0 ? 38 : 18))),
      );
    }
  }
  if (template.body) {
    lines += 2;
    for (const paragraph of template.body.paragraphs) {
      lines += Math.ceil(paragraph.length / 90) + 1;
    }
  }
  return Math.max(400, lines * LINE_HEIGHT + MARGIN * 2 + 40);
}
