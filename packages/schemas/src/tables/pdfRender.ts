import type { TableSchema } from './types.js';
import type { PDFRenderProps, Schema, BasePdf, CommonOptions } from '@pdfme/common';
import { Cell, Table, Row, Column } from './classes.js';
import { rectangle } from '../shapes/rectAndEllipse.js';
import cell from './cell.js';
import { getBodyWithSchemaRange } from './helper.js';
import { createSingleTable } from './tableHelper.js';
import { createTextLineSplitRange } from '../splitRange.js';

// Define the CreateTableArgs interface locally since it's not exported from tableHelper.js
interface CreateTableArgs {
  schema: Schema;
  basePdf: BasePdf;
  options: CommonOptions;
  _cache: Map<string | number, unknown>;
}

type Pos = { x: number; y: number };

const rectanglePdfRender = rectangle.pdf;
const cellPdfRender = cell.pdf;

async function drawCell(arg: PDFRenderProps<TableSchema>, cell: Cell) {
  await cellPdfRender({
    ...arg,
    value: cell.raw,
    schema: {
      name: '',
      type: 'cell',
      position: { x: cell.x, y: cell.y },
      width: cell.width,
      height: cell.height,
      fontName: cell.styles.fontName,
      alignment: cell.styles.alignment,
      // A row continued across pages reads on from the top.
      verticalAlignment: cell.isSliced() ? 'top' : cell.styles.verticalAlignment,
      ...(cell.isSliced()
        ? { __splitRange: createTextLineSplitRange(cell.lineStart, cell.lineEnd) }
        : {}),
      fontSize: cell.styles.fontSize,
      lineHeight: cell.styles.lineHeight,
      characterSpacing: cell.styles.characterSpacing,
      backgroundColor: cell.styles.backgroundColor,
      fontColor: cell.styles.textColor,
      borderColor: cell.styles.lineColor,
      borderWidth: cell.styles.lineWidth,
      padding: cell.styles.cellPadding,
    },
  });
}

async function drawRow(
  arg: PDFRenderProps<TableSchema>,
  table: Table,
  row: Row,
  cursor: Pos,
  columns: Column[],
) {
  cursor.x = table.settings.margin.left;
  const gap = table.settings.columnGap;
  for (const column of columns) {
    const cell = row.cells[column.index];
    if (cell) {
      cell.x = cursor.x;
      cell.y = cursor.y;
      await drawCell(arg, cell);
    }
    cursor.x += column.width + gap;
  }
  cursor.y += row.height;
}

type Frame = { x: number; y: number; width: number; height: number };

/**
 * Table frames. With a column gap every column is framed on its own, broken
 * around merged cells, which get a frame of their own.
 */
export function getTableFrames(table: Table, rows: Row[], startPos: Pos, endY: number): Frame[] {
  const gap = table.settings.columnGap;
  if (gap <= 0) {
    return [{ x: startPos.x, y: startPos.y, width: table.getWidth(), height: endY - startPos.y }];
  }
  const frames: Frame[] = [];
  table.columns.forEach((column, index) => {
    const x = startPos.x + (index > 0 ? table.getSpanWidth(0, index) + gap : 0);
    let segmentStart: number | undefined;
    let segmentEnd = 0;
    const close = () => {
      if (segmentStart !== undefined) {
        frames.push({ x, y: segmentStart, width: column.width, height: segmentEnd - segmentStart });
      }
      segmentStart = undefined;
    };
    for (const row of rows) {
      const top = Object.values(row.cells)[0]?.y ?? 0;
      const own = row.cells[column.index];
      if (own && own.colSpan === 1) {
        segmentStart ??= top;
        segmentEnd = top + row.height;
        continue;
      }
      close();
      if (own) frames.push({ x: own.x, y: top, width: own.width, height: row.height });
    }
    close();
  });
  return frames;
}

async function drawTableBorder(
  arg: PDFRenderProps<TableSchema>,
  table: Table,
  rows: Row[],
  startPos: Pos,
  cursor: Pos,
) {
  const lineWidth = table.settings.tableLineWidth;
  const lineColor = table.settings.tableLineColor;
  if (!lineWidth || !lineColor) return;
  for (const frame of getTableFrames(table, rows, startPos, cursor.y)) {
    await rectanglePdfRender({
      ...arg,
      schema: {
        name: '',
        type: 'rectangle',
        borderWidth: lineWidth,
        borderColor: lineColor,
        color: '',
        position: { x: frame.x, y: frame.y },
        width: frame.width,
        height: frame.height,
        readOnly: true,
      },
    });
  }
}

async function drawTable(arg: PDFRenderProps<TableSchema>, table: Table): Promise<void> {
  const settings = table.settings;
  const startY = settings.startY;
  const margin = settings.margin;
  const cursor = { x: margin.left, y: startY };

  const startPos = Object.assign({}, cursor);

  const rows = settings.showHead ? table.head.concat(table.body) : table.body;
  for (const row of rows) {
    await drawRow(arg, table, row, cursor, table.columns);
  }

  await drawTableBorder(arg, table, rows, startPos, cursor);
}

export const pdfRender = async (arg: PDFRenderProps<TableSchema>) => {
  const { value, schema, basePdf, options, _cache } = arg;

  const body = getBodyWithSchemaRange(
    typeof value !== 'string' ? JSON.stringify(value || '[]') : value,
    schema,
  );

  // Create a properly typed CreateTableArgs object
  const createTableArgs: CreateTableArgs = {
    schema,
    basePdf,
    options,
    _cache,
  };

  // Ensure body is properly typed before passing to createSingleTable
  // Ensure body is properly typed as string[][] before passing to createSingleTable
  const typedBody: string[][] = Array.isArray(body)
    ? body.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : []))
    : [];
  const table = await createSingleTable(typedBody, createTableArgs);

  // Use the original arg directly since drawTable expects PDFRenderProps<TableSchema>
  // which is the same type as our arg parameter
  await drawTable(arg, table);
};
