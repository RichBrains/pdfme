import React, { useState } from 'react';
import { ZOOM, type SchemaForUI } from '@pdfme/common';
import { getIndentChange, getIndentMarkerPositions, type TextIndent } from './indentRuler.js';

type TextSchema = SchemaForUI & TextIndent & { type: 'text' | 'multiVariableText' };

const markerStyle = (
  position: number,
  shape: 'triangle-up' | 'triangle-down' | 'bar',
): React.CSSProperties => ({
  position: 'absolute',
  left: position * ZOOM - 6,
  top: shape === 'triangle-up' ? 1 : shape === 'triangle-down' ? 12 : 5,
  width: 0,
  height: shape === 'bar' ? 14 : 0,
  cursor: 'ew-resize',
  zIndex: 4,
  borderLeft: shape === 'bar' ? '2px solid #1677ff' : '6px solid transparent',
  borderRight: shape === 'bar' ? undefined : '6px solid transparent',
  borderTop: shape === 'triangle-down' ? '8px solid #1677ff' : undefined,
  borderBottom: shape === 'triangle-up' ? '8px solid #1677ff' : undefined,
  padding: shape === 'bar' ? '0 1px' : undefined,
});

const IndentMarkers = ({
  schema,
  paperElement,
  scale,
  onChange,
}: {
  schema: TextSchema;
  paperElement: HTMLDivElement | undefined;
  scale: number;
  onChange: (key: 'leftIndent' | 'rightIndent' | 'specialIndent', value: number) => void;
}) => {
  const positions = getIndentMarkerPositions(schema);
  const [dragging, setDragging] = useState<keyof typeof positions | null>(null);
  const [position, setPosition] = useState<number | null>(null);
  const displayed = {
    ...positions,
    ...(dragging && position !== null ? { [dragging]: position } : {}),
  };

  const startDrag = (marker: keyof typeof positions, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(marker);
    setPosition(positions[marker]);
  };
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || !paperElement) return;
    const rect = paperElement.getBoundingClientRect();
    setPosition(Math.max(schema.position.x, (event.clientX - rect.left) / scale / ZOOM));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || position === null) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const change = getIndentChange({ marker: dragging, position, schema });
    onChange(change.key, change.value);
    setDragging(null);
    setPosition(null);
  };
  return (
    <div
      aria-label="Paragraph indentation rulers"
      style={{ position: 'absolute', top: -24, left: 0, right: 0, height: 24, zIndex: 4 }}
    >
      <div
        title="First-line indent"
        style={markerStyle(displayed.firstLine, 'triangle-up')}
        onPointerDown={(event) => startDrag('firstLine', event)}
        onPointerMove={move}
        onPointerUp={endDrag}
      />
      <div
        title="Left indent"
        style={markerStyle(displayed.left, 'triangle-down')}
        onPointerDown={(event) => startDrag('left', event)}
        onPointerMove={move}
        onPointerUp={endDrag}
      />
      <div
        title="Right indent"
        style={markerStyle(displayed.right, 'bar')}
        onPointerDown={(event) => startDrag('right', event)}
        onPointerMove={move}
        onPointerUp={endDrag}
      />
    </div>
  );
};

export const isTextIndentSchema = (schema: SchemaForUI | undefined): schema is TextSchema =>
  schema?.type === 'text' || schema?.type === 'multiVariableText';

export default IndentMarkers;
