import { getDefaultFont, isRichDocValue, parseRichDoc, type Font } from '@pdfme/common';
import { TEXT_FORMAT_RICH } from '../text/constants.js';
import type { TextSchema } from '../text/types.js';
import { layoutRichDoc, type RichBaseStyle, type RichLayout } from './layout.js';

export * from './layout.js';
export * from './pdfRender.js';
export * from './uiRender.js';

/** A text field renders as a rich document when flagged or when its value is one. */
export const isRichTextSchema = (schema: Pick<TextSchema, 'textFormat'>, value?: unknown) =>
  schema.textFormat === TEXT_FORMAT_RICH || isRichDocValue(value);

const LAYOUT_CACHE_KEY = 'rich-text-layout-cache';
const LAYOUT_CACHE_LIMIT = 200;

const getLayoutCache = (_cache: Map<string | number, unknown>) => {
  let cache = _cache.get(LAYOUT_CACHE_KEY) as Map<string, Promise<RichLayout>> | undefined;
  if (!cache) {
    cache = new Map();
    _cache.set(LAYOUT_CACHE_KEY, cache);
  }
  return cache;
};

const pickBaseStyle = (schema: TextSchema): RichBaseStyle => ({
  name: schema.name,
  fontName: schema.fontName,
  fontSize: schema.fontSize,
  lineHeight: schema.lineHeight,
  characterSpacing: schema.characterSpacing,
  fontColor: schema.fontColor,
  alignment: schema.alignment,
  fontVariants: schema.fontVariants,
  fontVariantFallback: schema.fontVariantFallback,
});

/**
 * Lays out a rich value for a content width, memoized per render cache so the
 * dynamic-layout pass, the PDF renderer and the canvas share one layout.
 */
export const getRichLayout = (arg: {
  value: string;
  schema: TextSchema;
  widthMm: number;
  font?: Font;
  _cache?: Map<string | number, unknown>;
}): Promise<RichLayout> => {
  const { value, schema, widthMm, font = getDefaultFont(), _cache = new Map() } = arg;
  const base = pickBaseStyle(schema);
  const key = JSON.stringify([widthMm, base, value]);
  const cache = getLayoutCache(_cache);
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= LAYOUT_CACHE_LIMIT) cache.clear();
  const pending = layoutRichDoc({ doc: parseRichDoc(value), base, font, _cache, widthMm });
  cache.set(key, pending);
  pending.catch(() => cache.delete(key));
  return pending;
};
