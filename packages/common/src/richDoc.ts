/**
 * Rich document: the styled-text model shared by text fields, table cells and
 * headers/footers (`textFormat: 'rich'`). It is stored as a JSON string in the
 * schema's `content`. Merge fields stay plain `{...}` placeholders inside run
 * text and are evaluated per run, so merged values can never be mistaken for
 * formatting and JSON braces never reach the expression evaluator.
 */

/** Marker key that identifies a serialized rich document. Always written first. */
export const RICH_DOC_MARKER = 'richDoc';
export const RICH_DOC_VERSION = 1;

export type RichAlignment = 'left' | 'center' | 'right' | 'justify';

export type RichListFormat =
  | 'bullet'
  | 'decimal'
  | 'lowerLetter'
  | 'upperLetter'
  | 'lowerRoman'
  | 'upperRoman';

export type RichList = {
  format: RichListFormat;
  /** Nesting level, 0-based. */
  level?: number;
  /** Explicit marker text (e.g. imported from Word). Overrides numbering. */
  marker?: string;
  /** Start a new count at this paragraph (defaults to 1, or `start`). */
  restart?: boolean;
  start?: number;
};

/** Character formatting. Every property is optional and falls back to the field. */
export type RichRunStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** #rrggbb */
  color?: string;
  /** #rrggbb background behind the text. */
  highlight?: string;
  fontName?: string;
  /** pt */
  fontSize?: number;
  href?: string;
};

export type RichRun = RichRunStyle & {
  /** Text, may contain `{...}` placeholders and `\n` line breaks. */
  text: string;
};

/** Paragraph formatting. Lengths are in mm, sizes in pt. */
export type RichParagraphStyle = {
  align?: RichAlignment;
  /** Multiplier of the font's line height (1 = single). */
  lineHeight?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  indentLeft?: number;
  indentRight?: number;
  /** Positive = first-line indent, negative = hanging indent. */
  indentFirstLine?: number;
  list?: RichList;
  /** Named style id; resolved by the host before layout. */
  style?: string;
};

export type RichParagraph = RichParagraphStyle & {
  runs: RichRun[];
};

export type RichDoc = {
  [RICH_DOC_MARKER]: typeof RICH_DOC_VERSION;
  paragraphs: RichParagraph[];
};

const RICH_DOC_PREFIX = `{"${RICH_DOC_MARKER}":`;

/** Cheap check usable on any string value (no JSON parse). */
export const isRichDocValue = (value: unknown): boolean =>
  typeof value === 'string' && value.startsWith(RICH_DOC_PREFIX);

export const createRichDoc = (paragraphs: RichParagraph[] = []): RichDoc => ({
  [RICH_DOC_MARKER]: RICH_DOC_VERSION,
  paragraphs,
});

export const serializeRichDoc = (doc: RichDoc): string =>
  JSON.stringify({ [RICH_DOC_MARKER]: RICH_DOC_VERSION, paragraphs: doc.paragraphs });

/** Parses a serialized document; plain strings become one paragraph per line. */
export const parseRichDoc = (value: string | undefined | null): RichDoc => {
  if (!value) return createRichDoc();
  if (isRichDocValue(value)) {
    try {
      const parsed = JSON.parse(value) as Partial<RichDoc>;
      if (Array.isArray(parsed.paragraphs)) {
        return createRichDoc(
          parsed.paragraphs.map((paragraph) => ({
            ...paragraph,
            runs: Array.isArray(paragraph?.runs) ? paragraph.runs : [],
          })),
        );
      }
    } catch {
      // Fall through: treat a corrupt document as plain text.
    }
  }
  return richDocFromPlainText(value);
};

export const richDocFromPlainText = (value: string): RichDoc =>
  createRichDoc(value.split(/\r\n|\r|\n/).map((line) => ({ runs: line ? [{ text: line }] : [] })));

export const richDocToPlainText = (doc: RichDoc): string =>
  doc.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');

/** Returns a copy with every run's text transformed (e.g. placeholder evaluation). */
export const mapRichDocText = (doc: RichDoc, transform: (text: string) => string): RichDoc =>
  createRichDoc(
    doc.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({ ...run, text: transform(run.text) })),
    })),
  );

/** Applies `transform` to run texts of a serialized rich document value. */
export const mapRichDocValueText = (value: string, transform: (text: string) => string): string =>
  serializeRichDoc(mapRichDocText(parseRichDoc(value), transform));
