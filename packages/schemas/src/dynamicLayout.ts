import type { DynamicLayoutArgs, DynamicLayoutCallbackResult, Schema } from '@pdfme/common';
import { getDynamicLayoutForList } from './list/dynamicTemplate.js';
import { getDynamicLayoutForMultiVariableText } from './multiVariableText/dynamicTemplate.js';
import { getDynamicLayoutForTable } from './tables/dynamicTemplate.js';
import { getDynamicLayoutForText } from './text/dynamicTemplate.js';
import { getTextWidthMode, isAutoHeightText } from './text/sizing.js';
import type { TextSchema } from './text/types.js';

export {
  BUILT_IN_DYNAMIC_LAYOUT_SPLIT_UNITS,
  LIST_ITEM_SPLIT_UNIT,
  TABLE_BODY_SPLIT_UNIT,
  TEXT_LINE_SPLIT_UNIT,
  createListItemSplitRange,
  createTableBodySplitRange,
  createTextLineSplitRange,
  getListItemRange,
  getTableBodyRange,
  getTextLineRange,
  type BuiltInDynamicLayoutSplitUnit,
} from './splitRange.js';

/** Text fields need dynamic layout when either their height or width can grow. */
const isExpandableTextSchema = (schema: Schema) => {
  if (schema.type !== 'text' && schema.type !== 'multiVariableText') return false;
  const textSchema = schema as TextSchema;
  return isAutoHeightText(textSchema) || getTextWidthMode(textSchema) !== 'fixed';
};

export const isDynamicLayoutSchema = (schema: Schema) =>
  schema.type === 'table' || schema.type === 'list' || isExpandableTextSchema(schema);

export const getDynamicLayoutForSchema = (
  value: string,
  args: DynamicLayoutArgs,
): Promise<DynamicLayoutCallbackResult> => {
  switch (args.schema.type) {
    case 'table':
      return getDynamicLayoutForTable(value, args);
    case 'list':
      return getDynamicLayoutForList(value, args);
    case 'text':
      return getDynamicLayoutForText(value, args);
    case 'multiVariableText':
      return getDynamicLayoutForMultiVariableText(value, args);
    default:
      return Promise.resolve([args.schema.height]);
  }
};
