import { describe, expect, it } from 'vitest';
import { getLayoutSnapTargets } from '../src/components/Designer/Canvas/layoutSnap.js';
import type { SchemaForUI, Template } from '@pdfme/common';

const basePdf = { width: 100, height: 100, padding: [0, 0, 0, 0] };
const template: Template = {
  basePdf,
  schemas: [[]],
  layout: {
    pages: [
      {
        margins: { top: 10, right: 20, bottom: 30, left: 15 },
        showMargins: true,
        grid: { visible: true, snap: true, spacing: 5, unit: 'mm' },
        horizontalGuides: [{ position: 12 }],
        verticalGuides: [{ position: 18 }],
      },
    ],
  },
};
const schema = (id: string, x: number, y: number): SchemaForUI => ({
  id,
  name: id,
  type: 'text',
  position: { x, y },
  width: 10,
  height: 10,
  content: '',
});

describe('getLayoutSnapTargets', () => {
  it('includes page, margins, grid, guides, and unselected field edges and centres', () => {
    const targets = getLayoutSnapTargets({
      template,
      pageIndex: 0,
      pageSize: { width: 100, height: 100 },
      schemas: [schema('active', 1, 1), schema('other', 30, 40)],
      selectedIds: ['active'],
    });
    expect(targets.vertical).toEqual(expect.arrayContaining([0, 15, 18, 50, 100, 30, 35, 40]));
    expect(targets.horizontal).toEqual(expect.arrayContaining([0, 10, 12, 50, 70, 100, 40, 45]));
  });

  it('excludes selected fields from their own snap targets', () => {
    const targets = getLayoutSnapTargets({
      template,
      pageIndex: 0,
      pageSize: { width: 100, height: 100 },
      schemas: [schema('active', 31, 41)],
      selectedIds: ['active'],
    });
    expect(targets.vertical).not.toContain(31);
    expect(targets.horizontal).not.toContain(41);
  });
});

import { getSnapFeedback } from '../src/components/Designer/Canvas/layoutSnap.js';

describe('getSnapFeedback', () => {
  const targets = [
    { axis: 'vertical' as const, position: 10, kind: 'margin' as const },
    { axis: 'horizontal' as const, position: 20, kind: 'guide' as const },
    { axis: 'vertical' as const, position: 30, kind: 'field' as const },
  ];

  it('returns the label key for the closest explicit snap target', () => {
    expect(
      getSnapFeedback({
        targets,
        frame: { left: 10.2, top: 40, width: 5, height: 5 },
        threshold: 0.5,
      }),
    ).toEqual({ key: 'layoutSnapMargin' });
    expect(
      getSnapFeedback({
        targets,
        frame: { left: 40, top: 20.1, width: 5, height: 5 },
        threshold: 0.5,
      }),
    ).toEqual({ key: 'layoutSnapGuide' });
  });

  it('recognizes grid snaps when there is no explicit guideline match', () => {
    expect(
      getSnapFeedback({
        targets: [],
        gridSpacing: 5,
        frame: { left: 10.1, top: 9, width: 2, height: 2 },
        threshold: 0.2,
      }),
    ).toEqual({ key: 'layoutSnapGrid' });
  });

  it('uses nearest distance, then source priority, deterministically', () => {
    expect(
      getSnapFeedback({
        targets: [
          { axis: 'vertical', position: 10.1, kind: 'margin' },
          { axis: 'vertical', position: 10.1, kind: 'guide' },
        ],
        frame: { left: 10, top: 50, width: 2, height: 2 },
        threshold: 0.2,
      }),
    ).toEqual({ key: 'layoutSnapGuide' });
    expect(
      getSnapFeedback({
        targets: [{ axis: 'vertical', position: 10.15, kind: 'guide' }],
        gridSpacing: 5,
        frame: { left: 10.02, top: 50, width: 2, height: 2 },
        threshold: 0.2,
      }),
    ).toEqual({ key: 'layoutSnapGrid' });
  });
});
