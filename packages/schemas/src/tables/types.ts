import type { ALIGNMENT, VERTICAL_ALIGNMENT } from '../text/types.js';
import type { BoxDimension } from '../box.js';
import type { Schema } from '@pdfme/common';

export type Spacing = BoxDimension;
type BorderInsets = Spacing;
type BoxDimensions = Spacing;

export interface CellStyle {
  fontName?: string;
  alignment: ALIGNMENT;
  verticalAlignment: VERTICAL_ALIGNMENT;
  fontSize: number;
  lineHeight: number;
  characterSpacing: number;
  fontColor: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: BoxDimensions;
  padding: BoxDimensions;
}

export type CellSchema = Schema & CellStyle;

/** Style override at row, column or cell level; unset keys inherit. */
export type CellStyleOverride = Partial<CellStyle> & {
  /** Spellcheck / hyphenation language of the text (e.g. `de`, `en`). */
  lang?: string;
};

/** Override for one cell; `colSpan` merges it with the cells to its right. */
export type CellOverride = CellStyleOverride & { colSpan?: number };

/** Break state of a table row split across pages: first line index per column. */
export type RowLineState = number[];

export type TableSchema = Schema & {
  showHead: boolean;
  head: string[];
  headWidthPercentages: number[];
  repeatHead?: boolean;

  tableStyles: {
    borderColor: string;
    borderWidth: number;
  };
  headStyles: CellStyle;
  bodyStyles: CellStyle & { alternateBackgroundColor: string };
  columnStyles: {
    alignment?: { [colIndex: number]: ALIGNMENT };
    /** Further per-column styles (font, colours, padding, borders, language). */
    styles?: { [colIndex: number]: CellStyleOverride };
  };
  /**
   * Gap (mm) between columns. With a gap each column is drawn as its own
   * bordered box, e.g. a German and an English column side by side.
   */
  columnGap?: number;
  /** Body row overrides keyed by row index. */
  rowStyles?: { [rowIndex: number]: CellStyleOverride };
  /** Cell overrides keyed by `row:col` (body) or `h:col` (head). */
  cellStyles?: { [cellKey: string]: CellOverride };
  /**
   * Let rows break across pages at line boundaries. Rows taller than a whole
   * page always break.
   */
  splitRows?: boolean;
  /** Line slices of the first/last body row of a page chunk (set by the layout). */
  __rowSlice?: { first?: RowLineState; last?: RowLineState };
};

export interface Styles {
  fontName: string | undefined;
  backgroundColor: string;
  textColor: string;
  lineHeight: number;
  characterSpacing: number;
  alignment: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment: 'top' | 'middle' | 'bottom';
  fontSize: number;
  cellPadding: Spacing;
  lineColor: string;
  lineWidth: BorderInsets;
  cellWidth: number;
  minCellHeight: number;
  minCellWidth: number;
  lang?: string;
  colSpan?: number;
}

export interface TableInput {
  settings: Settings;
  styles: StylesProps;
  content: ContentInput;
}

interface ContentInput {
  body: string[][];
  head: string[][];
  columns: number[];
}

export interface Settings {
  startY: number;
  margin: Spacing;
  tableWidth: number;
  showHead: boolean;
  tableLineWidth: number;
  tableLineColor: string;
  columnGap: number;
}

export interface StylesProps {
  styles: Partial<Styles>;
  headStyles: Partial<Styles>;
  bodyStyles: Partial<Styles>;
  alternateRowStyles: Partial<Styles>;
  columnStyles: { [key: string]: Partial<Styles> };
  columnBodyStyles: { [key: string]: Partial<Styles> };
  rowStyles: { [key: string]: Partial<Styles> };
  cellStyles: { [key: string]: Partial<Styles> };
}

export type Section = 'head' | 'body';
