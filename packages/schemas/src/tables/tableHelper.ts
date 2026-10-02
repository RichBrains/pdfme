import {
  Schema,
  isBlankPdf,
  BasePdf,
  CommonOptions,
  getDefaultFont,
  getFallbackFontName,
  cloneDeep,
} from '@pdfme/common';
import type { Font as FontKitFont } from 'fontkit';
import type {
  TableSchema,
  CellOverride,
  CellStyle,
  Styles,
  Spacing,
  TableInput,
  StylesProps,
  Section,
} from './types.js';
import { Cell, Column, Row, Table } from './classes.js';
import { getTableBodyRange } from '../splitRange.js';

type StyleProp =
  | 'styles'
  | 'headStyles'
  | 'bodyStyles'
  | 'alternateRowStyles'
  | 'columnStyles'
  | 'columnBodyStyles'
  | 'rowStyles'
  | 'cellStyles';

interface CreateTableArgs {
  schema: Schema;
  basePdf: BasePdf;
  options: CommonOptions;
  _cache: Map<string | number, unknown>;
}

interface UserOptions {
  startY: number;
  tableWidth: number;
  margin: Spacing;
  showHead: boolean;
  tableLineWidth?: number;
  tableLineColor?: string;
  head?: string[][];
  body?: string[][];

  styles?: Partial<Styles>;
  bodyStyles?: Partial<Styles>;
  headStyles?: Partial<Styles>;
  alternateRowStyles?: Partial<Styles>;
  columnStyles?: {
    [key: string]: Partial<Styles>;
  };
  /** Column styles that apply to body cells only (head keeps its own look). */
  columnBodyStyles?: { [key: string]: Partial<Styles> };
  rowStyles?: { [key: string]: Partial<Styles> };
  cellStyles?: { [key: string]: Partial<Styles> };
  columnGap?: number;
}

function parseSection(
  sectionName: Section,
  sectionRows: string[][],
  columns: Column[],
  styleProps: StylesProps,
  fallbackFontName: string,
  rowOffset: number,
): Row[] {
  return sectionRows.map((rawRow, rowIndex) => {
    const cells: { [key: string]: Cell } = {};
    let covered = 0;
    for (const column of columns) {
      // Columns merged into a cell to their left have no cell of their own.
      if (covered > 0) {
        covered--;
        continue;
      }
      const rawCell = (rawRow as unknown as Record<number, unknown>)?.[column.index];
      const styles = cellStyles(
        sectionName,
        column,
        rowIndex,
        rowOffset,
        styleProps,
        fallbackFontName,
      );
      const colSpan = Math.max(
        1,
        Math.min(Math.floor(styles.colSpan ?? 1), columns.length - column.index),
      );
      const cell = new Cell(rawCell == null ? '' : String(rawCell), styles, sectionName);
      cell.colIndex = column.index;
      cell.colSpan = colSpan;
      cells[column.index] = cell;
      covered = colSpan - 1;
    }
    return new Row(rawRow, rowIndex, sectionName, cells);
  });
}

function parseContent4Table(input: TableInput, fallbackFontName: string, rowOffset: number) {
  const content = input.content;
  const columns = content.columns.map((index) => new Column(index));
  const styles = input.styles;
  return {
    columns,
    head: parseSection('head', content.head, columns, styles, fallbackFontName, 0),
    body: parseSection('body', content.body, columns, styles, fallbackFontName, rowOffset),
  };
}

/**
 * Resolves a cell's styles from the layers, lowest first: defaults, table,
 * section (head/body), alternate row, row, column, cell.
 */
function cellStyles(
  sectionName: Section,
  column: Column,
  rowIndex: number,
  rowOffset: number,
  styles: StylesProps,
  fallbackFontName: string,
) {
  let sectionStyles;
  if (sectionName === 'head') {
    sectionStyles = styles.headStyles;
  } else if (sectionName === 'body') {
    sectionStyles = styles.bodyStyles;
  }
  const otherStyles = Object.assign({}, styles.styles, sectionStyles);

  const colStyles = styles.columnStyles[column.index] || {};

  const rowStyles =
    sectionName === 'body' && rowIndex % 2 === 0
      ? Object.assign({}, styles.alternateRowStyles)
      : {};

  const defaultStyle = {
    fontName: fallbackFontName,
    backgroundColor: '',
    textColor: '#000000',
    lineHeight: 1,
    characterSpacing: 0,
    alignment: 'left',
    verticalAlignment: 'middle',
    fontSize: 10,
    cellPadding: 5,
    lineColor: '#000000',
    lineWidth: 0,
    minCellHeight: 0,
    minCellWidth: 0,
  };
  const absoluteRow = rowOffset + rowIndex;
  const rowOverride = sectionName === 'body' ? styles.rowStyles[absoluteRow] || {} : {};
  const columnBodyOverride =
    sectionName === 'body' ? styles.columnBodyStyles[column.index] || {} : {};
  const cellOverride =
    styles.cellStyles[
      sectionName === 'head' ? `h:${column.index}` : `${absoluteRow}:${column.index}`
    ] || {};
  return Object.assign(
    defaultStyle,
    otherStyles,
    rowStyles,
    rowOverride,
    colStyles,
    columnBodyOverride,
    cellOverride,
  ) as Styles;
}

/** Maps a partial (override) cell style, leaving unset keys out so they inherit. */
function mapCellOverride(style: CellOverride | undefined): Partial<Styles> {
  if (!style) return {};
  const mapped: Partial<Styles> = {
    fontName: style.fontName,
    alignment: style.alignment,
    verticalAlignment: style.verticalAlignment,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    characterSpacing: style.characterSpacing,
    backgroundColor: style.backgroundColor,
    textColor: style.fontColor,
    lineColor: style.borderColor,
    lineWidth: style.borderWidth,
    cellPadding: style.padding,
    lang: style.lang,
    colSpan: style.colSpan,
  };
  return Object.fromEntries(
    Object.entries(mapped).filter(([, value]) => value !== undefined && value !== ''),
  ) as Partial<Styles>;
}

function mapOverrides<K extends string | number>(
  overrides: { [key in K]?: CellOverride } | undefined,
): Record<string, Partial<Styles>> {
  return Object.fromEntries(
    Object.entries(overrides ?? {}).map(([key, value]) => [
      key,
      mapCellOverride(value as CellOverride),
    ]),
  );
}

function mapCellStyle(style: CellStyle): Partial<Styles> {
  return {
    fontName: style.fontName,
    alignment: style.alignment,
    verticalAlignment: style.verticalAlignment,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight,
    characterSpacing: style.characterSpacing,
    backgroundColor: style.backgroundColor,
    // ---
    textColor: style.fontColor,
    lineColor: style.borderColor,
    lineWidth: style.borderWidth,
    cellPadding: style.padding,
  };
}

/** Column gap (mm) of a table schema. */
export const getColumnGap = (schema: Pick<TableSchema, 'columnGap'>) =>
  Math.max(0, Number(schema.columnGap) || 0);

function getTableOptions(schema: TableSchema, body: string[][]): UserOptions {
  const gaps = getColumnGap(schema) * Math.max(0, schema.headWidthPercentages.length - 1);
  const columnsWidth = Math.max(0, schema.width - gaps);
  const columnStylesWidth = schema.headWidthPercentages.reduce(
    (acc, cur, i) => ({ ...acc, [i]: { cellWidth: columnsWidth * (cur / 100) } }),
    {} as Record<number, Partial<Styles>>,
  );

  const columnStylesAlignment = Object.entries(schema.columnStyles.alignment || {}).reduce(
    (acc, [key, value]) => ({ ...acc, [key]: { alignment: value } }),
    {} as Record<number, Partial<Styles>>,
  );

  const columnStylesExtra = mapOverrides(schema.columnStyles.styles);

  const allKeys = new Set([
    ...Object.keys(columnStylesWidth).map(Number),
    ...Object.keys(columnStylesAlignment).map(Number),
  ]);
  const columnStyles = Array.from(allKeys).reduce(
    (acc, key) => {
      const widthStyle = columnStylesWidth[key] || {};
      const alignmentStyle = columnStylesAlignment[key] || {};
      return { ...acc, [key]: { ...alignmentStyle, ...widthStyle } };
    },
    {} as Record<number, Partial<Styles>>,
  );

  return {
    head: [schema.head],
    body,
    showHead: schema.showHead,
    startY: schema.position.y,
    tableWidth: schema.width,
    tableLineColor: schema.tableStyles.borderColor,
    tableLineWidth: schema.tableStyles.borderWidth,
    headStyles: mapCellStyle(schema.headStyles),
    bodyStyles: mapCellStyle(schema.bodyStyles),
    alternateRowStyles: { backgroundColor: schema.bodyStyles.alternateBackgroundColor },
    columnStyles,
    columnBodyStyles: columnStylesExtra,
    rowStyles: mapOverrides(schema.rowStyles),
    cellStyles: mapOverrides(schema.cellStyles),
    columnGap: getColumnGap(schema),
    margin: { top: 0, right: 0, left: schema.position.x, bottom: 0 },
  };
}

function parseStyles(cInput: UserOptions) {
  const styleOptions: StylesProps = {
    styles: {},
    headStyles: {},
    bodyStyles: {},
    alternateRowStyles: {},
    columnStyles: {},
    columnBodyStyles: {},
    rowStyles: {},
    cellStyles: {},
  };
  for (const prop of Object.keys(styleOptions) as StyleProp[]) {
    if (
      prop === 'columnStyles' ||
      prop === 'columnBodyStyles' ||
      prop === 'rowStyles' ||
      prop === 'cellStyles'
    ) {
      styleOptions[prop] = Object.assign({}, cInput[prop]);
    } else {
      const allOptions = [cInput];
      const styles = allOptions.map((opts) => opts[prop] || {});
      styleOptions[prop] = Object.assign({}, styles[0], styles[1], styles[2]);
    }
  }
  return styleOptions;
}

function parseContent4Input(options: UserOptions) {
  const head = options.head || [];
  const body = options.body || [];
  const columns = (head[0] || body[0] || []).map((_, index) => index);
  return { columns, head, body };
}

function parseInput(schema: TableSchema, body: string[][]): TableInput {
  const options = getTableOptions(schema, body);
  const styles = parseStyles(options);
  const settings = {
    startY: options.startY,
    margin: options.margin,
    tableWidth: options.tableWidth,
    showHead: options.showHead,
    tableLineWidth: options.tableLineWidth ?? 0,
    tableLineColor: options.tableLineColor ?? '',
    columnGap: options.columnGap ?? 0,
  };

  const content = parseContent4Input(options);

  return { content, styles, settings };
}

export async function createSingleTable(body: string[][], args: CreateTableArgs) {
  const { options, _cache, basePdf } = args;
  if (!isBlankPdf(basePdf)) {
    console.warn(
      '[@pdfme/schema/table]' +
        'When specifying a custom PDF for basePdf, ' +
        'you cannot use features such as page breaks or re-layout of other elements.' +
        'To utilize these features, please define basePdf as follows:\n' +
        '{ width: number; height: number; padding: [number, number, number, number]; }',
    );
  }

  const schema = cloneDeep(args.schema) as TableSchema;
  const { start } = getTableBodyRange(schema) || { start: 0 };
  if (start % 2 === 1) {
    const alternateBackgroundColor = schema.bodyStyles.alternateBackgroundColor;
    schema.bodyStyles.alternateBackgroundColor = schema.bodyStyles.backgroundColor;
    schema.bodyStyles.backgroundColor = alternateBackgroundColor;
  }
  schema.showHead =
    schema.showHead === false ? false : !schema.__isSplit || schema.repeatHead === true;

  const input = parseInput(schema, body);

  const font = options.font || getDefaultFont();

  const fallbackFontName = getFallbackFontName(font);

  const content = parseContent4Table(input, fallbackFontName, start);

  const table = await Table.create({
    input,
    content,
    font,
    _cache: _cache as unknown as Map<string | number, FontKitFont>,
  });
  if (schema.__rowSlice) table.applyRowSlice(schema.__rowSlice);
  return table;
}
