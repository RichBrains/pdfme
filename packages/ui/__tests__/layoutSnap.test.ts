import { describe, expect, it } from 'vitest';
import { getLayoutSnapTargets } from '../src/components/Designer/Canvas/layoutSnap.js';
import type { SchemaForUI, Template } from '@pdfme/common';

const basePdf = { width: 100, height: 100, padding: [0, 0, 0, 0] };
const template: Template = {
  basePdf,
  schemas: [[]],
  layout: { pages: [{ margins: { top: 10, right: 20, bottom: 30, left: 15 }, showMargins: true, grid: { visible: true, snap: true, spacing: 5, unit: 'mm' }, horizontalGuides: [{ position: 12 }], verticalGuides: [{ position: 18 }] }] },
};
const schema = (id: string, x: number, y: number): SchemaForUI => ({ id, name: id, type: 'text', position: { x, y }, width: 10, height: 10, content: '' });

describe('getLayoutSnapTargets', () => {
  it('includes page, margins, grid, guides, and unselected field edges and centres', () => {
    const targets = getLayoutSnapTargets({ template, pageIndex: 0, pageSize: { width: 100, height: 100 }, schemas: [schema('active', 1, 1), schema('other', 30, 40)], selectedIds: ['active'] });
    expect(targets.vertical).toEqual(expect.arrayContaining([0, 15, 18, 50, 100, 30, 35, 40]));
    expect(targets.horizontal).toEqual(expect.arrayContaining([0, 10, 12, 50, 70, 100, 40, 45]));
  });

  it('excludes selected fields from their own snap targets', () => {
    const targets = getLayoutSnapTargets({ template, pageIndex: 0, pageSize: { width: 100, height: 100 }, schemas: [schema('active', 31, 41)], selectedIds: ['active'] });
    expect(targets.vertical).not.toContain(31);
    expect(targets.horizontal).not.toContain(41);
  });
});
