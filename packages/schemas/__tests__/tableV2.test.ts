import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  createRichDoc,
  getDynamicTemplate,
  serializeRichDoc,
  type Font,
  type Schema,
  type Template,
} from '@pdfme/common';
import { propPanel } from '../src/tables/propPanel.js';
import { getDynamicLayoutForTable } from '../src/tables/dynamicTemplate.js';
import { createSingleTable } from '../src/tables/tableHelper.js';
import { getBodyWithSchemaRange } from '../src/tables/helper.js';
import type { TableSchema } from '../src/tables/types.js';

const font: Font = {
  SauceHanSansJP: {
    fallback: true,
    data: readFileSync(path.join(__dirname, '/assets/fonts/SauceHanSansJP.ttf')),
  },
};
const options = { font };
const basePdf = {
  width: 120,
  height: 100,
  padding: [10, 10, 10, 10] as [number, number, number, number],
};
const CONTENT_HEIGHT = 80;

const german =
  'Der Vertragsschluss erfolgt, nachdem die Hochschule der Bewerberin einen Zulassungsbescheid zugeschickt hat. ';
const english =
  'The contract is concluded once the university has sent the applicant an unconditional offer letter. ';

const tableSchema = (overrides: Partial<TableSchema> = {}): TableSchema =>
  ({
    ...propPanel.defaultSchema,
    name: 'terms',
    position: { x: 10, y: 10 },
    width: 100,
    height: 20,
    head: ['Deutsch', 'English'],
    headWidthPercentages: [50, 50],
    showHead: false,
    bodyStyles: {
      ...propPanel.defaultSchema.bodyStyles,
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      alternateBackgroundColor: '',
    },
    ...overrides,
  }) as TableSchema;

const layout = async (schema: TableSchema, content: string[][]) => {
  const template: Template = {
    basePdf,
    schemas: [[{ ...schema, content: JSON.stringify(content), readOnly: true } as Schema]],
  };
  const dynamic = await getDynamicTemplate({
    template,
    input: {},
    options,
    _cache: new Map(),
    getDynamicHeights: (value, args) => getDynamicLayoutForTable(value, args),
  });
  return dynamic.schemas.map((page) => page[0] as TableSchema);
};

/** Height of a page chunk as the table renders it. */
const renderedHeight = async (chunk: TableSchema) => {
  const content = (chunk as unknown as { content: string }).content;
  const table = await createSingleTable(getBodyWithSchemaRange(content, chunk), {
    schema: chunk,
    basePdf,
    options,
    _cache: new Map(),
  });
  return table.getHeight();
};

describe('table rows across pages', () => {
  const longRow = [german.repeat(6), english.repeat(6)];

  test('splits a row at line boundaries and continues it on the next page', async () => {
    const chunks = await layout(tableSchema({ splitRows: true }), [['Short', 'Row'], longRow]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].__rowSlice?.last).toBeDefined();
    expect(chunks[1].__rowSlice?.first).toEqual(chunks[0].__rowSlice?.last);
    for (const chunk of chunks) {
      expect(chunk.height).toBeLessThanOrEqual(CONTENT_HEIGHT + 0.01);
      // The layout's chunk height is exactly what the table draws.
      expect(await renderedHeight(chunk)).toBeCloseTo(chunk.height, 5);
    }
  });

  test('reserves room for the repeated header on continuation pages', async () => {
    const chunks = await layout(
      tableSchema({ splitRows: true, showHead: true, repeatHead: true }),
      [longRow],
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.height).toBeLessThanOrEqual(CONTENT_HEIGHT + 0.01);
      expect(await renderedHeight(chunk)).toBeCloseTo(chunk.height, 5);
    }
  });

  test('keeps rows together unless splitting is enabled, but breaks rows taller than a page', async () => {
    const filler = Array.from({ length: 5 }, () => ['a', 'b']);
    const chunks = await layout(tableSchema(), [...filler, longRow]);
    // The long row moves to a fresh page, then breaks because it is taller than one page.
    expect(chunks[0].__rowSlice).toBeUndefined();
    expect(chunks[1].__rowSlice?.last).toBeDefined();
    expect(chunks[1].position.y).toBe(10);
  });

  test('splits rich cells too', async () => {
    const rich = serializeRichDoc(
      createRichDoc(
        Array.from({ length: 12 }, (_, i) => ({
          spaceAfter: 1,
          runs: [{ text: `§ ${i + 1} `, bold: true }, { text: english }],
        })),
      ),
    );
    const chunks = await layout(tableSchema({ splitRows: true }), [[rich, rich]]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(await renderedHeight(chunk)).toBeCloseTo(chunk.height, 5);
    }
  });
});

describe('table layout options', () => {
  const create = (schema: TableSchema, body: string[][]) =>
    createSingleTable(body, { schema, basePdf, options, _cache: new Map() });

  test('column gaps narrow the columns and merged cells span the gap', async () => {
    const table = await create(
      tableSchema({ columnGap: 6, cellStyles: { '1:0': { colSpan: 2 } } }),
      [
        ['DE', 'EN'],
        ['Both columns', 'ignored'],
      ],
    );
    expect(table.columns.map((column) => column.width)).toEqual([47, 47]);
    expect(Object.keys(table.body[1].cells)).toEqual(['0']);
    expect(table.body[1].cells[0].width).toBe(100);
  });

  test('styles resolve from section to row, column and cell', async () => {
    const table = await create(
      tableSchema({
        rowStyles: { 0: { backgroundColor: '#ff0000', fontSize: 9 } },
        columnStyles: { styles: { 1: { backgroundColor: '#00ff00', lang: 'en' } } },
        cellStyles: { '0:1': { fontColor: '#0000ff' } },
      }),
      [['a', 'b']],
    );
    const [de, en] = [table.body[0].cells[0], table.body[0].cells[1]];
    expect(de.styles.backgroundColor).toBe('#ff0000');
    expect(de.styles.fontSize).toBe(9);
    expect(en.styles.backgroundColor).toBe('#00ff00');
    expect(en.styles.fontSize).toBe(9);
    expect(en.styles.lang).toBe('en');
    expect(en.styles.textColor).toBe('#0000ff');
    expect(de.styles.textColor).toBe('#000000');
  });
});
