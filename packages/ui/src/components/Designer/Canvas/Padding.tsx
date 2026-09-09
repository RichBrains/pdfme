import React from 'react';
import type * as CSS from 'csstype';
import { getPageMargins, type Template, ZOOM } from '@pdfme/common';
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

const Padding = ({ template, pageIndex }: { template: Template; pageIndex: number }) => {
  const { token } = theme.useToken();
  const layout = template.layout?.pages?.[pageIndex];
  if (layout && !layout.showMargins) return null;
  const margins = getPageMargins(template, pageIndex);
  return (
    <>
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
