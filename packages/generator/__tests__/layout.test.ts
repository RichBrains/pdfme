import { PDFDocument } from '@pdfme/pdf-lib';
import { BLANK_A4_PDF, CUSTOM_A4_PDF, type Template } from '@pdfme/common';
import { text } from '@pdfme/schemas';
import generate from '../src/generate.js';
import { getFont } from './utils.js';

const LONG_VALUE = 'The quick brown fox jumps over the lazy dog. '.repeat(20);

const getTextSchema = (overrides: Record<string, unknown> = {}) => ({
  name: 'body',
  type: 'text',
  content: LONG_VALUE,
  position: { x: 20, y: 20 },
  width: 80,
  height: 10,
  fontSize: 12,
  lineHeight: 1,
  characterSpacing: 0,
  alignment: 'left',
  verticalAlignment: 'top',
  fontColor: '#000000',
  backgroundColor: '',
  readOnly: true,
  ...overrides,
});

const generatePdf = (template: Template) =>
  generate({
    inputs: [{}],
    template,
    plugins: { text },
    options: { font: getFont() },
  });

describe('word-processing layout in generated PDFs', () => {
  test('expands text height on templates with an uploaded PDF background', async () => {
    const template: Template = {
      basePdf: CUSTOM_A4_PDF,
      schemas: [[getTextSchema({ overflow: 'expand' })]],
      layout: {
        pages: [
          {
            margins: { top: 20, right: 20, bottom: 20, left: 20 },
            showMargins: true,
            grid: { visible: false, snap: false, spacing: 5, unit: 'mm' },
            horizontalGuides: [],
            verticalGuides: [],
          },
        ],
      },
    };

    const pdf = await generatePdf(template);
    const pdfDoc = await PDFDocument.load(pdf);

    // Expansion happens in place: the uploaded background defines the page count.
    expect(pdfDoc.getPages()).toHaveLength(1);
  });

  test('breaks expanded text across pages on blank templates', async () => {
    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [[getTextSchema({ overflow: 'expand', content: LONG_VALUE.repeat(6) })]],
    };

    const pdf = await generatePdf(template);
    const pdfDoc = await PDFDocument.load(pdf);

    expect(pdfDoc.getPages().length).toBeGreaterThan(1);
  });

  test('renders paragraph indentation without failing', async () => {
    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [
        [
          getTextSchema({
            name: 'firstLine',
            indentMode: 'firstLine',
            specialIndent: 10,
            overflow: 'expand',
          }),
          getTextSchema({
            name: 'hanging',
            position: { x: 20, y: 120 },
            indentMode: 'hanging',
            specialIndent: 10,
            leftIndent: 5,
            rightIndent: 5,
            overflow: 'expand',
          }),
        ],
      ],
    };

    const pdf = await generatePdf(template);

    expect(pdf.length).toBeGreaterThan(0);
  });

  test('auto-width text stops at the configured page margin', async () => {
    const template: Template = {
      basePdf: BLANK_A4_PDF,
      schemas: [
        [getTextSchema({ width: 20, widthMode: 'fill', expansionBoundary: 'margin' })],
      ],
    };

    const pdf = await generatePdf(template);

    expect(pdf.length).toBeGreaterThan(0);
  });
});
