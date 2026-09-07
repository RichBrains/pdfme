import type { SchemaForUI } from '@pdfme/common';

export type SchemaChange = { key: string; value: unknown; schemaId: string };

export const getLiveTextReflowChanges = ({
  schemas,
  schema,
  width,
  height,
}: {
  schemas: SchemaForUI[];
  schema: SchemaForUI;
  width?: number;
  height?: number;
}): SchemaChange[] => {
  const nextWidth = width ?? schema.width;
  const nextHeight = height ?? schema.height;
  const changes: SchemaChange[] = [];
  if (nextWidth !== schema.width)
    changes.push({ key: 'width', value: nextWidth, schemaId: schema.id });
  if (nextHeight !== schema.height)
    changes.push({ key: 'height', value: nextHeight, schemaId: schema.id });
  const delta = nextHeight - schema.height;
  if (delta !== 0) {
    const bottom = schema.position.y + schema.height;
    schemas
      .filter((candidate) => candidate.id !== schema.id && candidate.position.y >= bottom)
      .forEach((candidate) =>
        changes.push({
          key: 'position.y',
          value: candidate.position.y + delta,
          schemaId: candidate.id,
        }),
      );
  }
  return changes;
};
