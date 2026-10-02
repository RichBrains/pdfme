import type { DynamicLayoutRange } from '@pdfme/common';
import { pt2mm } from '@pdfme/common';
import {
  DEFAULT_VERTICAL_ALIGNMENT,
  SYNTHETIC_BOLD_CSS_TEXT_SHADOW,
  VERTICAL_ALIGN_BOTTOM,
  VERTICAL_ALIGN_MIDDLE,
} from '../text/constants.js';
import type { TextSchema } from '../text/types.js';
import { getBoxInsets, hasBoxDimension } from '../box.js';
import { getAscentPt, getDescentPt, type RichLayout } from './layout.js';
import { getRichLinesInRange } from './pdfRender.js';

/**
 * Read-only canvas rendering of a laid-out rich document. Every piece is
 * absolutely positioned from the same layout the PDF uses, so line breaks,
 * justification and page splits on the canvas match the generated PDF.
 */
export const renderRichLayoutDom = (arg: {
  rootElement: HTMLElement;
  layout: RichLayout;
  schema: TextSchema;
  range?: DynamicLayoutRange;
}) => {
  const { rootElement, layout, schema, range } = arg;
  const { borderWidth, padding } = getBoxInsets(schema);
  const hasBorder = Boolean(schema.borderColor && hasBoxDimension(schema.borderWidth));

  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'relative',
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    overflow: 'visible',
    backgroundColor: schema.backgroundColor || 'transparent',
    padding: `${padding.top}mm ${padding.right}mm ${padding.bottom}mm ${padding.left}mm`,
    ...(hasBorder
      ? {
          borderStyle: 'solid',
          borderColor: schema.borderColor,
          borderTopWidth: `${borderWidth.top}mm`,
          borderRightWidth: `${borderWidth.right}mm`,
          borderBottomWidth: `${borderWidth.bottom}mm`,
          borderLeftWidth: `${borderWidth.left}mm`,
        }
      : { border: 'none' }),
  } satisfies Partial<CSSStyleDeclaration>);

  const content = document.createElement('div');
  Object.assign(content.style, { position: 'relative', width: '100%', height: '100%' });
  container.appendChild(content);

  const lines = getRichLinesInRange(layout, range);
  const total = lines.reduce((sum, line) => sum + line.height, 0);
  const verticalAlignment = schema.verticalAlignment ?? DEFAULT_VERTICAL_ALIGNMENT;
  const contentHeight = Math.max(
    0,
    schema.height - borderWidth.top - borderWidth.bottom - padding.top - padding.bottom,
  );
  const free = Math.max(0, contentHeight - total);
  let top =
    verticalAlignment === VERTICAL_ALIGN_MIDDLE
      ? free / 2
      : verticalAlignment === VERTICAL_ALIGN_BOTTOM
        ? free
        : 0;

  for (const line of lines) {
    const baselineTop = top + line.spaceBefore + line.baseline;
    for (const item of line.items) {
      if (!item.text) continue;
      const { style } = item;
      const ascent = pt2mm(getAscentPt(style));
      const contentAreaPt = getAscentPt(style) + getDescentPt(style);
      const span = document.createElement(style.href ? 'a' : 'span');
      span.textContent = item.text;
      const decorations = [
        style.underline ? 'underline' : '',
        style.strikethrough ? 'line-through' : '',
      ].filter(Boolean);
      Object.assign(span.style, {
        position: 'absolute',
        left: `${pt2mm(item.x)}mm`,
        top: `${baselineTop - ascent}mm`,
        width: `${pt2mm(item.width)}mm`,
        whiteSpace: 'pre',
        fontFamily: `'${style.fontName}'`,
        fontSize: `${style.fontSize}pt`,
        // Content-area line height puts the baseline exactly `ascent` below top.
        lineHeight: `${contentAreaPt}pt`,
        letterSpacing: `${style.characterSpacing}pt`,
        color: style.color,
        backgroundColor: style.highlight || 'transparent',
        textDecoration: decorations.join(' ') || 'none',
        ...(style.syntheticBold
          ? { fontWeight: '800', textShadow: SYNTHETIC_BOLD_CSS_TEXT_SHADOW }
          : {}),
        ...(style.syntheticItalic ? { fontStyle: 'italic' } : {}),
      } satisfies Partial<CSSStyleDeclaration>);
      if (style.href && span instanceof HTMLAnchorElement) {
        span.href = style.href;
        span.target = '_blank';
        span.rel = 'noopener noreferrer';
      }
      content.appendChild(span);
    }
    top += line.height;
  }

  rootElement.innerHTML = '';
  rootElement.appendChild(container);
  return container;
};
