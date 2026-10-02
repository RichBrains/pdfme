import { PDFDocument } from '@pdfme/pdf-lib';
import { createRichDoc, serializeRichDoc, type Template } from '@pdfme/common';
import { text } from '@pdfme/schemas';
import generate from '../src/generate.js';
import { getFont } from './utils.js';

const clause =
  'Der Vertragsschluss erfolgt, nachdem die BSBI der/dem Bewerbenden einen sog. Unconditional offer letter zugeschickt und vom/von Bewerber/in daraufhin ein unterzeichnetes Exemplar dieses Studienvertrages in Textform zurückerhalten hat.';

const richTemplate = (paragraphCount: number): Template => ({
  basePdf: { width: 120, height: 100, padding: [10, 10, 10, 10] },
  schemas: [
    [
      {
        name: 'terms',
        type: 'text',
        readOnly: true,
        textFormat: 'rich',
        heightMode: 'auto',
        content: serializeRichDoc(
          createRichDoc(
            Array.from({ length: paragraphCount }, (_, index) => ({
              align: 'justify' as const,
              spaceAfter: 2,
              list: { format: 'decimal' as const },
              runs: [
                { text: `Clause ${index + 1} `, bold: true },
                { text: '{__FIRSTNAME__}: ', italic: true, color: '#3c7bc4' },
                { text: clause, underline: index === 0 },
              ],
            })),
          ),
        ),
        position: { x: 10, y: 10 },
        width: 100,
        height: 10,
        fontSize: 10,
        lineHeight: 1,
        characterSpacing: 0,
        alignment: 'left',
        verticalAlignment: 'top',
        fontColor: '#000000',
        backgroundColor: '',
      },
    ],
  ],
});

describe('generate rich text', () => {
  test('renders a styled rich document with merge fields', async () => {
    const pdf = await generate({
      template: richTemplate(1),
      inputs: [{ __FIRSTNAME__: 'Ann' }],
      plugins: { text },
      options: { font: getFont() },
    });
    const pdfDoc = await PDFDocument.load(pdf);
    expect(pdfDoc.getPageCount()).toBe(1);
  });

  test('flows long rich content onto following pages line by line', async () => {
    const pdf = await generate({
      template: richTemplate(12),
      inputs: [{ __FIRSTNAME__: 'Ann' }],
      plugins: { text },
      options: { font: getFont() },
    });
    const pdfDoc = await PDFDocument.load(pdf);
    expect(pdfDoc.getPageCount()).toBeGreaterThan(2);
  });
});
