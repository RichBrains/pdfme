import type { DynamicLayoutArgs, DynamicLayoutResult } from '@pdfme/common';
import {
  getTextLineHeightsWithBox,
  getTextSplitBoxStyle,
  measureTextLines,
  sumLineHeights,
} from './measure.js';
import type { TextSchema } from './types.js';
import { createTextLineSplitRange } from '../splitRange.js';
import { getTextWidthMode, isAutoHeightText, resolveTextWidth } from './sizing.js';

export const getDynamicLayoutForText = async (
  value: string,
  args: DynamicLayoutArgs,
): Promise<DynamicLayoutResult> => {
  if (args.schema.type !== 'text') return { heights: [args.schema.height] };

  const authoredSchema = args.schema as TextSchema;

  // Width is resolved first: auto/fill width changes how text wraps, and
  // therefore how tall the field has to be.
  const resolvedWidth = await resolveTextWidth({
    value,
    schema: authoredSchema,
    context: { pageSize: args.pageSize, margins: args.margins, siblings: args.siblings },
    font: args.options.font,
    _cache: args._cache,
  });
  const hasResolvedWidth =
    getTextWidthMode(authoredSchema) !== 'fixed' && resolvedWidth !== authoredSchema.width;
  const schema: TextSchema = hasResolvedWidth
    ? { ...authoredSchema, width: resolvedWidth }
    : authoredSchema;
  const widthPatch = hasResolvedWidth ? { width: resolvedWidth } : {};

  const autoHeight = isAutoHeightText(schema);
  const { lineHeights } = await measureTextLines({
    value,
    schema,
    font: args.options.font,
    _cache: args._cache,
    // Auto-height fields own the height decision, so measuring against a
    // shrink-to-fit font size would keep their original box instead of growing.
    ignoreDynamicFontSize: autoHeight,
  });
  const heights = getTextLineHeightsWithBox(lineHeights, schema);
  const measuredHeight = sumLineHeights(heights);
  const contentPatch = { contentMinHeight: measuredHeight };

  if (!autoHeight) {
    return {
      heights: [schema.height],
      patchSplitSchema: () => ({ ...widthPatch, ...contentPatch }),
    };
  }

  // Keep the authored minimum separate from the current content-derived
  // minimum so editing may shrink a field after content is removed while a
  // manual resize can never make it smaller than the rendered text.
  const minHeight = schema.minHeight ?? schema.height;
  const resolvedHeight = Math.max(minHeight, measuredHeight);
  const heightPatch = { minHeight, ...contentPatch };

  // Content that already fits keeps a single unit: splitting it here would
  // introduce page breaks for text that never overflowed.
  if (measuredHeight <= minHeight || lineHeights.length <= 1) {
    return {
      heights: [resolvedHeight],
      patchSplitSchema: () => ({ dynamicFontSize: undefined, ...widthPatch, ...heightPatch }),
    };
  }

  return {
    heights,
    patchSplitSchema: ({ start, end, isSplit }) => ({
      dynamicFontSize: undefined,
      ...widthPatch,
      ...heightPatch,
      __splitRange: createTextLineSplitRange(start, end),
      __isSplit: isSplit,
      ...getTextSplitBoxStyle(schema, { start, end }, lineHeights.length),
    }),
  };
};
