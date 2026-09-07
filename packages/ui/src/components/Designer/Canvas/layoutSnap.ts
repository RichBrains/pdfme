import {
  getContentBounds,
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
  /** Grid spacing (mm) when grid snapping is enabled, otherwise undefined. */
  gridSpacing?: number;
  targets: Array<{ axis: 'horizontal' | 'vertical'; position: number; kind: SnapTargetKind }>;
};

export type SnapFeedback = {
  key:
    | 'layoutSnapMargin'
    | 'layoutSnapGuide'
    | 'layoutSnapGrid'
    | 'layoutSnapField'
    | 'layoutSnapPageCentre'
    | 'layoutSnapPageEdge';
};

export const getSnapFeedback = ({
  targets,
  gridSpacing,
  frame,
  threshold = 5 / 3.7795275591,
}: {
  targets: LayoutSnapTargets['targets'];
  gridSpacing?: number;
  frame: { left: number; top: number; width: number; height: number };
  threshold?: number;
}): SnapFeedback | null => {
  const positions = [
    { axis: 'vertical' as const, position: frame.left },
    { axis: 'vertical' as const, position: frame.left + frame.width / 2 },
    { axis: 'vertical' as const, position: frame.left + frame.width },
    { axis: 'horizontal' as const, position: frame.top },
    { axis: 'horizontal' as const, position: frame.top + frame.height / 2 },
    { axis: 'horizontal' as const, position: frame.top + frame.height },
  ];
  const match = positions.flatMap(({ axis, position }) =>
    targets.filter(
      (target) => target.axis === axis && Math.abs(target.position - position) <= threshold,
    ),
  )[0];
  if (match) {
    if (match.kind === 'margin') return { key: 'layoutSnapMargin' };
    if (match.kind === 'guide') return { key: 'layoutSnapGuide' };
    if (match.kind === 'field') return { key: 'layoutSnapField' };
    if (match.kind === 'page') {
      const isCentre =
        Math.abs(
          match.position -
            (match.axis === 'vertical'
              ? frame.left + frame.width / 2
              : frame.top + frame.height / 2),
        ) <= threshold;
      return { key: isCentre ? 'layoutSnapPageCentre' : 'layoutSnapPageEdge' };
    }
  }
  if (
    gridSpacing &&
    positions.some(
      ({ position }) =>
        Math.abs(position / gridSpacing - Math.round(position / gridSpacing)) <=
        threshold / gridSpacing,
    )
  ) {
    return { key: 'layoutSnapGrid' };
  }
  return null;
};

const add = (
  targets: LayoutSnapTargets['targets'],
  axis: 'horizontal' | 'vertical',
  position: number,
  kind: SnapTargetKind,
) => {
  if (
    !targets.some((target) => target.axis === axis && Math.abs(target.position - position) < 0.001)
  )
    targets.push({ axis, position, kind });
};

export const getLayoutSnapTargets = ({
  template,
  pageIndex,
  pageSize,
  schemas,
  selectedIds,
}: {
  template: Template;
  pageIndex: number;
  pageSize: Size;
  schemas: SchemaForUI[];
  selectedIds: string[];
}): LayoutSnapTargets => {
  const layout = getPageLayout(template, pageIndex);
  const bounds = getContentBounds(layout.margins, pageSize);
  const targets: LayoutSnapTargets['targets'] = [];
  [0, pageSize.width / 2, pageSize.width].forEach((position) =>
    add(targets, 'vertical', position, 'page'),
  );
  [0, pageSize.height / 2, pageSize.height].forEach((position) =>
    add(targets, 'horizontal', position, 'page'),
  );
  [bounds.left, bounds.right].forEach((position) => add(targets, 'vertical', position, 'margin'));
  [bounds.top, bounds.bottom].forEach((position) => add(targets, 'horizontal', position, 'margin'));
  getGuidePositions(layout.verticalGuides).forEach((position) =>
    add(targets, 'vertical', position, 'guide'),
  );
  getGuidePositions(layout.horizontalGuides).forEach((position) =>
    add(targets, 'horizontal', position, 'guide'),
  );
  // Grid snapping is handled by Moveable's own grid support instead of being
  // expanded into one guideline per grid line.
  const gridSpacing = layout.grid.snap ? getGridSpacingMm(layout.grid) : undefined;
  schemas
    .filter((schema) => !selectedIds.includes(schema.id))
    .forEach((schema) => {
      [
        schema.position.x,
        schema.position.x + schema.width / 2,
        schema.position.x + schema.width,
      ].forEach((position) => add(targets, 'vertical', position, 'field'));
      [
        schema.position.y,
        schema.position.y + schema.height / 2,
        schema.position.y + schema.height,
      ].forEach((position) => add(targets, 'horizontal', position, 'field'));
    });
  return {
    targets,
    gridSpacing,
    horizontal: targets
      .filter((target) => target.axis === 'horizontal')
      .map((target) => target.position),
    vertical: targets
      .filter((target) => target.axis === 'vertical')
      .map((target) => target.position),
  };
};
