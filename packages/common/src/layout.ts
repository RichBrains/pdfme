import type {
  BasePdf,
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
 * field, so they start with zero margins that the author can configure.
 */
export const getDefaultPageMargins = (basePdf: BasePdf): PageMargins => {
  if (isBlankPdf(basePdf)) {
    const [top, right, bottom, left] = basePdf.padding;
    return { top, right, bottom, left };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
};

export const getDefaultPageLayout = (basePdf: BasePdf): PageLayoutSettings => ({
  margins: getDefaultPageMargins(basePdf),
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
