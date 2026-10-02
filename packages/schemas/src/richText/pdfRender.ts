import type { PDFDocument, PDFFont, Rotation } from '@pdfme/pdf-lib';
import { mm2pt, type ColorType, type DynamicLayoutRange, type PDFRenderProps } from '@pdfme/common';
import {
  SYNTHETIC_BOLD_OFFSET_RATIO,
  SYNTHETIC_BOLD_PDF_EXTRA_DRAWS,
  SYNTHETIC_ITALIC_SKEW_DEGREES,
  VERTICAL_ALIGN_BOTTOM,
  VERTICAL_ALIGN_MIDDLE,
} from '../text/constants.js';
import { addUriLinkAnnotation } from '../text/linkAnnotation.js';
import type { TextSchema } from '../text/types.js';
import { hex2PrintingColor, rotatePoint } from '../utils.js';
import { getAscentPt, getDescentPt, type RichLayout, type RichLineItem } from './layout.js';

type Page = PDFRenderProps<TextSchema>['page'];
type PdfLib = PDFRenderProps<TextSchema>['pdfLib'];

/** Lines of a layout that fall inside a split range (page fragment). */
export const getRichLinesInRange = (layout: RichLayout, range?: DynamicLayoutRange) => {
  if (!range) return layout.lines;
  return layout.lines.slice(range.start, range.end ?? layout.lines.length);
};

const drawItem = (arg: {
  pdfDoc: PDFDocument;
  page: Page;
  pdfLib: PdfLib;
  item: RichLineItem;
  pdfFont: PDFFont;
  x: number;
  baselineY: number;
  rotate: Rotation;
  pivotPoint: { x: number; y: number };
  colorType?: ColorType;
  opacity?: number;
}) => {
  const { page, pdfLib, item, pdfFont, x, baselineY, rotate, pivotPoint, colorType, opacity } = arg;
  const { style } = item;
  const color = hex2PrintingColor(style.color, colorType);
  const at = (px: number, py: number) =>
    rotate.angle === 0 ? { x: px, y: py } : rotatePoint({ x: px, y: py }, pivotPoint, rotate.angle);
  const ascent = getAscentPt(style);
  const descent = getDescentPt(style);

  if (style.highlight) {
    const corner = at(x, baselineY - descent);
    page.drawRectangle({
      x: corner.x,
      y: corner.y,
      width: item.width,
      height: ascent + descent,
      rotate,
      color: hex2PrintingColor(style.highlight, colorType),
      opacity,
    });
  }

  const line = (offsetY: number) => {
    const thickness = Math.max(0.5, style.fontSize / 16);
    page.drawLine({
      start: at(x, baselineY + offsetY),
      end: at(x + item.width, baselineY + offsetY),
      thickness,
      color,
      opacity,
    });
  };
  if (!/^\s*$/.test(item.text)) {
    if (style.underline) line(-style.fontSize / 10);
    if (style.strikethrough) line(ascent / 3);
  } else if (style.underline) {
    // Underlined spaces between underlined words stay continuous, like Word.
    line(-style.fontSize / 10);
  }

  if (style.characterSpacing) {
    page.pushOperators(pdfLib.setCharacterSpacing(style.characterSpacing));
  }
  const draw = (drawX: number) => {
    const point = at(drawX, baselineY);
    page.drawText(item.text, {
      x: point.x,
      y: point.y,
      rotate,
      size: style.fontSize,
      font: pdfFont,
      color,
      opacity,
      ...(style.syntheticItalic ? { ySkew: pdfLib.degrees(SYNTHETIC_ITALIC_SKEW_DEGREES) } : {}),
    });
  };
  draw(x);
  if (style.syntheticBold) {
    const offset = style.fontSize * SYNTHETIC_BOLD_OFFSET_RATIO;
    for (let i = 1; i <= SYNTHETIC_BOLD_PDF_EXTRA_DRAWS; i += 1) draw(x + offset * i);
  }
  if (style.characterSpacing) {
    page.pushOperators(pdfLib.setCharacterSpacing(0));
  }

  if (style.href) {
    if (rotate.angle === 0) {
      addUriLinkAnnotation({
        pdfDoc: arg.pdfDoc,
        page,
        rect: { x, y: baselineY - descent, width: item.width, height: ascent + descent },
        uri: style.href,
      });
    }
  }
};

/**
 * Draws the lines of `layout` that belong to this fragment inside the content
 * box (pt, PDF coordinates: `x`/`y` is the box's bottom-left corner).
 */
export const renderRichLayout = async (arg: {
  layout: RichLayout;
  range?: DynamicLayoutRange;
  pdfDoc: PDFDocument;
  page: Page;
  pdfLib: PdfLib;
  embedPdfFont: (fontName: string) => Promise<PDFFont>;
  x: number;
  y: number;
  width: number;
  height: number;
  verticalAlignment?: string;
  rotate: Rotation;
  pivotPoint: { x: number; y: number };
  colorType?: ColorType;
  opacity?: number;
}) => {
  const { layout, range, page, pdfLib, embedPdfFont, x, y, height, rotate, pivotPoint } = arg;
  const lines = getRichLinesInRange(layout, range);
  if (lines.length === 0) return;

  const fontNames = new Set(lines.flatMap((line) => line.items.map((item) => item.style.fontName)));
  const pdfFonts = new Map<string, PDFFont>();
  await Promise.all(
    Array.from(fontNames, async (fontName) => {
      pdfFonts.set(fontName, await embedPdfFont(fontName));
    }),
  );

  const totalHeight = mm2pt(lines.reduce((sum, line) => sum + line.height, 0));
  const free = Math.max(0, height - totalHeight);
  const offset =
    arg.verticalAlignment === VERTICAL_ALIGN_MIDDLE
      ? free / 2
      : arg.verticalAlignment === VERTICAL_ALIGN_BOTTOM
        ? free
        : 0;

  let top = y + height - offset;
  for (const line of lines) {
    const baselineY = top - mm2pt(line.spaceBefore + line.baseline);
    for (const item of line.items) {
      const pdfFont = pdfFonts.get(item.style.fontName);
      if (!pdfFont || item.text.length === 0) continue;
      drawItem({
        pdfDoc: arg.pdfDoc,
        page,
        pdfLib,
        item,
        pdfFont,
        x: x + item.x,
        baselineY,
        rotate,
        pivotPoint,
        colorType: arg.colorType,
        opacity: arg.opacity,
      });
    }
    top -= mm2pt(line.height);
  }
};
