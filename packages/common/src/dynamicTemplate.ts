import {
  Schema,
  Template,
  BasePdf,
  BlankPdf,
  CommonOptions,
  DynamicLayoutCallbackResult,
  DynamicLayoutResult,
  PageMargins,
  ReflowScope,
  Size,
} from './types.js';
import { cloneDeep, isBlankPdf } from './helper.js';
import { getElementSpacing, getPageLayout, getPageMargins, getReflowScope } from './layout.js';
import { replacePlaceholders } from './expression.js';

/** Floating point tolerance for comparisons */
const EPSILON = 0.01;

interface ModifyTemplateForDynamicTableArg {
  template: Template;
  input: Record<string, string>;
  _cache: Map<string | number, unknown>;
  options: CommonOptions;
  getDynamicHeights: (
    value: string,
    args: {
      schema: Schema;
      basePdf: BasePdf;
      options: CommonOptions;
      _cache: Map<string | number, unknown>;
      pageSize?: Size;
      margins?: PageMargins;
      siblings?: Schema[];
    },
  ) => Promise<DynamicLayoutCallbackResult>;
  /**
   * Page sizes (mm) of the base PDF. Required to reflow templates that use an
   * uploaded PDF as background, because their page geometry is not part of the
   * template itself.
   */
  pageSizes?: Size[];
}

/** Vertical geometry used to reflow a single template page. */
interface PageGeometry {
  contentHeight: number;
  paddingTop: number;
  pageSize?: Size;
  margins?: PageMargins;
}

/**
 * Large finite stand-in for "no page break". Using Infinity would make the
 * page-index arithmetic in placeUnitsOnPages produce NaN.
 */
const NO_PAGE_BREAK_HEIGHT = 1e9;

interface LayoutItem {
  schema: Schema;
  baseY: number;
  height: number;
  dynamicLayout: DynamicLayoutResult;
}

/** Calculate the content height of a page (drawable area excluding padding) */
const getContentHeight = (basePdf: BlankPdf): number =>
  basePdf.height - basePdf.padding[0] - basePdf.padding[2];

/**
 * Vertical geometry per template page.
 *
 * Blank PDFs use their padding and support page breaking. Uploaded PDFs use the
 * configured page margins and expand fields in place: the background artwork of
 * a continuation page is undefined, so fields are reflowed without adding pages.
 */
const getPageGeometries = (
  template: Template,
  pageSizes: Size[] | undefined,
): { geometries: PageGeometry[]; allowPageBreak: boolean } | undefined => {
  const basePdf = template.basePdf;
  if (isBlankPdf(basePdf)) {
    const [top, right, bottom, left] = basePdf.padding;
    const geometry: PageGeometry = {
      contentHeight: getContentHeight(basePdf),
      paddingTop: top,
      pageSize: { width: basePdf.width, height: basePdf.height },
      margins: { top, right, bottom, left },
    };
    return { geometries: template.schemas.map(() => geometry), allowPageBreak: true };
  }

  if (!pageSizes || pageSizes.length === 0) return undefined;

  const geometries = template.schemas.map((_, pageIndex) => {
    const pageSize = pageSizes[Math.min(pageIndex, pageSizes.length - 1)];
    const margins = getPageMargins(template, pageIndex);
    return {
      contentHeight: Math.max(0, pageSize.height - margins.top - margins.bottom),
      paddingTop: margins.top,
      pageSize,
      margins,
    };
  });

  return { geometries, allowPageBreak: false };
};

/** Get the input value for a schema */
const getSchemaValue = (
  schema: Schema,
  input: Record<string, string>,
  schemas: Schema[][],
): string => {
  if (!schema.readOnly) {
    return input?.[schema.name] || '';
  }

  if (schema.type !== 'text' && schema.type !== 'multiVariableText') {
    return schema.content || '';
  }

  return replacePlaceholders({
    content: schema.content || '',
    variables: input,
    schemas,
  });
};

/**
 * Normalize schemas within a single page into layout items.
 * Returns items sorted by Y coordinate with their order preserved.
 */
function normalizePageSchemas(
  pageSchemas: Schema[],
  paddingTop: number,
): { items: LayoutItem[]; orderMap: Map<string, number> } {
  const items: LayoutItem[] = [];
  const orderMap = new Map<string, number>();

  pageSchemas.forEach((schema, index) => {
    // Guard against negative Y position when schema.y < paddingTop
    // Prevents "Cannot read properties of undefined (reading 'push')" error
    const localY = Math.max(0, schema.position.y - paddingTop);
    items.push({
      schema: cloneDeep(schema),
      baseY: localY,
      height: schema.height,
      dynamicLayout: { heights: [schema.height] }, // Will be updated later
    });
    orderMap.set(schema.name, index);
  });

  // Sort by Y coordinate (preserve original order for same position)
  items.sort((a, b) => {
    if (Math.abs(a.baseY - b.baseY) > EPSILON) {
      return a.baseY - b.baseY;
    }
    return (orderMap.get(a.schema.name) ?? 0) - (orderMap.get(b.schema.name) ?? 0);
  });

  return { items, orderMap };
}

/**
 * Place height units on pages, splitting across pages as needed.
 * @returns The final global Y coordinate after placement
 */
function placeUnitsOnPages(
  schema: Schema,
  dynamicLayout: DynamicLayoutResult,
  startGlobalY: number,
  contentHeight: number,
  paddingTop: number,
  pages: Schema[][],
): number {
  const dynamicHeights = dynamicLayout.heights;
  let currentUnitIndex = 0;
  let currentPageIndex = Math.floor(startGlobalY / contentHeight);
  let currentYInPage = startGlobalY % contentHeight;

  if (currentYInPage < 0) currentYInPage = 0;

  let actualGlobalEndY = 0;
  const isSplittable = dynamicHeights.length > 1;

  while (currentUnitIndex < dynamicHeights.length) {
    // Ensure page exists
    while (pages.length <= currentPageIndex) pages.push([]);

    const spaceLeft = contentHeight - currentYInPage;
    const unitHeight = dynamicHeights[currentUnitIndex];

    // If a unit doesn't fit, move to next page
    if (unitHeight > spaceLeft + EPSILON) {
      const isAtPageStart = Math.abs(spaceLeft - contentHeight) <= EPSILON;

      if (!isAtPageStart) {
        currentPageIndex++;
        currentYInPage = 0;
        continue;
      }
      // Force placement for oversized units that don't fit even on a fresh page
    }

    // Pack as many units as possible on this page
    let chunkHeight = 0;
    const startUnitIndex = currentUnitIndex;

    while (currentUnitIndex < dynamicHeights.length) {
      const h = dynamicHeights[currentUnitIndex];
      if (currentYInPage + chunkHeight + h <= contentHeight + EPSILON) {
        chunkHeight += h;
        currentUnitIndex++;
      } else {
        break;
      }
    }

    // Some schemas, such as tables with headers, should not leave the first unit
    // alone on a page without any following data units.
    // BUT: if already at page top, don't move (prevents infinite loop when data row is too large)
    const isAtPageTop = currentYInPage <= EPSILON;
    if (
      dynamicLayout.avoidFirstUnitOnly &&
      isSplittable &&
      startUnitIndex === 0 &&
      currentUnitIndex === 1 &&
      dynamicHeights.length > 1 &&
      !isAtPageTop
    ) {
      currentUnitIndex = 0;
      currentPageIndex++;
      currentYInPage = 0;
      continue;
    }

    // Force at least one unit to prevent infinite loop
    if (currentUnitIndex === startUnitIndex) {
      chunkHeight += dynamicHeights[currentUnitIndex];
      currentUnitIndex++;
    }

    // Create schema for this chunk
    const patch =
      dynamicLayout.patchSplitSchema?.({
        schema,
        start: startUnitIndex,
        end: currentUnitIndex,
        isSplit: startUnitIndex > 0,
        chunkHeight,
      }) ?? {};

    const newSchema: Schema = {
      ...schema,
      ...patch,
      height: chunkHeight,
      position: { ...schema.position, y: currentYInPage + paddingTop },
    };

    pages[currentPageIndex].push(newSchema);

    // Update position
    currentYInPage += chunkHeight;

    if (currentYInPage >= contentHeight - EPSILON) {
      currentPageIndex++;
      currentYInPage = 0;
    }

    actualGlobalEndY = currentPageIndex * contentHeight + currentYInPage;
  }

  return actualGlobalEndY;
}

/** Sort elements within each page by their original order */
function sortPagesByOrder(pages: Schema[][], orderMap: Map<string, number>): void {
  pages.forEach((page) => {
    page.sort((a, b) => (orderMap.get(a.name) ?? 0) - (orderMap.get(b.name) ?? 0));
  });
}

/** Remove trailing empty pages */
function removeTrailingEmptyPages(pages: Schema[][]): void {
  while (pages.length > 1 && pages[pages.length - 1].length === 0) {
    pages.pop();
  }
}

/**
 * Process a single template page that has dynamic content.
 * Uses the same layout algorithm as the original implementation,
 * but scoped to a single page's schemas.
 */
function processDynamicPage(
  items: LayoutItem[],
  orderMap: Map<string, number>,
  contentHeight: number,
  paddingTop: number,
  allowPageBreak: boolean,
  scope: ReflowScope,
  elementSpacing: number,
): Schema[][] {
  const pages: Schema[][] = [];
  // With the `page` scope a single running offset shifts everything below the
  // grown field. With the `flow` scope each named flow keeps its own offset, so
  // fields outside that flow stay where the author placed them.
  const offsets = new Map<string, number>();
  const flowKeyOf = (schema: Schema) =>
    scope === 'page' ? '' : ((schema as { layoutFlow?: string }).layoutFlow ?? '');
  const offsetFor = (key: string) => (key === '' && scope === 'flow' ? 0 : (offsets.get(key) ?? 0));

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const flowKey = flowKeyOf(item.schema);
    const currentGlobalStartY = item.baseY + offsetFor(flowKey);

    const actualGlobalEndY = placeUnitsOnPages(
      item.schema,
      item.dynamicLayout,
      currentGlobalStartY,
      allowPageBreak ? contentHeight : NO_PAGE_BREAK_HEIGHT,
      paddingTop,
      pages,
    );

    // Preserve the source layout's gaps when they are already wider than the
    // configured minimum, but increase the running offset when the next field
    // would otherwise be too close to this field's expanded bounding box.
    const originalGlobalEndY = item.baseY + item.height;
    if (flowKey !== '' || scope === 'page') {
      const nextInFlow = items
        .slice(index + 1)
        .find((candidate) => flowKeyOf(candidate.schema) === flowKey);
      const minimumOffset = nextInFlow
        ? actualGlobalEndY + elementSpacing - nextInFlow.baseY
        : Number.NEGATIVE_INFINITY;
      offsets.set(flowKey, Math.max(actualGlobalEndY - originalGlobalEndY, minimumOffset));
    }
  }

  sortPagesByOrder(pages, orderMap);
  removeTrailingEmptyPages(pages);

  return pages;
}

const normalizeDynamicLayoutResult = (result: DynamicLayoutCallbackResult): DynamicLayoutResult => {
  const dynamicLayout = Array.isArray(result) ? { heights: result } : result;
  return {
    ...dynamicLayout,
    heights: dynamicLayout.heights.length === 0 ? [0] : dynamicLayout.heights,
  };
};

/**
 * Process a template containing tables with dynamic heights
 * and generate a new template with proper page breaks.
 *
 * Processing is done page-by-page:
 * - Pages with height changes are processed with full layout calculations
 * - Pages without height changes are copied as-is (no offset propagation between pages)
 *
 * This reduces computation cost by:
 * 1. Limiting layout calculations to pages that need them
 * 2. Avoiding cross-page offset propagation for static pages
 */
export const getDynamicTemplate = async (
  arg: ModifyTemplateForDynamicTableArg,
): Promise<Template> => {
  const { template, input, options, _cache, getDynamicHeights, pageSizes } = arg;
  const basePdf = template.basePdf;

  const pageGeometry = getPageGeometries(template, pageSizes);
  if (!pageGeometry) {
    return template;
  }
  const { geometries, allowPageBreak } = pageGeometry;
  const resultPages: Schema[][] = [];
  const PARALLEL_LIMIT = 10;

  // Process each template page independently
  for (let pageIndex = 0; pageIndex < template.schemas.length; pageIndex++) {
    const pageSchemas = template.schemas[pageIndex];

    if (pageSchemas.length === 0) {
      resultPages.push([]);
      continue;
    }

    const { contentHeight, paddingTop, pageSize, margins } = geometries[pageIndex];

    // Normalize this page's schemas
    const { items, orderMap } = normalizePageSchemas(pageSchemas, paddingTop);

    // Calculate dynamic heights for this page's schemas with concurrency limit
    for (let i = 0; i < items.length; i += PARALLEL_LIMIT) {
      const chunk = items.slice(i, i + PARALLEL_LIMIT);
      const chunkResults = await Promise.all(
        chunk.map((item) => {
          const value = getSchemaValue(item.schema, input, template.schemas);
          return getDynamicHeights(value, {
            schema: item.schema,
            basePdf,
            options,
            _cache,
            pageSize,
            margins,
            siblings: pageSchemas.filter((sibling) => sibling !== item.schema),
          }).then(normalizeDynamicLayoutResult);
        }),
      );
      // Update items with calculated dynamic layouts
      for (let j = 0; j < chunkResults.length; j++) {
        items[i + j].dynamicLayout = chunkResults[j];
      }
    }

    // Process all pages independently (no cross-page offset propagation)
    const pageLayout = getPageLayout(template, pageIndex);
    const processedPages = processDynamicPage(
      items,
      orderMap,
      contentHeight,
      paddingTop,
      allowPageBreak,
      getReflowScope(pageLayout),
      getElementSpacing(pageLayout),
    );
    resultPages.push(...processedPages);
  }

  // Check if anything changed - return original template if not
  if (resultPages.length === template.schemas.length) {
    let unchanged = true;
    for (let i = 0; i < resultPages.length && unchanged; i++) {
      if (resultPages[i].length !== template.schemas[i].length) {
        unchanged = false;
        break;
      }
      for (let j = 0; j < resultPages[i].length && unchanged; j++) {
        const orig = template.schemas[i][j];
        const result = resultPages[i][j];
        if (
          Math.abs(orig.height - result.height) > EPSILON ||
          Math.abs(orig.position.y - result.position.y) > EPSILON
        ) {
          unchanged = false;
        }
      }
    }
    if (unchanged) {
      return template;
    }
  }

  return { ...template, basePdf, schemas: resultPages };
};
