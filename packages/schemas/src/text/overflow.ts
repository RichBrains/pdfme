import type { BasePdf } from '@pdfme/common';
import { TEXT_OVERFLOW_EXPAND } from './constants.js';
import type { TextSchema } from './types.js';

type TextOverflowSchema = Pick<TextSchema, 'overflow'> & Partial<Pick<TextSchema, 'type'>>;

/**
 * Height expansion is background independent: it works on blank templates and
 * on templates that use an uploaded PDF as background.
 * Parameters are retained for API compatibility and future per-background policies.
 */
export const canUseTextOverflowExpand = (
  _schema: Partial<Pick<TextSchema, 'type'>>,
  _basePdf?: BasePdf,
) => true;

export const isTextOverflowExpand = (schema: TextOverflowSchema, basePdf?: BasePdf) =>
  canUseTextOverflowExpand(schema, basePdf) && schema.overflow === TEXT_OVERFLOW_EXPAND;

export const shouldUseDynamicFontSize = (
  schema: Pick<TextSchema, 'dynamicFontSize' | 'overflow'> & Partial<Pick<TextSchema, 'type'>>,
  basePdf?: BasePdf,
) => Boolean(schema.dynamicFontSize) && !isTextOverflowExpand(schema, basePdf);
