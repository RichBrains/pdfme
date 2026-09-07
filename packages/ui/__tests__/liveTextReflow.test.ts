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
  it('updates only the active text box for default auto-expand', () => {
    const active = schema('active', 10, 10);
    expect(
      getLiveTextReflowChanges({
        schema: active,
        width: 25,
        height: 16,
      }),
    ).toEqual([
      { key: 'width', value: 25, schemaId: 'active' },
      { key: 'height', value: 16, schemaId: 'active' },
    ]);
  });

  it('applies reduced measured heights as well as expansion', () => {
    const active = schema('active', 10, 10);
    expect(getLiveTextReflowChanges({ schema: active, height: 6 })).toEqual([
      { key: 'height', value: 6, schemaId: 'active' },
    ]);
  });
});
