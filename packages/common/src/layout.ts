import type {
  BasePdf,
  ReflowScope,
  GridSettings,
  PageLayoutSettings,
  PageMargins,
  RulerGuide,
  Schema,
  Size,
  Template,
  TemplateLayout,
} from './types.js';
import { isBlankPdf, mm2pt, pt2mm } from './helper.js';

export const DEFAULT_GRID_SPACING_MM = 5;

export type ContentBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

export const getDefaultGridSettings = (): GridSettings => ({
  visible: false,
  snap: false,
  spacing: DEFAULT_GRID_SPACING_MM,
  unit: 'mm',
});

/**
 * Margins default to the blank-PDF padding when available so that existing
 * templates keep their current content area. Uploaded PDFs have no padding
 * field, so they start with a DEFAULT_MARGIN_MM margin on each side that
 * the author can configure.
 */
/** Default margin (mm) applied on each side when a base PDF has no padding to derive from. */
export const DEFAULT_MARGIN_MM = 20;

export const getDefaultPageMargins = (basePdf: BasePdf): PageMargins => {
  if (isBlankPdf(basePdf)) {
    const [top, right, bottom, left] = basePdf.padding;
    return { top, right, bottom, left };
  }
  return {
    top: DEFAULT_MARGIN_MM,
    right: DEFAULT_MARGIN_MM,
    bottom: DEFAULT_MARGIN_MM,
    left: DEFAULT_MARGIN_MM,
  };
};

export const DEFAULT_REFLOW_SCOPE: ReflowScope = 'page';
export const DEFAULT_ELEMENT_MARGINS: PageMargins = { top: 0, right: 0, bottom: 0, left: 0 };

export const getDefaultPageLayout = (basePdf: BasePdf): PageLayoutSettings => ({
  margins: getDefaultPageMargins(basePdf),
  reflowScope: DEFAULT_REFLOW_SCOPE,
  elementMargins: DEFAULT_ELEMENT_MARGINS,
  showMargins: true,
  grid: getDefaultGridSettings(),
  horizontalGuides: [],
  verticalGuides: [],
});

/** Returns the layout settings for a page, falling back to derived defaults. */
export const getPageLayout = (template: Template, pageIndex: number): PageLayoutSettings => {
  const page = template.layout?.pages?.[pageIndex];
  return page ?? getDefaultPageLayout(template.basePdf);
};

export const getPageMargins = (template: Template, pageIndex: number): PageMargins =>
  getPageLayout(template, pageIndex).margins;

/** Returns the four-sided margin used when snapping against other elements. */
export const getElementMargins = (layout: PageLayoutSettings): PageMargins =>
  layout.elementMargins ?? DEFAULT_ELEMENT_MARGINS;

/** Creates a fully populated layout for every page of the template. */
export const normalizeTemplateLayout = (template: Template): TemplateLayout => ({
  pages: template.schemas.map((_, pageIndex) => getPageLayout(template, pageIndex)),
});

export const getGridSpacingMm = (grid: GridSettings): number =>
  grid.unit === 'pt' ? pt2mm(grid.spacing) : grid.spacing;

export const getGridSpacingPt = (grid: GridSettings): number =>
  grid.unit === 'pt' ? grid.spacing : mm2pt(grid.spacing);

/** Content area (in mm) defined by the page size and the configured margins. */
export const getContentBounds = (margins: PageMargins, pageSize: Size): ContentBounds => {
  const left = margins.left;
  const top = margins.top;
  const right = Math.max(left, pageSize.width - margins.right);
  const bottom = Math.max(top, pageSize.height - margins.bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

export const getTemplateContentBounds = (
  template: Template,
  pageIndex: number,
  pageSize: Size,
): ContentBounds => getContentBounds(getPageMargins(template, pageIndex), pageSize);

/** True when any part of the schema lies outside the configured content area. */
export const isOutsideContentBounds = (
  schema: Pick<Schema, 'position' | 'width' | 'height'>,
  bounds: ContentBounds,
): boolean =>
  schema.position.x < bounds.left - 1e-6 ||
  schema.position.y < bounds.top - 1e-6 ||
  schema.position.x + schema.width > bounds.right + 1e-6 ||
  schema.position.y + schema.height > bounds.bottom + 1e-6;

/** Moves a schema position so the whole field fits inside the content area. */
export const clampToContentBounds = (
  schema: Pick<Schema, 'position' | 'width' | 'height'>,
  bounds: ContentBounds,
): { x: number; y: number } => {
  const maxX = Math.max(bounds.left, bounds.right - schema.width);
  const maxY = Math.max(bounds.top, bounds.bottom - schema.height);
  return {
    x: Math.min(Math.max(schema.position.x, bounds.left), maxX),
    y: Math.min(Math.max(schema.position.y, bounds.top), maxY),
  };
};

export type SchemaPlacement = Pick<Schema, 'position' | 'width' | 'height'>;

const isSchemaPlacementFree = (arg: {
  schema: SchemaPlacement;
  schemas: SchemaPlacement[];
  bounds: ContentBounds;
  margins: PageMargins;
}): boolean => {
  const { schema, schemas, bounds, margins } = arg;
  if (isOutsideContentBounds(schema, bounds)) return false;
  return schemas.every(
    (existing) =>
      schema.position.x + schema.width + margins.right <= existing.position.x - margins.left ||
      schema.position.x - margins.left >= existing.position.x + existing.width + margins.right ||
      schema.position.y + schema.height + margins.bottom <= existing.position.y - margins.top ||
      schema.position.y - margins.top >= existing.position.y + existing.height + margins.bottom,
  );
};

/** Finds the first position that keeps element-margin areas separate within page content bounds. */
export const findFreeSchemaPosition = (arg: {
  schema: SchemaPlacement;
  schemas: SchemaPlacement[];
  bounds: ContentBounds;
  margins?: PageMargins;
  preferredPosition?: { x: number; y: number };
}): { x: number; y: number } | undefined => {
  const { schema, schemas, bounds, preferredPosition } = arg;
  const margins = arg.margins ?? DEFAULT_ELEMENT_MARGINS;
  if (schema.width > bounds.width || schema.height > bounds.height) return undefined;

  const fits = (position: { x: number; y: number }): boolean =>
    isSchemaPlacementFree({ schema: { ...schema, position }, schemas, bounds, margins });

  if (preferredPosition) {
    const preferred = clampToContentBounds({ ...schema, position: preferredPosition }, bounds);
    if (fits(preferred)) return preferred;
  }

  const xCandidates = new Set<number>([bounds.left, bounds.right - schema.width]);
  const yCandidates = new Set<number>([bounds.top, bounds.bottom - schema.height]);
  schemas.forEach((existing) => {
    xCandidates.add(existing.position.x - margins.left - margins.right - schema.width);
    xCandidates.add(existing.position.x + existing.width + margins.right + margins.left);
    yCandidates.add(existing.position.y - margins.top - margins.bottom - schema.height);
    yCandidates.add(existing.position.y + existing.height + margins.bottom + margins.top);
  });

  const xs = [...xCandidates]
    .filter((x) => x >= bounds.left && x + schema.width <= bounds.right)
    .sort((a, b) => a - b);
  const ys = [...yCandidates]
    .filter((y) => y >= bounds.top && y + schema.height <= bounds.bottom)
    .sort((a, b) => a - b);

  for (const y of ys) {
    for (const x of xs) {
      const position = { x, y };
      if (fits(position)) return position;
    }
  }

  return undefined;
};

export const snapValueToGrid = (value: number, spacingMm: number): number =>
  spacingMm > 0 ? Math.round(value / spacingMm) * spacingMm : value;

/** Grid line positions (mm) for one axis, excluding the 0 and `length` edges. */
export const getGridLinePositions = (length: number, spacingMm: number): number[] => {
  if (!(spacingMm > 0) || !(length > 0)) return [];
  const positions: number[] = [];
  for (let pos = spacingMm; pos < length; pos += spacingMm) {
    positions.push(Number(pos.toFixed(4)));
  }
  return positions;
};

export const getGuidePositions = (guides: RulerGuide[]): number[] =>
  guides.map((guide) => guide.position);

export const getReflowScope = (layout: PageLayoutSettings): ReflowScope =>
  layout.reflowScope ?? DEFAULT_REFLOW_SCOPE;

/**
 * Fields that should move when `schema` grows.
 *
 * With the `page` scope every field lower on the page follows, which matches
 * historical pdfme behavior. With the `flow` scope only fields sharing the same
 * `layoutFlow` follow, so absolutely positioned artwork such as logos,
 * signatures, or sidebars stays where the author put it.
 */
export const getReflowFollowers = <
  T extends Pick<Schema, 'position' | 'height'> & { layoutFlow?: string },
>(arg: {
  schema: T;
  schemas: T[];
  scope: ReflowScope;
}): T[] => {
  const { schema, schemas, scope } = arg;
  const bottom = schema.position.y + schema.height;
  return schemas.filter((candidate) => {
    if (candidate === schema) return false;
    if (candidate.position.y < bottom) return false;
    if (scope === 'page') return true;
    return Boolean(schema.layoutFlow) && candidate.layoutFlow === schema.layoutFlow;
  });
};
