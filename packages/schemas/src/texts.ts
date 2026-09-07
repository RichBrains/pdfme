export { TEXT_OVERFLOW_EXPAND, TEXT_OVERFLOW_VISIBLE } from './text/constants.js';
export { getDynamicLayoutForText } from './text/dynamicTemplate.js';
export { measureTextHeight, measureTextWidth, mergeTextLineRangeValue } from './text/measure.js';
export {
  DEFAULT_PARAGRAPH_INDENT,
  getLineStartIndentMm,
  getLineWidthMm,
  getParagraphIndent,
  getParagraphLineStarts,
  hasParagraphIndent,
} from './text/indent.js';
export {
  DEFAULT_TEXT_EXPANSION_BOUNDARY,
  DEFAULT_TEXT_WIDTH_MODE,
  getAvailableTextWidth,
  getTextExpansionBoundary,
  getTextHeightMode,
  getTextWidthMode,
  isAutoHeightText,
  resolveTextWidth,
} from './text/sizing.js';
export type {
  PARAGRAPH_INDENT_MODE,
  ParagraphIndent,
  TEXT_EXPANSION_BOUNDARY,
  TEXT_HEIGHT_MODE,
  TEXT_WIDTH_MODE,
} from './text/types.js';
export { getDynamicLayoutForMultiVariableText } from './multiVariableText/dynamicTemplate.js';
export { createTextLineSplitRange, getTextLineRange, TEXT_LINE_SPLIT_UNIT } from './splitRange.js';
