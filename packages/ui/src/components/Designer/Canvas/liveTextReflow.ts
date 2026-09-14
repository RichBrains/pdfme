import { getReflowFollowers, type ReflowScope, type SchemaForUI } from '@pdfme/common';

export type SchemaChange = { key: string; value: unknown; schemaId: string };

/**
 * Field types whose Designer height is always driven by content. Everything
 * else (image, shapes, qrcode, signature, svg) stays freely resizable.
 * 'conditionalTextBlock'/'blockTable' are app-specific letter fields rendered
 * through the text/table plugins; kept as literals because the fork cannot
 * import app schema constants.
 */
export const isHeightLockedSchema = (schema: Pick<SchemaForUI, 'type'>): boolean =>
  schema.type === 'text' ||
  schema.type === 'multiVariableText' ||
  schema.type === 'conditionalTextBlock' ||
  schema.type === 'list' ||
  schema.type === 'table' ||
  schema.type === 'blockTable';

const FINGERPRINT_IGNORED_KEYS = new Set([
  'id',
  'position',
  'dynamicFontSize',
  '__splitRange',
  '__isSplit',
]);

/**
 * Fingerprint of everything that can change a height-locked field's content
 * height. Geometry and volatile generation outputs are excluded. Height
 * itself is included so wholesale template replacements (Reset, file load)
 * re-snap; reflow commits update the map to post-commit values so passes
 * converge instead of re-triggering themselves.
 */
export const heightFingerprint = (schema: SchemaForUI): string => {
  const rest = { ...(schema as unknown as Record<string, unknown>) };
  for (const key of FINGERPRINT_IGNORED_KEYS) {
    delete rest[key];
  }
  return JSON.stringify(rest, Object.keys(rest).sort());
};

/**
 * Live canvas reflow for the field being edited.
 *
 * The edited field always resizes, including contracting back towards its
 * minimum height. Neighbouring fields only move when the page opts into a
 * reflow scope that includes them, so an absolutely positioned template never
 * shifts unrelated artwork while the author types.
 */
export const getLiveTextReflowChanges = ({
  schemas,
  schema,
  width,
  height,
  scope = 'flow',
  maxBottom,
}: {
  schemas?: SchemaForUI[];
  schema: SchemaForUI;
  width?: number;
  height?: number;
  scope?: ReflowScope;
  /** Lower bound (mm) followers must not be pushed past, e.g. the content area. */
  maxBottom?: number;
}): SchemaChange[] => {
  const nextWidth = width ?? schema.width;
  const nextHeight = height ?? schema.height;
  const changes: SchemaChange[] = [];
  if (nextWidth !== schema.width)
    changes.push({ key: 'width', value: nextWidth, schemaId: schema.id });
  if (nextHeight !== schema.height)
    changes.push({ key: 'height', value: nextHeight, schemaId: schema.id });

  const delta = nextHeight - schema.height;
  if (delta === 0 || !schemas) return changes;

  const active = schemas.find((candidate) => candidate.id === schema.id) ?? schema;
  const minimumFollowerY = active.position.y + nextHeight;
  getReflowFollowers({ schema: active, schemas, scope }).forEach((candidate) => {
    const nextY = Math.max(candidate.position.y + delta, minimumFollowerY);
    const clampedY =
      maxBottom === undefined ? nextY : Math.min(nextY, Math.max(0, maxBottom - candidate.height));
    if (clampedY !== candidate.position.y)
      changes.push({ key: 'position.y', value: clampedY, schemaId: candidate.id });
  });

  return changes;
};

/** Fields that a live reflow of `schema` would move, for author-facing preview. */
export const getReflowPreviewIds = (arg: {
  schemas: SchemaForUI[];
  schema: SchemaForUI;
  scope: ReflowScope;
}): string[] => getReflowFollowers(arg).map((candidate) => candidate.id);
