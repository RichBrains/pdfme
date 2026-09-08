import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, vi } from 'vitest';
import type { Font as FontKitFont } from 'fontkit';
import { Font, getDefaultFont, mm2pt } from '@pdfme/common';
import type { BasePdf, PropPanelSchema, PropPanelWidgetProps } from '@pdfme/common';
import {
  calculateDynamicFontSize,
  getBrowserVerticalFontAdjustments,
  getFontDescentInPt,
  getFontKitFont,
  getSplittedLines,
  filterStartJP,
  filterEndJP,
  widthOfTextAtSize,
} from '../src/text/helper.js';
import {
  escapeInlineMarkdown,
  parseInlineMarkdown,
  stripInlineMarkdown,
} from '../src/text/inlineMarkdown.js';
import {
  calculateDynamicRichTextFontSize,
  getRichTextLineText,
  isInlineMarkdownTextSchema,
  layoutRichTextLines,
  resolveFontVariant,
  type ResolvedRichTextRun,
} from '../src/text/richText.js';
import {
  LINE_START_FORBIDDEN_CHARS,
  LINE_END_FORBIDDEN_CHARS,
  TEXT_OVERFLOW_EXPAND,
  TEXT_OVERFLOW_VISIBLE,
} from '../src/text/constants.js';
import { getDynamicLayoutForText } from '../src/text/dynamicTemplate.js';
import { mergeTextLineRangeValue } from '../src/text/measure.js';
import { shouldUseDynamicFontSize } from '../src/text/overflow.js';
import { splitTextToSize } from '../src/text/helper.js';
import { measureTextWidth } from '../src/text/measure.js';
import {
  getLineStartIndentMm,
  getLineWidthMm,
  getParagraphIndent,
  getParagraphLineStarts,
  hasParagraphIndent,
} from '../src/text/indent.js';
import {
  getAvailableTextWidth,
  getTextHeightMode,
  getTextWidthMode,
  resolveTextWidth,
} from '../src/text/sizing.js';
import { propPanel as textPropPanel } from '../src/text/propPanel.js';
import { getDynamicLayoutForMultiVariableText } from '../src/multiVariableText/dynamicTemplate.js';

import { FontWidthCalcValues, TextSchema } from '../src/text/types.js';
import type { MultiVariableTextSchema } from '../src/multiVariableText/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sansData = readFileSync(path.join(__dirname, `/assets/fonts/SauceHanSansJP.ttf`));
const serifData = readFileSync(path.join(__dirname, `/assets/fonts/SauceHanSerifJP.ttf`));

afterEach(() => {
  vi.unstubAllGlobals();
});

const createMockFont = (
  advanceWidth: number,
  hasGlyphForCodePoint = (_codePoint: number) => true,
) =>
  ({
    unitsPerEm: 1000,
    ascent: 800,
    descent: -200,
    bbox: { maxY: 800, minY: -200 },
    layout: (text: string) => ({
      glyphs: Array.from(text, () => ({ advanceWidth })),
    }),
    hasGlyphForCodePoint,
  }) as unknown as FontKitFont;

const getSampleFont = (): Font => ({
  SauceHanSansJP: { fallback: true, data: sansData },
  SauceHanSerifJP: { data: serifData },
});

const getTextSchema = () => {
  const textSchema: TextSchema = {
    name: 'test',
    type: 'text',
    content: 'test',
    position: { x: 0, y: 0 },
    width: 50,
    height: 20,
    alignment: 'left',
    verticalAlignment: 'top',
    fontColor: '#000000',
    backgroundColor: '#ffffff',
    lineHeight: 1,
    characterSpacing: 1,
    fontSize: 14,
  };
  return textSchema;
};

const getTextPropPanelSchema = ({
  basePdf,
  activeSchema,
}: {
  basePdf?: BasePdf;
  activeSchema?: Partial<TextSchema>;
} = {}) => {
  if (typeof textPropPanel.schema !== 'function') {
    throw new Error('Text propPanel schema should be a function.');
  }

  return textPropPanel.schema({
    activeSchema: {
      ...getTextSchema(),
      id: 'text-id',
      ...activeSchema,
    },
    activeElements: [],
    changeSchemas: () => undefined,
    schemas: [],
    basePdf,
    options: { font: getSampleFont() },
    theme: {},
    i18n: (key: string) => key,
  } as unknown as Omit<PropPanelWidgetProps, 'rootElement'>);
};

const getOverflowOptionValues = (schema: Record<string, PropPanelSchema>) => {
  const overflow = schema.overflow as PropPanelSchema & {
    props: { options: Array<{ value: string }> };
  };
  return overflow.props.options.map((option) => option.value);
};

describe('parseInlineMarkdown', () => {
  it('parses supported inline markdown styles', () => {
    const result = parseInlineMarkdown(
      'Hello **bold** and *italic* and ***both*** and ~~gone~~ and `code`',
    );

    expect(result).toEqual([
      { text: 'Hello ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'italic', italic: true },
      { text: ' and ' },
      { text: 'both', bold: true, italic: true },
      { text: ' and ' },
      { text: 'gone', strikethrough: true },
      { text: ' and ' },
      { text: 'code', code: true },
    ]);
  });

  it('keeps escaped and unmatched delimiters as text', () => {
    expect(parseInlineMarkdown('\\*\\*literal\\*\\* and **unclosed')).toEqual([
      { text: '**literal** and **unclosed' },
    ]);
  });

  it('strips inline markdown markers', () => {
    expect(stripInlineMarkdown('Hello **bold** and `code`')).toBe('Hello bold and code');
  });

  it('parses links as href runs while preserving nested style', () => {
    expect(parseInlineMarkdown('See [**pdfme** docs](https://pdfme.com/docs).')).toEqual([
      { text: 'See ' },
      { text: 'pdfme', bold: true, href: 'https://pdfme.com/docs' },
      { text: ' docs', href: 'https://pdfme.com/docs' },
      { text: '.' },
    ]);
    expect(stripInlineMarkdown('See [pdfme](https://pdfme.com).')).toBe('See pdfme.');
  });

  it('only parses safe link destinations', () => {
    expect(
      parseInlineMarkdown('[web](https://pdfme.com) [mail](mailto:hello@pdfme.com) [toc](#toc)'),
    ).toEqual([
      { text: 'web', href: 'https://pdfme.com' },
      { text: ' ' },
      { text: 'mail', href: 'mailto:hello@pdfme.com' },
      { text: ' ' },
      { text: 'toc', href: '#toc' },
    ]);
    expect(parseInlineMarkdown('[bad](javascript:alert(1)) [file](file:///tmp/a)')).toEqual([
      { text: '[bad](javascript:alert(1)) [file](file:///tmp/a)' },
    ]);
  });

  it('handles empty link labels and destinations explicitly', () => {
    expect(parseInlineMarkdown('Go [](https://pdfme.com).')).toEqual([{ text: 'Go .' }]);
    expect(parseInlineMarkdown('Go [empty]().')).toEqual([{ text: 'Go [empty]().' }]);
  });

  it('keeps escaped links as literal text', () => {
    const escaped = escapeInlineMarkdown('[pdfme](https://pdfme.com)');

    expect(escaped).toBe('\\[pdfme\\]\\(https://pdfme.com\\)');
    expect(parseInlineMarkdown(escaped)).toEqual([{ text: '[pdfme](https://pdfme.com)' }]);
  });

  it('escapes markdown markers for literal content', () => {
    const escaped = escapeInlineMarkdown('**literal** and `code` with \\');

    expect(escaped).toBe('\\*\\*literal\\*\\* and \\`code\\` with \\\\');
    expect(parseInlineMarkdown(`**${escaped}**`)).toEqual([
      { text: '**literal** and `code` with \\', bold: true },
    ]);
  });
});

describe('resolveFontVariant', () => {
  const font = {
    Base: { data: new Uint8Array(), fallback: true },
    Bold: { data: new Uint8Array() },
    Italic: { data: new Uint8Array() },
    BoldItalic: { data: new Uint8Array() },
    Mono: { data: new Uint8Array() },
  } as unknown as Font;

  it('uses loaded variant fonts when they are available', () => {
    const schema = {
      ...getTextSchema(),
      fontName: 'Base',
      fontVariants: { bold: 'Bold', italic: 'Italic', boldItalic: 'BoldItalic', code: 'Mono' },
    };

    expect(resolveFontVariant({ text: 'x', bold: true }, schema, font)).toEqual({
      fontName: 'Bold',
      syntheticBold: false,
      syntheticItalic: false,
    });
    expect(resolveFontVariant({ text: 'x', bold: true, italic: true }, schema, font)).toEqual({
      fontName: 'BoldItalic',
      syntheticBold: false,
      syntheticItalic: false,
    });
    expect(resolveFontVariant({ text: 'x', code: true }, schema, font)).toEqual({
      fontName: 'Mono',
      syntheticBold: false,
      syntheticItalic: false,
    });
  });

  it('falls back to synthetic styling when variant fonts are missing', () => {
    const schema = {
      ...getTextSchema(),
      fontName: 'Base',
      fontVariants: { bold: 'MissingBold', italic: 'Italic' },
    };

    expect(resolveFontVariant({ text: 'x', bold: true }, schema, font)).toEqual({
      fontName: 'Base',
      syntheticBold: true,
      syntheticItalic: false,
    });
    expect(resolveFontVariant({ text: 'x', bold: true, italic: true }, schema, font)).toEqual({
      fontName: 'Italic',
      syntheticBold: true,
      syntheticItalic: false,
    });
  });

  it('can disable synthetic fallback or throw on missing variants', () => {
    const plainSchema = { ...getTextSchema(), fontName: 'Base', fontVariantFallback: 'plain' };
    expect(resolveFontVariant({ text: 'x', bold: true }, plainSchema, font)).toEqual({
      fontName: 'Base',
      syntheticBold: false,
      syntheticItalic: false,
    });

    const errorSchema = { ...getTextSchema(), fontName: 'Base', fontVariantFallback: 'error' };
    expect(() => resolveFontVariant({ text: 'x', italic: true }, errorSchema, font)).toThrow(
      'Missing font variant',
    );
  });
});

describe('isInlineMarkdownTextSchema', () => {
  it('enables inline markdown for read-only text schemas only', () => {
    expect(
      isInlineMarkdownTextSchema({
        ...getTextSchema(),
        textFormat: 'inline-markdown',
        readOnly: true,
      }),
    ).toBe(true);

    expect(
      isInlineMarkdownTextSchema({
        ...getTextSchema(),
        textFormat: 'inline-markdown',
        readOnly: false,
      }),
    ).toBe(false);
  });

  it('keeps inline markdown available for multiVariableText schemas', () => {
    expect(
      isInlineMarkdownTextSchema({
        ...getTextSchema(),
        type: 'multiVariableText',
        textFormat: 'inline-markdown',
        readOnly: false,
      }),
    ).toBe(true);
  });
});

describe('text prop panel', () => {
  it('offers overflow expand for blank basePdf', () => {
    const schema = getTextPropPanelSchema({
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
    });

    expect(getOverflowOptionValues(schema)).toEqual([TEXT_OVERFLOW_VISIBLE, TEXT_OVERFLOW_EXPAND]);
  });

  it('offers overflow expand for custom basePdf', () => {
    // Height expansion is background independent: uploaded PDFs support it too.
    const schema = getTextPropPanelSchema({
      basePdf: 'data:application/pdf;base64,AA==' as BasePdf,
    });

    expect(getOverflowOptionValues(schema)).toEqual([TEXT_OVERFLOW_VISIBLE, TEXT_OVERFLOW_EXPAND]);
  });

  it('keeps overflow expand available for text-derived schemas that do not use text expand', () => {
    const schema = getTextPropPanelSchema({
      basePdf: 'data:application/pdf;base64,AA==' as BasePdf,
      activeSchema: { type: 'select' },
    });

    expect(getOverflowOptionValues(schema)).toEqual([TEXT_OVERFLOW_VISIBLE, TEXT_OVERFLOW_EXPAND]);
  });

  it('disables dynamic font size controls when custom basePdf uses overflow expand', () => {
    const schema = getTextPropPanelSchema({
      basePdf: 'data:application/pdf;base64,AA==' as BasePdf,
      activeSchema: {
        overflow: TEXT_OVERFLOW_EXPAND,
        dynamicFontSize: { min: 20, max: 30, fit: 'vertical' },
      },
    });
    const dynamicFontSize = schema.dynamicFontSize as PropPanelSchema;
    const minFontSize = dynamicFontSize.properties?.min;

    // Expansion owns the height, so shrink-to-fit is not applicable.
    expect(minFontSize?.hidden).toBe(true);
  });
});

describe('text dynamic layout', () => {
  const baseArgs = {
    basePdf: { width: 100, height: 100, padding: [10, 10, 10, 10] },
    options: { font: getSampleFont() },
    _cache: new Map<string | number, unknown>(),
  };

  it('keeps the schema height when text overflow is undefined', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights).toEqual([5]);
  });

  it('keeps the schema height when text overflow is visible', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
      overflow: 'visible',
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights).toEqual([5]);
  });

  it('expands text height when text overflow is expand', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
      overflow: 'expand',
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights.reduce((sum, height) => sum + height, 0)).toBeGreaterThan(5);
    expect(result.heights.length).toBeGreaterThan(1);
  });

  it('does not shrink text height when the measured height is smaller', async () => {
    const schema = {
      ...getTextSchema(),
      height: 40,
      width: 60,
      overflow: 'expand',
    } as TextSchema;

    const result = await getDynamicLayoutForText('short', {
      ...baseArgs,
      schema,
    });

    expect(result.heights).toEqual([40]);
  });

  it('lets overflow expand take priority over dynamic font size', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
      overflow: 'expand',
      dynamicFontSize: { min: 4, max: 20, fit: 'vertical' },
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights.reduce((sum, height) => sum + height, 0)).toBeGreaterThan(5);
    expect(
      result.patchSplitSchema?.({
        schema,
        start: 0,
        end: 1,
        isSplit: false,
        chunkHeight: result.heights[0],
      }),
    ).toMatchObject({
      dynamicFontSize: undefined,
      minHeight: 5,
      contentMinHeight: expect.any(Number),
      __splitRange: { unit: 'textLine', start: 0, end: 1 },
      __isSplit: false,
    });
  });

  it('patches expanded text chunks with line ranges', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
      overflow: 'expand',
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights.length).toBeGreaterThan(2);
    expect(
      result.patchSplitSchema?.({
        schema,
        start: 1,
        end: 3,
        isSplit: true,
        chunkHeight: result.heights[1] + result.heights[2],
      }),
    ).toMatchObject({
      dynamicFontSize: undefined,
      minHeight: 5,
      contentMinHeight: expect.any(Number),
      __splitRange: { unit: 'textLine', start: 1, end: 3 },
      __isSplit: true,
    });
  });

  it('keeps text box padding and borders on the visible edges of split chunks', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      width: 20,
      overflow: 'expand',
      borderColor: '#d0d7de',
      borderWidth: { top: 0.5, right: 0.2, bottom: 0.5, left: 0.2 },
      padding: { top: 2, right: 3, bottom: 2, left: 3 },
    } as TextSchema;

    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights.length).toBeGreaterThan(2);
    expect(
      result.patchSplitSchema?.({
        schema,
        start: 0,
        end: 1,
        isSplit: true,
        chunkHeight: result.heights[0],
      }),
    ).toMatchObject({
      borderWidth: { top: 0.5, right: 0.2, bottom: 0, left: 0.2 },
      padding: { top: 2, right: 3, bottom: 0, left: 3 },
    });
    expect(
      result.patchSplitSchema?.({
        schema,
        start: result.heights.length - 1,
        end: result.heights.length,
        isSplit: true,
        chunkHeight: result.heights[result.heights.length - 1],
      }),
    ).toMatchObject({
      borderWidth: { top: 0, right: 0.2, bottom: 0.5, left: 0.2 },
      padding: { top: 0, right: 3, bottom: 2, left: 3 },
    });
  });

  it('merges form edits from a split text line range into the full value', async () => {
    const schema = {
      ...getTextSchema(),
      width: 20,
      overflow: 'expand',
      __splitRange: { unit: 'textLine', start: 1, end: 3 },
    } as TextSchema;

    const result = await mergeTextLineRangeValue({
      value: 'long text '.repeat(8),
      replacement: 'edited one\r\nedited two\redited three\nedited four',
      schema,
      font: getSampleFont(),
      _cache: new Map<string | number, unknown>(),
    });

    expect(result).toContain('edited one\nedited two\nedited three\nedited four');
    expect(result).not.toBe('edited one\nedited two\nedited three\nedited four');
  });

  it('does not use dynamic font size while text overflow is expand', () => {
    expect(
      shouldUseDynamicFontSize({
        dynamicFontSize: { min: 20, max: 30, fit: 'vertical' },
        overflow: 'expand',
      }),
    ).toBe(false);
  });

  it('treats overflow expand as expanding for custom basePdf dynamic font sizing', () => {
    expect(
      shouldUseDynamicFontSize(
        {
          type: 'text',
          dynamicFontSize: { min: 20, max: 30, fit: 'vertical' },
          overflow: 'expand',
        },
        'data:application/pdf;base64,AA==' as BasePdf,
      ),
    ).toBe(false);
  });

  it('expands multiVariableText after substituting variables', async () => {
    const schema = {
      ...getTextSchema(),
      name: 'message',
      type: 'multiVariableText',
      height: 5,
      width: 20,
      overflow: 'expand',
      text: 'Hello {name}',
      variables: ['name'],
      required: true,
    } as MultiVariableTextSchema;

    const result = await getDynamicLayoutForMultiVariableText(
      JSON.stringify({ name: 'long text '.repeat(20) }),
      {
        ...baseArgs,
        schema,
      },
    );

    expect(result.heights[0]).toBeGreaterThan(5);
  });

  it('expands multiVariableText when optional variables are empty strings', async () => {
    const schema = {
      ...getTextSchema(),
      name: 'message',
      type: 'multiVariableText',
      height: 5,
      width: 20,
      overflow: 'expand',
      text: 'Title\n{name}\nFooter\nDone',
      variables: ['name'],
      required: false,
    } as MultiVariableTextSchema;

    const result = await getDynamicLayoutForMultiVariableText(JSON.stringify({ name: '' }), {
      ...baseArgs,
      schema,
    });

    expect(result.heights[0]).toBeGreaterThan(5);
  });

  it('expands read-only multiVariableText as resolved text', async () => {
    const schema = {
      ...getTextSchema(),
      name: 'message',
      type: 'multiVariableText',
      readOnly: true,
      height: 5,
      width: 20,
      overflow: 'expand',
      text: 'Hello {name}',
      variables: ['name'],
      required: true,
    } as MultiVariableTextSchema;

    const result = await getDynamicLayoutForMultiVariableText('Hello long text '.repeat(20), {
      ...baseArgs,
      schema,
    });

    expect(result.heights[0]).toBeGreaterThan(5);
  });
});

describe('layoutRichTextLines', () => {
  const fontKitFont = createMockFont(1000 / 12);

  const createRun = (
    text: string,
    options: Partial<ResolvedRichTextRun> = {},
  ): ResolvedRichTextRun => ({
    text,
    fontName: 'Base',
    fontKitFont,
    syntheticBold: false,
    syntheticItalic: false,
    ...options,
  });

  it('keeps a word together when style changes inside the word', () => {
    const lines = layoutRichTextLines({
      runs: [createRun('x he'), createRun('llo', { bold: true })],
      fontSize: 12,
      characterSpacing: 0,
      boxWidthInPt: 6,
    });

    expect(lines.map(getRichTextLineText)).toEqual(['x ', 'hello']);
    expect(lines[1].runs.map((run) => run.text)).toEqual(['he', 'llo']);
  });

  it('wraps before splitting an oversized token at the end of a line', () => {
    const lines = layoutRichTextLines({
      runs: [createRun('abc '), createRun('123456', { code: true })],
      fontSize: 12,
      characterSpacing: 0,
      boxWidthInPt: 7,
    });

    expect(lines.map(getRichTextLineText)).toEqual(['abc ', '1234', '56']);
  });
});

describe('calculateDynamicRichTextFontSize', () => {
  it('measures inline markdown text with resolved variant fonts', async () => {
    const baseFont = createMockFont(500);
    const boldFont = createMockFont(1000);
    const font = {
      Base: { data: new Uint8Array(), fallback: true },
      Bold: { data: new Uint8Array() },
    } as Font;
    const cache = new Map<string | number, FontKitFont>([
      ['getFontKitFont-Base', baseFont],
      ['getFontKitFont-Bold', boldFont],
    ]);
    const schema: TextSchema = {
      ...getTextSchema(),
      fontName: 'Base',
      width: 10,
      height: 20,
      characterSpacing: 0,
      fontSize: 20,
      textFormat: 'inline-markdown',
      readOnly: true,
      fontVariants: { bold: 'Bold' },
      dynamicFontSize: { min: 4, max: 20, fit: 'horizontal' },
    };

    const fontSize = await calculateDynamicRichTextFontSize({
      value: '**abcdef**',
      schema,
      font,
      _cache: cache,
    });

    expect(widthOfTextAtSize('abcdef', boldFont, fontSize, 0)).toBeLessThanOrEqual(
      mm2pt(schema.width),
    );
    expect(fontSize).toBeLessThan(
      calculateDynamicFontSize({
        textSchema: schema,
        fontKitFont: baseFont,
        value: 'abcdef',
      }),
    );
  });
});

describe('getSplitPosition test with mocked font width calculations', () => {
  /**
   * To simplify these tests we use a mocked font where each glyph has width 1.
   * Therefore, setting the boxWidthInPt to 5 should result in a split after 5 characters.
   */
  const mockedAdvanceWidth = 1000 / 12;
  const mockedFont = {
    unitsPerEm: 1000,
    layout: (text: string) => ({
      glyphs: Array.from(text, () => ({ advanceWidth: mockedAdvanceWidth })),
    }),
  } as unknown as FontKitFont;
  const mockCalcValues: FontWidthCalcValues = {
    font: mockedFont,
    fontSize: 12,
    characterSpacing: 0,
    boxWidthInPt: 5,
  };

  it('does not split an empty string', () => {
    expect(getSplittedLines('', mockCalcValues)).toEqual(['']);
  });

  it('does not split a short line', () => {
    expect(getSplittedLines('a', mockCalcValues)).toEqual(['a']);
    expect(getSplittedLines('aaaa', mockCalcValues)).toEqual(['aaaa']);
  });

  it('splits a line to the nearest previous breakable char', () => {
    expect(getSplittedLines('aaa bbb', mockCalcValues)).toEqual(['aaa', 'bbb']);
    expect(getSplittedLines('top-hat', mockCalcValues)).toEqual(['top-', 'hat']);
    expect(getSplittedLines('top—hat', mockCalcValues)).toEqual(['top—', 'hat']); // em dash
    expect(getSplittedLines('top–hat', mockCalcValues)).toEqual(['top–', 'hat']); // en dash
  });

  it('splits a line where the split point is on a breakable char', () => {
    expect(getSplittedLines('aaaaa bbbbb', mockCalcValues)).toEqual(['aaaaa', 'bbbbb']);
    expect(getSplittedLines('left-hand', mockCalcValues)).toEqual(['left-', 'hand']);
  });

  it('splits a long line in the middle of a word if too long', () => {
    expect(getSplittedLines('aaaaaa bbb', mockCalcValues)).toEqual(['aaaaa', 'a bbb']);
    expect(getSplittedLines('aaaaaa-a b', mockCalcValues)).toEqual(['aaaaa', 'a-a b']);
    expect(getSplittedLines('aaaaa-aa b', mockCalcValues)).toEqual(['aaaaa', '-aa b']);
  });

  it('splits a long line without breakable chars at exactly 5 chars', () => {
    expect(getSplittedLines('abcdef', mockCalcValues)).toEqual(['abcde', 'f']);
  });

  it('splits a very long line without breakable chars at exactly 5 chars', () => {
    expect(getSplittedLines('abcdefghijklmn', mockCalcValues)).toEqual(['abcde', 'fghij', 'klmn']);
  });

  it('splits a line with lots of words', () => {
    expect(getSplittedLines('a b c d e', mockCalcValues)).toEqual(['a b c', 'd e']);
  });
});

describe('getSplittedLines test with real font width calculations', () => {
  const font = getDefaultFont();
  const baseCalcValues = {
    fontSize: 12,
    characterSpacing: 1,
    boxWidthInPt: 40,
  };

  it('should not split a line when the text is shorter than the width', async () => {
    const _cache = new Map();
    await getFontKitFont(getTextSchema().fontName, font, _cache).then((fontKitFont) => {
      const fontWidthCalcs = Object.assign({}, baseCalcValues, { font: fontKitFont });
      const result = getSplittedLines('short', fontWidthCalcs);
      expect(result).toEqual(['short']);
    });
  });

  it('should split a line when the text is longer than the width', async () => {
    const _cache = new Map();
    await getFontKitFont(getTextSchema().fontName, font, _cache).then((fontKitFont) => {
      const fontWidthCalcs = Object.assign({}, baseCalcValues, { font: fontKitFont });
      const result = getSplittedLines('this will wrap', fontWidthCalcs);
      expect(result).toEqual(['this', 'will', 'wrap']);
    });
  });

  it('should split a line in the middle when unspaced text will not fit on a line', async () => {
    const _cache = new Map();
    await getFontKitFont(getTextSchema().fontName, font, _cache).then((fontKitFont) => {
      const fontWidthCalcs = Object.assign({}, baseCalcValues, { font: fontKitFont });
      const result = getSplittedLines('thiswillbecut', fontWidthCalcs);
      expect(result).toEqual(['thiswi', 'llbecu', 't']);
    });
  });

  it('should not split text when it is impossible due to size constraints', async () => {
    const _cache = new Map();
    await getFontKitFont(getTextSchema().fontName, font, _cache).then((fontKitFont) => {
      const fontWidthCalcs = Object.assign({}, baseCalcValues, { font: fontKitFont });
      fontWidthCalcs.boxWidthInPt = 2;
      const result = getSplittedLines('thiswillnotbecut', fontWidthCalcs);
      expect(result).toEqual(['thiswillnotbecut']);
    });
  });
});

describe('getFontKitFont remote font cache', () => {
  const font: Font = {
    RemoteSans: {
      fallback: true,
      data: 'https://example.com/fonts/remote-sans.ttf',
    },
  };
  const createFontResponse = (init?: ResponseInit) => new Response(new Uint8Array(sansData), init);

  it('shares an in-flight remote font load across concurrent calls', async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return createFontResponse();
    });
    vi.stubGlobal('fetch', fetchMock);

    const _cache = new Map();
    const fontKitFonts = await Promise.all(
      Array.from({ length: 20 }, () => getFontKitFont('RemoteSans', font, _cache)),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(fontKitFonts).size).toBe(1);

    const cachedFont = await getFontKitFont('RemoteSans', font, _cache);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cachedFont).toBe(fontKitFonts[0]);
  });

  it('clears a failed in-flight remote font load so it can be retried', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createFontResponse({ status: 500 }))
      .mockResolvedValueOnce(createFontResponse());
    vi.stubGlobal('fetch', fetchMock);

    const _cache = new Map();
    await expect(
      Promise.all([
        getFontKitFont('RemoteSans', font, _cache),
        getFontKitFont('RemoteSans', font, _cache),
      ]),
    ).rejects.toThrow('HTTP 500');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(_cache.size).toBe(0);

    await expect(getFontKitFont('RemoteSans', font, _cache)).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(_cache.size).toBe(1);
  });
});

describe('calculateDynamicFontSize with Default font', () => {
  let fontKitFont: FontKitFont;

  beforeAll(async () => {
    fontKitFont = await getFontKitFont('SauceHanSansJP', getDefaultFont(), new Map());
  });

  it('should return default font size when dynamicFontSizeSetting is not provided', async () => {
    const textSchema = getTextSchema();
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value: 'test' });

    expect(result).toBe(14);
  });

  it('should return default font size when dynamicFontSizeSetting max is less than min', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 11, max: 10, fit: 'vertical' };
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value: 'test' });

    expect(result).toBe(14);
  });

  it('should calculate a dynamic font size of vertical fit between min and max', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(19.25);
  });

  it('should calculate a dynamic font size of horizontal fit between min and max', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'horizontal' };
    const value = 'test with a length string\n and a new line';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(11.25);
  });

  it('should calculate a dynamic font size between min and max regardless of current font size', async () => {
    const textSchema = getTextSchema();
    textSchema.fontSize = 2;
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    let result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(19.25);

    textSchema.fontSize = 40;
    result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(19.25);
  });

  it('should return min font size when content is too big to fit given constraints', async () => {
    const textSchema = getTextSchema();
    textSchema.width = 10;
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(10);
  });

  it('should return max font size when content is too small to fit given constraints', async () => {
    const textSchema = getTextSchema();
    textSchema.width = 1000;
    textSchema.height = 200;
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(30);
  });

  it('should not reduce font size below 0', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: -5, max: 10, fit: 'vertical' };
    textSchema.width = 4;
    textSchema.height = 1;
    const value = 'a very \nlong \nmulti-line \nstring\nto';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBeGreaterThan(0);
  });

  it('should calculate a dynamic font size when a starting font size is passed that is lower than the eventual', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    const startingFontSize = 18;
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value, startingFontSize });

    expect(result).toBe(19.25);
  });

  it('should calculate a dynamic font size when a starting font size is passed that is higher than the eventual', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'horizontal' };
    const value = 'test with a length string\n and a new line';
    const startingFontSize = 36;
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value, startingFontSize });

    expect(result).toBe(11.25);
  });

  it('should calculate a dynamic font size using vertical fit as a default if no fit provided', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'test with a length string\n and a new line';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(19.25);
  });
});

describe('calculateDynamicFontSize with Custom font', () => {
  let fontKitFont: FontKitFont;
  beforeAll(async () => {
    fontKitFont = await getFontKitFont('SauceHanSansJP', getSampleFont(), new Map());
  });

  it('should return smaller font size when dynamicFontSizeSetting is provided with horizontal fit', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'horizontal' };
    const value = 'あいうあいうあい';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(16.75);
  });

  it('should return smaller font size when dynamicFontSizeSetting is provided with vertical fit', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'あいうあいうあい';
    const result = calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(26);
  });

  it('should return min font size when content is too big to fit given constraints', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 20, max: 30, fit: 'vertical' };
    const value = 'あいうあいうあいうあいうあいうあいうあいうあいうあいう';
    const result = await calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(20);
  });

  it('should return max font size when content is too small to fit given constraints', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 10, max: 30, fit: 'vertical' };
    const value = 'あ';
    const result = await calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(30);
  });

  it('should return min font size when content is multi-line with too many lines for the container', async () => {
    const textSchema = getTextSchema();
    textSchema.dynamicFontSize = { min: 5, max: 20, fit: 'vertical' };
    const value = 'あ\nいう\nあ\nいう\nあ\nいう\nあ\nいう\nあ\nいう\nあ\nいう';
    const result = await calculateDynamicFontSize({ textSchema, fontKitFont, value });

    expect(result).toBe(5);
  });
});

describe('getFontDescentInPt test', () => {
  test('it gets a descent size relative to the font size', () => {
    expect(getFontDescentInPt({ descent: -400, unitsPerEm: 1000 } as FontKitFont, 12)).toBe(
      -4.800000000000001,
    );
    expect(getFontDescentInPt({ descent: 54, unitsPerEm: 1000 } as FontKitFont, 20)).toBe(1.08);
    expect(getFontDescentInPt({ descent: -512, unitsPerEm: 2048 } as FontKitFont, 54)).toBe(-13.5);
  });
});

describe('getBrowserVerticalFontAdjustments test', () => {
  // Font with a base line-height of 1.349
  const font = { ascent: 1037, descent: -312, unitsPerEm: 1000 } as FontKitFont;

  test('it gets a top adjustment when vertically aligning top', () => {
    expect(getBrowserVerticalFontAdjustments(font, 12, 1.0, 'top')).toEqual({
      topAdj: 2.791301999999999,
      bottomAdj: 0,
    });
    expect(getBrowserVerticalFontAdjustments(font, 36, 2.0, 'top')).toEqual({
      topAdj: 8.373906,
      bottomAdj: 0,
    });
  });

  test('it gets a bottom adjustment when vertically aligning middle or bottom', () => {
    expect(getBrowserVerticalFontAdjustments(font, 12, 1.0, 'bottom')).toEqual({
      topAdj: 0,
      bottomAdj: 2.791302,
    });
    expect(getBrowserVerticalFontAdjustments(font, 12, 1.15, 'middle')).toEqual({
      topAdj: 0,
      bottomAdj: 1.5916020000000004,
    });
  });

  test('it does not get a bottom adjustment if the line height exceeds that of the font', () => {
    expect(getBrowserVerticalFontAdjustments(font, 12, 1.35, 'bottom')).toEqual({
      topAdj: 0,
      bottomAdj: 0,
    });
  });

  test('it does not get a bottom adjustment if the font base line-height is 1.0 or less', () => {
    const thisFont = { ascent: 900, descent: -50, unitsPerEm: 1000 } as FontKitFont;
    expect(getBrowserVerticalFontAdjustments(thisFont, 20, 1.0, 'bottom')).toEqual({
      topAdj: 0,
      bottomAdj: 0,
    });
  });
});

describe('filterStartJP', () => {
  test('空の配列を渡すと空の配列を返す', () => {
    expect(filterStartJP([])).toEqual([]);
  });

  test('禁則文字を含まない行はそのまま返す', () => {
    const input = ['これは', '普通の', '文章です。'];
    expect(filterStartJP(input)).toEqual(input);
  });

  test('行頭の禁則文字を前の行の末尾に移動する', () => {
    const input = ['これは', '。文章', 'です'];
    const expected = ['これは。', '文章', 'です'];
    expect(filterStartJP(input)).toEqual(expected);
  });

  test('複数の禁則文字を正しく処理する', () => {
    const input = ['これは', '。とても', '、長い', '」文章', 'です'];
    const expected = ['これは。', 'とても、', '長い」', '文章', 'です'];
    expect(filterStartJP(input)).toEqual(expected);
  });

  test('空の行を保持する', () => {
    const input = ['これは', '', '。文章', 'です'];
    const expected = ['これは。', '', '文章', 'です'];
    expect(filterStartJP(input)).toEqual(expected);
  });

  test('1文字の行（禁則文字のみ）はそのまま保持する', () => {
    const input = ['これは', '。', '文章', 'です'];
    // const expected = ['これは。', '文章', 'です'];
    const expected = ['これは', '。', '文章', 'です'];
    expect(filterStartJP(input)).toEqual(expected);
  });

  test('すべての禁則文字を正しく処理する', () => {
    const input = LINE_START_FORBIDDEN_CHARS.map((char: string) => ['この', char + '文字']).flat();
    const expected = LINE_START_FORBIDDEN_CHARS.map((char: string) => [
      'この' + char,
      '文字',
    ]).flat();
    expect(filterStartJP(input)).toEqual(expected);
  });
});

describe('filterEndJP', () => {
  test('空の配列を渡すと空の配列を返す', () => {
    expect(filterEndJP([])).toEqual([]);
  });

  test('禁則文字を含まない行はそのまま返す', () => {
    const input = ['これは', '普通の', '文章です。'];
    expect(filterEndJP(input)).toEqual(input);
  });

  test('行末の禁則文字を次の行の先頭に移動する', () => {
    const input = ['これは「', '文章', 'です。'];
    const expected = ['これは', '「文章', 'です。'];
    expect(filterEndJP(input)).toEqual(expected);
  });

  test('複数の禁則文字を正しく処理する', () => {
    const input = ['これは「', '長い『', '文章（', 'です。'];
    const expected = ['これは', '「長い', '『文章', '（です。'];
    expect(filterEndJP(input)).toEqual(expected);
  });

  // Cant understand purpose of this test...
  // test('空の行を保持する', () => {
  //   const input = ['これは「', '', '文章', 'です。'];
  //   const expected = ['これは', '「', '', '文章', 'です。'];
  //   expect(filterEndJP(input)).toEqual(expected);
  // });

  test('1文字の行（禁則文字のみ）はそのまま保持する', () => {
    const input = ['これは', '「', '文章', 'です。'];
    const expected = ['これは', '「', '文章', 'です。'];
    expect(filterEndJP(input)).toEqual(expected);
  });

  test('すべての禁則文字を正しく処理する', () => {
    const input = LINE_END_FORBIDDEN_CHARS.map((char: string) => ['これは' + char, '文章']).flat();
    const expected = LINE_END_FORBIDDEN_CHARS.map((char: string) => [
      'これは',
      char + '文章',
    ]).flat();
    expect(filterEndJP(input)).toEqual(expected);
  });

  test('最後の行の禁則文字は移動しない', () => {
    const input = ['これは「', '文章「', 'です「'];
    const expected = ['これは', '「文章', '「です「'];
    expect(filterEndJP(input)).toEqual(expected);
  });
});

describe('paragraph indentation', () => {
  it('defaults to no indentation', () => {
    const indent = getParagraphIndent(getTextSchema());

    expect(indent).toEqual({ left: 0, right: 0, mode: 'none', special: 0 });
    expect(hasParagraphIndent(indent)).toBe(false);
  });

  it('offsets only the first line for a first-line indent', () => {
    const indent = getParagraphIndent({
      leftIndent: 5,
      indentMode: 'firstLine',
      specialIndent: 10,
    });

    expect(getLineStartIndentMm(indent, true)).toBe(15);
    expect(getLineStartIndentMm(indent, false)).toBe(5);
  });

  it('offsets only the wrapped lines for a hanging indent', () => {
    const indent = getParagraphIndent({ leftIndent: 5, indentMode: 'hanging', specialIndent: 10 });

    expect(getLineStartIndentMm(indent, true)).toBe(5);
    expect(getLineStartIndentMm(indent, false)).toBe(15);
  });

  it('supports a negative first-line offset (outdent)', () => {
    const indent = getParagraphIndent({
      leftIndent: 10,
      indentMode: 'firstLine',
      specialIndent: -5,
    });

    expect(getLineStartIndentMm(indent, true)).toBe(5);
    expect(getLineStartIndentMm(indent, false)).toBe(10);
  });

  it('reduces the usable line width by both indents', () => {
    const indent = getParagraphIndent({
      leftIndent: 10,
      rightIndent: 5,
      indentMode: 'firstLine',
      specialIndent: 10,
    });

    expect(getLineWidthMm(indent, 100, true)).toBe(75);
    expect(getLineWidthMm(indent, 100, false)).toBe(85);
    expect(getLineWidthMm(indent, 5, true)).toBe(0);
  });

  it('marks paragraph starts from the line splitter output', () => {
    expect(getParagraphLineStarts(['first', 'wrapped\n', 'second\n'])).toEqual([true, false, true]);
  });

  it('wraps the first line earlier when a first-line indent is set', async () => {
    const fontKitFont = await getFontKitFont(undefined, getSampleFont(), new Map());
    const args = {
      value: 'one two three four five six seven eight nine ten',
      characterSpacing: 0,
      fontSize: 12,
      fontKitFont,
      boxWidthInPt: mm2pt(50),
    };

    const plain = splitTextToSize(args);
    const indented = splitTextToSize({
      ...args,
      paragraphIndent: { left: 0, right: 0, mode: 'firstLine', special: 20 },
    });

    expect(indented[0].length).toBeLessThan(plain[0].length);
    // Wrapped lines keep the full width, so only the first line is narrower.
    expect(indented.join(' ').replace(/\s+/g, ' ').trim()).toContain('one two');
  });

  it('wraps wrapped lines earlier when a hanging indent is set', async () => {
    const fontKitFont = await getFontKitFont(undefined, getSampleFont(), new Map());
    const args = {
      value: 'one two three four five six seven eight nine ten',
      characterSpacing: 0,
      fontSize: 12,
      fontKitFont,
      boxWidthInPt: mm2pt(50),
    };

    const plain = splitTextToSize(args);
    const hanging = splitTextToSize({
      ...args,
      paragraphIndent: { left: 0, right: 0, mode: 'hanging', special: 20 },
    });

    expect(hanging[0]).toBe(plain[0]);
    expect(hanging.length).toBeGreaterThanOrEqual(plain.length);
  });
});

describe('text sizing modes', () => {
  const pageSize = { width: 100, height: 100 };
  const margins = { top: 10, right: 10, bottom: 10, left: 10 };

  it('derives the height mode from the legacy overflow flag', () => {
    expect(getTextHeightMode({ overflow: TEXT_OVERFLOW_EXPAND })).toBe('auto');
    expect(getTextHeightMode({ overflow: TEXT_OVERFLOW_VISIBLE })).toBe('fixed');
    expect(getTextHeightMode({ heightMode: 'auto', overflow: TEXT_OVERFLOW_VISIBLE })).toBe('auto');
  });

  it('defaults the width mode to fixed', () => {
    expect(getTextWidthMode(getTextSchema())).toBe('fixed');
  });

  it('stops available width at the page margin by default', () => {
    const schema = { ...getTextSchema(), position: { x: 20, y: 0 } };

    expect(getAvailableTextWidth(schema, { pageSize, margins })).toBe(70);
  });

  it('stops available width at the page edge when requested', () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 20, y: 0 },
      expansionBoundary: 'page' as const,
    };

    expect(getAvailableTextWidth(schema, { pageSize, margins })).toBe(80);
  });

  it('stops available width at another field resolved by stable id', () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 20, y: 0 },
      height: 10,
      expansionBoundary: 'field' as const,
      boundarySchemaId: 'stopper-id',
    };

    expect(
      getAvailableTextWidth(schema, {
        pageSize,
        margins,
        siblings: [
          {
            layoutId: 'stopper-id',
            name: 'renamed later',
            position: { x: 60, y: 0 },
            width: 10,
            height: 10,
          },
        ],
      }),
    ).toBe(40);
  });

  it('ignores a boundary field that does not share the active row', () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 20, y: 0 },
      height: 10,
      expansionBoundary: 'field' as const,
      boundarySchemaId: 'footer-id',
    };

    expect(
      getAvailableTextWidth(schema, {
        pageSize,
        margins,
        siblings: [
          {
            layoutId: 'footer-id',
            name: 'footer',
            position: { x: 60, y: 200 },
            width: 10,
            height: 10,
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('ignores a boundary field positioned to the left of the active field', () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 60, y: 0 },
      height: 10,
      expansionBoundary: 'field' as const,
      boundarySchemaId: 'left-id',
    };

    expect(
      getAvailableTextWidth(schema, {
        pageSize,
        margins,
        siblings: [
          { layoutId: 'left-id', name: 'left', position: { x: 10, y: 0 }, width: 10, height: 10 },
        ],
      }),
    ).toBeUndefined();
  });

  it('still resolves legacy name-based boundary references', () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 20, y: 0 },
      height: 10,
      expansionBoundary: 'field' as const,
      boundarySchemaName: 'stopper',
    };

    expect(
      getAvailableTextWidth(schema, {
        pageSize,
        margins,
        siblings: [{ name: 'stopper', position: { x: 60, y: 0 }, width: 10, height: 10 }],
      }),
    ).toBe(40);
  });

  it('contracts auto-height text back to its minimum height', async () => {
    const schema = {
      ...getTextSchema(),
      height: 40,
      minHeight: 5,
      width: 60,
      overflow: 'expand' as const,
    };

    const result = await getDynamicLayoutForText('one line', {
      schema,
      basePdf: { width: 100, height: 100, padding: [0, 0, 0, 0] },
      options: { font: getSampleFont() },
      _cache: new Map<string | number, unknown>(),
    });

    expect(result.heights).toHaveLength(1);
    expect(result.heights[0]).toBeLessThan(40);
    expect(result.heights[0]).toBeGreaterThanOrEqual(5);
  });

  it('persists the current content minimum height separately from the authored minimum', async () => {
    const schema = {
      ...getTextSchema(),
      height: 5,
      minHeight: 5,
      width: 20,
      overflow: 'expand' as const,
    };
    const result = await getDynamicLayoutForText('long text '.repeat(20), {
      schema,
      basePdf: { width: 100, height: 100, padding: [0, 0, 0, 0] },
      options: { font: getSampleFont() },
      _cache: new Map<string | number, unknown>(),
    });
    const patch = result.patchSplitSchema?.({
      schema,
      start: 0,
      end: 1,
      isSplit: false,
      chunkHeight: result.heights[0],
    });

    expect(patch?.minHeight).toBe(5);
    expect(patch?.contentMinHeight).toBeGreaterThan(5);
  });

  it('passes same-page siblings into the boundary context', async () => {
    const schema = {
      ...getTextSchema(),
      position: { x: 10, y: 0 },
      width: 10,
      height: 10,
      widthMode: 'fill' as const,
      expansionBoundary: 'field' as const,
      boundarySchemaId: 'stopper-id',
    };

    const result = await getDynamicLayoutForText('hello', {
      schema,
      basePdf: { width: 100, height: 100, padding: [0, 0, 0, 0] },
      options: { font: getSampleFont() },
      _cache: new Map<string | number, unknown>(),
      pageSize: { width: 100, height: 100 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      siblings: [
        {
          layoutId: 'stopper-id',
          name: 'stopper',
          type: 'text',
          position: { x: 40, y: 0 },
          width: 10,
          height: 10,
        },
      ],
    });

    expect(
      result.patchSplitSchema?.({ schema, start: 0, end: 1, isSplit: false, chunkHeight: 10 }),
    ).toMatchObject({ width: 30 });
  });

  it('does not constrain manual or overlapping fields', () => {
    const base = { ...getTextSchema(), position: { x: 20, y: 0 } };

    expect(
      getAvailableTextWidth({ ...base, expansionBoundary: 'manual' }, { pageSize, margins }),
    ).toBeUndefined();
    expect(
      getAvailableTextWidth({ ...base, expansionBoundary: 'allow-overlap' }, { pageSize, margins }),
    ).toBeUndefined();
  });

  it('keeps the authored width for fixed-width text', async () => {
    const schema = { ...getTextSchema(), width: 30 };

    await expect(
      resolveTextWidth({
        value: 'a very long value that would not fit',
        schema,
        context: { pageSize, margins },
        font: getSampleFont(),
      }),
    ).resolves.toBe(30);
  });

  it('fills the available width for fill-width text', async () => {
    const schema = {
      ...getTextSchema(),
      width: 10,
      position: { x: 20, y: 0 },
      widthMode: 'fill' as const,
    };

    await expect(
      resolveTextWidth({
        value: 'short',
        schema,
        context: { pageSize, margins },
        font: getSampleFont(),
      }),
    ).resolves.toBe(70);
  });

  it('grows auto-width text up to the boundary only', async () => {
    const schema = {
      ...getTextSchema(),
      width: 10,
      position: { x: 20, y: 0 },
      widthMode: 'auto' as const,
    };

    const width = await resolveTextWidth({
      value: 'text '.repeat(200),
      schema,
      context: { pageSize, margins },
      font: getSampleFont(),
    });

    expect(width).toBe(70);
  });

  it('measures the natural width of the widest paragraph', async () => {
    const schema = { ...getTextSchema(), width: 10 };
    const narrow = await measureTextWidth({ value: 'ab', schema, font: getSampleFont() });
    const wide = await measureTextWidth({
      value: 'ab\nabcdefghij',
      schema,
      font: getSampleFont(),
    });

    expect(wide).toBeGreaterThan(narrow);
  });
});
