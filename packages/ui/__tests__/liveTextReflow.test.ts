import { describe, expect, it } from 'vitest';
import {
  getLiveTextReflowChanges,
  heightFingerprint,
  isHeightLockedSchema,
} from '../src/components/Designer/Canvas/liveTextReflow.js';
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

  it('keeps a reflow follower directly below the expanded field', () => {
    const active = schema('active', 10, 10);
    const follower = schema('follower', 20, 10);
    expect(
      getLiveTextReflowChanges({
        schemas: [active, follower],
        schema: active,
        height: 16,
        scope: 'page',
      }),
    ).toEqual([
      { key: 'height', value: 16, schemaId: 'active' },
      { key: 'position.y', value: 26, schemaId: 'follower' },
    ]);
  });
});

describe('isHeightLockedSchema', () => {
  it.each([
    'text',
    'multiVariableText',
    'conditionalTextBlock',
    'list',
    'table',
    'blockTable',
  ])('locks %s to its content height', (type) => {
    expect(isHeightLockedSchema({ type } as SchemaForUI)).toBe(true);
  });

  it.each(['image', 'line', 'rectangle', 'ellipse', 'svg', 'qrcode', 'signature'])(
    'leaves %s freely resizable',
    (type) => {
      expect(isHeightLockedSchema({ type } as SchemaForUI)).toBe(false);
    },
  );
});

describe('heightFingerprint', () => {
  const locked = (overrides: Record<string, unknown> = {}): SchemaForUI =>
    ({
      id: 'a',
      name: 'a',
      type: 'table',
      content: '[]',
      position: { x: 10, y: 20 },
      width: 50,
      height: 30,
      ...overrides,
    }) as SchemaForUI;

  it('changes when content or width changes', () => {
    const base = heightFingerprint(locked());
    expect(heightFingerprint(locked({ content: '[["x"]]' }))).not.toBe(base);
    expect(heightFingerprint(locked({ width: 60 }))).not.toBe(base);
  });

  it('ignores geometry and volatile generation outputs so reflows converge', () => {
    const base = heightFingerprint(locked());
    expect(
      heightFingerprint(
        locked({
          position: { x: 99, y: 99 },
          dynamicFontSize: { min: 1, max: 2 },
        }),
      ),
    ).toBe(base);
  });

  it('tracks height outputs so wholesale replacements re-snap', () => {
    const base = heightFingerprint(locked());
    expect(heightFingerprint(locked({ height: 99 }))).not.toBe(base);
    expect(heightFingerprint(locked({ minHeight: 12 }))).not.toBe(
      base,
    );
    expect(
      heightFingerprint(locked({ contentMinHeight: 14 })),
    ).not.toBe(base);
  });
});
