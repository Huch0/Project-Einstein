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
