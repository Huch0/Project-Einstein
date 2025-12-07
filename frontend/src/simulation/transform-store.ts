import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import type { CanvasTransform, CanvasDimensions, ImageDimensions, SceneMappingLike } from './coords';
import { computeCanvasTransform, DEFAULT_TRANSFORM } from './coords';

type TransformState = {
  transform: CanvasTransform;
  mapping?: SceneMappingLike | null;
  image?: ImageDimensions | null;
  container: CanvasDimensions;
  camera: { position: { x: number; y: number }; zoom: number } | null;
};

type Listener = () => void;

export function createTransformStore(initial: Partial<TransformState> = {}) {
  let state: TransformState = {
    transform: DEFAULT_TRANSFORM,
    mapping: initial.mapping ?? null,
    image: initial.image ?? null,
    container: initial.container ?? { width: 0, height: 0 },
    camera: null,
  };
  const listeners = new Set<Listener>();

  const notify = () => listeners.forEach((l) => l());

  const recompute = () => {
    const base = computeCanvasTransform({
      mapping: state.mapping ?? null,
      imageSize: state.image ?? null,
      containerSize: state.container,
    });
    // Apply camera (pan/zoom) if present without mutating base mapping semantics.
    const cam = state.camera;
    let transformed = base;
    if (cam) {
      const zoom = cam.zoom <= 0 ? 1 : cam.zoom;
      // Adjust metersToPixels by zoom factor (zoom acts like additional scale)
      const metersToPixels = base.metersToPixels * zoom;
      // Apply pan shift (camera.position is stage translation in pixels)
      const originPx: [number, number] = [
        base.originPx[0] + cam.position.x,
        base.originPx[1] + cam.position.y,
      ];
      transformed = {
        ...base,
        originPx,
        metersToPixels,
        pxPerMeter: metersToPixels,
        pixelsToMeters: metersToPixels !== 0 ? 1 / metersToPixels : 0,
      };
    }
    state = { ...state, transform: transformed };
  };

  const setContainer = (container: CanvasDimensions) => {
    state = { ...state, container };
    recompute();
    notify();
  };

  const setMappingAndImage = (mapping?: SceneMappingLike | null, image?: ImageDimensions | null) => {
    state = { ...state, mapping: mapping ?? null, image: image ?? null };
    recompute();
    notify();
  };

  const setCamera = (camera: { position: { x: number; y: number }; zoom: number } | null) => {
    state = { ...state, camera };
    recompute();
    notify();
  };

  const subscribe = (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };

  const getSnapshot = () => state;
  const getServerSnapshot = () => state;

  return {
    subscribe,
    getSnapshot,
    getServerSnapshot,
    setContainer,
    setMappingAndImage,
    setCamera,
  };
}

export function useTransformStore(store: ReturnType<typeof createTransformStore>) {
  const subscribe = useMemo(() => store.subscribe, [store]);
  const getSnapshot = useMemo(() => store.getSnapshot, [store]);
  const getServerSnapshot = useMemo(() => store.getServerSnapshot, [store]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return state;
}

export function useTransformController(store: ReturnType<typeof createTransformStore>) {
  const setContainer = useCallback(store.setContainer, [store]);
  const setMappingAndImage = useCallback(store.setMappingAndImage, [store]);
  const setCamera = useCallback(store.setCamera, [store]);
  return { setContainer, setMappingAndImage, setCamera };
}
