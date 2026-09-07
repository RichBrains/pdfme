import { describe, expect, it } from 'vitest';
import { getLiveTextReflowChanges } from '../src/components/Designer/Canvas/liveTextReflow.js';
import type { SchemaForUI } from '@pdfme/common';

const schema = (id: string, y: number, height: number): SchemaForUI => ({
  id,
  name: id,
  type: 'text',
  content: '',
  position: { x: 0, y },
  width: 20,
  height,
});

describe('getLiveTextReflowChanges', () => {
  it('updates the active text box and shifts lower fields by its height delta', () => {
    const active = schema('active', 10, 10);
    expect(
      getLiveTextReflowChanges({
        schemas: [active, schema('lower', 20, 5), schema('above', 2, 5)],
        schema: active,
        width: 25,
        height: 16,
      }),
    ).toEqual([
      { key: 'width', value: 25, schemaId: 'active' },
      { key: 'height', value: 16, schemaId: 'active' },
      { key: 'position.y', value: 26, schemaId: 'lower' },
    ]);
  });

  it('does not move neighbouring fields when the measured height is unchanged', () => {
    const active = schema('active', 10, 10);
    expect(
      getLiveTextReflowChanges({
        schemas: [active, schema('lower', 20, 5)],
        schema: active,
        height: 10,
      }),
    ).toEqual([]);
  });
});
