import React from 'react';
import type * as CSS from 'csstype';
import { getPageMargins, type Template, ZOOM } from '@pdfme/common';
import { theme } from 'antd';

const getPaddingStyle = (i: number, p: number, color: string): CSS.Properties => {
  const style: CSS.Properties = { position: 'absolute', background: color, opacity: 0.12, pointerEvents: 'none', zIndex: 1 };
  switch (i) {
    case 0: style.top = 0; style.height = `${p * ZOOM}px`; style.left = 0; style.right = 0; break;
    case 1: style.right = 0; style.width = `${p * ZOOM}px`; style.top = 0; style.bottom = 0; break;
    case 2: style.bottom = 0; style.height = `${p * ZOOM}px`; style.left = 0; style.right = 0; break;
    case 3: style.left = 0; style.width = `${p * ZOOM}px`; style.top = 0; style.bottom = 0; break;
  }
  return style;
};

const Padding = ({ template, pageIndex }: { template: Template; pageIndex: number }) => {
  const { token } = theme.useToken();
  const layout = template.layout?.pages?.[pageIndex];
  if (layout && !layout.showMargins) return null;
  const margins = getPageMargins(template, pageIndex);
  return <>{[margins.top, margins.right, margins.bottom, margins.left].map((margin, index) => <div key={String(index)} style={getPaddingStyle(index, margin, token.colorWarning)} />)}</>;
};

export default Padding;
