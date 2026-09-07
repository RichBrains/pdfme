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
    context: { pageSize: args.pageSize, margins: args.margins },
    font: args.options.font,
    _cache: args._cache,
  });
  const hasResolvedWidth =
    getTextWidthMode(authoredSchema) !== 'fixed' && resolvedWidth !== authoredSchema.width;
  const schema: TextSchema = hasResolvedWidth
    ? { ...authoredSchema, width: resolvedWidth }
    : authoredSchema;
  const widthPatch = hasResolvedWidth ? { width: resolvedWidth } : {};

  if (!isAutoHeightText(schema)) {
    return {
      heights: [schema.height],
      ...(hasResolvedWidth ? { patchSplitSchema: () => ({ ...widthPatch }) } : {}),
    };
  }

  const { lineHeights } = await measureTextLines({
    value,
    schema,
    font: args.options.font,
    _cache: args._cache,
    // `expand` owns the height decision, so measuring against a shrink-to-fit font size
    // would make the field keep its original box instead of growing.
    ignoreDynamicFontSize: true,
  });
  const heights = getTextLineHeightsWithBox(lineHeights, schema);
  const measuredHeight = sumLineHeights(heights);

  if (measuredHeight <= schema.height || lineHeights.length === 0) {
    return {
      heights: [schema.height],
      patchSplitSchema: () => ({ dynamicFontSize: undefined, ...widthPatch }),
    };
  }

  return {
    heights: lineHeights.length === 1 ? [Math.max(schema.height, measuredHeight)] : heights,
    patchSplitSchema: ({ start, end, isSplit }) => ({
      dynamicFontSize: undefined,
      ...widthPatch,
      __splitRange: lineHeights.length === 1 ? undefined : createTextLineSplitRange(start, end),
      __isSplit: isSplit,
      ...getTextSplitBoxStyle(schema, { start, end }, lineHeights.length),
    }),
  };
};
