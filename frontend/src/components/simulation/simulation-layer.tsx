import { useEffect, useMemo, useRef, useCallback } from 'react';
import Matter from 'matter-js';
import { useSimulation } from '@/simulation/SimulationContext';
import { initializeMatterScene } from '@/simulation/matterRunner';
import {
    computeCanvasTransform,
    sceneMetersToCanvas,
    canvasToSceneMeters,
    createBoundingTransform,
    normalizeSceneMapping,
    sceneMetersToImagePixels,
    computeLetterboxFit,
} from '@/simulation/coords';

export type SimulationObjectPosition = { x: number; y: number };

export type SimulationLayerProps = {
    objectPosition: SimulationObjectPosition;
    onObjectPositionChange: (position: SimulationObjectPosition) => void;
    enabled: boolean;
    dimensions: { width: number; height: number };
};

const toVec2 = (value: unknown): [number, number] | null => {
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]);
        const y = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return [x, y];
        }
    }

    if (value && typeof value === 'object' && 'x' in (value as Record<string, unknown>) && 'y' in (value as Record<string, unknown>)) {
        const point = value as { x: unknown; y: unknown };
        const x = Number(point.x);
        const y = Number(point.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return [x, y];
        }
    }

    return null;
};

export function SimulationLayer({
    objectPosition,
    onObjectPositionChange,
    enabled,
    dimensions,
}: SimulationLayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const renderHostRef = useRef<HTMLDivElement>(null);
    const matterEngineRef = useRef<Matter.Engine | null>(null);
    const matterRenderRef = useRef<Matter.Render | null>(null);
    const matterBodyMapRef = useRef<Map<string, Matter.Body>>(new Map());
    const isDragging = useRef(false);
    const destroyMatterScene = useCallback(() => {
        const render = matterRenderRef.current;
        if (render) {
            Matter.Render.stop(render);
            render.canvas.remove();
            render.textures = {};
            matterRenderRef.current = null;
        }

        const engine = matterEngineRef.current;
        if (engine) {
            Matter.World.clear(engine.world, false);
            Matter.Engine.clear(engine);
            matterEngineRef.current = null;
        }

        matterBodyMapRef.current = new Map();
    }, []);
    const { frames, currentIndex, detections, imageSizePx, scale_m_per_px, scene, playing } = useSimulation();
    const currentFrame = frames[currentIndex];

    const applyFrameToMatter = useCallback((frame: any) => {
        if (!frame) return;
        const bodyMap = matterBodyMapRef.current;
        if (!bodyMap || bodyMap.size === 0) return;

        const updateBody = (id: string, positionValue: unknown, angleValue: unknown, velocityValue: unknown, angularVelocityValue: unknown) => {
            const matterBody = bodyMap.get(id);
            if (!matterBody) return;

            const position = toVec2(positionValue);
            if (position) {
                Matter.Body.setPosition(matterBody, { x: position[0], y: -position[1] });
            }

            if (typeof angleValue === 'number' && Number.isFinite(angleValue)) {
                Matter.Body.setAngle(matterBody, -angleValue);
            }

            if (Array.isArray(velocityValue) && velocityValue.length >= 2) {
                const vx = Number(velocityValue[0]);
                const vy = Number(velocityValue[1]);
                if (Number.isFinite(vx) && Number.isFinite(vy)) {
                    Matter.Body.setVelocity(matterBody, { x: vx, y: -vy });
                }
            }

            if (typeof angularVelocityValue === 'number' && Number.isFinite(angularVelocityValue)) {
                Matter.Body.setAngularVelocity(matterBody, -angularVelocityValue);
            }
        };

        if (Array.isArray(frame?.bodies)) {
            for (const body of frame.bodies) {
                updateBody(body?.id ?? 'body', body?.position_m, body?.angle_rad, body?.velocity_m_s, body?.angular_velocity_rad_s);
            }
            return;
        }

        if (frame?.positions && typeof frame.positions === 'object') {
            for (const [id, pos] of Object.entries(frame.positions as Record<string, unknown>)) {
                updateBody(id, pos, 0, undefined, undefined);
            }
        }
    }, []);

    const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), max);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        if (objectPosition.x === 0 && objectPosition.y === 0) {
            onObjectPositionChange({ x: rect.width / 2, y: rect.height / 2 });
            return;
        }
        const clampedX = clamp(objectPosition.x, 0, rect.width);
        const clampedY = clamp(objectPosition.y, 0, rect.height);
        if (clampedX !== objectPosition.x || clampedY !== objectPosition.y) {
            onObjectPositionChange({ x: clampedX, y: clampedY });
        }
    }, [objectPosition, onObjectPositionChange, dimensions.width, dimensions.height]);

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!enabled) return;
        isDragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!enabled || !isDragging.current) return;
        const area = containerRef.current;
        if (!area) return;

        const rect = area.getBoundingClientRect();
        const x = clamp(event.clientX - rect.left, 0, rect.width);
        const y = clamp(event.clientY - rect.top, 0, rect.height);
        onObjectPositionChange({ x, y });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!isDragging.current) return;
        isDragging.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    // Compute object-contain layout box for background image
    const rect = containerRef.current?.getBoundingClientRect();
    const containerW = rect?.width || dimensions.width;
    const containerH = rect?.height || dimensions.height;
    const imgW = imageSizePx?.width || containerW;
    const imgH = imageSizePx?.height || containerH;
    const s = imgW > 0 && imgH > 0 ? Math.min(containerW / imgW, containerH / imgH) : 1;
    const renderW = imgW * s;
    const renderH = imgH * s;
    const offsetX = (containerW - renderW) / 2;
    const offsetY = (containerH - renderH) / 2;

    const fallbackBounds = useMemo(() => {
        if (!frames.length) {
            return null;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const frame of frames as Array<any>) {
            if (Array.isArray(frame?.bodies)) {
                for (const body of frame.bodies) {
                    const tuple = toVec2(body?.position_m);
                    if (!tuple) continue;
                    const [x, y] = tuple;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                continue;
            }

            if (frame?.positions && typeof frame.positions === 'object') {
                for (const value of Object.values(frame.positions as Record<string, unknown>)) {
                    const tuple = toVec2(value);
                    if (!tuple) continue;
                    const [x, y] = tuple;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
            return null;
        }

        return {
            minX,
            maxX,
            minY,
            maxY,
        } as const;
    }, [frames]);

    const mappingCandidate = useMemo(() => {
        const direct = (scene as any)?.mapping as { origin_px?: unknown; scale_m_per_px?: unknown } | undefined;
        if (direct) {
            return direct;
        }
        if (typeof scale_m_per_px === 'number' && Number.isFinite(scale_m_per_px) && scale_m_per_px > 0) {
            const assumedOrigin: [number, number] = [
                (imageSizePx?.width ?? containerW) / 2,
                (imageSizePx?.height ?? containerH) / 2,
            ];
            return { origin_px: assumedOrigin, scale_m_per_px };
        }
        return null;
    }, [scene, scale_m_per_px, imageSizePx, containerW, containerH]);

    const mappingTransform = useMemo(() => {
        return computeCanvasTransform({
            mapping: mappingCandidate,
            imageSize: imageSizePx ?? undefined,
            containerSize: { width: containerW, height: containerH },
        });
    }, [mappingCandidate, imageSizePx, containerW, containerH]);

    const fallbackTransform = useMemo(() => {
        if (mappingTransform.hasMapping) {
            return null;
        }
        if (!fallbackBounds || containerW <= 0 || containerH <= 0) {
            return null;
        }
        return createBoundingTransform({
            bounds: fallbackBounds,
            containerSize: { width: containerW, height: containerH },
            padding: 24,
        });
    }, [mappingTransform.hasMapping, fallbackBounds, containerW, containerH]);

    const activeTransform = fallbackTransform ?? mappingTransform;
    const metersToPx = activeTransform.metersToPixels;

    const bodyMetadata = useMemo(() => {
        if (!scene || !Array.isArray((scene as any)?.bodies)) {
            return new Map<string, any>();
        }
        const meta = new Map<string, any>();
        for (const body of (scene as any).bodies) {
            if (!body?.id) continue;
            meta.set(body.id, body);
        }
        return meta;
    }, [scene]);

    const bodyPoints = useMemo<Array<{
        id: string;
        x: number;
        y: number;
        meta?: any;
        position: [number, number];
        angle: number;
        vertices?: Array<[number, number]>;
    }>>(() => {
        const frame = currentFrame as any;
        if (!frame) return [];

        const rawPoints: Array<{ id: string; position: [number, number]; angle: number; vertices?: Array<[number, number]> }> = [];

        if (Array.isArray(frame.bodies) && frame.bodies.length > 0) {
            for (const body of frame.bodies) {
                const tuple = toVec2(body?.position_m);
                if (!tuple) continue;
                const angle = typeof body?.angle_rad === 'number' ? body.angle_rad : 0;
                const vertices = Array.isArray(body?.vertices_world)
                    ? body.vertices_world
                        .map((vert: unknown) => toVec2(vert))
                        .filter((vert: [number, number] | null): vert is [number, number] => vert !== null)
                    : undefined;
                rawPoints.push({ id: body.id ?? 'body', position: tuple, angle, vertices });
            }
        } else if (frame.positions && typeof frame.positions === 'object') {
            for (const [id, pos] of Object.entries(frame.positions as Record<string, unknown>)) {
                const tuple = toVec2(pos);
                if (!tuple) continue;
                rawPoints.push({ id, position: tuple, angle: 0 });
            }
        }

        if (rawPoints.length === 0) {
            return [];
        }

        return rawPoints.map(({ id, position, angle, vertices }) => {
            const [x, y] = sceneMetersToCanvas(position, activeTransform);
            const meta = bodyMetadata.get(id);
            return { id, x, y, meta, position, angle, vertices };
        });
    }, [currentFrame, activeTransform, bodyMetadata]);
    const detectionFit = useMemo(() => {
        if (containerW <= 0 || containerH <= 0) {
            return null;
        }
        if (mappingTransform.hasMapping) {
            return {
                scale: mappingTransform.letterboxScale,
                offsetX: mappingTransform.letterboxOffset.x,
                offsetY: mappingTransform.letterboxOffset.y,
            };
        }
        if (imageSizePx) {
            const fit = computeLetterboxFit(imageSizePx, { width: containerW, height: containerH });
            return fit;
        }
        return null;
    }, [mappingTransform, imageSizePx, containerW, containerH]);

    useEffect(() => {
        if (mappingTransform.hasMapping || !fallbackTransform) {
            return;
        }
        // eslint-disable-next-line no-console
        console.debug('[SimulationLayer] bounding fallback', {
            containerW,
            containerH,
            fallbackBounds,
            scale_m_per_px,
        });
    }, [mappingTransform, fallbackTransform, fallbackBounds, containerW, containerH, scale_m_per_px]);

    useEffect(() => {
        if (!currentFrame) return;
        const frameAny = currentFrame as any;
        // eslint-disable-next-line no-console
        console.debug('[SimulationLayer] frame', {
            index: currentIndex,
            bodies: Array.isArray(frameAny?.bodies) ? frameAny.bodies.length : 0,
            positions: frameAny?.positions ? Object.keys(frameAny.positions).length : 0,
            points: bodyPoints,
        });
    }, [currentFrame, bodyPoints, currentIndex]);

    useEffect(() => {
        const renderHost = renderHostRef.current;
        if (!scene || !renderHost) {
            return;
        }

        const width = renderHost.clientWidth || containerW;
        const height = renderHost.clientHeight || containerH;

        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 2 || height <= 2) {
            return;
        }

        if (!Number.isFinite(metersToPx) || metersToPx <= 0) {
            return;
        }

        destroyMatterScene();

        try {
            const built = initializeMatterScene(scene);
            matterEngineRef.current = built.engine;
            matterBodyMapRef.current = built.bodyMap;

            const render = Matter.Render.create({
                element: renderHost,
                engine: built.engine,
                options: {
                    width,
                    height,
                    background: 'transparent',
                    wireframes: false,
                    pixelRatio: 1,
                },
            });

            render.canvas.style.width = '100%';
            render.canvas.style.height = '100%';

            const topLeftScene = canvasToSceneMeters([0, 0], activeTransform);
            const bottomRightScene = canvasToSceneMeters([width, height], activeTransform);
            const minXScene = Math.min(topLeftScene[0], bottomRightScene[0]);
            const maxXScene = Math.max(topLeftScene[0], bottomRightScene[0]);
            const minMatterY = Math.min(-topLeftScene[1], -bottomRightScene[1]);
            const maxMatterY = Math.max(-topLeftScene[1], -bottomRightScene[1]);

            render.bounds.min.x = minXScene;
            render.bounds.max.x = maxXScene;
            render.bounds.min.y = minMatterY;
            render.bounds.max.y = maxMatterY;
            render.options.hasBounds = true;
            render.options.wireframes = false;

            matterRenderRef.current = render;
            Matter.Render.run(render);

            if (frames.length > 0) {
                applyFrameToMatter(frames[0]);
                Matter.Render.world(render);
            }
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error('[SimulationLayer] Failed to initialize Matter renderer', error);
            destroyMatterScene();
        }

        return () => {
            destroyMatterScene();
        };
    }, [scene, destroyMatterScene, containerW, containerH, metersToPx, activeTransform, frames, applyFrameToMatter]);

    useEffect(() => {
        if (!currentFrame) return;
        applyFrameToMatter(currentFrame);
        const render = matterRenderRef.current;
        if (render) {
            Matter.Render.world(render);
        }
    }, [currentFrame, applyFrameToMatter]);

    useEffect(() => {
        if (!activeTransform.hasMapping) {
            return;
        }
        const normalized = normalizeSceneMapping((scene as any)?.mapping);
        if (!normalized || bodyPoints.length === 0) {
            return;
        }
        const tolerancePx = 2;
        for (const body of bodyPoints) {
            const [imgX, imgY] = sceneMetersToImagePixels(body.position, normalized);
            const expectedX = activeTransform.letterboxOffset.x + imgX * activeTransform.letterboxScale;
            const expectedY = activeTransform.letterboxOffset.y + imgY * activeTransform.letterboxScale;
            const delta = Math.hypot(expectedX - body.x, expectedY - body.y);
            const payload = {
                id: body.id,
                delta,
                expected: [expectedX, expectedY] as [number, number],
                actual: [body.x, body.y] as [number, number],
            };
            if (delta > tolerancePx) {
                // eslint-disable-next-line no-console
                console.warn('[SimulationLayer] mapping delta exceeds tolerance', payload);
            } else {
                // eslint-disable-next-line no-console
                console.debug('[SimulationLayer] mapping delta', payload);
            }
        }
    }, [activeTransform, bodyPoints, scene]);

    useEffect(() => () => destroyMatterScene(), [destroyMatterScene]);

    return (
        <div className="relative h-full w-full">
            <div
                ref={containerRef}
                className="absolute inset-4 rounded-md bg-primary/5 overflow-hidden shadow-sm"
                style={{ pointerEvents: enabled ? 'auto' : 'none' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40 pointer-events-none" />

                <div ref={renderHostRef} className="absolute inset-0 pointer-events-none" />

                {detections.length > 0 && !playing && detectionFit && (
                    <DetectionOverlay
                        fit={detectionFit}
                        boxes={detections.map((d) => ({
                            id: d.id,
                            label: d.label,
                            bbox: d.bbox_px,
                            polygon_px: d.polygon_px,
                        }))}
                    />
                )}

                {bodyPoints.length === 0 && !playing ? (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none">
                        Simulation frames will appear here once available.
                    </div>
                ) : null}
                {bodyPoints.map((body) => {
                    const isStatic = body.meta?.type === 'static';
                    const labelColor = isStatic ? 'bg-muted/80 text-muted-foreground' : 'bg-white text-slate-900';
                    return (
                        <div
                            key={`${body.id}-label`}
                            className="absolute pointer-events-none text-[11px] font-semibold uppercase tracking-wide"
                            style={{
                                left: body.x,
                                top: body.y,
                                transform: 'translate(-50%, calc(-50% + 24px))',
                            }}
                        >
                            <span className={`px-1.5 py-0.5 rounded ${labelColor} backdrop-blur-sm leading-none shadow-sm`}>{body.id}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

type OverlayBox = { 
    id: string; 
    label: string; 
    bbox: [number, number, number, number]; 
    polygon_px?: Array<[number, number]>;
};

function DetectionOverlay({ boxes, fit }: { boxes: OverlayBox[]; fit: { scale: number; offsetX: number; offsetY: number } }) {
    const { scale, offsetX, offsetY } = fit;
    return (
        <div className="absolute inset-0 pointer-events-none">
            {boxes.map((b) => {
                const [x, y, w, h] = b.bbox;
                const left = offsetX + x * scale;
                const top = offsetY + y * scale;
                const width = w * scale;
                const height = h * scale;

                if (b.polygon_px && b.polygon_px.length > 0) {
                    const points = b.polygon_px
                        .map(([px, py]) => {
                            const sx = offsetX + px * scale;
                            const sy = offsetY + py * scale;
                            return `${sx},${sy}`;
                        })
                        .join(' ');

                    return (
                        <div key={b.id} style={{ position: 'absolute', inset: 0 }}>
                            <svg className="absolute inset-0 w-full h-full overflow-visible">
                                <polygon
                                    points={points}
                                    fill="none"
                                    stroke="rgb(52, 211, 153)"
                                    strokeWidth="2"
                                    opacity="0.8"
                                />
                            </svg>
                            <div
                                className="absolute px-1 py-0.5 text-[10px] leading-none rounded bg-emerald-500 text-white shadow"
                                style={{ left, top: top - 16 }}
                            >
                                {b.label}
                            </div>
                        </div>
                    );
                }

                return (
                    <div key={b.id} style={{ position: 'absolute', left, top, width, height }} className="border-2 border-emerald-400/80 rounded-sm">
                        <div className="absolute -top-4 left-0 px-1 py-0.5 text-[10px] leading-none rounded bg-emerald-500 text-white shadow">
                            {b.label}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
