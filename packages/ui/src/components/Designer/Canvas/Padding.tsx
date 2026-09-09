import React from 'react';
import type * as CSS from 'csstype';
import { getElementMargins, getPageLayout, getPageMargins, type Template, ZOOM } from '@pdfme/common';
import { theme } from 'antd';

const getPaddingStyle = (i: number, p: number, color: string): CSS.Properties => {
  const style: CSS.Properties = {
    position: 'absolute',
    background: color,
    // The fill makes the no-content area obvious without hiding page artwork.
    opacity: 0.18,
    pointerEvents: 'none',
    zIndex: 3,
  };
  switch (i) {
    case 0:
      style.top = 0;
      style.height = `${p * ZOOM}px`;
      style.left = 0;
      style.right = 0;
      break;
    case 1:
      style.right = 0;
      style.width = `${p * ZOOM}px`;
      style.top = 0;
      style.bottom = 0;
      break;
    case 2:
      style.bottom = 0;
      style.height = `${p * ZOOM}px`;
      style.left = 0;
      style.right = 0;
      break;
    case 3:
      style.left = 0;
      style.width = `${p * ZOOM}px`;
      style.top = 0;
      style.bottom = 0;
      break;
  }
  return style;
};

const getElementMarginStyle = (
  schema: { position: { x: number; y: number }; width: number; height: number },
  margin: number,
  side: number,
  color: string,
): CSS.Properties => {
  const left = schema.position.x * ZOOM;
  const top = schema.position.y * ZOOM;
  const width = schema.width * ZOOM;
  const height = schema.height * ZOOM;
  const size = margin * ZOOM;
  const style: CSS.Properties = { position: 'absolute', background: color, opacity: 0.16, pointerEvents: 'none', zIndex: 3 };
  if (side === 0) Object.assign(style, { left, top: top - size, width, height: size });
  if (side === 1) Object.assign(style, { left: left + width, top, width: size, height });
  if (side === 2) Object.assign(style, { left, top: top + height, width, height: size });
  if (side === 3) Object.assign(style, { left: left - size, top, width: size, height });
  return style;
};

/** A solid red line at the inner edge of each translucent margin band. */
const getMarginGuideStyle = (i: number, p: number, color: string): CSS.Properties => {
  const offset = `${p * ZOOM}px`;
  const style: CSS.Properties = {
    position: 'absolute',
    background: color,
    pointerEvents: 'none',
    zIndex: 4,
  };

  switch (i) {
    case 0:
      style.top = `calc(${offset} - 1px)`;
      style.left = 0;
      style.right = 0;
      style.height = '2px';
      break;
    case 1:
      style.right = `calc(${offset} - 1px)`;
      style.top = 0;
      style.bottom = 0;
      style.width = '2px';
      break;
    case 2:
      style.bottom = `calc(${offset} - 1px)`;
      style.left = 0;
      style.right = 0;
      style.height = '2px';
      break;
    case 3:
      style.left = `calc(${offset} - 1px)`;
      style.top = 0;
      style.bottom = 0;
      style.width = '2px';
      break;
  }

  return style;
};

const Padding = ({
  template,
  pageIndex,
  schemas,
}: {
  template: Template;
  pageIndex: number;
  schemas: Template['schemas'][number];
}) => {
  const { token } = theme.useToken();
  const layout = template.layout?.pages?.[pageIndex];
  if (layout && !layout.showMargins) return null;
  const margins = getPageMargins(template, pageIndex);
  const elementMargins = getElementMargins(getPageLayout(template, pageIndex));
  return (
    <>
      {schemas.flatMap((schema) =>
        [elementMargins.top, elementMargins.right, elementMargins.bottom, elementMargins.left].map(
          (margin, side) =>
            margin > 0 ? <div key={`${schema.name}-${side}`} style={getElementMarginStyle(schema, margin, side, token.colorWarning)} /> : null,
        ),
      )}
      {[margins.top, margins.right, margins.bottom, margins.left].map((margin, index) =>
        margin > 0 ? (
          <React.Fragment key={String(index)}>
            <div style={getPaddingStyle(index, margin, token.colorError)} />
            <div style={getMarginGuideStyle(index, margin, token.colorError)} />
          </React.Fragment>
        ) : null,
      )}
    </>
  );
};

export default Padding;
