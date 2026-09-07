import React from 'react';
import { getGridLinePositions, getGridSpacingMm, type GridSettings, ZOOM } from '@pdfme/common';

const Grid = ({
  grid,
  pageSize,
}: {
  grid: GridSettings;
  pageSize: { width: number; height: number };
}) => {
  if (!grid.visible) return null;
  const spacing = getGridSpacingMm(grid);
  const vertical = getGridLinePositions(pageSize.width, spacing);
  const horizontal = getGridLinePositions(pageSize.height, spacing);
  const color = 'rgba(22, 119, 255, 0.18)';

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    >
      {vertical.map((position) => (
        <div
          key={`v-${position}`}
          style={{
            position: 'absolute',
            left: position * ZOOM,
            top: 0,
            bottom: 0,
            width: 1,
            background: color,
          }}
        />
      ))}
      {horizontal.map((position) => (
        <div
          key={`h-${position}`}
          style={{
            position: 'absolute',
            top: position * ZOOM,
            left: 0,
            right: 0,
            height: 1,
            background: color,
          }}
        />
      ))}
    </div>
  );
};

export default Grid;
