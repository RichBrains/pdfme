export type IndentMode = 'none' | 'firstLine' | 'hanging';

export type TextIndent = {
  position: { x: number };
  width: number;
  leftIndent?: number;
  rightIndent?: number;
  indentMode?: IndentMode;
  specialIndent?: number;
};

export type IndentMarkerPositions = {
  left: number;
  firstLine: number;
  right: number;
};

export const getIndentMarkerPositions = (schema: TextIndent): IndentMarkerPositions => {
  const leftIndent = schema.leftIndent ?? 0;
  const rightIndent = schema.rightIndent ?? 0;
  const specialIndent = schema.specialIndent ?? 0;
  const indentMode = schema.indentMode ?? 'none';
  const left = schema.position.x + leftIndent + (indentMode === 'hanging' ? specialIndent : 0);
  const firstLine =
    schema.position.x + leftIndent + (indentMode === 'firstLine' ? specialIndent : 0);
  return { left, firstLine, right: schema.position.x + schema.width - rightIndent };
};

export const getIndentChange = ({
  marker,
  position,
  schema,
}: {
  marker: keyof IndentMarkerPositions;
  position: number;
  schema: TextIndent;
}): { key: 'leftIndent' | 'rightIndent' | 'specialIndent'; value: number } => {
  const leftIndent = schema.leftIndent ?? 0;
  if (marker === 'left')
    return { key: 'leftIndent', value: Math.max(0, position - schema.position.x) };
  if (marker === 'right') {
    return { key: 'rightIndent', value: Math.max(0, schema.position.x + schema.width - position) };
  }
  // Negative values are intentional: they outdent the first line, which is a
  // standard word-processor style for letterheads and references.
  const specialIndent =
    schema.indentMode === 'hanging'
      ? leftIndent - (position - schema.position.x)
      : position - schema.position.x - leftIndent;
  return { key: 'specialIndent', value: specialIndent };
};
