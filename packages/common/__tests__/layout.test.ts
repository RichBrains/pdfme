import {
  clampToContentBounds,
  getReflowFollowers,
  getReflowScope,
  getContentBounds,
  getDefaultPageLayout,
  getDefaultPageMargins,
  getGridLinePositions,
  getGridSpacingMm,
  getPageLayout,
  getPageMargins,
  isOutsideContentBounds,
  normalizeTemplateLayout,
  snapValueToGrid,
} from '../src/layout.js';
import { mm2pt } from '../src/helper.js';
import type { Template } from '../src/index.js';

const blankPdf = { width: 210, height: 297, padding: [10, 20, 30, 40] as [number, number, number, number] };
const customPdf = 'data:application/pdf;base64,AA==';

const templateWith = (basePdf: Template['basePdf'], layout?: Template['layout']): Template => ({
  basePdf,
  schemas: [[]],
  ...(layout ? { layout } : {}),
});

describe('page margins', () => {
  it('derives blank pdf margins from padding', () => {
    expect(getDefaultPageMargins(blankPdf)).toEqual({
      top: 10,
      right: 20,
      bottom: 30,
      left: 40,
    });
  });

  it('starts uploaded pdf templates without margins', () => {
    expect(getDefaultPageMargins(customPdf)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it('prefers the persisted page layout over the derived default', () => {
    const layout = {
      pages: [
        {
          ...getDefaultPageLayout(customPdf),
          margins: { top: 5, right: 6, bottom: 7, left: 8 },
        },
      ],
    };

    expect(getPageMargins(templateWith(customPdf, layout), 0)).toEqual({
      top: 5,
      right: 6,
      bottom: 7,
      left: 8,
    });
  });

  it('falls back to defaults for pages without persisted settings', () => {
    const template = templateWith(blankPdf, { pages: [] });
    expect(getPageLayout(template, 3).margins).toEqual(getDefaultPageMargins(blankPdf));
  });

  it('normalizes a layout entry for every template page', () => {
    const template: Template = { basePdf: customPdf, schemas: [[], [], []] };
    expect(normalizeTemplateLayout(template).pages).toHaveLength(3);
  });
});

describe('content bounds', () => {
  const margins = { top: 10, right: 20, bottom: 30, left: 40 };
  const pageSize = { width: 210, height: 297 };

  it('computes the printable area', () => {
    expect(getContentBounds(margins, pageSize)).toEqual({
      left: 40,
      top: 10,
      right: 190,
      bottom: 267,
      width: 150,
      height: 257,
    });
  });

  it('never produces negative content areas', () => {
    const bounds = getContentBounds({ top: 200, right: 200, bottom: 200, left: 200 }, pageSize);
    expect(bounds.width).toBe(0);
    expect(bounds.height).toBe(0);
  });

  it('detects fields outside the content area', () => {
    const bounds = getContentBounds(margins, pageSize);
    const inside = { position: { x: 50, y: 20 }, width: 10, height: 10 };
    const outside = { position: { x: 185, y: 20 }, width: 10, height: 10 };

    expect(isOutsideContentBounds(inside, bounds)).toBe(false);
    expect(isOutsideContentBounds(outside, bounds)).toBe(true);
  });

  it('moves a field back inside the content area', () => {
    const bounds = getContentBounds(margins, pageSize);
    const outside = { position: { x: 300, y: 0 }, width: 10, height: 10 };

    expect(clampToContentBounds(outside, bounds)).toEqual({ x: 180, y: 10 });
  });
});

describe('grid', () => {
  it('converts pt spacing to mm', () => {
    expect(getGridSpacingMm({ visible: true, snap: true, spacing: mm2pt(5), unit: 'pt' })).toBeCloseTo(5);
  });

  it('snaps values to the nearest grid line', () => {
    expect(snapValueToGrid(12, 5)).toBe(10);
    expect(snapValueToGrid(13, 5)).toBe(15);
    expect(snapValueToGrid(13, 0)).toBe(13);
  });

  it('lists interior grid lines only', () => {
    expect(getGridLinePositions(20, 5)).toEqual([5, 10, 15]);
    expect(getGridLinePositions(20, 0)).toEqual([]);
  });
});

describe('reflow scope', () => {
  const field = (name: string, y: number, layoutFlow?: string) => ({
    name,
    position: { x: 0, y },
    height: 10,
    ...(layoutFlow ? { layoutFlow } : {}),
  });

  it('defaults to page scope for backward compatibility', () => {
    expect(getReflowScope(getDefaultPageLayout(customPdf))).toBe('page');
    expect(getReflowScope({ ...getDefaultPageLayout(customPdf), reflowScope: undefined })).toBe(
      'page',
    );
  });

  it('moves every lower field in page scope', () => {
    const active = field('body', 10);
    const followers = getReflowFollowers({
      schema: active,
      schemas: [active, field('logo', 40), field('header', 0)],
      scope: 'page',
    });

    expect(followers.map((item) => item.name)).toEqual(['logo']);
  });

  it('moves only same-flow fields in flow scope', () => {
    const active = field('body', 10, 'letter');
    const followers = getReflowFollowers({
      schema: active,
      schemas: [active, field('closing', 40, 'letter'), field('logo', 50)],
      scope: 'flow',
    });

    expect(followers.map((item) => item.name)).toEqual(['closing']);
  });

  it('moves nothing in flow scope when the field has no flow', () => {
    const active = field('body', 10);
    expect(
      getReflowFollowers({
        schema: active,
        schemas: [active, field('lower', 40, 'letter')],
        scope: 'flow',
      }),
    ).toEqual([]);
  });
});
