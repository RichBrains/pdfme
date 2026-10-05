import React from 'react';
import type * as CSS from 'csstype';
import { getPageMargins, type Template, ZOOM } from '@pdfme/common';
import { theme } from 'antd';

type Side = 'top' | 'right' | 'bottom' | 'left';

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const BORDER_PROPERTY = {
  top: 'borderBottom',
  right: 'borderLeft',
  bottom: 'borderTop',
  left: 'borderRight',
} as const;

/**
 * One band per margin: a faint tint over the no-content area with a thin
 * dashed line on its inner edge. Physical sides on purpose: page geometry
 * does not flip with the writing direction. The line is a real border so it
 * stays visible in forced-colors mode.
 */
const getMarginStyle = (
  side: Side,
  size: number,
  tint: string,
  line: string,
): CSS.Properties => {
  const style: CSS.Properties = {
    position: 'absolute',
    boxSizing: 'border-box',
    background: `color-mix(in srgb, ${tint} 4%, transparent)`,
    pointerEvents: 'none',
    zIndex: 3,
  };
  const extent = `${size * ZOOM}px`;
  style[side] = 0;
  if (side === 'top' || side === 'bottom') {
    Object.assign(style, { left: 0, right: 0, height: extent });
  } else {
    Object.assign(style, { top: 0, bottom: 0, width: extent });
  }
  style[BORDER_PROPERTY[side]] = `1px dashed color-mix(in srgb, ${line} 35%, transparent)`;
  return style;
};

const Padding = ({ template, pageIndex }: { template: Template; pageIndex: number }) => {
  const { token } = theme.useToken();
  const layout = template.layout?.pages?.[pageIndex];
  if (layout && !layout.showMargins) return null;
  const margins = getPageMargins(template, pageIndex);
  return (
    <>
      {SIDES.map((side) =>
        margins[side] > 0 ? (
          <div
            key={side}
            style={getMarginStyle(side, margins[side], token.colorText, token.colorPrimary)}
          />
        ) : null,
      )}
    </>
  );
};

export default Padding;
