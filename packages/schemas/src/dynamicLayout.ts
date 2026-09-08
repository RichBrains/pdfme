import type { DynamicLayoutArgs, DynamicLayoutCallbackResult, Schema } from '@pdfme/common';
import { getDynamicLayoutForList } from './list/dynamicTemplate.js';
import { getDynamicLayoutForMultiVariableText } from './multiVariableText/dynamicTemplate.js';
import { getDynamicLayoutForTable } from './tables/dynamicTemplate.js';
import { getDynamicLayoutForText } from './text/dynamicTemplate.js';

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

/** Text fields participate in dynamic layout so their content minimum can be kept current. */
const isExpandableTextSchema = (schema: Schema) =>
  schema.type === 'text' || schema.type === 'multiVariableText';

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
