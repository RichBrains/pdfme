import type { Font } from '@pdfme/common';
import type { TextSchema } from '../text/types.js';

/** Arguments a host's rich text editor receives to edit one value in place. */
export type RichTextEditorArgs = {
  rootElement: HTMLDivElement;
  value: string;
  /** Base style of the text (font, size, colour, alignment, content width). */
  schema: TextSchema;
  font: Font;
  onChange: (value: string) => void;
  stopEditing: () => void;
};

export type RichTextEditorRenderer = (args: RichTextEditorArgs) => void;

let editorRenderer: RichTextEditorRenderer | undefined;

/**
 * Registers the editor used for rich text that is edited in place on the
 * canvas (e.g. a rich table cell). Without one, rich text is read-only.
 */
export const setRichTextEditor = (renderer: RichTextEditorRenderer | undefined) => {
  editorRenderer = renderer;
};

export const getRichTextEditor = () => editorRenderer;

let displayTransform: ((value: string) => string) | undefined;

/**
 * Registers how rich text reads on the canvas when it is not being edited,
 * e.g. merge fields shown by their friendly names. The PDF is unaffected.
 */
export const setRichTextDisplayValue = (transform: ((value: string) => string) | undefined) => {
  displayTransform = transform;
};

export const getRichTextDisplayValue = () => displayTransform;
