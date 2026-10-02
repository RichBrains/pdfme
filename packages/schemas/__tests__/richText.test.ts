import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  createRichDoc,
  getDefaultFont,
  isRichDocValue,
  parseRichDoc,
  replacePlaceholders,
  richDocFromPlainText,
  richDocToPlainText,
  serializeRichDoc,
  type Font,
  type RichParagraph,
} from '@pdfme/common';
import { computeListMarkers, formatListMarker, layoutRichDoc } from '../src/richText/layout.js';
import { getRichLayout, isRichTextSchema } from '../src/richText/index.js';
import { measureTextLines } from '../src/text/measure.js';
import type { TextSchema } from '../src/text/types.js';

const sansData = readFileSync(path.join(__dirname, '/assets/fonts/SauceHanSansJP.ttf'));
const serifData = readFileSync(path.join(__dirname, '/assets/fonts/SauceHanSerifJP.ttf'));

const baseSchema = (overrides: Partial<TextSchema> = {}): TextSchema =>
  ({
    name: 'body',
    type: 'text',
    position: { x: 0, y: 0 },
    width: 100,
    height: 20,
    fontSize: 10,
    lineHeight: 1,
    characterSpacing: 0,
    alignment: 'left',
    verticalAlignment: 'top',
    fontColor: '#000000',
    backgroundColor: '',
    textFormat: 'rich',
    ...overrides,
  }) as TextSchema;

const doc = (...paragraphs: RichParagraph[]) => serializeRichDoc(createRichDoc(paragraphs));

const LOREM =
  'Für das Vertragsverhältnis zwischen der Berlin School of Business and Innovation GmbH und dem Studierenden gelten die nachfolgenden Allgemeinen Studienbedingungen wie folgt.';

describe('rich document model', () => {
  test('serializes with a detectable marker and round-trips', () => {
    const value = doc({ runs: [{ text: 'Hello', bold: true }] });
    expect(isRichDocValue(value)).toBe(true);
    expect(isRichDocValue('{__FIRSTNAME__}')).toBe(false);
    expect(parseRichDoc(value).paragraphs[0].runs[0]).toEqual({ text: 'Hello', bold: true });
  });

  test('treats plain strings as one paragraph per line', () => {
    expect(richDocToPlainText(parseRichDoc('a\nb'))).toBe('a\nb');
    expect(richDocFromPlainText('x\n\ny').paragraphs).toHaveLength(3);
  });

  test('evaluates merge fields per run without corrupting JSON or formatting', () => {
    const value = doc({
      runs: [
        { text: 'Dear ', bold: false },
        { text: '{__FIRSTNAME__}', bold: true },
        { text: ', welcome.' },
      ],
    });
    const result = replacePlaceholders({
      content: value,
      // Values that look like markup or JSON must stay literal text.
      variables: { __FIRSTNAME__: '**Ann** "}{' },
      schemas: [],
    });
    const parsed = parseRichDoc(result);
    expect(parsed.paragraphs[0].runs.map((run) => run.text)).toEqual([
      'Dear ',
      '**Ann** "}{',
      ', welcome.',
    ]);
    expect(parsed.paragraphs[0].runs[1].bold).toBe(true);
  });

  test('isRichTextSchema detects the format flag or a rich value', () => {
    expect(isRichTextSchema({ textFormat: 'rich' })).toBe(true);
    expect(isRichTextSchema({ textFormat: 'plain' }, doc({ runs: [] }))).toBe(true);
    expect(isRichTextSchema({ textFormat: 'plain' }, 'plain text')).toBe(false);
  });
});

describe('list markers', () => {
  test('formats Word-style numbering', () => {
    expect(formatListMarker('decimal', 3, 0)).toBe('3.');
    expect(formatListMarker('lowerLetter', 2, 0)).toBe('b)');
    expect(formatListMarker('lowerLetter', 27, 0)).toBe('aa)');
    expect(formatListMarker('upperRoman', 4, 0)).toBe('IV.');
    expect(formatListMarker('lowerRoman', 9, 0)).toBe('ix.');
    expect(formatListMarker('bullet', 1, 1)).toBe('◦');
  });

  test('counts per level, resets deeper levels, honours restart and explicit markers', () => {
    const markers = computeListMarkers([
      { runs: [], list: { format: 'decimal' } },
      { runs: [], list: { format: 'lowerLetter', level: 1 } },
      { runs: [], list: { format: 'lowerLetter', level: 1 } },
      { runs: [] },
      { runs: [], list: { format: 'decimal' } },
      { runs: [], list: { format: 'lowerLetter', level: 1 } },
      { runs: [], list: { format: 'decimal', restart: true } },
      { runs: [], list: { format: 'decimal', marker: '§ 7' } },
    ]);
    expect(markers).toEqual(['1.', 'a)', 'b)', undefined, '2.', 'a)', '1.', '§ 7']);
  });
});

describe('rich layout', () => {
  const font: Font = getDefaultFont();

  test('wraps long paragraphs into several line units', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(doc({ runs: [{ text: LOREM }] })),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 40,
    });
    expect(layout.lines.length).toBeGreaterThan(3);
    for (const line of layout.lines) {
      const end = Math.max(...line.items.map((item) => item.x + item.width));
      // 40mm ≈ 113.4pt
      expect(end).toBeLessThanOrEqual(113.4 + 0.01);
    }
  });

  test('justifies every line except the last of a paragraph', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(doc({ align: 'justify', runs: [{ text: LOREM }] })),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 50,
    });
    const ends = layout.lines.map((line) => Math.max(...line.items.map((i) => i.x + i.width)));
    const fullWidth = (50 * 72) / 25.4;
    ends.slice(0, -1).forEach((end) => expect(end).toBeCloseTo(fullWidth, 1));
    expect(ends[ends.length - 1]).toBeLessThan(fullWidth - 1);
  });

  test('centers and right-aligns per paragraph', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(
        doc(
          { align: 'center', runs: [{ text: 'Hi' }] },
          { align: 'right', runs: [{ text: 'Hi' }] },
        ),
      ),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 50,
    });
    const [center, right] = layout.lines;
    const fullWidth = (50 * 72) / 25.4;
    expect(center.items[0].x).toBeCloseTo((fullWidth - center.items[0].width) / 2, 1);
    expect(right.items[0].x + right.items[0].width).toBeCloseTo(fullWidth, 1);
  });

  test('places list markers in the hanging indent and wraps under the text', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(doc({ list: { format: 'decimal' }, runs: [{ text: LOREM }] })),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 50,
    });
    const [first, second] = layout.lines;
    expect(first.items[0].text).toBe('1.');
    expect(first.items[0].x).toBeCloseTo(0, 1);
    const textStart = (6.35 * 72) / 25.4;
    expect(first.items[1].x).toBeCloseTo(textStart, 1);
    expect(second.items[0].x).toBeCloseTo(textStart, 1);
  });

  test('adds paragraph spacing to the first and last line units', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(doc({ spaceBefore: 3, spaceAfter: 2, runs: [{ text: LOREM }] })),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 40,
    });
    const first = layout.lines[0];
    const last = layout.lines[layout.lines.length - 1];
    expect(first.spaceBefore).toBe(3);
    expect(first.height).toBeCloseTo(first.boxHeight + 3, 5);
    expect(last.height).toBeCloseTo(last.boxHeight + 2, 5);
  });

  test('larger runs make taller lines', async () => {
    const layout = await layoutRichDoc({
      doc: parseRichDoc(
        doc({ runs: [{ text: 'small' }] }, { runs: [{ text: 'BIG', fontSize: 20 }] }),
      ),
      base: baseSchema(),
      font,
      _cache: new Map(),
      widthMm: 80,
    });
    expect(layout.lines[1].boxHeight).toBeCloseTo(layout.lines[0].boxHeight * 2, 1);
  });

  test('uses registered bold/italic faces before synthetic styling', async () => {
    const withVariants: Font = {
      Sans: { data: sansData, fallback: true, variants: { bold: 'Sans Bold' } },
      'Sans Bold': { data: serifData, hidden: true },
    };
    const layout = await layoutRichDoc({
      doc: parseRichDoc(
        doc({
          runs: [
            { text: 'bold', bold: true },
            { text: ' italic', italic: true },
          ],
        }),
      ),
      base: baseSchema({ fontName: 'Sans' }),
      font: withVariants,
      _cache: new Map(),
      widthMm: 80,
    });
    const [bold, italic] = layout.lines[0].items;
    expect(bold.style.fontName).toBe('Sans Bold');
    expect(bold.style.syntheticBold).toBe(false);
    expect(italic.style.fontName).toBe('Sans');
    expect(italic.style.syntheticItalic).toBe(true);
  });

  test('text measurement exposes one height per rich line for page splitting', async () => {
    const value = doc({ runs: [{ text: LOREM }] }, { runs: [{ text: LOREM }] });
    const schema = baseSchema({ width: 40 });
    const { lineHeights } = await measureTextLines({ value, schema, font });
    const layout = await getRichLayout({ value, schema, widthMm: 40, font });
    expect(lineHeights).toEqual(layout.lines.map((line) => line.height));
    expect(lineHeights.length).toBeGreaterThan(6);
  });
});
