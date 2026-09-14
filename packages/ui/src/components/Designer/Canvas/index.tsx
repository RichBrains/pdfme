import React, {
  Ref,
  useMemo,
  useContext,
  MutableRefObject,
  useRef,
  useState,
  useEffect,
  forwardRef,
  useCallback,
} from 'react';
import { theme, Button } from 'antd';
import MoveableComponent, { OnDrag, OnRotate, OnResize } from 'react-moveable';
import {
  ZOOM,
  Schema,
  SchemaForUI,
  Size,
  ChangeSchemas,
  BasePdf,
  Template,
  getPageLayout,
  isOutsideContentBounds,
  getTemplateContentBounds,
  getReflowScope,
  getElementMargins,
  clampToContentBounds,
  replacePlaceholders,
  Font,
} from '@pdfme/common';
import { CacheContext, FontContext, I18nContext, PluginsRegistry } from '../../../contexts.js';
import { X } from 'lucide-react';
import { RULER_HEIGHT, RIGHT_SIDEBAR_WIDTH, DESIGNER_CLASSNAME } from '../../../constants.js';
import { usePrevious } from '../../../hooks.js';
import { round, flatten, uuid } from '../../../helper.js';
import Paper from '../../Paper.js';
import Renderer from '../../Renderer.js';
import Selecto from './Selecto.js';
import Moveable from './Moveable.js';
import Guides from './Guides.js';
import Mask from './Mask.js';
import Padding from './Padding.js';
import Grid from './Grid.js';
import { getLayoutSnapTargets, getSnapFeedback } from './layoutSnap.js';
import {
  getLiveTextReflowChanges,
  heightFingerprint,
  isHeightLockedSchema,
  type SchemaChange,
} from './liveTextReflow.js';
import { getDynamicLayoutForSchema, isDynamicLayoutSchema } from '@pdfme/schemas/dynamicLayout';
import IndentMarkers, { isTextIndentSchema } from './IndentMarkers.js';
import StaticSchema from '../../StaticSchema.js';

const mm2px = (mm: number) => mm * 3.7795275591;

const DELETE_BTN_ID = uuid();
const fmt4Num = (prop: string) => Number(prop.replace('px', ''));
const fmt = (prop: string) => round(fmt4Num(prop) / ZOOM, 2);
const isTopLeftResize = (d: string) => d === '-1,-1' || d === '-1,0' || d === '0,-1';
const normalizeRotate = (angle: number) => ((angle % 360) + 360) % 360;

/** Text fields keep a content-derived minimum height after they are measured. */
const isTextSchema = (schema: SchemaForUI): boolean =>
  schema.type === 'text' || schema.type === 'multiVariableText';

type LayoutTarget = { schema: Schema; value: string };

const getSchemaMinHeight = (schema: SchemaForUI): number | undefined => {
  const { minHeight, contentMinHeight } = schema as {
    minHeight?: unknown;
    contentMinHeight?: unknown;
  };
  const values = [minHeight, contentMinHeight].filter(
    (value): value is number => typeof value === 'number',
  );
  return values.length > 0 ? Math.max(...values) : undefined;
};

const getSchemaWidthMode = (schema: SchemaForUI): string | undefined => {
  const widthMode = (schema as { widthMode?: unknown }).widthMode;
  return typeof widthMode === 'string' ? widthMode : undefined;
};

const DeleteButton = ({
  activeElements: aes,
  controlScale,
}: {
  activeElements: HTMLElement[];
  controlScale: number;
}) => {
  const { token } = theme.useToken();

  const size = 26;
  const top = Math.min(...aes.map(({ style }) => fmt4Num(style.top)));
  const left =
    Math.max(...aes.map(({ style }) => fmt4Num(style.left) + fmt4Num(style.width))) +
    10 * controlScale;

  return (
    <Button
      id={DELETE_BTN_ID}
      className={DESIGNER_CLASSNAME + 'delete-button'}
      style={{
        position: 'absolute',
        zIndex: 1,
        top,
        left,
        width: size,
        height: size,
        padding: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: token.borderRadius,
        color: token.colorWhite,
        background: token.colorPrimary,
        transform: `scale(${controlScale})`,
        transformOrigin: 'top left',
      }}
    >
      <X style={{ pointerEvents: 'none' }} />
    </Button>
  );
};

interface GuidesInterface {
  getGuides(): number[];
  scroll(pos: number): void;
  scrollGuides(pos: number): void;
  loadGuides(guides: number[]): void;
  resize(): void;
}

interface Props {
  basePdf: BasePdf;
  template: Template;
  onChangePageLayout: (
    pageIndex: number,
    update: (layout: ReturnType<typeof getPageLayout>) => ReturnType<typeof getPageLayout>,
  ) => void;
  height: number;
  hoveringSchemaId: string | null;
  onChangeHoveringSchemaId: (id: string | null) => void;
  pageCursor: number;
  schemasList: SchemaForUI[][];
  scale: number;
  renderScale: number;
  backgrounds: string[];
  pageSizes: Size[];
  size: Size;
  activeElements: HTMLElement[];
  onEdit: (targets: HTMLElement[]) => void;
  changeSchemas: ChangeSchemas;
  removeSchemas: (ids: string[]) => void;
  paperRefs: MutableRefObject<HTMLDivElement[]>;
  sidebarOpen: boolean;
}

const Canvas = (props: Props, ref: Ref<HTMLDivElement>) => {
  const {
    basePdf,
    template,
    onChangePageLayout,
    pageCursor,
    scale,
    renderScale,
    backgrounds,
    pageSizes,
    size,
    activeElements,
    schemasList,
    hoveringSchemaId,
    onEdit,
    changeSchemas,
    removeSchemas,
    onChangeHoveringSchemaId,
    paperRefs,
    sidebarOpen,
  } = props;
  const { token } = theme.useToken();
  const pluginsRegistry = useContext(PluginsRegistry);
  const i18n = useContext(I18nContext);
  const font = useContext(FontContext);
  const cache = useContext(CacheContext);
  const verticalGuides = useRef<GuidesInterface[]>([]);
  const horizontalGuides = useRef<GuidesInterface[]>([]);
  const moveable = useRef<MoveableComponent>(null);
  const controlScale = scale > 0 ? 1 / scale : 1;

  const [isPressShiftKey, setIsPressShiftKey] = useState(false);
  const [isPressAltKey, setIsPressAltKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [snapFeedback, setSnapFeedback] = useState<string | null>(null);
  const reflowRequestRef = useRef(0);
  const reflowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reflowFingerprintsRef = useRef(new Map<string, string>());
  const pendingTextChangesRef = useRef<SchemaChange[]>([]);
  const pendingTextReflowRef = useRef<ReflowItem[] | null>(null);
  // Last live-resize direction, read at resize-end to decide whether the
  // user manually changed a text field's width (vs. only its height).
  const lastResizeDirectionRef = useRef<number[] | null>(null);

  const prevSchemas = usePrevious(schemasList[pageCursor]);

  const onKeydown = (e: KeyboardEvent) => {
    if (e.shiftKey) setIsPressShiftKey(true);
    if (e.altKey) setIsPressAltKey(true);
  };
  const onKeyup = (e: KeyboardEvent) => {
    if (e.key === 'Shift' || !e.shiftKey) setIsPressShiftKey(false);
    if (e.key === 'Alt' || !e.altKey) setIsPressAltKey(false);
    if (e.key === 'Escape' || e.key === 'Esc') setEditing(false);
  };

  const initEvents = useCallback(() => {
    window.addEventListener('keydown', onKeydown);
    window.addEventListener('keyup', onKeyup);
  }, []);

  const destroyEvents = useCallback(() => {
    window.removeEventListener('keydown', onKeydown);
    window.removeEventListener('keyup', onKeyup);
  }, []);

  useEffect(() => {
    initEvents();

    return destroyEvents;
  }, [initEvents, destroyEvents]);

  useEffect(() => {
    moveable.current?.updateRect();
    if (!prevSchemas) {
      return;
    }

    const prevSchemaKeys = JSON.stringify(prevSchemas[pageCursor] || {});
    const schemaKeys = JSON.stringify(schemasList[pageCursor] || {});

    if (prevSchemaKeys === schemaKeys) {
      moveable.current?.updateRect();
    }
  }, [pageCursor, schemasList, prevSchemas]);

  useEffect(() => {
    moveable.current?.updateRect();
  }, [renderScale]);

  const onDrag = ({ target, top, left }: OnDrag) => {
    target.style.top = `${top}px`;
    target.style.left = `${left}px`;
    updateSnapFeedback({
      top,
      left,
      width: fmt4Num(target.style.width),
      height: fmt4Num(target.style.height),
    });
  };

  const onDragEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    setSnapFeedback(null);
    const { top, left } = target.style;
    const schema = schemasList[pageCursor]?.find((candidate) => candidate.id === target.id);
    const position = resolveDropPosition(schema, { x: fmt(left), y: fmt(top) });
    if (schema && position) {
      target.style.top = `${position.y * ZOOM}px`;
      target.style.left = `${position.x * ZOOM}px`;
    }
    changeSchemas([
      { key: 'position.y', value: position ? position.y : fmt(top), schemaId: target.id },
      { key: 'position.x', value: position ? position.x : fmt(left), schemaId: target.id },
    ]);
  };

  const onDragEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    setSnapFeedback(null);
    const arg = targets.map(({ style: { top, left }, id }) => [
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'position.x', value: fmt(left), schemaId: id },
    ]);
    changeSchemas(flatten(arg));
  };

  const onRotate = ({ target, rotate }: OnRotate) => {
    target.style.transform = `rotate(${rotate}deg)`;
  };

  const onRotateEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    const { transform } = target.style;
    const rotate = Number(transform.replace('rotate(', '').replace('deg)', ''));
    const normalizedRotate = normalizeRotate(rotate);
    changeSchemas([{ key: 'rotate', value: normalizedRotate, schemaId: target.id }]);
  };

  const onRotateEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    const arg = targets.map(({ style: { transform }, id }) => {
      const rotate = Number(transform.replace('rotate(', '').replace('deg)', ''));
      const normalizedRotate = normalizeRotate(rotate);
      return [{ key: 'rotate', value: normalizedRotate, schemaId: id }];
    });
    changeSchemas(flatten(arg));
  };

  const onResizeEnd = ({ target }: { target: HTMLElement | SVGElement }) => {
    setSnapFeedback(null);
    const { id, style } = target;
    const { width, height, top, left } = style;
    const targetSchema = schemasList[pageCursor].find((schema) => schema.id === id);
    const heightLocked = targetSchema ? isHeightLockedSchema(targetSchema) : false;
    // Height-locked (table) fields ignore vertical drags: height and Y stay
    // content-driven, only width and X are committed.
    const nextWidth = fmt(width);
    const nextHeight = heightLocked ? (targetSchema?.height ?? fmt(height)) : fmt(height);
    const rawLeft = fmt(left);
    const rawTop = heightLocked ? (targetSchema?.position.y ?? fmt(top)) : fmt(top);
    // The resized box may now break the element margins, so nudge it to the
    // closest position that still honours them before committing.
    const resized = targetSchema
      ? { ...targetSchema, width: nextWidth, height: nextHeight }
      : undefined;
    const position =
      resolveDropPosition(resized, { x: rawLeft, y: rawTop }) ??
      ({ x: rawLeft, y: rawTop } as { x: number; y: number });

    const changes: SchemaChange[] = [
      { key: 'position.x', value: position.x, schemaId: id },
      { key: 'position.y', value: position.y, schemaId: id },
      { key: 'width', value: nextWidth, schemaId: id },
      { key: 'height', value: nextHeight, schemaId: id },
    ];

    // A horizontal resize handle was dragged: the field's width is no
    // longer driven by its widthMode, so lock it to 'fixed' like a manual
    // edit of the width field in the property panel would.
    const resizedHorizontally = (lastResizeDirectionRef.current?.[0] ?? 0) !== 0;
    if (
      targetSchema &&
      resizedHorizontally &&
      (targetSchema.type === 'text' ||
        targetSchema.type === 'multiVariableText' ||
        targetSchema.type === 'conditionalTextBlock') &&
      getSchemaWidthMode(targetSchema) !== 'fixed'
    ) {
      changes.push({ key: 'widthMode', value: 'fixed', schemaId: id });
    }
    lastResizeDirectionRef.current = null;

    changeSchemas(changes);

    if (!targetSchema) return;

    target.style.left = `${position.x * ZOOM}px`;
    target.style.top = `${position.y * ZOOM}px`;
    targetSchema.position.x = position.x;
    targetSchema.position.y = position.y;
    targetSchema.width = nextWidth;
    targetSchema.height = nextHeight;
    if (targetSchema.type === 'text' || targetSchema.type === 'multiVariableText') {
      queueLiveTextReflow({
        schema: targetSchema,
        measureValue: targetSchema.content ?? '',
        commitEntries: [],
        direct: false,
      });
    }
  };

  const onResizeEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    setSnapFeedback(null);
    const arg = targets.map(({ style: { width, height, top, left }, id }) => {
      const targetSchema = schemasList[pageCursor]?.find((schema) => schema.id === id);
      if (targetSchema && isHeightLockedSchema(targetSchema)) {
        return [
          { key: 'width', value: fmt(width), schemaId: id },
          { key: 'height', value: targetSchema.height, schemaId: id },
          { key: 'position.y', value: targetSchema.position.y, schemaId: id },
          { key: 'position.x', value: fmt(left), schemaId: id },
        ];
      }
      return [
        { key: 'width', value: fmt(width), schemaId: id },
        { key: 'height', value: fmt(height), schemaId: id },
        { key: 'position.y', value: fmt(top), schemaId: id },
        { key: 'position.x', value: fmt(left), schemaId: id },
      ];
    });
    changeSchemas(flatten(arg));
  };

  const onResize = ({ target, width, height, direction }: OnResize) => {
    if (!target) return;
    lastResizeDirectionRef.current = direction;
    const style = target.style;
    const oldWidth = fmt4Num(style.width);
    const oldHeight = fmt4Num(style.height);
    const oldTop = fmt4Num(style.top);

    // Don't let a manual drag shrink an auto-height text field below the
    // minimum height its content requires.
    const targetSchema = schemasList[pageCursor]?.find((schema) => schema.id === target.id);
    let clampedHeight = height;
    if (targetSchema && isTextSchema(targetSchema)) {
      const minHeight = getSchemaMinHeight(targetSchema);
      if (typeof minHeight === 'number') {
        clampedHeight = Math.max(height, minHeight * ZOOM);
      }
    }

    // Height-locked (table) fields are width-only: ignore vertical drags so
    // the box height stays content-driven.
    if (targetSchema && isHeightLockedSchema(targetSchema)) {
      clampedHeight = oldHeight;
    }

    const left = fmt4Num(style.left) + (direction[0] < 0 ? oldWidth - width : 0);
    const top =
      targetSchema && isHeightLockedSchema(targetSchema)
        ? oldTop
        : fmt4Num(style.top) + (direction[1] < 0 ? oldHeight - clampedHeight : 0);
    Object.assign(style, {
      width: `${width}px`,
      height: `${clampedHeight}px`,
      left: `${left}px`,
      top: `${top}px`,
    });
    updateSnapFeedback({ top, left, width, height: clampedHeight });
  };

  const pageLayout = getPageLayout(template, pageCursor);
  // Page sizes are resolved asynchronously for uploaded PDFs, so they can be
  // missing on the first render.
  const currentPageSize = pageSizes[pageCursor] ?? { width: 0, height: 0 };
  const contentBounds = useMemo(
    () => getTemplateContentBounds(template, pageCursor, currentPageSize),
    [template, pageCursor, currentPageSize],
  );
  /**
   * Aligns a dropped element to the page margins. Overlapping siblings is left
   * to the author: only free-space placement of brand new fields avoids it, so
   * an existing field is never relocated behind the author's back.
   */
  const resolveDropPosition = (
    schema: SchemaForUI | undefined,
    position: { x: number; y: number },
  ): { x: number; y: number } | undefined => {
    if (!schema) return undefined;
    const aligned = clampToContentBounds(
      { position, width: schema.width, height: schema.height },
      contentBounds,
    );
    if (aligned.x === position.x && aligned.y === position.y) return undefined;
    return aligned;
  };

  // The margin bands belong to each field so they follow it while dragging
  // without intercepting pointer events.
  const elementMarginShadow = useMemo(() => {
    if (!pageLayout.showMargins) return undefined;
    const margins = getElementMargins(pageLayout);
    const layers = [
      margins.top > 0 ? `0 -${margins.top * ZOOM}px 0 0 ${token.colorWarningBg}` : '',
      margins.right > 0 ? `${margins.right * ZOOM}px 0 0 0 ${token.colorWarningBg}` : '',
      margins.bottom > 0 ? `0 ${margins.bottom * ZOOM}px 0 0 ${token.colorWarningBg}` : '',
      margins.left > 0 ? `-${margins.left * ZOOM}px 0 0 0 ${token.colorWarningBg}` : '',
    ].filter(Boolean);
    return layers.length ? layers.join(', ') : undefined;
  }, [pageLayout, token.colorWarningBg]);

  const snapTargets = useMemo(
    () =>
      getLayoutSnapTargets({
        template,
        pageIndex: pageCursor,
        pageSize: currentPageSize,
        schemas: schemasList[pageCursor] || [],
        selectedIds: activeElements.map((element) => element.id),
      }),
    [template, pageCursor, currentPageSize, schemasList, activeElements],
  );
  const updateSnapFeedback = ({
    top,
    left,
    width,
    height,
  }: {
    top: number;
    left: number;
    width: number;
    height: number;
  }) => {
    const feedback = getSnapFeedback({
      targets: snapTargets.targets,
      gridSpacing: snapTargets.gridSpacing,
      frame: { top: top / ZOOM, left: left / ZOOM, width: width / ZOOM, height: height / ZOOM },
    });
    setSnapFeedback(feedback ? i18n(feedback.key) : null);
  };

  const selectedSchema = schemasList[pageCursor]?.find(
    (schema) => schema.id === activeElements[0]?.id,
  );

  // Height-locked selections (text, list, tables) render width-only handles
  // so height stays content-driven.
  const isHeightLockedSelection = (schemasList[pageCursor] || []).some(
    (schema) =>
      isHeightLockedSchema(schema) && activeElements.some((element) => element.id === schema.id),
  );

  /**
   * Resolves what to measure for a content-height reflow. A plugin mapping
   * takes precedence so host letter fields (whose stock measurement cannot
   * see merge-field templates) measure exactly what the canvas renders;
   * built-in dynamic types measure themselves; anything else is static.
   * The fork never imports app schema logic.
   */
  const resolveLayoutTarget = (
    schema: SchemaForUI,
    value: string,
  ): LayoutTarget | null => {
    const mapped = pluginsRegistry
      .findByType(schema.type)
      ?.resolveDynamicLayoutTarget?.(schema, value);
    if (mapped) {
      if (!isDynamicLayoutSchema(mapped.schema)) return null;
      return mapped;
    }
    if (isDynamicLayoutSchema(schema)) return { schema, value };
    return null;
  };

  type ReflowItem = {
    /** Schema snapshot with the latest edits applied. */
    schema: SchemaForUI;
    /** Value string the layout function measures (content/variables JSON). */
    measureValue: string;
    /** Edit entries to commit alongside the reflow. */
    commitEntries: SchemaChange[];
    /**
     * Commit straight through after measuring instead of previewing in the
     * DOM first. Used for discrete passes (placement, panel edits, mount
     * snap) so the canvas never shows positions the template doesn't hold.
     * Canvas typing keeps the preview for live feel and flushes on blur.
     */
    direct: boolean;
  };

  const applyLiveTextReflow = async ({
    items,
    requestId,
    commit,
  }: {
    items: ReflowItem[];
    requestId: number;
    commit: boolean;
  }) => {
    try {
      const measured = await Promise.all(
        items.map(async (item) => {
          const target = resolveLayoutTarget(item.schema, item.measureValue);
          if (!target) return { item, layout: null };
          const result = await getDynamicLayoutForSchema(target.value, {
            schema: target.schema,
            basePdf,
            options: { font } as { font: Font },
            _cache: cache,
            pageSize: currentPageSize,
            margins: pageLayout.margins,
          });
          const layout = Array.isArray(result) ? { heights: result } : result;
          return { item, layout };
        }),
      );
      if (requestId !== reflowRequestRef.current) return;
      const changes: SchemaChange[] = [];
      for (const { item, layout } of measured) {
        const { schema, commitEntries } = item;
        if (!layout) {
          if (commit) changes.push(...commitEntries);
          continue;
        }
        const measuredHeight = layout.heights.reduce(
          (total, height) => total + height,
          0,
        );
        const patch =
          layout.patchSplitSchema?.({
            schema,
            start: 0,
            end: layout.heights.length,
            isSplit: false,
            chunkHeight: measuredHeight,
          }) ?? {};
        const minimumHeight =
          typeof patch.contentMinHeight === 'number'
            ? Math.max(
                patch.contentMinHeight,
                typeof patch.minHeight === 'number' ? patch.minHeight : 0,
              )
            : undefined;
        // Height-locked fields always track the measured content height,
        // growing and shrinking with it. An empty field keeps its current
        // box so it stays selectable on the canvas. Other dynamic types
        // keep the grow-only behaviour from their layout patch.
        const contentHeight =
          typeof patch.contentMinHeight === 'number'
            ? patch.contentMinHeight
            : measuredHeight;
        const heightForChanges = isHeightLockedSchema(schema)
          ? contentHeight > 0
            ? contentHeight
            : schema.height
          : minimumHeight;
        // Height-locked fields own their height entirely: the layout patch
        // minimums must not be stored, otherwise a stale pre-snap floor
        // (minHeight) resurrects the old box at generation time while the
        // Designer shows the snapped one. Strip them when present.
        const lockedFloorCleanup = isHeightLockedSchema(schema)
          ? [
              ...('minHeight' in schema
                ? [{ key: 'minHeight', value: undefined, schemaId: schema.id }]
                : []),
              ...('contentMinHeight' in schema
                ? [{ key: 'contentMinHeight', value: undefined, schemaId: schema.id }]
                : []),
            ]
          : [
              ...(typeof patch.minHeight === 'number'
                ? [{ key: 'minHeight', value: patch.minHeight, schemaId: schema.id }]
                : []),
              ...(typeof patch.contentMinHeight === 'number'
                ? [
                    {
                      key: 'contentMinHeight',
                      value: patch.contentMinHeight,
                      schemaId: schema.id,
                    },
                  ]
                : []),
            ];
        changes.push(
          ...commitEntries,
          ...lockedFloorCleanup,
          ...getLiveTextReflowChanges({
            schemas: schemasList[pageCursor] || [],
            schema,
            width: typeof patch.width === 'number' ? patch.width : undefined,
            height: heightForChanges,
            scope: getReflowScope(pageLayout),
            maxBottom: contentBounds.bottom,
          }),
        );
      }
      pendingTextReflowRef.current = null;
      if (commit) {
        pendingTextChangesRef.current = [];
        // Record post-commit fingerprints so the watcher effect converges
        // instead of re-queueing its own commits (this also re-snaps after
        // wholesale replacements like Reset or file load, whose stale
        // heights no longer match).
        for (const { item } of measured) {
          const applied = {
            ...(item.schema as unknown as Record<string, unknown>),
          };
          for (const change of changes) {
            if (
              change.schemaId === item.schema.id &&
              !change.key.includes('.')
            ) {
              applied[change.key] = change.value;
            }
          }
          reflowFingerprintsRef.current.set(
            item.schema.id,
            heightFingerprint(applied as unknown as SchemaForUI),
          );
        }
        if (changes.length > 0) changeSchemas(changes);
        return;
      }
      pendingTextChangesRef.current = changes;
      changes.forEach(({ key, value: changeValue, schemaId }) => {
        const element = document.getElementById(schemaId);
        if (!(element instanceof HTMLElement)) return;
        if (key === 'width' || key === 'height')
          element.style[key] = `${Number(changeValue) * ZOOM}px`;
        if (key === 'position.y') element.style.top = `${Number(changeValue) * ZOOM}px`;
      });
      moveable.current?.updateRect();
    } catch (error) {
      if (requestId === reflowRequestRef.current) {
        pendingTextReflowRef.current = null;
        if (commit) flushPendingContentChange();
      }
      console.error('[@pdfme/ui] live text reflow failed', error);
    }
  };

  const flushPendingContentChange = () => {
    const changes = pendingTextChangesRef.current;
    pendingTextChangesRef.current = [];
    if (changes.length) changeSchemas(changes);
  };

  const flushPendingTextChanges = () => {
    if (reflowTimerRef.current) {
      clearTimeout(reflowTimerRef.current);
      reflowTimerRef.current = null;
    }
    const pendingReflow = pendingTextReflowRef.current;
    if (pendingReflow) {
      const requestId = ++reflowRequestRef.current;
      void applyLiveTextReflow({ items: pendingReflow, requestId, commit: true });
      return;
    }
    flushPendingContentChange();
  };
  const queueLiveTextReflow = (item: ReflowItem) => {
    if (item.commitEntries.length > 0) {
      pendingTextChangesRef.current = item.commitEntries;
    }
    if (!resolveLayoutTarget(item.schema, item.measureValue)) return;
    const pending = pendingTextReflowRef.current ?? [];
    const existingIndex = pending.findIndex(
      (candidate) => candidate.schema.id === item.schema.id,
    );
    if (existingIndex >= 0) {
      pending[existingIndex] = item;
    } else {
      pending.push(item);
    }
    pendingTextReflowRef.current = pending;
    const requestId = ++reflowRequestRef.current;
    if (reflowTimerRef.current) clearTimeout(reflowTimerRef.current);
    reflowTimerRef.current = setTimeout(() => {
      reflowTimerRef.current = null;
      const items = pendingTextReflowRef.current ?? [];
      // Direct passes commit straight through so the canvas never shows
      // positions the template doesn't hold; preview passes (canvas typing)
      // paint first and flush on blur or selection change.
      const direct = items.length > 0 && items.every((item) => item.direct);
      void applyLiveTextReflow({ items, requestId, commit: direct });
    }, 150);
  };

  // Panel-driven edits (conditions, table settings, sidebar styling) bypass
  // the canvas onChange below, so height-locked fields reflow here by
  // watching their content fingerprint. The first pass also snaps stale
  // stored heights to content on open; passes converge through the
  // equality-guarded reflow plus post-commit fingerprints (a commit re-fires
  // this effect, but the unchanged fingerprint skips it).
  const queueLiveTextReflowRef = useRef(queueLiveTextReflow);
  queueLiveTextReflowRef.current = queueLiveTextReflow;

  useEffect(() => {
    if (pendingTextReflowRef.current || reflowTimerRef.current) return;
    // Page sizes resolve asynchronously after mount; measuring against the
    // zero-area fallback would commit wrong heights and mark them seen.
    if (currentPageSize.width <= 0 || currentPageSize.height <= 0) return;
    const pageSchemas = schemasList[pageCursor] || [];
    for (const schema of pageSchemas) {
      if (!isHeightLockedSchema(schema)) continue;
      const fingerprint = heightFingerprint(schema);
      if (reflowFingerprintsRef.current.get(schema.id) === fingerprint) continue;
      const content = (schema as unknown as { content?: unknown }).content;
      queueLiveTextReflowRef.current({
        schema,
        measureValue: typeof content === 'string' ? content : '',
        commitEntries: [],
        direct: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemasList, pageCursor, currentPageSize]);

  const setGuides = (axis: 'horizontalGuides' | 'verticalGuides', guides: number[]) =>
    onChangePageLayout(pageCursor, (layout) => ({
      ...layout,
      [axis]: guides.map((position) => ({ position })),
    }));

  const onClickMoveable = () => {
    // Just set editing to true without trying to access event properties
    setEditing(true);
  };

  const rotatable = useMemo(() => {
    const selectedSchemas = (schemasList[pageCursor] || []).filter((s) =>
      activeElements.map((ae) => ae.id).includes(s.id),
    );
    const schemaTypes = selectedSchemas.map((s) => s.type);
    const uniqueSchemaTypes = [...new Set(schemaTypes)];

    // Create a type-safe array of default schemas
    const defaultSchemas: Record<string, unknown>[] = [];

    pluginsRegistry.entries().forEach(([, plugin]) => {
      if (plugin.propPanel.defaultSchema) {
        defaultSchemas.push(plugin.propPanel.defaultSchema as Record<string, unknown>);
      }
    });

    // Check if all schema types have rotate property
    return uniqueSchemaTypes.every((type) => {
      const matchingSchema = defaultSchemas.find((ds) => ds && 'type' in ds && ds.type === type);
      return matchingSchema && 'rotate' in matchingSchema;
    });
  }, [activeElements, pageCursor, schemasList, pluginsRegistry]);

  return (
    <div
      className={DESIGNER_CLASSNAME + 'canvas'}
      style={{
        position: 'relative',
        overflow: 'auto',
        marginRight: sidebarOpen ? RIGHT_SIDEBAR_WIDTH : 0,
        ...size,
      }}
      ref={ref}
    >
      <Selecto
        container={paperRefs.current[pageCursor]}
        continueSelect={isPressShiftKey}
        onDragStart={(e) => {
          // Use type assertion to safely access inputEvent properties
          const inputEvent = e.inputEvent as MouseEvent | TouchEvent;
          const target = inputEvent.target as Element | null;
          const isMoveableElement = moveable.current?.isMoveableElement(target as Element);

          if ((inputEvent.type === 'touchstart' && e.isTrusted) || isMoveableElement) {
            e.stop();
          }

          if (paperRefs.current[pageCursor] === target) {
            onEdit([]);
          }

          // Check if the target is an HTMLElement and has an id property
          const targetElement = target as HTMLElement | null;
          if (targetElement && targetElement.id === DELETE_BTN_ID) {
            removeSchemas(activeElements.map((ae) => ae.id));
          }
        }}
        onSelect={(e) => {
          // Use type assertions to safely access properties
          const inputEvent = e.inputEvent as MouseEvent | TouchEvent;
          const added = e.added as HTMLElement[];
          const removed = e.removed as HTMLElement[];
          const selected = e.selected as HTMLElement[];

          const isClick = inputEvent.type === 'mousedown';
          let newActiveElements: HTMLElement[] = isClick ? selected : [];

          if (!isClick && added.length > 0) {
            newActiveElements = activeElements.concat(added);
          }
          if (!isClick && removed.length > 0) {
            newActiveElements = activeElements.filter((ae) => !removed.includes(ae));
          }
          if (newActiveElements !== activeElements) flushPendingTextChanges();
          onEdit(newActiveElements);

          if (newActiveElements != activeElements) {
            setEditing(false);
          }

          // For MacOS CMD+SHIFT+3/4 screenshots where the keydown event is never received, check mouse too
          const mouseEvent = inputEvent as MouseEvent;
          if (mouseEvent && typeof mouseEvent.shiftKey === 'boolean' && !mouseEvent.shiftKey) {
            setIsPressShiftKey(false);
          }
        }}
      />
      <Paper
        paperRefs={paperRefs}
        scale={scale}
        size={size}
        schemasList={schemasList}
        pageSizes={pageSizes}
        backgrounds={backgrounds}
        hasRulers={true}
        renderPaper={({ index, paperSize }) => {
          const layout = getPageLayout(template, index);
          return (
            <>
              {!editing && activeElements.length > 0 && pageCursor === index && (
                <DeleteButton activeElements={activeElements} controlScale={controlScale} />
              )}
              {snapFeedback && pageCursor === index && activeElements[0] && (
                <div
                  aria-live="polite"
                  style={{
                    position: 'absolute',
                    zIndex: 6,
                    left: fmt4Num(activeElements[0].style.left),
                    top: fmt4Num(activeElements[0].style.top) - 24,
                    padding: '2px 6px',
                    borderRadius: 3,
                    color: token.colorWhite,
                    background: token.colorPrimary,
                    fontSize: 11,
                    pointerEvents: 'none',
                  }}
                >
                  {snapFeedback}
                </div>
              )}
              <Grid
                grid={getPageLayout(template, index).grid}
                pageSize={{ width: paperSize.width / ZOOM, height: paperSize.height / ZOOM }}
              />
              <Padding template={template} pageIndex={index} />
              <StaticSchema
                template={{ schemas: schemasList, basePdf }}
                input={Object.fromEntries(
                  schemasList.flat().map(({ name, content = '' }) => [name, content]),
                )}
                scale={renderScale}
                totalPages={schemasList.length}
                currentPage={index + 1}
              />
              <Guides
                paperSize={paperSize}
                horizontalRef={(e) => {
                  if (e) horizontalGuides.current[index] = e;
                }}
                verticalRef={(e) => {
                  if (e) verticalGuides.current[index] = e;
                }}
                horizontalGuides={layout.horizontalGuides.map((guide) => guide.position)}
                verticalGuides={layout.verticalGuides.map((guide) => guide.position)}
                onChangeHorizontalGuides={(guides) => setGuides('horizontalGuides', guides)}
                onChangeVerticalGuides={(guides) => setGuides('verticalGuides', guides)}
              />
              {pageCursor === index &&
                activeElements.length === 1 &&
                isTextIndentSchema(selectedSchema) && (
                  <IndentMarkers
                    schema={selectedSchema}
                    paperElement={paperRefs.current[index]}
                    scale={scale}
                    onChange={(key, value) =>
                      changeSchemas([{ key, value: round(value, 2), schemaId: selectedSchema.id }])
                    }
                  />
                )}
              {pageCursor !== index ? (
                <Mask
                  width={paperSize.width + RULER_HEIGHT}
                  height={paperSize.height + RULER_HEIGHT}
                />
              ) : (
                !editing && (
                  <Moveable
                    ref={moveable}
                    target={activeElements}
                    controlScale={controlScale}
                    bounds={{ left: 0, top: 0, bottom: paperSize.height, right: paperSize.width }}
                    horizontalGuidelines={snapTargets.horizontal.map((position) => position * ZOOM)}
                    verticalGuidelines={snapTargets.vertical.map((position) => position * ZOOM)}
                    elementGuidelines={schemasList[pageCursor]
                      .filter(
                        (schema) => !activeElements.some((element) => element.id === schema.id),
                      )
                      .map((schema) => document.getElementById(schema.id))
                      .filter((element): element is HTMLElement => element instanceof HTMLElement)}
                    snapEnabled={!isPressAltKey}
                    snapGridSize={
                      snapTargets.gridSpacing ? snapTargets.gridSpacing * ZOOM : undefined
                    }
                    keepRatio={isPressShiftKey}
                    rotatable={rotatable}
                    renderDirections={isHeightLockedSelection ? ['e', 'w'] : undefined}
                    onDrag={onDrag}
                    onDragEnd={onDragEnd}
                    onDragGroupEnd={onDragEnds}
                    onRotate={onRotate}
                    onRotateEnd={onRotateEnd}
                    onRotateGroupEnd={onRotateEnds}
                    onResize={onResize}
                    onResizeEnd={onResizeEnd}
                    onResizeGroupEnd={onResizeEnds}
                    onClick={onClickMoveable}
                  />
                )
              )}
            </>
          );
        }}
        renderSchema={({ schema, index }) => {
          const mode =
            editing && activeElements.map((ae) => ae.id).includes(schema.id)
              ? 'designer'
              : 'viewer';

          const content = schema.content || '';
          let value = content;

          if (mode !== 'designer' && schema.readOnly) {
            const variables = {
              ...schemasList.flat().reduce(
                (acc, currSchema) => {
                  acc[currSchema.name] = currSchema.content || '';
                  return acc;
                },
                {} as Record<string, string>,
              ),
              totalPages: schemasList.length,
              currentPage: index + 1,
            };

            value = replacePlaceholders({ content, variables, schemas: schemasList });
          }

          return (
            <Renderer
              key={schema.id}
              schema={schema}
              basePdf={basePdf}
              value={value}
              onChangeHoveringSchemaId={onChangeHoveringSchemaId}
              mode={mode}
              onChange={
                (schemasList[pageCursor] || []).some((s) => s.id === schema.id)
                  ? (arg) => {
                      // Use type assertion to safely handle the argument
                      type ChangeArg = { key: string; value: unknown };
                      const args = Array.isArray(arg) ? (arg as ChangeArg[]) : [arg as ChangeArg];
                      const entries = args.map(({ key, value }) => ({
                        key,
                        value,
                        schemaId: schema.id,
                      }));
                      // Letter text edits commit the `text` template rather
                      // than `content` (variables JSON); both drive height.
                      const reflowEntry =
                        entries.find(
                          (entry) =>
                            entry.key === 'content' && typeof entry.value === 'string',
                        ) ??
                        (schema.type === 'multiVariableText'
                          ? entries.find(
                              (entry) =>
                                entry.key === 'text' && typeof entry.value === 'string',
                            )
                          : undefined);
                      if (reflowEntry) {
                        const contentEntries = entries.filter(
                          (entry) =>
                            entry.key === 'content' ||
                            entry.key === 'text' ||
                            entry.key === 'variables',
                        );
                        const snapshot = {
                          ...schema,
                          [reflowEntry.key]: reflowEntry.value,
                        } as SchemaForUI;
                        const content = (
                          schema as unknown as { content?: unknown }
                        ).content;
                        queueLiveTextReflow({
                          schema: snapshot,
                          measureValue:
                            reflowEntry.key === 'content'
                              ? (reflowEntry.value as string)
                              : typeof content === 'string'
                                ? content
                                : '',
                          commitEntries: contentEntries,
                          direct: false,
                        });
                        const rest = entries.filter(
                          (entry) =>
                            entry.key !== 'content' &&
                            entry.key !== 'text' &&
                            entry.key !== 'variables',
                        );
                        if (rest.length > 0) changeSchemas(rest);
                        return;
                      }
                      if (entries.length > 0) changeSchemas(entries);
                    }
                  : undefined
              }
              stopEditing={() => {
                flushPendingTextChanges();
                setEditing(false);
              }}
              outline={`1px ${isOutsideContentBounds(schema, contentBounds) ? 'solid' : hoveringSchemaId === schema.id ? 'solid' : 'dashed'} ${
                isOutsideContentBounds(schema, contentBounds)
                  ? token.colorWarning
                  : schema.readOnly && hoveringSchemaId !== schema.id
                    ? 'transparent'
                    : token.colorPrimary
              }`}
              marginShadow={elementMarginShadow}
              scale={renderScale}
            />
          );
        }}
      />
    </div>
  );
};
export default forwardRef<HTMLDivElement, Props>(Canvas);
