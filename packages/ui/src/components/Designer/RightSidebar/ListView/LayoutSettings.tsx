import React from 'react';
import { InputNumber, Select, Switch, Typography } from 'antd';
import { getPageLayout, type Template } from '@pdfme/common';

// TODO(i18n): add dedicated Designer layout labels when the public dictionary is extended.
const LayoutSettings = ({ template, pageIndex, onChangePageLayout }: {
  template: Template;
  pageIndex: number;
  onChangePageLayout: (pageIndex: number, update: (layout: ReturnType<typeof getPageLayout>) => ReturnType<typeof getPageLayout>) => void;
}) => {
  const layout = getPageLayout(template, pageIndex);
  const update = (fn: (value: typeof layout) => typeof layout) => onChangePageLayout(pageIndex, fn);
  const margin = (side: keyof typeof layout.margins, value: number | null) => update((current) => ({ ...current, margins: { ...current.margins, [side]: value ?? 0 } }));
  return <div style={{ padding: 12, borderTop: '1px solid #d9d9d9' }}>
    <Typography.Text strong>Layout</Typography.Text>
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 8 }}>
      <span>Show margins</span><Switch size="small" checked={layout.showMargins} onChange={(showMargins) => update((current) => ({ ...current, showMargins }))} />
      <span>Grid visible</span><Switch size="small" checked={layout.grid.visible} onChange={(visible) => update((current) => ({ ...current, grid: { ...current.grid, visible } }))} />
      <span>Grid snap</span><Switch size="small" checked={layout.grid.snap} onChange={(snap) => update((current) => ({ ...current, grid: { ...current.grid, snap } }))} />
      <span>Grid spacing</span><InputNumber min={0.1} value={layout.grid.spacing} onChange={(spacing) => update((current) => ({ ...current, grid: { ...current.grid, spacing: spacing ?? current.grid.spacing } }))} />
      <span>Grid unit</span><Select value={layout.grid.unit} style={{ width: 80 }} options={[{ value: 'mm' }, { value: 'pt' }]} onChange={(unit: 'mm' | 'pt') => update((current) => ({ ...current, grid: { ...current.grid, unit } }))} />
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => <React.Fragment key={side}><span>Margin {side}</span><InputNumber min={0} value={layout.margins[side]} onChange={(value) => margin(side, value)} /></React.Fragment>)}
    </div>
  </div>;
};
export default LayoutSettings;
