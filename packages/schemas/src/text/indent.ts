import { mm2pt } from '@pdfme/common';
import type { PARAGRAPH_INDENT_MODE, ParagraphIndent, TextSchema } from './types.js';

export const DEFAULT_PARAGRAPH_INDENT: ParagraphIndent = {
  left: 0,
  right: 0,
  mode: 'none',
  special: 0,
};

type ParagraphIndentSchema = Partial<
  Pick<TextSchema, 'leftIndent' | 'rightIndent' | 'indentMode' | 'specialIndent'>
>;

/** Paragraph indentation (mm) of a text schema, with word-processor defaults. */
export const getParagraphIndent = (schema: ParagraphIndentSchema): ParagraphIndent => ({
  left: schema.leftIndent ?? DEFAULT_PARAGRAPH_INDENT.left,
  right: schema.rightIndent ?? DEFAULT_PARAGRAPH_INDENT.right,
  mode: (schema.indentMode ?? DEFAULT_PARAGRAPH_INDENT.mode) as PARAGRAPH_INDENT_MODE,
  special: schema.specialIndent ?? DEFAULT_PARAGRAPH_INDENT.special,
});

export const hasParagraphIndent = (indent: ParagraphIndent) =>
  indent.left !== 0 || indent.right !== 0 || (indent.mode !== 'none' && indent.special !== 0);

/**
 * Horizontal offset (mm) of a line from the content-area leading edge.
 *
 * - `none`: every line starts at the paragraph left indent.
 * - `firstLine`: the first line is offset, wrapped lines are not.
 * - `hanging`: the first line stays put, wrapped lines are offset.
 */
export const getLineStartIndentMm = (indent: ParagraphIndent, isParagraphStart: boolean) => {
  const { left, mode, special } = indent;
  if (mode === 'firstLine') return isParagraphStart ? left + special : left;
  if (mode === 'hanging') return isParagraphStart ? left : left + special;
  return left;
};

/** Usable text width (mm) of a line after paragraph indentation is applied. */
export const getLineWidthMm = (
  indent: ParagraphIndent,
  contentWidthMm: number,
  isParagraphStart: boolean,
) => Math.max(0, contentWidthMm - getLineStartIndentMm(indent, isParagraphStart) - indent.right);

export const getLineStartIndentPt = (indent: ParagraphIndent, isParagraphStart: boolean) =>
  mm2pt(getLineStartIndentMm(indent, isParagraphStart));

export const getLineWidthPt = (
  indent: ParagraphIndent,
  contentWidthPt: number,
  isParagraphStart: boolean,
) =>
  Math.max(
    0,
    contentWidthPt - getLineStartIndentPt(indent, isParagraphStart) - mm2pt(indent.right),
  );

/**
 * Marks which lines start a paragraph.
 * The line splitter terminates the last line of every paragraph with a newline,
 * so a line starts a paragraph when it is first or follows such a line.
 */
export const getParagraphLineStarts = (lines: string[]): boolean[] =>
  lines.map((_, index) => index === 0 || lines[index - 1].endsWith('\n'));
