import type { Schema } from '@pdfme/common';
import type { Font as FontKitFont } from 'fontkit';
import type { BoxDimension } from '../box.js';

export type ALIGNMENT = 'left' | 'center' | 'right' | 'justify';
export type VERTICAL_ALIGNMENT = 'top' | 'middle' | 'bottom';
export type DYNAMIC_FONT_SIZE_FIT = 'horizontal' | 'vertical';
export type TEXT_FORMAT = 'plain' | 'inline-markdown';
export type TEXT_OVERFLOW = 'visible' | 'expand';
export type FONT_VARIANT_FALLBACK = 'synthetic' | 'plain' | 'error';
export type PARAGRAPH_INDENT_MODE = 'none' | 'firstLine' | 'hanging';
export type TEXT_WIDTH_MODE = 'fixed' | 'auto' | 'fill';
export type TEXT_HEIGHT_MODE = 'fixed' | 'auto';
/** What stops a field from expanding further. */
export type TEXT_EXPANSION_BOUNDARY = 'page' | 'margin' | 'field' | 'manual' | 'allow-overlap';

/** Paragraph indentation, in mm, relative to the content area of the field. */
export type ParagraphIndent = {
  left: number;
  right: number;
  mode: PARAGRAPH_INDENT_MODE;
  /** First-line or hanging offset. Negative values outdent the first line. */
  special: number;
};

export type FontVariants = {
  bold?: string;
  italic?: string;
  boldItalic?: string;
  code?: string;
};

export type RichTextRun = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  href?: string;
};

export type FontWidthCalcValues = {
  font: FontKitFont;
  fontSize: number;
  characterSpacing: number;
  boxWidthInPt: number;
};

export type TextSchema = Schema & {
  fontName?: string;
  textFormat?: TEXT_FORMAT;
  fontVariants?: FontVariants;
  fontVariantFallback?: FONT_VARIANT_FALLBACK;
  alignment: ALIGNMENT;
  verticalAlignment: VERTICAL_ALIGNMENT;
  fontSize: number;
  lineHeight: number;
  strikethrough?: boolean;
  underline?: boolean;
  characterSpacing: number;
  dynamicFontSize?: {
    min: number;
    max: number;
    fit: DYNAMIC_FONT_SIZE_FIT;
  };
  overflow?: TEXT_OVERFLOW;
  /** Paragraph left indent in mm. */
  leftIndent?: number;
  /** Paragraph right indent in mm. */
  rightIndent?: number;
  indentMode?: PARAGRAPH_INDENT_MODE;
  widthMode?: TEXT_WIDTH_MODE;
  heightMode?: TEXT_HEIGHT_MODE;
  /** Minimum auto-height in mm. Defaults to the authored height when first expanded. */
  minHeight?: number;
  /** Current content-derived minimum height in mm for the resolved text width. */
  contentMinHeight?: number;
  expansionBoundary?: TEXT_EXPANSION_BOUNDARY;
  /** Persisted layout ID of the field used when `expansionBoundary` is `field`. */
  boundarySchemaId?: string;
  /** @deprecated Use `boundarySchemaId`; retained to read older templates. */
  boundarySchemaName?: string;
  /** First-line / hanging indent amount in mm. */
  specialIndent?: number;
  fontColor: string;
  backgroundColor: string;
  borderColor?: string;
  borderWidth?: BoxDimension;
  padding?: BoxDimension;
};
