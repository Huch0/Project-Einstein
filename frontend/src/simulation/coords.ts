export interface SceneMappingLike {
  origin_px?: unknown;
  scale_m_per_px?: unknown;
}

export interface NormalizedSceneMapping {
  origin_px: [number, number];
  scale_m_per_px: number;
}

export interface CanvasDimensions {
  width: number;
  height: number;
}

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CanvasTransform {
  hasMapping: boolean;
  originPx: [number, number];
  metersToPixels: number;
  pxPerMeter: number;
  pixelsToMeters: number;
  letterboxScale: number;
  letterboxOffset: { x: number; y: number };
  imagePxPerMeter: number;
  mapping?: NormalizedSceneMapping;
}

const DEFAULT_SCALE_M_PER_PX = 0.01;
const DEFAULT_METERS_TO_PX = 80;
const FALLBACK_MIN_PX_PER_M = 6;
const FALLBACK_MAX_PX_PER_M = 480;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const normalizeOrigin = (originCandidate: unknown): [number, number] | null => {
  if (Array.isArray(originCandidate) && originCandidate.length >= 2) {
    const ox = Number(originCandidate[0]);
    const oy = Number(originCandidate[1]);
    if (Number.isFinite(ox) && Number.isFinite(oy)) {
      return [ox, oy];
    }
  }
  if (
    originCandidate &&
    typeof originCandidate === 'object' &&
    'x' in (originCandidate as Record<string, unknown>) &&
    'y' in (originCandidate as Record<string, unknown>)
  ) {
    const source = originCandidate as { x: unknown; y: unknown };
    const ox = Number(source.x);
    const oy = Number(source.y);
    if (Number.isFinite(ox) && Number.isFinite(oy)) {
      return [ox, oy];
    }
  }
  return null;
};

const letterbox = (
  image: ImageDimensions | undefined,
  container: CanvasDimensions,
): { scale: number; offsetX: number; offsetY: number } => {
  if (!image || image.width <= 0 || image.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  if (container.width <= 0 || container.height <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }

  const scale = Math.min(
    container.width / image.width,
    container.height / image.height,
  );
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const renderW = image.width * safeScale;
  const renderH = image.height * safeScale;
  const offsetX = (container.width - renderW) / 2;
  const offsetY = (container.height - renderH) / 2;
  return { scale: safeScale, offsetX, offsetY };
};

export function computeLetterboxFit(
  image: ImageDimensions | undefined,
  container: CanvasDimensions,
) {
  return letterbox(image, container);
}

export function normalizeSceneMapping(
  mapping?: SceneMappingLike | null,
): NormalizedSceneMapping | null {
  if (!mapping) {
    return null;
  }
  const origin = normalizeOrigin(mapping.origin_px);
  const scaleMPerPx = Number(mapping.scale_m_per_px);
  if (!origin || !Number.isFinite(scaleMPerPx) || scaleMPerPx <= 0) {
    return null;
  }
  return { origin_px: origin, scale_m_per_px: scaleMPerPx };
}

export function computeCanvasTransform({
  mapping,
  imageSize,
  containerSize,
}: {
  mapping?: SceneMappingLike | null;
  imageSize?: ImageDimensions | null;
  containerSize: CanvasDimensions;
}): CanvasTransform {
  const fallbackOrigin: [number, number] = [
    containerSize.width / 2,
    containerSize.height / 2,
  ];
  const normalized = normalizeSceneMapping(mapping);

  if (!normalized) {
    const metersToPixels = clamp(
      DEFAULT_METERS_TO_PX,
      FALLBACK_MIN_PX_PER_M,
      FALLBACK_MAX_PX_PER_M,
    );
    return {
      hasMapping: false,
      originPx: fallbackOrigin,
      metersToPixels,
      pxPerMeter: metersToPixels,
      pixelsToMeters: 1 / metersToPixels,
      letterboxScale: 1,
      letterboxOffset: { x: 0, y: 0 },
      imagePxPerMeter: metersToPixels,
    };
  }

  const { scale, offsetX, offsetY } = letterbox(imageSize ?? undefined, containerSize);
  const imagePxPerMeter = 1 / normalized.scale_m_per_px;
  const metersToPixels = imagePxPerMeter * scale;
  const originPx: [number, number] = [
    offsetX + normalized.origin_px[0] * scale,
    offsetY + normalized.origin_px[1] * scale,
  ];

  return {
    hasMapping: true,
    originPx,
    metersToPixels,
    pxPerMeter: metersToPixels,
    pixelsToMeters: metersToPixels !== 0 ? 1 / metersToPixels : 0,
    letterboxScale: scale,
    letterboxOffset: { x: offsetX, y: offsetY },
    imagePxPerMeter,
    mapping: normalized,
  };
}

export function createBoundingTransform({
  bounds,
  containerSize,
  padding = 24,
  clampPxPerMeter,
}: {
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  containerSize: CanvasDimensions;
  padding?: number;
  clampPxPerMeter?: { min?: number; max?: number };
}): CanvasTransform {
  const widthMeters = Math.max(bounds.maxX - bounds.minX, 1e-3);
  const heightMeters = Math.max(bounds.maxY - bounds.minY, 1e-3);
  const availableWidth = Math.max(containerSize.width - padding * 2, 8);
  const availableHeight = Math.max(containerSize.height - padding * 2, 8);
  const rawScale = Math.min(availableWidth / widthMeters, availableHeight / heightMeters);
  const minClamp = clampPxPerMeter?.min ?? FALLBACK_MIN_PX_PER_M;
  const maxClamp = clampPxPerMeter?.max ?? FALLBACK_MAX_PX_PER_M;
  const metersToPixels = clamp(rawScale, minClamp, maxClamp);
  const originPx: [number, number] = [
    (containerSize.width - widthMeters * metersToPixels) / 2 - bounds.minX * metersToPixels,
    (containerSize.height - heightMeters * metersToPixels) / 2 - bounds.minY * metersToPixels,
  ];

  return {
    hasMapping: false,
    originPx,
    metersToPixels,
    pxPerMeter: metersToPixels,
    pixelsToMeters: metersToPixels !== 0 ? 1 / metersToPixels : 0,
    letterboxScale: 1,
    letterboxOffset: { x: 0, y: 0 },
    imagePxPerMeter: metersToPixels,
  };
}

export const sceneMetersToCanvas = (
  point: [number, number],
  transform: CanvasTransform,
): [number, number] => {
  const [x, y] = point;
  return [
    transform.originPx[0] + x * transform.metersToPixels,
    transform.originPx[1] - y * transform.metersToPixels,
  ];
};

export const canvasToSceneMeters = (
  point: [number, number],
  transform: CanvasTransform,
): [number, number] => {
  const [xPx, yPx] = point;
  return [
    (xPx - transform.originPx[0]) * transform.pixelsToMeters,
    (transform.originPx[1] - yPx) * transform.pixelsToMeters,
  ];
};

export function sceneMetersToImagePixels(
  point: [number, number],
  mapping: NormalizedSceneMapping,
): [number, number] {
  const [x, y] = point;
  const pxPerMeter = 1 / mapping.scale_m_per_px;
  return [
    mapping.origin_px[0] + x * pxPerMeter,
    mapping.origin_px[1] - y * pxPerMeter,
  ];
}

export function imagePixelsToSceneMeters(
  point: [number, number],
  mapping: NormalizedSceneMapping,
): [number, number] {
  const [xPx, yPx] = point;
  const metersPerPx = mapping.scale_m_per_px;
  return [
    (xPx - mapping.origin_px[0]) * metersPerPx,
    (mapping.origin_px[1] - yPx) * metersPerPx,
  ];
}

export const DEFAULT_TRANSFORM: CanvasTransform = {
  hasMapping: false,
  originPx: [0, 0],
  metersToPixels: DEFAULT_METERS_TO_PX,
  pxPerMeter: DEFAULT_METERS_TO_PX,
  pixelsToMeters: 1 / DEFAULT_METERS_TO_PX,
  letterboxScale: 1,
  letterboxOffset: { x: 0, y: 0 },
  imagePxPerMeter: DEFAULT_METERS_TO_PX,
};

export const combineTransforms = (
  preferred: CanvasTransform | null | undefined,
  fallback: CanvasTransform,
): CanvasTransform => {
  if (preferred && preferred.hasMapping) {
    return preferred;
  }
  return fallback;
};

const toVec2 = (value: unknown): [number, number] | null => {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  if (
    value &&
    typeof value === 'object' &&
    'x' in (value as Record<string, unknown>) &&
    'y' in (value as Record<string, unknown>)
  ) {
    const source = value as { x: unknown; y: unknown };
    const x = Number(source.x);
    const y = Number(source.y);
    if (Number.isFinite(x) && Number.isFinite(y)) {
      return [x, y];
    }
  }

  return null;
};

const cloneScene = <T>(scene: T): T => {
  try {
    return structuredClone(scene);
  } catch {
    return JSON.parse(JSON.stringify(scene)) as T;
  }
};

const isFiniteTuple = (tuple: unknown): tuple is [number, number] => {
  if (!Array.isArray(tuple) || tuple.length < 2) return false;
  const x = Number(tuple[0]);
  const y = Number(tuple[1]);
  return Number.isFinite(x) && Number.isFinite(y);
};

const translateTuple = (tuple: [number, number], dx: number, dy: number): [number, number] => [
  tuple[0] + dx,
  tuple[1] + dy,
];

const scaleTupleAbout = (
  tuple: [number, number],
  center: [number, number],
  scale: number,
): [number, number] => [
  center[0] + (tuple[0] - center[0]) * scale,
  center[1] + (tuple[1] - center[1]) * scale,
];

const vectorLikeKey = (key: string) =>
  /(_m$|_origin$|_anchor|_point|_offset|position|vertex)/i.test(key);

const scalarLengthKey = (key: string) => /length|radius|width|height|distance/i.test(key);

const STATIC_LIKE_ID_PREFIXES = [
  'ground',
  'surface',
  'platform',
  'wall',
  'ramp',
  'floor',
  'incline',
  'support',
  'anchor',
];

const isStaticLikeBody = (body: any): boolean => {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const typeRaw = typeof body.type === 'string' ? body.type.toLowerCase() : '';
  if (typeRaw) {
    if (typeRaw === 'dynamic' || typeRaw === 'kinematic') {
      return false;
    }
    if (typeRaw === 'static' || typeRaw === 'environment') {
      return true;
    }
    if (STATIC_LIKE_ID_PREFIXES.some((prefix) => typeRaw.startsWith(prefix))) {
      return true;
    }
  }

  const idRaw = typeof body.id === 'string' ? body.id.toLowerCase() : '';
  if (!idRaw) {
    return false;
  }

  return STATIC_LIKE_ID_PREFIXES.some((prefix) => idRaw.startsWith(prefix));
};

const ensureDynamicBodyDefaults = (body: any) => {
  if (!body || typeof body !== 'object') {
    return;
  }

  const typeRaw = typeof body.type === 'string' ? body.type.toLowerCase() : '';
  if (typeRaw === 'static' || typeRaw === 'environment' || isStaticLikeBody(body)) {
    return;
  }

  if (!body.material || typeof body.material !== 'object') {
    body.material = {};
  }

  const material = body.material as Record<string, unknown>;
  const restitutionRaw = typeof material.restitution === 'number'
    ? material.restitution
    : Number(material.restitution);

  if (!Number.isFinite(restitutionRaw)) {
    material.restitution = 1;
  }
};

const CONTACT_SEPARATION_EPSILON = 5e-4;

const getColliderHalfExtents = (body: any): { halfX: number; halfY: number } => {
  const collider = body?.collider;
  if (!collider || typeof collider !== 'object') {
    return { halfX: 0.05, halfY: 0.05 };
  }

  const type = typeof collider.type === 'string' ? collider.type.toLowerCase() : '';
  if (type === 'rectangle') {
    const width = Number(collider.width_m);
    const height = Number(collider.height_m);
    const halfX = Number.isFinite(width) && width > 0 ? width / 2 : 0.05;
    const halfY = Number.isFinite(height) && height > 0 ? height / 2 : 0.05;
    return { halfX, halfY };
  }

  if (type === 'circle') {
    const radius = Number(collider.radius_m);
    const half = Number.isFinite(radius) && radius > 0 ? radius : 0.05;
    return { halfX: half, halfY: half };
  }

  const polygonSources: Array<unknown> = [];
  if (Array.isArray(collider.vertices)) {
    polygonSources.push(...collider.vertices);
  }
  if (Array.isArray(collider.points_m)) {
    polygonSources.push(...collider.points_m);
  }
  if (Array.isArray(collider.polygon_m)) {
    polygonSources.push(...collider.polygon_m);
  }

  if (polygonSources.length > 0) {
    let halfX = 0.05;
    let halfY = 0.05;
    const points = polygonSources
      .map(toVec2)
      .filter((point): point is [number, number] => Boolean(point));
    if (points.length > 0) {
      const xs = points.map((p) => p[0]);
      const ys = points.map((p) => p[1]);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      halfX = (maxX - minX) / 2;
      halfY = (maxY - minY) / 2;
    }
    return {
      halfX: halfX > 0 ? halfX : 0.05,
      halfY: halfY > 0 ? halfY : 0.05,
    };
  }

  return { halfX: 0.05, halfY: 0.05 };
};

const computeBodyAabb = (body: any): { id: string; minX: number; maxX: number; minY: number; maxY: number } | null => {
  const tuple = toVec2(body?.position_m);
  if (!tuple) return null;
  const { halfX, halfY } = getColliderHalfExtents(body);
  return {
    id: typeof body?.id === 'string' ? body.id : 'body',
    minX: tuple[0] - halfX,
    maxX: tuple[0] + halfX,
    minY: tuple[1] - halfY,
    maxY: tuple[1] + halfY,
  };
};

const mergeAabbs = (entries: Array<{ minX: number; maxX: number; minY: number; maxY: number }>) => {
  return entries.reduce(
    (acc, entry) => {
      return {
        minX: Math.min(acc.minX, entry.minX),
        maxX: Math.max(acc.maxX, entry.maxX),
        minY: Math.min(acc.minY, entry.minY),
        maxY: Math.max(acc.maxY, entry.maxY),
      };
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
};

const translateBody = (body: any, dx: number, dy: number) => {
  const pos = toVec2(body?.position_m);
  if (pos) {
    body.position_m = translateTuple(pos, dx, dy);
  }

  const collider = body?.collider;
  if (collider && typeof collider === 'object') {
    const translatePoints = (key: string) => {
      const value = (collider as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        (collider as Record<string, unknown>)[key] = value.map((item) => {
          const tuple = toVec2(item);
          return tuple ? translateTuple(tuple, dx, dy) : item;
        });
      }
    };

    translatePoints('points_m');
    translatePoints('polygon_m');
    translatePoints('vertices');
  }
};

const translateConstraint = (constraint: any, dx: number, dy: number) => {
  if (!constraint || typeof constraint !== 'object') return;
  for (const [key, value] of Object.entries(constraint)) {
    if (Array.isArray(value) && value.length >= 2 && vectorLikeKey(key)) {
      const tuple = toVec2(value);
      if (tuple) {
        (constraint as Record<string, unknown>)[key] = translateTuple(tuple, dx, dy);
      }
    }
  }
};

const scaleBody = (body: any, center: [number, number], scale: number, options: { scaleVelocities?: boolean }) => {
  const pos = toVec2(body?.position_m);
  if (pos) {
    body.position_m = scaleTupleAbout(pos, center, scale);
  }

  if (options.scaleVelocities) {
    const velocity = toVec2(body?.velocity_m_s);
    if (velocity) {
      body.velocity_m_s = [velocity[0] * scale, velocity[1] * scale];
    }
  }

  const collider = body?.collider;
  if (collider && typeof collider === 'object') {
    if (typeof collider.width_m === 'number') {
      collider.width_m *= scale;
    }
    if (typeof collider.height_m === 'number') {
      collider.height_m *= scale;
    }
    if (typeof collider.radius_m === 'number') {
      collider.radius_m *= scale;
    }

    const scalePoints = (key: string) => {
      const value = (collider as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        (collider as Record<string, unknown>)[key] = value.map((item) => {
          const tuple = toVec2(item);
          return tuple ? scaleTupleAbout(tuple, center, scale) : item;
        });
      }
    };

    scalePoints('points_m');
    scalePoints('polygon_m');
    scalePoints('vertices');
  }
};

const scaleConstraint = (
  constraint: any,
  center: [number, number],
  scale: number,
) => {
  if (!constraint || typeof constraint !== 'object') return;

  for (const [key, value] of Object.entries(constraint)) {
    if (Array.isArray(value) && value.length >= 2 && vectorLikeKey(key)) {
      const tuple = toVec2(value);
      if (tuple) {
        (constraint as Record<string, unknown>)[key] = scaleTupleAbout(tuple, center, scale);
      }
    }

    if (typeof value === 'number' && scalarLengthKey(key)) {
      (constraint as Record<string, unknown>)[key] = value * scale;
    }
  }
};

const safeMargin = (value: number) => (Number.isFinite(value) && value >= 0 ? value : 0);

const computeImageBounds = (mapping: NormalizedSceneMapping, image: ImageDimensions): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} => {
  const corners: Array<[number, number]> = [
    imagePixelsToSceneMeters([0, 0], mapping),
    imagePixelsToSceneMeters([image.width, 0], mapping),
    imagePixelsToSceneMeters([image.width, image.height], mapping),
    imagePixelsToSceneMeters([0, image.height], mapping),
  ];

  const xs = corners.map((corner) => corner[0]);
  const ys = corners.map((corner) => corner[1]);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
};

export interface SceneNormalizationOptions {
  margin_m?: number;
  mode?: 'translate-only' | 'translate-and-scale';
  targetBodies?: 'dynamic' | 'all';
  scaleVelocities?: boolean;
}

export interface SceneNormalizationReport {
  applied: boolean;
  translation_m: [number, number];
  scale?: number;
  adjustedBodyIds: string[];
  mode: 'translate-only' | 'translate-and-scale';
  warnings: string[];
}

export interface SceneNormalizationResult<TScene = any> {
  scene: TScene;
  report: SceneNormalizationReport;
}

const pickBodiesForNormalization = (
  scene: any,
  selection: SceneNormalizationOptions['targetBodies'],
): Array<any> => {
  const bodies = Array.isArray(scene?.bodies) ? scene.bodies : [];
  if (selection === 'all') {
    return bodies;
  }
  return bodies.filter((body: any) => {
    const type = typeof body?.type === 'string' ? body.type.toLowerCase() : '';
    return type !== 'static' && type !== 'environment';
  });
};

export function normalizeSceneToImageBounds<TScene = any>(
  sourceScene: TScene,
  mapping: NormalizedSceneMapping,
  image: ImageDimensions,
  options?: SceneNormalizationOptions,
): SceneNormalizationResult<TScene> {
  const scene = cloneScene(sourceScene);
  const sceneAny = scene as any;
  const warnings: string[] = [];
  const margin = safeMargin(options?.margin_m ?? 0.02);
  const mode = options?.mode ?? 'translate-and-scale';
  const scaleVelocities = options?.scaleVelocities ?? false;

  if (Array.isArray(sceneAny?.bodies)) {
    for (const body of sceneAny.bodies) {
      ensureDynamicBodyDefaults(body);
    }
  }

  const targets = pickBodiesForNormalization(sceneAny, options?.targetBodies ?? 'dynamic');

  if (targets.length === 0) {
    return {
      scene,
      report: {
        applied: false,
        translation_m: [0, 0],
        scale: undefined,
        adjustedBodyIds: [],
        mode,
        warnings: ['Normalization skipped: no eligible bodies found.'],
      },
    };
  }

  const bounds = computeImageBounds(mapping, image);
  const bodyAabbs = targets
    .map(computeBodyAabb)
    .filter((entry): entry is { id: string; minX: number; maxX: number; minY: number; maxY: number } => Boolean(entry));

  if (bodyAabbs.length === 0) {
    return {
      scene,
      report: {
        applied: false,
        translation_m: [0, 0],
        scale: undefined,
        adjustedBodyIds: [],
        mode,
        warnings: ['Normalization skipped: no positions available for bodies.'],
      },
    };
  }

  const aggregate = mergeAabbs(bodyAabbs);
  const allowedMinX = bounds.minX + margin;
  const allowedMaxX = bounds.maxX - margin;
  const allowedMinY = bounds.minY + margin;
  const allowedMaxY = bounds.maxY - margin;

  let dx = 0;
  let dy = 0;

  if (aggregate.minX < allowedMinX) {
    dx += allowedMinX - aggregate.minX;
  }
  if (aggregate.maxX + dx > allowedMaxX) {
    dx -= aggregate.maxX + dx - allowedMaxX;
  }

  if (aggregate.minY < allowedMinY) {
    dy += allowedMinY - aggregate.minY;
  }
  if (aggregate.maxY + dy > allowedMaxY) {
    dy -= aggregate.maxY + dy - allowedMaxY;
  }

  if (dx !== 0 || dy !== 0) {
    for (const body of targets) {
      translateBody(body, dx, dy);
    }
    if (Array.isArray(sceneAny?.constraints)) {
      for (const constraint of sceneAny.constraints) {
        translateConstraint(constraint, dx, dy);
      }
    }
  }

  const translatedAabbs = targets
    .map(computeBodyAabb)
    .filter((entry): entry is { id: string; minX: number; maxX: number; minY: number; maxY: number } => Boolean(entry));

  const translatedAggregate = mergeAabbs(translatedAabbs);
  const width = translatedAggregate.maxX - translatedAggregate.minX;
  const height = translatedAggregate.maxY - translatedAggregate.minY;
  const allowedWidth = allowedMaxX - allowedMinX;
  const allowedHeight = allowedMaxY - allowedMinY;

  let scale = 1;
  if (mode === 'translate-and-scale' && (width > allowedWidth || height > allowedHeight)) {
    const widthScale = allowedWidth > 0 ? allowedWidth / width : 1;
    const heightScale = allowedHeight > 0 ? allowedHeight / height : 1;
    const candidate = Math.min(widthScale, heightScale, 1);
    if (candidate < 1) {
      scale = candidate;
      const center: [number, number] = [
        (translatedAggregate.minX + translatedAggregate.maxX) / 2,
        (translatedAggregate.minY + translatedAggregate.maxY) / 2,
      ];

      for (const body of targets) {
        scaleBody(body, center, scale, { scaleVelocities });
      }

      if (Array.isArray(sceneAny?.constraints)) {
        for (const constraint of sceneAny.constraints) {
          scaleConstraint(constraint, center, scale);
        }
      }

      // After scaling, run a translation pass to restore margins tightly.
      const scaledAabbs = targets
        .map(computeBodyAabb)
        .filter((entry): entry is { id: string; minX: number; maxX: number; minY: number; maxY: number } => Boolean(entry));
      const scaledAggregate = mergeAabbs(scaledAabbs);

      let postDx = 0;
      let postDy = 0;

      if (scaledAggregate.minX < allowedMinX) {
        postDx += allowedMinX - scaledAggregate.minX;
      }
      if (scaledAggregate.maxX + postDx > allowedMaxX) {
        postDx -= scaledAggregate.maxX + postDx - allowedMaxX;
      }
      if (scaledAggregate.minY < allowedMinY) {
        postDy += allowedMinY - scaledAggregate.minY;
      }
      if (scaledAggregate.maxY + postDy > allowedMaxY) {
        postDy -= scaledAggregate.maxY + postDy - allowedMaxY;
      }

      if (postDx !== 0 || postDy !== 0) {
        for (const body of targets) {
          translateBody(body, postDx, postDy);
        }
        if (Array.isArray(sceneAny?.constraints)) {
          for (const constraint of sceneAny.constraints) {
            translateConstraint(constraint, postDx, postDy);
          }
        }
        dx += postDx;
        dy += postDy;
      }
    }
  }

  const separationAdjustments = new Map<string, { dx: number; dy: number }>();
  const dynamicForSeparation = targets.filter((body) => !isStaticLikeBody(body));
  const staticBodies = Array.isArray(sceneAny?.bodies)
    ? (sceneAny.bodies as Array<any>).filter((body) => isStaticLikeBody(body))
    : [];

  if (dynamicForSeparation.length > 0 && staticBodies.length > 0) {
    const maxIterations = 5;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      let movedThisPass = false;

      for (const body of dynamicForSeparation) {
        let dynamicAabb = computeBodyAabb(body);
        if (!dynamicAabb) {
          continue;
        }

        for (const staticBody of staticBodies) {
          if (staticBody === body) {
            continue;
          }

          const staticAabb = computeBodyAabb(staticBody);
          if (!staticAabb) {
            continue;
          }

          const overlapX =
            Math.min(dynamicAabb.maxX, staticAabb.maxX) - Math.max(dynamicAabb.minX, staticAabb.minX);
          const overlapY =
            Math.min(dynamicAabb.maxY, staticAabb.maxY) - Math.max(dynamicAabb.minY, staticAabb.minY);

          if (overlapX <= 0 || overlapY <= 0) {
            continue;
          }

          let resolveX = 0;
          let resolveY = 0;

          if (overlapY <= overlapX) {
            const centerDynamicY = (dynamicAabb.minY + dynamicAabb.maxY) / 2;
            const centerStaticY = (staticAabb.minY + staticAabb.maxY) / 2;
            const direction = centerDynamicY >= centerStaticY ? 1 : -1;
            resolveY = overlapY * direction + CONTACT_SEPARATION_EPSILON * direction;
          } else {
            const centerDynamicX = (dynamicAabb.minX + dynamicAabb.maxX) / 2;
            const centerStaticX = (staticAabb.minX + staticAabb.maxX) / 2;
            const direction = centerDynamicX >= centerStaticX ? 1 : -1;
            resolveX = overlapX * direction + CONTACT_SEPARATION_EPSILON * direction;
          }

          if (resolveX === 0 && resolveY === 0) {
            continue;
          }

          translateBody(body, resolveX, resolveY);
          dynamicAabb = {
            id: dynamicAabb.id,
            minX: dynamicAabb.minX + resolveX,
            maxX: dynamicAabb.maxX + resolveX,
            minY: dynamicAabb.minY + resolveY,
            maxY: dynamicAabb.maxY + resolveY,
          };

          const previous = separationAdjustments.get(dynamicAabb.id) ?? { dx: 0, dy: 0 };
          previous.dx += resolveX;
          previous.dy += resolveY;
          separationAdjustments.set(dynamicAabb.id, previous);
          movedThisPass = true;
        }
      }

      if (!movedThisPass) {
        break;
      }
    }

    if (separationAdjustments.size > 0) {
      warnings.push(
        `Contact separation applied to ${Array.from(separationAdjustments.keys()).join(', ')}`,
      );
    }
  }

  const finalAabbs = targets
    .map(computeBodyAabb)
    .filter((entry): entry is { id: string; minX: number; maxX: number; minY: number; maxY: number } =>
      Boolean(entry),
    );

  const adjustedBodyIds = new Set<string>(finalAabbs.map((entry) => entry.id));
  for (const id of separationAdjustments.keys()) {
    adjustedBodyIds.add(id);
  }

  if (!sceneAny.meta || typeof sceneAny.meta !== 'object') {
    sceneAny.meta = {};
  }
  const normalizationMeta: Record<string, unknown> = {
    translation_m: [dx, dy],
    scale,
    mode,
    margin_m: margin,
  };
  if (separationAdjustments.size > 0) {
    normalizationMeta.contact_separation = Array.from(separationAdjustments.entries()).map(
      ([id, delta]) => ({
        id,
        delta_m: [delta.dx, delta.dy] as [number, number],
      }),
    );
  }
  (sceneAny.meta as Record<string, unknown>).normalization = normalizationMeta;

  const separationApplied = separationAdjustments.size > 0;

  return {
    scene,
    report: {
      applied: dx !== 0 || dy !== 0 || scale !== 1 || separationApplied,
      translation_m: [dx, dy],
      scale: scale !== 1 ? scale : undefined,
      adjustedBodyIds: Array.from(adjustedBodyIds),
      mode,
      warnings,
    },
  };
}

