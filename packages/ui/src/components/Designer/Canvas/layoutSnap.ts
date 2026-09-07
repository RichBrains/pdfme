import {
  getContentBounds,
  getGridLinePositions,
  getGridSpacingMm,
  getGuidePositions,
  getPageLayout,
  type SchemaForUI,
  type Size,
  type Template,
} from '@pdfme/common';

export type SnapTargetKind = 'page' | 'margin' | 'guide' | 'grid' | 'field';
export type LayoutSnapTargets = {
  horizontal: number[];
  vertical: number[];
  targets: Array<{ axis: 'horizontal' | 'vertical'; position: number; kind: SnapTargetKind }>;
};

const add = (targets: LayoutSnapTargets['targets'], axis: 'horizontal' | 'vertical', position: number, kind: SnapTargetKind) => {
  if (!targets.some((target) => target.axis === axis && Math.abs(target.position - position) < 0.001)) targets.push({ axis, position, kind });
};

export const getLayoutSnapTargets = ({ template, pageIndex, pageSize, schemas, selectedIds }: {
  template: Template;
  pageIndex: number;
  pageSize: Size;
  schemas: SchemaForUI[];
  selectedIds: string[];
}): LayoutSnapTargets => {
  const layout = getPageLayout(template, pageIndex);
  const bounds = getContentBounds(layout.margins, pageSize);
  const targets: LayoutSnapTargets['targets'] = [];
  [0, pageSize.width / 2, pageSize.width].forEach((position) => add(targets, 'vertical', position, 'page'));
  [0, pageSize.height / 2, pageSize.height].forEach((position) => add(targets, 'horizontal', position, 'page'));
  [bounds.left, bounds.right].forEach((position) => add(targets, 'vertical', position, 'margin'));
  [bounds.top, bounds.bottom].forEach((position) => add(targets, 'horizontal', position, 'margin'));
  getGuidePositions(layout.verticalGuides).forEach((position) => add(targets, 'vertical', position, 'guide'));
  getGuidePositions(layout.horizontalGuides).forEach((position) => add(targets, 'horizontal', position, 'guide'));
  if (layout.grid.snap) {
    getGridLinePositions(pageSize.width, getGridSpacingMm(layout.grid)).forEach((position) => add(targets, 'vertical', position, 'grid'));
    getGridLinePositions(pageSize.height, getGridSpacingMm(layout.grid)).forEach((position) => add(targets, 'horizontal', position, 'grid'));
  }
  schemas.filter((schema) => !selectedIds.includes(schema.id)).forEach((schema) => {
    [schema.position.x, schema.position.x + schema.width / 2, schema.position.x + schema.width].forEach((position) => add(targets, 'vertical', position, 'field'));
    [schema.position.y, schema.position.y + schema.height / 2, schema.position.y + schema.height].forEach((position) => add(targets, 'horizontal', position, 'field'));
  });
  return {
    targets,
    horizontal: targets.filter((target) => target.axis === 'horizontal').map((target) => target.position),
    vertical: targets.filter((target) => target.axis === 'vertical').map((target) => target.position),
  };
};
