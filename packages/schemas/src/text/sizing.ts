import type { PageMargins, Size } from '@pdfme/common';
import { getContentBounds } from '@pdfme/common';
import { TEXT_OVERFLOW_EXPAND } from './constants.js';
import { measureTextWidth } from './measure.js';
import type {
  TEXT_EXPANSION_BOUNDARY,
  TEXT_HEIGHT_MODE,
  TEXT_WIDTH_MODE,
  TextSchema,
} from './types.js';

export const DEFAULT_TEXT_WIDTH_MODE: TEXT_WIDTH_MODE = 'fixed';
export const DEFAULT_TEXT_EXPANSION_BOUNDARY: TEXT_EXPANSION_BOUNDARY = 'margin';

export const getTextWidthMode = (schema: Pick<TextSchema, 'widthMode'>): TEXT_WIDTH_MODE =>
  schema.widthMode ?? DEFAULT_TEXT_WIDTH_MODE;

/**
 * Height mode and the legacy `overflow: 'expand'` flag express the same intent,
 * so either one enables automatic height.
 */
export const getTextHeightMode = (
  schema: Pick<TextSchema, 'heightMode' | 'overflow'>,
): TEXT_HEIGHT_MODE =>
  schema.heightMode ?? (schema.overflow === TEXT_OVERFLOW_EXPAND ? 'auto' : 'fixed');

export const isAutoHeightText = (schema: Pick<TextSchema, 'heightMode' | 'overflow'>) =>
  getTextHeightMode(schema) === 'auto';

export const getTextExpansionBoundary = (
  schema: Pick<TextSchema, 'expansionBoundary'>,
): TEXT_EXPANSION_BOUNDARY => schema.expansionBoundary ?? DEFAULT_TEXT_EXPANSION_BOUNDARY;

export type TextBoundaryContext = {
  pageSize?: Size;
  margins?: PageMargins;
  /** Fields that can act as an expansion boundary, in page coordinates (mm). */
  siblings?: { name: string; position: { x: number; y: number }; width: number; height: number }[];
};

/**
 * Horizontal space (mm) a field may grow into before it hits the boundary the
 * author selected. Returns `undefined` when the boundary cannot be resolved,
 * which keeps the field at its configured width.
 */
export const getAvailableTextWidth = (
  schema: Pick<
    TextSchema,
    'position' | 'width' | 'height' | 'expansionBoundary' | 'boundarySchemaName'
  >,
  context: TextBoundaryContext,
): number | undefined => {
  const boundary = getTextExpansionBoundary(schema);
  const { pageSize, margins, siblings } = context;

  if (boundary === 'manual' || boundary === 'allow-overlap') return undefined;

  if (boundary === 'field') {
    const target = siblings?.find((sibling) => sibling.name === schema.boundarySchemaName);
    if (!target) return undefined;
    return Math.max(0, target.position.x - schema.position.x);
  }

  if (!pageSize) return undefined;

  if (boundary === 'page') return Math.max(0, pageSize.width - schema.position.x);

  const bounds = getContentBounds(margins ?? { top: 0, right: 0, bottom: 0, left: 0 }, pageSize);
  return Math.max(0, bounds.right - schema.position.x);
};

/**
 * Width (mm) a text field should use for rendering.
 * `auto` grows to the content width but never past the boundary, `fill` always
 * uses the whole available width, and `fixed` keeps the authored width.
 */
export const resolveTextWidth = async (arg: {
  value: string;
  schema: TextSchema;
  context: TextBoundaryContext;
  font?: Parameters<typeof measureTextWidth>[0]['font'];
  _cache?: Map<string | number, unknown>;
}): Promise<number> => {
  const { value, schema, context, font, _cache } = arg;
  const widthMode = getTextWidthMode(schema);
  if (widthMode === 'fixed') return schema.width;

  const availableWidth = getAvailableTextWidth(schema, context);
  if (availableWidth === undefined || availableWidth <= 0) return schema.width;

  if (widthMode === 'fill') return availableWidth;

  const naturalWidth = await measureTextWidth({ value, schema, font, _cache });
  return Math.min(Math.max(schema.width, naturalWidth), availableWidth);
};
