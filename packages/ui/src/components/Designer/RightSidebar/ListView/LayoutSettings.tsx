import React, { useContext } from 'react';
import { InputNumber, Select, Switch, Typography } from 'antd';
import { getPageLayout, type PageLayoutSettings, type Template } from '@pdfme/common';
import { I18nContext } from '../../../../contexts.js';

const MARGIN_LABEL_KEYS = {
  top: 'layoutMarginTop',
  right: 'layoutMarginRight',
  bottom: 'layoutMarginBottom',
  left: 'layoutMarginLeft',
} as const;

/**
 * Page layout settings. They are stored on the template, so they behave the
 * same for blank pages and for pages backed by an uploaded PDF.
 */
const LayoutSettings = ({
  template,
  pageIndex,
  onChangePageLayout,
}: {
  template: Template;
  pageIndex: number;
  onChangePageLayout: (
    pageIndex: number,
    update: (layout: PageLayoutSettings) => PageLayoutSettings,
  ) => void;
}) => {
  const i18n = useContext(I18nContext);
  const layout = getPageLayout(template, pageIndex);
  const update = (fn: (value: PageLayoutSettings) => PageLayoutSettings) =>
    onChangePageLayout(pageIndex, fn);

  return (
    <div style={{ padding: 12, borderTop: '1px solid #d9d9d9' }}>
      <Typography.Text strong>{i18n('layout')}</Typography.Text>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
        }}
      >
        <span>{i18n('layoutShowMargins')}</span>
        <Switch
          size="small"
          checked={layout.showMargins}
          onChange={(showMargins) => update((current) => ({ ...current, showMargins }))}
        />
        <span>{i18n('layoutShowGrid')}</span>
        <Switch
          size="small"
          checked={layout.grid.visible}
          onChange={(visible) =>
            update((current) => ({ ...current, grid: { ...current.grid, visible } }))
          }
        />
        <span>{i18n('layoutSnapToGrid')}</span>
        <Switch
          size="small"
          checked={layout.grid.snap}
          onChange={(snap) =>
            update((current) => ({ ...current, grid: { ...current.grid, snap } }))
          }
        />
        <span>{i18n('layoutGridSpacing')}</span>
        <InputNumber
          size="small"
          min={0.1}
          value={layout.grid.spacing}
          onChange={(spacing) =>
            update((current) => ({
              ...current,
              grid: { ...current.grid, spacing: spacing ?? current.grid.spacing },
            }))
          }
        />
        <span>{i18n('layoutGridUnit')}</span>
        <Select
          size="small"
          value={layout.grid.unit}
          style={{ width: 80 }}
          options={[
            { value: 'mm', label: 'mm' },
            { value: 'pt', label: 'pt' },
          ]}
          onChange={(unit: 'mm' | 'pt') =>
            update((current) => ({ ...current, grid: { ...current.grid, unit } }))
          }
        />
        {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
          <React.Fragment key={side}>
            <span>{i18n(MARGIN_LABEL_KEYS[side])}</span>
            <InputNumber
              size="small"
              min={0}
              value={layout.margins[side]}
              onChange={(value) =>
                update((current) => ({
                  ...current,
                  margins: { ...current.margins, [side]: value ?? 0 },
                }))
              }
            />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};

export default LayoutSettings;
