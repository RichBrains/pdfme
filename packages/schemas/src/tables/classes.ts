import {
  Font,
  isRichDocValue,
  mm2pt,
  parseRichDoc,
  pt2mm,
  richDocToPlainText,
} from '@pdfme/common';
import type { Font as FontKitFont } from 'fontkit';
import { splitTextToSize, getFontKitFont, widthOfTextAtSize } from '../text/helper.js';
import { getRichLayout } from '../richText/index.js';
import type { TextSchema } from '../text/types.js';
import type { RowLineState, Styles, TableInput, Settings, Section, StylesProps } from './types.js';

type ContentSettings = { body: Row[]; head: Row[]; columns: Column[] };

export class Cell {
  raw: string;
  text: string[];
  styles: Styles;
  section: Section;
  /** Column the cell starts in, and how many columns it spans. */
  colIndex = 0;
  colSpan = 1;
  /** Whether `raw` is a rich document. */
  rich: boolean;
  /** Height (mm) of every laid-out line, including paragraph spacing. */
  lineHeights: number[] = [];
  /** Line slice shown when the row is split across pages. */
  lineStart = 0;
  lineEnd?: number;
  contentHeight = 0;
  contentWidth = 0;
  wrappedWidth = 0;
  minReadableWidth = 0;
  minWidth = 0;

  width = 0;
  height = 0;
  x = 0;
  y = 0;

  constructor(raw: string, styles: Styles, section: Section) {
    this.styles = styles;
    this.section = section;
    this.raw = raw;
    this.rich = isRichDocValue(raw);
    const splitRegex = /\r\n|\r|\n/g;
    this.text = (this.rich ? richDocToPlainText(parseRichDoc(raw)) : raw).split(splitRegex);
  }

  /** Whether only part of the cell's lines is shown (row split across pages). */
  isSliced() {
    return (
      this.lineStart > 0 || (this.lineEnd !== undefined && this.lineEnd < this.lineHeights.length)
    );
  }

  getLinesHeight(start = this.lineStart, end = this.lineEnd ?? this.lineHeights.length) {
    return this.lineHeights.slice(start, end).reduce((acc, height) => acc + height, 0);
  }

  getContentHeight() {
    const vPadding = this.padding('top') + this.padding('bottom');
    const height = this.getLinesHeight() + vPadding;
    return Math.max(height, this.styles.minCellHeight);
  }

  /** Width (mm) available to the text: the cell minus padding and borders. */
  getTextWidth() {
    const borders = this.styles.lineWidth;
    const borderLeft = typeof borders === 'number' ? borders : (borders?.left ?? 0);
    const borderRight = typeof borders === 'number' ? borders : (borders?.right ?? 0);
    return Math.max(
      0,
      this.width - this.padding('left') - this.padding('right') - borderLeft - borderRight,
    );
  }

  /** The text schema the cell's content is measured and drawn with. */
  getTextSchema(): TextSchema {
    return {
      name: '',
      type: 'text',
      position: { x: 0, y: 0 },
      width: this.getTextWidth(),
      height: 0,
      content: this.raw,
      fontName: this.styles.fontName,
      alignment: this.styles.alignment,
      verticalAlignment: this.styles.verticalAlignment,
      fontSize: this.styles.fontSize,
      lineHeight: this.styles.lineHeight,
      characterSpacing: this.styles.characterSpacing,
      fontColor: this.styles.textColor,
      backgroundColor: '',
    } as unknown as TextSchema;
  }

  padding(name: 'top' | 'bottom' | 'left' | 'right') {
    return this.styles.cellPadding[name];
  }
}

export class Column {
  index: number;
  wrappedWidth = 0;
  minReadableWidth = 0;
  minWidth = 0;
  width = 0;

  constructor(index: number) {
    this.index = index;
  }

  getMaxCustomCellWidth(table: Table) {
    let max = 0;
    for (const row of table.allRows()) {
      const cell: Cell | undefined = row.cells[this.index];
      if (!cell) continue;
      max = Math.max(max, cell.styles.cellWidth);
    }
    return max;
  }
}

export class Row {
  readonly raw: string[];
  readonly index: number;
  readonly section: Section;
  readonly cells: { [key: string]: Cell };

  height = 0;

  constructor(raw: string[], index: number, section: Section, cells: { [key: string]: Cell }) {
    this.raw = raw;
    this.index = index;
    this.section = section;
    this.cells = cells;
  }

  getMaxCellHeight(columns: Column[]) {
    return columns.reduce((acc, column) => Math.max(acc, this.cells[column.index]?.height || 0), 0);
  }

  getMinimumRowHeight(columns: Column[]) {
    return columns.reduce((acc: number, column: Column) => {
      const cell = this.cells[column.index];
      if (!cell) return 0;
      const vPadding = cell.padding('top') + cell.padding('bottom');
      const oneRowHeight = vPadding + cell.styles.lineHeight;
      return oneRowHeight > acc ? oneRowHeight : acc;
    }, 0);
  }
}

export class Table {
  readonly settings: Settings;
  readonly styles: StylesProps;

  readonly columns: Column[];
  readonly head: Row[];
  readonly body: Row[];

  constructor(input: TableInput, content: ContentSettings) {
    this.settings = input.settings;
    this.styles = input.styles;

    this.columns = content.columns;
    this.head = content.head;
    this.body = content.body;
  }

  static async create(arg: {
    input: TableInput;
    content: ContentSettings;
    font: Font;
    _cache: Map<string | number, FontKitFont>;
  }) {
    const { input, content, font, _cache } = arg;
    const table = new Table(input, content);

    await calculateWidths({ table, font, _cache });

    return table;
  }

  getHeadHeight() {
    return this.head.reduce((acc, row) => acc + row.getMaxCellHeight(this.columns), 0);
  }

  getBodyHeight() {
    return this.body.reduce((acc, row) => acc + row.getMaxCellHeight(this.columns), 0);
  }

  allRows() {
    return this.head.concat(this.body);
  }

  getWidth() {
    return this.settings.tableWidth;
  }

  getHeight() {
    return (this.settings.showHead ? this.getHeadHeight() : 0) + this.getBodyHeight();
  }

  /** Total width of the columns `from`..`from + span - 1`, including the gaps between them. */
  getSpanWidth(from: number, span: number) {
    const columns = this.columns.slice(from, from + span);
    const gaps = Math.max(0, columns.length - 1) * this.settings.columnGap;
    return columns.reduce((acc, column) => acc + column.width, 0) + gaps;
  }

  /** Shows only part of the first/last body row, as laid out across pages. */
  applyRowSlice(slice: { first?: RowLineState; last?: RowLineState }) {
    if (this.body.length === 0) return;
    const first = this.body[0];
    const last = this.body[this.body.length - 1];
    if (slice.first) {
      for (const cell of Object.values(first.cells)) {
        cell.lineStart = Math.min(slice.first[cell.colIndex] ?? 0, cell.lineHeights.length);
      }
    }
    if (slice.last) {
      for (const cell of Object.values(last.cells)) {
        cell.lineEnd = Math.max(
          cell.lineStart,
          slice.last[cell.colIndex] ?? cell.lineHeights.length,
        );
      }
    }
    for (const row of new Set([first, last])) {
      row.height = Object.values(row.cells).reduce(
        (acc, cell) => Math.max(acc, cell.getContentHeight()),
        0,
      );
      for (const cell of Object.values(row.cells)) cell.height = row.height;
    }
  }
}

async function calculateWidths(arg: {
  table: Table;
  font: Font;
  _cache: Map<string | number, FontKitFont>;
}) {
  const { table, font, _cache } = arg;

  const getFontKitFontByFontName = (fontName: string | undefined) =>
    getFontKitFont(fontName, font, _cache);

  await calculate(table, getFontKitFontByFontName);
  const gaps = Math.max(0, table.columns.length - 1) * table.settings.columnGap;

  const resizableColumns: Column[] = [];
  let initialTableWidth = 0;

  table.columns.forEach((column) => {
    const customWidth = column.getMaxCustomCellWidth(table);
    if (customWidth) {
      // final column width
      column.width = customWidth;
    } else {
      // initial column width (will be resized)
      column.width = column.wrappedWidth;
      resizableColumns.push(column);
    }
    initialTableWidth += column.width;
  });

  // width difference that needs to be distributed
  let resizeWidth = table.getWidth() - gaps - initialTableWidth;

  // first resize attempt: with respect to minReadableWidth and minWidth
  if (resizeWidth) {
    resizeWidth = resizeColumns(resizableColumns, resizeWidth, (column) =>
      Math.max(column.minReadableWidth, column.minWidth),
    );
  }

  // second resize attempt: ignore minReadableWidth but respect minWidth
  if (resizeWidth) {
    resizeWidth = resizeColumns(resizableColumns, resizeWidth, (column) => column.minWidth);
  }

  resizeWidth = Math.abs(resizeWidth);

  applyColSpans(table);
  await fitContent(table, getFontKitFontByFontName, font, _cache);
  applyRowHeights(table);
}

function applyRowHeights(table: Table) {
  for (const row of table.allRows()) {
    for (const cell of Object.values(row.cells)) cell.height = row.height;
  }
}

function applyColSpans(table: Table) {
  for (const row of table.allRows()) {
    for (const cell of Object.values(row.cells)) {
      cell.width = table.getSpanWidth(cell.colIndex, cell.colSpan);
    }
  }
}

async function fitContent(
  table: Table,
  getFontKitFontByFontName: (fontName: string | undefined) => Promise<FontKitFont>,
  font: Font,
  _cache: Map<string | number, FontKitFont>,
) {
  for (const row of table.allRows()) {
    for (const cell of Object.values(row.cells)) {
      if (cell.rich) {
        const layout = await getRichLayout({
          value: cell.raw,
          schema: cell.getTextSchema(),
          widthMm: cell.getTextWidth(),
          font,
          _cache: _cache as unknown as Map<string | number, unknown>,
        });
        cell.lineHeights = layout.lines.map((line) => line.height);
      } else {
        const fontKitFont = await getFontKitFontByFontName(cell.styles.fontName);
        // Wrap at the text area (inside padding), exactly as the cell draws it.
        cell.text = splitTextToSize({
          value: cell.raw,
          characterSpacing: cell.styles.characterSpacing,
          boxWidthInPt: mm2pt(cell.getTextWidth()),
          fontSize: cell.styles.fontSize,
          fontKitFont,
        });
        const lineHeight = pt2mm(cell.styles.fontSize) * cell.styles.lineHeight;
        cell.lineHeights = cell.text.map(() => lineHeight);
      }

      cell.contentHeight = cell.getContentHeight();
      if (cell.contentHeight > row.height) {
        row.height = cell.contentHeight;
      }
    }
  }
}

function resizeColumns(
  columns: Column[],
  resizeWidth: number,
  getMinWidth: (column: Column) => number,
) {
  const initialResizeWidth = resizeWidth;
  const sumWrappedWidth = columns.reduce((acc, column) => acc + column.wrappedWidth, 0);

  for (let i = 0; i < columns.length; i++) {
    const column = columns[i];

    const ratio = column.wrappedWidth / sumWrappedWidth;
    const suggestedChange = initialResizeWidth * ratio;
    const suggestedWidth = column.width + suggestedChange;

    const minWidth = getMinWidth(column);
    const newWidth = suggestedWidth < minWidth ? minWidth : suggestedWidth;

    resizeWidth -= newWidth - column.width;
    column.width = newWidth;
  }

  resizeWidth = Math.round(resizeWidth * 1e10) / 1e10;

  // Run the resizer again if there's remaining width needs
  // to be distributed and there're columns that can be resized
  if (resizeWidth) {
    const resizableColumns = columns.filter((column) => {
      return resizeWidth < 0
        ? column.width > getMinWidth(column) // check if column can shrink
        : true; // check if column can grow
    });

    if (resizableColumns.length) {
      resizeWidth = resizeColumns(resizableColumns, resizeWidth, getMinWidth);
    }
  }

  return resizeWidth;
}

async function calculate(
  table: Table,
  getFontKitFontByFontName: (fontName: string | undefined) => Promise<FontKitFont>,
) {
  for (const row of table.allRows()) {
    for (const column of table.columns) {
      const cell = row.cells[column.index];
      if (!cell) continue;

      const hPadding = cell.padding('right') + cell.padding('left');
      const fontKitFont = await getFontKitFontByFontName(cell.styles.fontName);

      cell.contentWidth = getStringWidth(cell, fontKitFont) + hPadding;

      const longestWordWidth = getStringWidth(
        Object.assign(cell, { text: cell.text.join(' ').split(/\s+/) }),
        fontKitFont,
      );
      cell.minReadableWidth = longestWordWidth + hPadding;

      cell.minWidth = cell.styles.cellWidth;
      cell.wrappedWidth = cell.styles.cellWidth;
    }
  }

  for (const row of table.allRows()) {
    for (const column of table.columns) {
      const cell = row.cells[column.index];

      // For now we ignore the minWidth and wrappedWidth of colspan cells when calculating colspan widths.
      // Could probably be improved upon however.
      if (cell) {
        column.wrappedWidth = Math.max(column.wrappedWidth, cell.wrappedWidth);
        column.minWidth = Math.max(column.minWidth, cell.minWidth);
        column.minReadableWidth = Math.max(column.minReadableWidth, cell.minReadableWidth);
      } else {
        // Respect cellWidth set in columnStyles even if there is no cells for this column
        // or if the column only have colspan cells. Since the width of colspan cells
        // does not affect the width of columns, setting columnStyles cellWidth enables the
        // user to at least do it manually.

        // Note that this is not perfect for now since for example row and table styles are
        // not accounted for
        const columnStyles = table.styles.columnStyles[column.index] || {};
        const cellWidth = columnStyles.cellWidth || columnStyles.minCellWidth;
        if (cellWidth) {
          column.minWidth = cellWidth;
          column.wrappedWidth = cellWidth;
        }
      }
    }
  }
}

function getStringWidth(cell: Cell, fontKitFont: FontKitFont) {
  const text = cell.text;
  const textArr: string[] = Array.isArray(text) ? text : [text];
  const fontSize = cell.styles.fontSize;
  const characterSpacing = cell.styles.characterSpacing;
  const widestLineWidth = textArr
    .map((text) => widthOfTextAtSize(text, fontKitFont, fontSize, characterSpacing))
    .reduce((a, b) => Math.max(a, b), 0);

  return widestLineWidth;
}
