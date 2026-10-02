import {
  getFallbackFontName,
  mm2pt,
  pt2mm,
  type Font,
  type RichDoc,
  type RichListFormat,
  type RichParagraph,
  type RichRun,
  type RichAlignment,
} from '@pdfme/common';
import type { Font as FontKitFont } from 'fontkit';
import {
  DEFAULT_ALIGNMENT,
  DEFAULT_CHARACTER_SPACING,
  DEFAULT_FONT_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_LINE_HEIGHT,
  SYNTHETIC_BOLD_OFFSET_RATIO,
  SYNTHETIC_BOLD_PDF_EXTRA_DRAWS,
  SYNTHETIC_ITALIC_SKEW_DEGREES,
} from '../text/constants.js';
import { getFontKitFont, widthOfTextAtSize } from '../text/helper.js';
import { resolveFontVariant } from '../text/richText.js';
import type { TextSchema } from '../text/types.js';

/** Default hanging indent per list level (Word's 0.25"). */
export const LIST_INDENT_MM = 6.35;

/** Field-level defaults a rich document inherits from its schema. */
export type RichBaseStyle = Pick<
  TextSchema,
  | 'name'
  | 'fontName'
  | 'fontSize'
  | 'lineHeight'
  | 'characterSpacing'
  | 'fontColor'
  | 'alignment'
  | 'fontVariants'
  | 'fontVariantFallback'
>;

export type RichResolvedStyle = {
  fontName: string;
  fontKitFont: FontKitFont;
  fontSize: number;
  characterSpacing: number;
  color: string;
  syntheticBold: boolean;
  syntheticItalic: boolean;
  underline: boolean;
  strikethrough: boolean;
  highlight?: string;
  href?: string;
};

/** A positioned piece of text on a line. x is relative to the content box (pt). */
export type RichLineItem = {
  text: string;
  x: number;
  width: number;
  style: RichResolvedStyle;
};

export type RichLine = {
  paragraphIndex: number;
  /** Total unit height in mm: spacing before + line box + spacing after. */
  height: number;
  /** Paragraph spacing above this line's box (mm, first line only). */
  spaceBefore: number;
  /** Height of the line box itself (mm). */
  boxHeight: number;
  /** Distance from the top of the line box to the baseline (mm). */
  baseline: number;
  items: RichLineItem[];
};

export type RichLayout = { lines: RichLine[] };

type Piece = { text: string; style: RichResolvedStyle; space: boolean; width: number };

type ResolvedParagraph = {
  align: RichAlignment;
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
  indentLeft: number;
  indentRight: number;
  indentFirstLine: number;
  marker?: { text: string; style: RichResolvedStyle };
};

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const isSpace = (text: string) => /^\s+$/u.test(text);

// ---------------------------------------------------------------------------
// List numbering
// ---------------------------------------------------------------------------

const toRoman = (value: number) => {
  const numerals: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let rest = Math.max(1, Math.floor(value));
  let result = '';
  for (const [amount, numeral] of numerals) {
    while (rest >= amount) {
      result += numeral;
      rest -= amount;
    }
  }
  return result;
};

const toLetters = (value: number) => {
  let rest = Math.max(1, Math.floor(value));
  let result = '';
  while (rest > 0) {
    rest -= 1;
    result = String.fromCharCode(97 + (rest % 26)) + result;
    rest = Math.floor(rest / 26);
  }
  return result;
};

const BULLETS = ['•', '◦', '▪'];

export const formatListMarker = (format: RichListFormat, count: number, level: number) => {
  switch (format) {
    case 'bullet':
      return BULLETS[level % BULLETS.length];
    case 'decimal':
      return `${count}.`;
    case 'lowerLetter':
      return `${toLetters(count)})`;
    case 'upperLetter':
      return `${toLetters(count).toUpperCase()}.`;
    case 'lowerRoman':
      return `${toRoman(count)}.`;
    case 'upperRoman':
      return `${toRoman(count).toUpperCase()}.`;
    default:
      return '';
  }
};

/** Marker text per paragraph; counters continue across intervening paragraphs. */
export const computeListMarkers = (paragraphs: RichParagraph[]): (string | undefined)[] => {
  const counters: number[] = [];
  return paragraphs.map(({ list }) => {
    if (!list) return undefined;
    const level = Math.max(0, list.level ?? 0);
    counters.length = Math.max(counters.length, level + 1);
    // Entering a level resets every deeper level.
    counters.splice(level + 1);
    const previous = counters[level] ?? 0;
    const count = list.restart || previous === 0 ? (list.start ?? 1) : previous + 1;
    counters[level] = count;
    return list.marker ?? formatListMarker(list.format, count, level);
  });
};

// ---------------------------------------------------------------------------
// Style resolution
// ---------------------------------------------------------------------------

type FontKitLoader = (fontName: string) => Promise<FontKitFont>;

const createFontKitLoader = (font: Font, _cache: Map<string | number, unknown>): FontKitLoader => {
  const local = new Map<string, Promise<FontKitFont>>();
  return (fontName) => {
    let pending = local.get(fontName);
    if (!pending) {
      pending = getFontKitFont(fontName, font, _cache as Map<string, FontKitFont>);
      local.set(fontName, pending);
    }
    return pending;
  };
};

const resolveRunStyle = async (
  run: Omit<RichRun, 'text'>,
  base: RichBaseStyle,
  font: Font,
  loadFont: FontKitLoader,
): Promise<RichResolvedStyle> => {
  const familyName =
    run.fontName && font[run.fontName]
      ? run.fontName
      : base.fontName && font[base.fontName]
        ? base.fontName
        : getFallbackFontName(font);
  const variant = resolveFontVariant(
    { text: '', bold: run.bold, italic: run.italic },
    { ...(base as TextSchema), fontName: familyName },
    font,
  );
  return {
    fontName: variant.fontName,
    fontKitFont: await loadFont(variant.fontName),
    fontSize: run.fontSize ?? base.fontSize ?? DEFAULT_FONT_SIZE,
    characterSpacing: base.characterSpacing ?? DEFAULT_CHARACTER_SPACING,
    color: run.color || base.fontColor || DEFAULT_FONT_COLOR,
    syntheticBold: variant.syntheticBold,
    syntheticItalic: variant.syntheticItalic,
    underline: Boolean(run.underline),
    strikethrough: Boolean(run.strikethrough),
    highlight: run.highlight || undefined,
    href: run.href || undefined,
  };
};

// ---------------------------------------------------------------------------
// Metrics (pt)
// ---------------------------------------------------------------------------

export const getAscentPt = (style: RichResolvedStyle) =>
  (style.fontKitFont.ascent / style.fontKitFont.unitsPerEm) * style.fontSize;

export const getDescentPt = (style: RichResolvedStyle) =>
  (Math.abs(style.fontKitFont.descent) / style.fontKitFont.unitsPerEm) * style.fontSize;

/** Single-spaced line height, like Word: ascent + descent + line gap. */
const getSingleLineHeightPt = (style: RichResolvedStyle) => {
  const { ascent, descent, lineGap, unitsPerEm } = style.fontKitFont;
  return ((ascent - descent + (lineGap || 0)) / unitsPerEm) * style.fontSize;
};

export const measurePieceWidth = (text: string, style: RichResolvedStyle) => {
  const syntheticBold = style.syntheticBold
    ? style.fontSize * SYNTHETIC_BOLD_OFFSET_RATIO * SYNTHETIC_BOLD_PDF_EXTRA_DRAWS
    : 0;
  const syntheticItalic = style.syntheticItalic
    ? getAscentPt(style) * Math.tan((SYNTHETIC_ITALIC_SKEW_DEGREES * Math.PI) / 180)
    : 0;
  return (
    widthOfTextAtSize(text, style.fontKitFont, style.fontSize, style.characterSpacing) +
    syntheticBold +
    syntheticItalic
  );
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const toPieces = (text: string, style: RichResolvedStyle): Piece[] =>
  Array.from(wordSegmenter.segment(text), ({ segment }) => ({
    text: segment,
    style,
    space: isSpace(segment),
    width: measurePieceWidth(segment, style),
  }));

/** Splits a piece wider than `maxWidth` into grapheme chunks that fit. */
const splitOversizedPiece = (piece: Piece, maxWidth: number): Piece[] => {
  const chunks: Piece[] = [];
  let current = '';
  for (const { segment } of graphemeSegmenter.segment(piece.text)) {
    const candidate = current + segment;
    if (current && measurePieceWidth(candidate, piece.style) > maxWidth) {
      chunks.push({ ...piece, text: current, width: measurePieceWidth(current, piece.style) });
      current = segment;
    } else {
      current = candidate;
    }
  }
  if (current)
    chunks.push({ ...piece, text: current, width: measurePieceWidth(current, piece.style) });
  return chunks;
};

type DraftLine = { pieces: Piece[]; hardBreak: boolean };

const trimTrailingSpaces = (pieces: Piece[]) => {
  let end = pieces.length;
  while (end > 0 && pieces[end - 1].space) end -= 1;
  return pieces.slice(0, end);
};

const piecesWidth = (pieces: Piece[]) => pieces.reduce((sum, piece) => sum + piece.width, 0);

type Token =
  | { kind: 'space'; piece: Piece }
  | { kind: 'word'; pieces: Piece[] }
  | { kind: 'break' };

/** Break opportunities exist only at spaces and after hyphens, like Word. */
const BREAK_AFTER = /[-\u2010\u2013\u2014]$/u;

/**
 * Groups pieces into unbreakable words. Adjacent non-space pieces stay
 * together even across style changes, so „ never parts from the word it
 * opens and "(„BSBI“)" wraps as one unit.
 */
const tokenize = (segments: { pieces: Piece[]; hardBreakAfter: boolean }[]): Token[] => {
  const tokens: Token[] = [];
  let word: Piece[] = [];
  const endWord = () => {
    if (word.length > 0) tokens.push({ kind: 'word', pieces: word });
    word = [];
  };
  for (const segment of segments) {
    for (const piece of segment.pieces) {
      if (piece.space) {
        endWord();
        tokens.push({ kind: 'space', piece });
        continue;
      }
      word.push(piece);
      if (BREAK_AFTER.test(piece.text)) endWord();
    }
    if (segment.hardBreakAfter) {
      endWord();
      tokens.push({ kind: 'break' });
    }
  }
  endWord();
  return tokens;
};

const breakParagraph = (
  segments: { pieces: Piece[]; hardBreakAfter: boolean }[],
  widthForLine: (lineIndex: number) => number,
): DraftLine[] => {
  const lines: DraftLine[] = [];
  let current: Piece[] = [];
  let currentWidth = 0;

  const flush = (hardBreak: boolean) => {
    lines.push({ pieces: current, hardBreak });
    current = [];
    currentWidth = 0;
  };
  const hasContent = () => current.some((candidate) => !candidate.space);
  // Width the line would have once trailing spaces are trimmed.
  const visibleWidth = () => piecesWidth(trimTrailingSpaces(current));

  const queue = tokenize(segments);
  while (queue.length > 0) {
    const token = queue.shift() as Token;
    if (token.kind === 'break') {
      flush(true);
      continue;
    }
    if (token.kind === 'space') {
      // Leading spaces on a wrapped line are dropped, like Word.
      const wrapped =
        current.length === 0 && lines.length > 0 && !lines[lines.length - 1].hardBreak;
      if (!wrapped) {
        current.push(token.piece);
        currentWidth += token.piece.width;
      }
      continue;
    }
    const available = widthForLine(lines.length);
    const wordWidth = piecesWidth(token.pieces);
    if (currentWidth + wordWidth <= available || (!hasContent() && wordWidth <= available)) {
      current.push(...token.pieces);
      currentWidth += wordWidth;
      continue;
    }
    if (hasContent() && visibleWidth() > 0) {
      flush(false);
      queue.unshift(token);
      continue;
    }
    // A single word wider than the line: break inside it, piece by piece.
    const [first, ...rest] = token.pieces;
    const chunks = splitOversizedPiece(first, Math.max(available - currentWidth, 1));
    current.push(chunks[0]);
    currentWidth += chunks[0].width;
    const remaining = [...chunks.slice(1), ...rest];
    if (remaining.length > 0) {
      flush(false);
      queue.unshift({ kind: 'word', pieces: remaining });
    }
  }
  if (current.length > 0 || lines.length === 0) flush(true);
  else if (lines.length > 0) lines[lines.length - 1].hardBreak = true;
  return lines;
};

const resolveParagraph = (
  paragraph: RichParagraph,
  base: RichBaseStyle,
  marker: { text: string; style: RichResolvedStyle } | undefined,
): ResolvedParagraph => {
  const level = Math.max(0, paragraph.list?.level ?? 0);
  const listDefaults = paragraph.list
    ? { indentLeft: (level + 1) * LIST_INDENT_MM, indentFirstLine: -LIST_INDENT_MM }
    : { indentLeft: 0, indentFirstLine: 0 };
  return {
    align: paragraph.align ?? (base.alignment as RichAlignment | undefined) ?? DEFAULT_ALIGNMENT,
    lineHeight: paragraph.lineHeight ?? base.lineHeight ?? DEFAULT_LINE_HEIGHT,
    spaceBefore: paragraph.spaceBefore ?? 0,
    spaceAfter: paragraph.spaceAfter ?? 0,
    indentLeft: paragraph.indentLeft ?? listDefaults.indentLeft,
    indentRight: paragraph.indentRight ?? 0,
    indentFirstLine: paragraph.indentFirstLine ?? listDefaults.indentFirstLine,
    marker,
  };
};

/**
 * Lays a rich document out into positioned lines for a content box of
 * `widthMm`. Each line is one splittable unit for page breaks.
 */
export const layoutRichDoc = async (arg: {
  doc: RichDoc;
  base: RichBaseStyle;
  font: Font;
  _cache: Map<string | number, unknown>;
  widthMm: number;
}): Promise<RichLayout> => {
  const { doc, base, font, _cache, widthMm } = arg;
  const loadFont = createFontKitLoader(font, _cache);
  const boxWidth = mm2pt(widthMm);
  const markers = computeListMarkers(doc.paragraphs);
  const lines: RichLine[] = [];

  for (let paragraphIndex = 0; paragraphIndex < doc.paragraphs.length; paragraphIndex += 1) {
    const paragraph = doc.paragraphs[paragraphIndex];
    const firstRunStyle = paragraph.runs[0] ?? { text: '' };
    const emptyStyle = await resolveRunStyle(firstRunStyle, base, font, loadFont);
    const markerText = markers[paragraphIndex];
    const resolved = resolveParagraph(
      paragraph,
      base,
      markerText ? { text: markerText, style: emptyStyle } : undefined,
    );

    const segments: { pieces: Piece[]; hardBreakAfter: boolean }[] = [];
    for (const run of paragraph.runs) {
      const style = await resolveRunStyle(run, base, font, loadFont);
      const parts = run.text.split(/\r\n|\r|\n/);
      parts.forEach((part, index) => {
        segments.push({ pieces: toPieces(part, style), hardBreakAfter: index < parts.length - 1 });
      });
    }

    const leftPt = mm2pt(resolved.indentLeft);
    const rightPt = mm2pt(resolved.indentRight);
    const firstLinePt = mm2pt(resolved.indentFirstLine);
    // With a list marker the first line's text starts at the left indent;
    // the marker sits in the hanging area.
    const firstLineStart = (hasMarker: boolean) =>
      hasMarker ? leftPt : Math.max(0, leftPt + firstLinePt);
    const lineStart = (lineIndex: number) =>
      lineIndex === 0 ? firstLineStart(Boolean(resolved.marker)) : leftPt;
    const widthForLine = (lineIndex: number) =>
      Math.max(1, boxWidth - lineStart(lineIndex) - rightPt);

    const drafts = breakParagraph(segments, widthForLine);

    drafts.forEach((draft, lineIndex) => {
      const isFirst = lineIndex === 0;
      const isLast = lineIndex === drafts.length - 1;
      const pieces = trimTrailingSpaces(draft.pieces);
      const styles = pieces.length > 0 ? pieces.map((piece) => piece.style) : [emptyStyle];
      if (isFirst && resolved.marker) styles.push(resolved.marker.style);

      const ascent = Math.max(...styles.map(getAscentPt));
      const descent = Math.max(...styles.map(getDescentPt));
      const single = Math.max(...styles.map(getSingleLineHeightPt));
      const boxHeight = single * resolved.lineHeight;
      const baseline = (boxHeight - (ascent + descent)) / 2 + ascent;

      const start = lineStart(lineIndex);
      const available = widthForLine(lineIndex);
      const contentWidth = piecesWidth(pieces);
      const slack = Math.max(0, available - contentWidth);
      const justify = resolved.align === 'justify' && !isLast && !draft.hardBreak;
      const spaceCount = justify ? pieces.filter((piece) => piece.space).length : 0;
      const extraPerSpace = spaceCount > 0 ? slack / spaceCount : 0;
      let x =
        start + (resolved.align === 'center' ? slack / 2 : resolved.align === 'right' ? slack : 0);

      const items: RichLineItem[] = [];
      if (isFirst && resolved.marker) {
        items.push({
          text: resolved.marker.text,
          x: Math.max(0, leftPt + firstLinePt),
          width: measurePieceWidth(resolved.marker.text, resolved.marker.style),
          style: resolved.marker.style,
        });
      }
      for (const piece of pieces) {
        const width = piece.width + (piece.space ? extraPerSpace : 0);
        items.push({ text: piece.text, x, width, style: piece.style });
        x += width;
      }

      const spaceBefore = isFirst ? resolved.spaceBefore : 0;
      const spaceAfter = isLast ? resolved.spaceAfter : 0;
      lines.push({
        paragraphIndex,
        spaceBefore,
        boxHeight: pt2mm(boxHeight),
        baseline: pt2mm(baseline),
        height: spaceBefore + pt2mm(boxHeight) + spaceAfter,
        items: mergeItems(items, justify),
      });
    });
  }

  return { lines };
};

/** Joins adjacent same-style items (not justified spaces) to reduce PDF ops. */
const mergeItems = (items: RichLineItem[], justified: boolean): RichLineItem[] => {
  const merged: RichLineItem[] = [];
  for (const item of items) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      !justified &&
      previous.style === item.style &&
      Math.abs(previous.x + previous.width - item.x) < 0.01
    ) {
      previous.text += item.text;
      previous.width += item.width;
      continue;
    }
    merged.push({ ...item });
  }
  return merged;
};

export const getRichLayoutHeight = (layout: RichLayout) =>
  layout.lines.reduce((sum, line) => sum + line.height, 0);
