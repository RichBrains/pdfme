import {
  getContentBounds,
  getElementMargins,
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
    { axis: 'vertical' as const, position: frame.left, centre: false },
    { axis: 'vertical' as const, position: frame.left + frame.width / 2, centre: true },
    { axis: 'vertical' as const, position: frame.left + frame.width, centre: false },
    { axis: 'horizontal' as const, position: frame.top, centre: false },
    { axis: 'horizontal' as const, position: frame.top + frame.height / 2, centre: true },
    { axis: 'horizontal' as const, position: frame.top + frame.height, centre: false },
  ];
  const priority: Record<SnapTargetKind, number> = {
    guide: 0,
    field: 1,
    margin: 2,
    page: 3,
    grid: 4,
  };
  const candidates = positions.flatMap(({ axis, position, centre }, positionIndex) =>
    targets
      .map((target, targetIndex) => ({
        target,
        distance: Math.abs(target.position - position),
        centre,
        axisIndex: axis === 'vertical' ? 0 : 1,
        positionIndex,
        targetIndex,
      }))
      .filter((candidate) => candidate.target.axis === axis && candidate.distance <= threshold),
  );
  if (gridSpacing) {
    positions.forEach(({ axis, position, centre }, positionIndex) => {
      const nearest = Math.round(position / gridSpacing) * gridSpacing;
      const distance = Math.abs(nearest - position);
      if (distance <= threshold) {
        candidates.push({
          target: { axis, position: nearest, kind: 'grid' },
          distance,
          centre,
          axisIndex: axis === 'vertical' ? 0 : 1,
          positionIndex,
          targetIndex: Number.MAX_SAFE_INTEGER,
        });
      }
    });
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      priority[a.target.kind] - priority[b.target.kind] ||
      a.axisIndex - b.axisIndex ||
      a.positionIndex - b.positionIndex ||
      a.targetIndex - b.targetIndex,
  );
  const match = candidates[0];
  if (!match) return null;
  if (match.target.kind === 'margin') return { key: 'layoutSnapMargin' };
  if (match.target.kind === 'guide') return { key: 'layoutSnapGuide' };
  if (match.target.kind === 'field') return { key: 'layoutSnapField' };
  if (match.target.kind === 'grid') return { key: 'layoutSnapGrid' };
  return { key: match.centre ? 'layoutSnapPageCentre' : 'layoutSnapPageEdge' };
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
  const elementMargins = getElementMargins(layout);
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
      // Fields snap to the outer boundary of another field's configured margin,
      // not directly to its bounding box. Zero margins preserve the old targets.
      [
        schema.position.x - elementMargins.left,
        schema.position.x + schema.width / 2,
        schema.position.x + schema.width + elementMargins.right,
      ].forEach((position) => add(targets, 'vertical', position, 'field'));
      [
        schema.position.y - elementMargins.top,
        schema.position.y + schema.height / 2,
        schema.position.y + schema.height + elementMargins.bottom,
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
