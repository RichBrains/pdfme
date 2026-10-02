import {
  Schema,
  BasePdf,
  BlankPdf,
  CommonOptions,
  DynamicLayoutArgs,
  DynamicLayoutBreak,
  DynamicLayoutBreakArgs,
  DynamicLayoutResult,
  isBlankPdf,
} from '@pdfme/common';
import { createSingleTable } from './tableHelper.js';
import { getBodyWithRange, getBody } from './helper.js';
import type { Row } from './classes.js';
import { RowLineState, TableSchema } from './types.js';
import { createTableBodySplitRange, getTableBodyRange } from '../splitRange.js';

export const getDynamicHeightsForTable = async (
  value: string,
  args: {
    schema: Schema;
    basePdf: BasePdf;
    options: CommonOptions;
    _cache: Map<string | number, unknown>;
  },
): Promise<number[]> => {
  if (args.schema.type !== 'table') return Promise.resolve([args.schema.height]);
  const schema = args.schema as TableSchema;
  const bodyRange = getTableBodyRange(schema);
  const body = bodyRange?.start === 0 ? getBody(value) : getBodyWithRange(value, bodyRange);
  const table = await createSingleTable(body, args);

  const baseHeights = schema.showHead
    ? table.allRows().map((row) => row.height)
    : [0].concat(table.body.map((row) => row.height));

  const headerHeight = schema.showHead ? table.getHeadHeight() : 0;
  const shouldRepeatHeader = schema.repeatHead && isBlankPdf(args.basePdf) && headerHeight > 0;

  if (!shouldRepeatHeader) {
    return baseHeights;
  }

  const basePdf = args.basePdf as BlankPdf;
  const [paddingTop, , paddingBottom] = basePdf.padding;
  const pageContentHeight = basePdf.height - paddingTop - paddingBottom;
  const getPageStartY = (pageIndex: number) => pageIndex * pageContentHeight + paddingTop;

  const initialPageIndex = Math.max(
    0,
    Math.floor((schema.position.y - paddingTop) / pageContentHeight),
  );
  const headRowCount = schema.showHead ? table.head.length : 0;
  const SAFETY_MARGIN = 0.5;

  let currentPageIndex = initialPageIndex;
  let currentPageY = schema.position.y;
  let rowsOnCurrentPage = 0;

  const result: number[] = [];

  for (let i = 0; i < baseHeights.length; i++) {
    const isBodyRow = i >= headRowCount;
    const rowHeight = baseHeights[i];

    while (true) {
      const currentPageStartY = getPageStartY(currentPageIndex);
      const remainingHeight = currentPageStartY + pageContentHeight - currentPageY;
      const needsHeader =
        isBodyRow && rowsOnCurrentPage === 0 && currentPageIndex > initialPageIndex;
      const totalRowHeight = rowHeight + (needsHeader ? headerHeight : 0);

      if (totalRowHeight > remainingHeight - SAFETY_MARGIN) {
        if (rowsOnCurrentPage === 0 && Math.abs(currentPageY - currentPageStartY) < SAFETY_MARGIN) {
          result.push(totalRowHeight);
          currentPageY += totalRowHeight;
          rowsOnCurrentPage++;
          break;
        }
        currentPageIndex++;
        currentPageY = getPageStartY(currentPageIndex);
        rowsOnCurrentPage = 0;
        continue;
      }

      result.push(totalRowHeight);
      currentPageY += totalRowHeight;
      rowsOnCurrentPage++;

      if (currentPageY >= currentPageStartY + pageContentHeight - SAFETY_MARGIN) {
        currentPageIndex++;
        currentPageY = getPageStartY(currentPageIndex);
        rowsOnCurrentPage = 0;
      }
      break;
    }
  }

  return result;
};

/** Smallest height (mm) worth starting a row on before a page break. */
const MIN_BREAK_HEIGHT = 1;

/**
 * Breaks a body row so it fills `available` mm: every cell keeps the lines
 * that fit (from where the previous page stopped) and continues below.
 */
export const breakTableRow = (
  row: Row,
  { from, available }: Pick<DynamicLayoutBreakArgs, 'from' | 'available'>,
): DynamicLayoutBreak | null => {
  if (available < MIN_BREAK_HEIGHT) return null;
  const starts = (Array.isArray(from) ? from : []) as RowLineState;
  const to: RowLineState = [];
  let height = 0;
  let restHeight = 0;
  let taken = false;
  let remaining = false;

  for (const cell of Object.values(row.cells)) {
    const padding = cell.padding('top') + cell.padding('bottom');
    const start = Math.min(starts[cell.colIndex] ?? 0, cell.lineHeights.length);
    let end = start;
    let used = 0;
    while (
      end < cell.lineHeights.length &&
      padding + used + cell.lineHeights[end] <= available + 1e-6
    ) {
      used += cell.lineHeights[end];
      end++;
    }
    to[cell.colIndex] = end;
    if (end > start) taken = true;
    if (end < cell.lineHeights.length) remaining = true;
    height = Math.max(height, padding + used);
    restHeight = Math.max(restHeight, padding + cell.getLinesHeight(end, cell.lineHeights.length));
  }

  if (!taken || !remaining) return null;
  return { height, to, restHeight };
};

export const getDynamicLayoutForTable = async (
  value: string,
  args: DynamicLayoutArgs,
): Promise<DynamicLayoutResult> => {
  const schema = args.schema as TableSchema;
  const patchSplitSchema: DynamicLayoutResult['patchSplitSchema'] = ({
    start,
    end,
    isSplit,
    startFrom,
    endAt,
  }) => {
    const range = {
      start: start === 0 ? 0 : start - 1,
      end: end - 1,
    };
    const rowSlice =
      startFrom !== undefined || endAt !== undefined
        ? {
            ...(startFrom !== undefined ? { first: startFrom as RowLineState } : {}),
            ...(endAt !== undefined ? { last: endAt as RowLineState } : {}),
          }
        : undefined;
    return {
      __splitRange: createTableBodySplitRange(range.start, range.end),
      __isSplit: isSplit,
      __rowSlice: rowSlice,
    } as Partial<Schema>;
  };

  if (args.schema.type !== 'table') {
    return { heights: await getDynamicHeightsForTable(value, args), patchSplitSchema };
  }

  const splitRows = schema.splitRows === true;
  const repeatHead = schema.repeatHead === true && schema.showHead && isBlankPdf(args.basePdf);
  // Legacy layout: whole rows, with repeated headers baked into the row heights.
  if (repeatHead && !splitRows) {
    return {
      heights: await getDynamicHeightsForTable(value, args),
      avoidFirstUnitOnly: true,
      patchSplitSchema,
    };
  }

  const bodyRange = getTableBodyRange(schema);
  const body = bodyRange?.start === 0 ? getBody(value) : getBodyWithRange(value, bodyRange);
  const table = await createSingleTable(body, args);
  // Unit 0 is the head (0 when hidden); every body row is one more unit.
  const heights = schema.showHead
    ? table.allRows().map((row) => row.height)
    : [0].concat(table.body.map((row) => row.height));
  const headUnits = schema.showHead ? table.head.length : 1;

  return {
    heights,
    avoidFirstUnitOnly: true,
    patchSplitSchema,
    continuationHeight: repeatHead ? table.getHeadHeight() : 0,
    // Rows break at line boundaries when enabled; a row taller than a whole
    // page always breaks rather than running off the page.
    breakUnit: ({ index, from, available, atPageTop }) => {
      if (index < headUnits) return null;
      if (!splitRows && !atPageTop) return null;
      const row = table.body[index - headUnits];
      return row ? breakTableRow(row, { from, available }) : null;
    },
  };
};
