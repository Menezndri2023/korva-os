import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

export interface DocumentTemplate {
  documentType: 'invoice' | 'quote' | 'certificate';
  title: string;
  organizationHeader: { name: string; address?: string };
  metadata: { label: string; value: string }[];
  /** Invoice/quote shape — a line-item table plus a totals block. */
  table?: {
    columns: string[];
    rows: string[][];
    totals: { label: string; value: string }[];
  };
  /** Certificate shape — centered prose, no table. */
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
  async renderPdf(template: DocumentTemplate): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const height = estimateHeight(template);
    const page = doc.addPage([PAGE_WIDTH, height]);
    let cursorY = height - MARGIN;

    cursorY = drawText(page, template.organizationHeader.name, {
      x: MARGIN,
      y: cursorY,
      font: boldFont,
      size: HEADING_SIZE,
    });
    if (template.organizationHeader.address) {
      cursorY = drawText(page, template.organizationHeader.address, {
        x: MARGIN,
        y: cursorY,
        font,
        size: BODY_SIZE,
        color: rgb(0.4, 0.4, 0.4),
      });
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
    } else if (template.body) {
      cursorY = drawBody(page, template.body, {
        x: MARGIN,
        y: cursorY,
        font,
        boldFont,
      });
    }

    if (template.footer) {
      drawText(page, template.footer, {
        x: MARGIN,
        y: MARGIN / 2,
        font,
        size: BODY_SIZE - 1,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    return Buffer.from(await doc.save());
  }
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
  const columnWidth = CONTENT_WIDTH / table.columns.length;

  table.columns.forEach((column, i) => {
    page.drawText(column, {
      x: options.x + i * columnWidth,
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
    row.forEach((cell, i) => {
      page.drawText(cell, {
        x: options.x + i * columnWidth,
        y,
        font: options.font,
        size: BODY_SIZE,
      });
    });
    y -= LINE_HEIGHT;
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
function estimateHeight(template: DocumentTemplate): number {
  let lines = 6; // header + title + spacing
  lines += template.metadata.length;
  if (template.table) {
    lines += 2 + template.table.rows.length + template.table.totals.length;
  }
  if (template.body) {
    lines += 2;
    for (const paragraph of template.body.paragraphs) {
      lines += Math.ceil(paragraph.length / 90) + 1;
    }
  }
  return Math.max(400, lines * LINE_HEIGHT + MARGIN * 2 + 40);
}
