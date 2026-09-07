import { describe, expect, it } from 'vitest';
import {
  getIndentChange,
  getIndentMarkerPositions,
} from '../src/components/Designer/Canvas/indentRuler.js';

const schema = {
  position: { x: 10 },
  width: 80,
  leftIndent: 5,
  rightIndent: 7,
  specialIndent: 3,
};

describe('paragraph indent ruler helpers', () => {
  it('positions first-line and hanging markers relative to the field content box', () => {
    expect(getIndentMarkerPositions({ ...schema, indentMode: 'firstLine' })).toEqual({
      left: 15,
      firstLine: 18,
      right: 83,
    });
    expect(getIndentMarkerPositions({ ...schema, indentMode: 'hanging' })).toEqual({
      left: 18,
      firstLine: 15,
      right: 83,
    });
  });

  it('converts marker drags into persisted mm indent values', () => {
    expect(getIndentChange({ marker: 'left', position: 20, schema })).toEqual({
      key: 'leftIndent',
      value: 10,
    });
    expect(getIndentChange({ marker: 'right', position: 75, schema })).toEqual({
      key: 'rightIndent',
      value: 15,
    });
    expect(
      getIndentChange({
        marker: 'firstLine',
        position: 21,
        schema: { ...schema, indentMode: 'firstLine' },
      }),
    ).toEqual({
      key: 'specialIndent',
      value: 6,
    });
  });

  it('allows dragging the first-line marker into an outdent', () => {
    expect(
      getIndentChange({
        marker: 'firstLine',
        position: 12,
        schema: { ...schema, indentMode: 'firstLine' },
      }),
    ).toEqual({ key: 'specialIndent', value: -3 });
  });
});
