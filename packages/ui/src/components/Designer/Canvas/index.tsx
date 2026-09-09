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
  isSchemaPlacementFree,
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
import { getLiveTextReflowChanges, type SchemaChange } from './liveTextReflow.js';
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
  const pendingTextChangesRef = useRef<SchemaChange[]>([]);
  const pendingTextReflowRef = useRef<{ schema: SchemaForUI; value: string } | null>(null);
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
    if (
      schema &&
      !isSchemaPlacementFree({
        schema: {
          position: { x: fmt(left), y: fmt(top) },
          width: schema.width,
          height: schema.height,
        },
        schemas: schemasList[pageCursor].filter((candidate) => candidate.id !== schema.id),
        bounds: contentBounds,
        margins: getElementMargins(pageLayout),
      })
    ) {
      target.style.top = `${schema.position.y * ZOOM}px`;
      target.style.left = `${schema.position.x * ZOOM}px`;
      return;
    }
    changeSchemas([
      { key: 'position.y', value: fmt(top), schemaId: target.id },
      { key: 'position.x', value: fmt(left), schemaId: target.id },
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

    const changes: SchemaChange[] = [
      { key: 'position.x', value: fmt(left), schemaId: id },
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'width', value: fmt(width), schemaId: id },
      { key: 'height', value: fmt(height), schemaId: id },
    ];

    // A horizontal resize handle was dragged: the field's width is no
    // longer driven by its widthMode, so lock it to 'fixed' like a manual
    // edit of the width field in the property panel would.
    const resizedHorizontally = (lastResizeDirectionRef.current?.[0] ?? 0) !== 0;
    if (
      targetSchema &&
      resizedHorizontally &&
      targetSchema.type === 'text' &&
      getSchemaWidthMode(targetSchema) !== 'fixed'
    ) {
      changes.push({ key: 'widthMode', value: 'fixed', schemaId: id });
    }
    lastResizeDirectionRef.current = null;

    changeSchemas(changes);

    if (!targetSchema) return;

    targetSchema.position.x = fmt(left);
    targetSchema.position.y = fmt(top);
    targetSchema.width = fmt(width);
    targetSchema.height = fmt(height);
    if (targetSchema.type === 'text' || targetSchema.type === 'multiVariableText') {
      queueLiveTextReflow(targetSchema, targetSchema.content ?? '');
    }
  };

  const onResizeEnds = ({ targets }: { targets: (HTMLElement | SVGElement)[] }) => {
    setSnapFeedback(null);
    const arg = targets.map(({ style: { width, height, top, left }, id }) => [
      { key: 'width', value: fmt(width), schemaId: id },
      { key: 'height', value: fmt(height), schemaId: id },
      { key: 'position.y', value: fmt(top), schemaId: id },
      { key: 'position.x', value: fmt(left), schemaId: id },
    ]);
    changeSchemas(flatten(arg));
  };

  const onResize = ({ target, width, height, direction }: OnResize) => {
    if (!target) return;
    lastResizeDirectionRef.current = direction;
    const style = target.style;
    const oldWidth = fmt4Num(style.width);
    const oldHeight = fmt4Num(style.height);

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

    const left = fmt4Num(style.left) + (direction[0] < 0 ? oldWidth - width : 0);
    const top = fmt4Num(style.top) + (direction[1] < 0 ? oldHeight - clampedHeight : 0);
    if (
      targetSchema &&
      !isSchemaPlacementFree({
        schema: {
          position: { x: left / ZOOM, y: top / ZOOM },
          width: width / ZOOM,
          height: clampedHeight / ZOOM,
        },
        schemas: schemasList[pageCursor].filter((candidate) => candidate.id !== targetSchema.id),
        bounds: contentBounds,
        margins: getElementMargins(pageLayout),
      })
    )
      return;
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

  const applyLiveTextReflow = async ({
    schema,
    value,
    requestId,
    commit,
  }: {
    schema: SchemaForUI;
    value: string;
    requestId: number;
    commit: boolean;
  }) => {
    try {
      const result = await getDynamicLayoutForSchema(value, {
        schema,
        basePdf,
        options: { font } as { font: Font },
        _cache: cache,
        pageSize: currentPageSize,
        margins: pageLayout.margins,
      });
      if (requestId !== reflowRequestRef.current) return;
      const layout = Array.isArray(result) ? { heights: result } : result;
      const measuredHeight = layout.heights.reduce((total, item) => total + item, 0);
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
      const changes = [
        { key: 'content', value, schemaId: schema.id },
        ...(typeof patch.minHeight === 'number'
          ? [{ key: 'minHeight', value: patch.minHeight, schemaId: schema.id }]
          : []),
        ...(typeof patch.contentMinHeight === 'number'
          ? [{ key: 'contentMinHeight', value: patch.contentMinHeight, schemaId: schema.id }]
          : []),
        ...getLiveTextReflowChanges({
          schemas: schemasList[pageCursor] || [],
          schema,
          width: typeof patch.width === 'number' ? patch.width : undefined,
          height: minimumHeight,
          scope: getReflowScope(pageLayout),
          elementSpacing:
            getElementMargins(pageLayout).bottom + getElementMargins(pageLayout).top,
          maxBottom: contentBounds.bottom,
        }),
      ];
      pendingTextReflowRef.current = null;
      if (commit) {
        pendingTextChangesRef.current = [];
        changeSchemas(changes);
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
      void applyLiveTextReflow({ ...pendingReflow, requestId, commit: true });
      return;
    }
    flushPendingContentChange();
  };

  const queueLiveTextReflow = (schema: SchemaForUI, value: string) => {
    pendingTextChangesRef.current = [{ key: 'content', value, schemaId: schema.id }];
    if (!isDynamicLayoutSchema(schema)) return;
    pendingTextReflowRef.current = { schema, value };
    const requestId = ++reflowRequestRef.current;
    if (reflowTimerRef.current) clearTimeout(reflowTimerRef.current);
    reflowTimerRef.current = setTimeout(() => {
      reflowTimerRef.current = null;
      void applyLiveTextReflow({ schema, value, requestId, commit: false });
    }, 150);
  };

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
              <Padding
                template={template}
                pageIndex={index}
                schemas={schemasList[index] ?? []}
              />
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
                      const contentChange = args.find(({ key }) => key === 'content');
                      if (contentChange && typeof contentChange.value === 'string') {
                        queueLiveTextReflow(schema, contentChange.value);
                      }
                      const nonContentChanges = args
                        .filter(({ key }) => key !== 'content')
                        .map(({ key, value }) => ({ key, value, schemaId: schema.id }));
                      if (nonContentChanges.length) changeSchemas(nonContentChanges);
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
              scale={renderScale}
            />
          );
        }}
      />
    </div>
  );
};
export default forwardRef<HTMLDivElement, Props>(Canvas);
