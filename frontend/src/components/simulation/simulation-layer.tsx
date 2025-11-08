import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import Matter from 'matter-js';
import { useSimulation } from '@/simulation/SimulationContext';
import { initializeMatterScene, enforcePulleyConstraints } from '@/simulation/matterRunner';
import {
    computeCanvasTransform,
    sceneMetersToCanvas,
    createBoundingTransform,
    normalizeSceneMapping,
    sceneMetersToImagePixels,
    computeLetterboxFit,
} from '@/simulation/coords';
import { createDebouncedBatchUpdate } from '@/lib/simulation-api';
import { useGlobalChat } from '@/contexts/global-chat-context';

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

const convertLength = (value: unknown, metersToPixels: number): number | undefined => {
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return num * metersToPixels;
};

const convertVelocity = (value: unknown, metersToPixels: number): [number, number] | undefined => {
    const tuple = toVec2(value);
    if (!tuple) return undefined;
    return [tuple[0] * metersToPixels, -tuple[1] * metersToPixels];
};

const convertSceneForRender = (scene: any, transform: ReturnType<typeof computeCanvasTransform>) => {
    if (!scene || typeof scene !== 'object') {
        return scene;
    }

    const scale = transform.metersToPixels;

    const projectPoint = (point: unknown): [number, number] | null => {
        const tuple = toVec2(point);
        if (!tuple) return null;
        return sceneMetersToCanvas(tuple, transform);
    };

    const cloneBody = (body: any) => {
        if (!body || typeof body !== 'object') {
            return body;
        }
        const position = projectPoint(body.position_m);
        const velocity = convertVelocity(body.velocity_m_s, scale);
        const angularVelocity = Number(body.angular_velocity_rad_s);
        const collider = body.collider && typeof body.collider === 'object' ? { ...body.collider } : undefined;
        if (collider) {
            if (typeof collider.width_m === 'number') {
                collider.width_m = convertLength(collider.width_m, scale) ?? collider.width_m;
            }
            if (typeof collider.height_m === 'number') {
                collider.height_m = convertLength(collider.height_m, scale) ?? collider.height_m;
            }
            if (typeof collider.radius_m === 'number') {
                collider.radius_m = convertLength(collider.radius_m, scale) ?? collider.radius_m;
            }
            if (Array.isArray(collider.points_m)) {
                collider.points_m = collider.points_m.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
            if (Array.isArray(collider.polygon_m)) {
                collider.polygon_m = collider.polygon_m.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
            if (Array.isArray(collider.vertices)) {
                collider.vertices = collider.vertices.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
        }

        const render = body.render && typeof body.render === 'object' ? { ...body.render } : undefined;

        return {
            ...body,
            position_m: position ?? body.position_m,
            velocity_m_s: velocity ?? body.velocity_m_s,
            angular_velocity_rad_s: Number.isFinite(angularVelocity) ? angularVelocity : body.angular_velocity_rad_s,
            collider,
            render,
            __renderSpace: 'canvas',
        };
    };

    const projectAnchor = (value: unknown): { x: number; y: number; __canvas: true } | undefined => {
        const tuple = toVec2(value);
        if (!tuple) return undefined;
        const [x, y] = tuple;
        return { x: x * scale, y: -y * scale, __canvas: true };
    };

    const cloneConstraint = (constraint: any) => {
        if (!constraint || typeof constraint !== 'object') {
            return constraint;
        }
        const next: any = { ...constraint };
        const ropeKeys = ['rope_length_m', 'length_m', 'rest_length_m'];
        for (const key of ropeKeys) {
            if (key in next) {
                const converted = convertLength(next[key], scale);
                if (typeof converted === 'number') {
                    next[key] = converted;
                }
            }
        }

        const anchorKeys = [
            'anchor_a',
            'anchorA',
            'anchor_a_m',
            'anchorA_m',
            'point_a',
            'pointA',
            'point_a_m',
            'pointA_m',
            'offset_a',
            'offsetA',
            'offset_a_m',
            'offsetA_m',
            'anchor_b',
            'anchorB',
            'anchor_b_m',
            'anchorB_m',
            'point_b',
            'pointB',
            'point_b_m',
            'pointB_m',
            'offset_b',
            'offsetB',
            'offset_b_m',
            'offsetB_m',
        ];

        for (const key of anchorKeys) {
            if (key in next) {
                const projected = projectAnchor(next[key]);
                if (projected) {
                    next[key] = projected;
                }
            }
        }

        if ('pulley_anchor_m' in next) {
            const projected = projectPoint(next.pulley_anchor_m);
            if (projected) {
                next.pulley_anchor_m = { x: projected[0], y: projected[1], __canvas: true };
            }
        }

        return next;
    };

    return {
        ...scene,
        bodies: Array.isArray(scene.bodies) ? scene.bodies.map(cloneBody) : scene.bodies,
        constraints: Array.isArray(scene.constraints) ? scene.constraints.map(cloneConstraint) : scene.constraints,
    };
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
    const matterMouseConstraintRef = useRef<Matter.MouseConstraint | null>(null);
    const pulleyConstraintsRef = useRef<Array<{
        bodyA: Matter.Body;
        bodyB: Matter.Body;
        anchor: [number, number];
        totalLength: number;
    }>>([]);
    const isDragging = useRef(false);
    const animationFrameRef = useRef<number | null>(null);
    
    // Scene modification tracking (ref for immediate check, no re-render)
    const sceneModifiedRef = useRef(false);
    const renderSceneRef = useRef<any>(null);
    
    // Visual feedback state
    const [hoveredBodyId, setHoveredBodyId] = useState<string | null>(null);
    const [cursor, setCursor] = useState<string>('default');
    
    // Double-click activation state (for safe dragging)
    const [activatedBodyId, setActivatedBodyId] = useState<string | null>(null);
    const activatedBodyIdRef = useRef<string | null>(null);
    const lastClickTimeRef = useRef<number>(0);
    const lastClickedBodyRef = useRef<string | null>(null);
    const DOUBLE_CLICK_DELAY = 300; // milliseconds
    const activationTimestampRef = useRef<number>(0);
    const ACTIVATION_FLASH_MS = 250; // visual flash duration
    
    // Refs for visual feedback (to avoid closure issues in afterRender)
    const selectedEntityIdRef = useRef<string | null>(null);
    const hoveredBodyIdRef = useRef<string | null>(null);
    
    // Sync state to refs - MOVED AFTER selectedEntityId declaration
    
    const destroyMatterScene = useCallback(() => {
        // Stop animation loop
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }

        // Remove mouse constraint
        const mouseConstraint = matterMouseConstraintRef.current;
        if (mouseConstraint && matterEngineRef.current) {
            Matter.World.remove(matterEngineRef.current.world, mouseConstraint);
            matterMouseConstraintRef.current = null;
        }

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
        pulleyConstraintsRef.current = [];
    }, []);
    const { 
        frames, 
        currentIndex, 
        detections, 
        imageSizePx, 
        scale_m_per_px, 
        scene, 
        playing, 
        renderImageDataUrl, 
        normalizationReport,
        simulationMode,
        registerUpdateEntityCallback,
        selectedEntityId,
        setSelectedEntityId,
        editingEnabled,
        sceneModified,
        setSceneModified,
        updateBodyLocal,
        updateSceneAndResimulate,
    } = useSimulation();
    const currentFrame = frames[currentIndex];
    const globalChat = useGlobalChat();
    
    // Sync state to refs for afterRender event (avoid closure issues)
    useEffect(() => {
        selectedEntityIdRef.current = selectedEntityId;
    }, [selectedEntityId]);
    
    useEffect(() => {
        hoveredBodyIdRef.current = hoveredBodyId;
    }, [hoveredBodyId]);
    
    // Debounced backend sync (for Interactive Mode)
    const debouncedBackendSyncRef = useRef<{
        debouncedUpdate: (bodyUpdates?: Record<string, any>, constraintUpdates?: Record<string, any>) => void;
        flush: () => Promise<any>;
    } | null>(null);
    
    // Register callback for Frontend entity updates (Interactive Mode)
    useEffect(() => {
        const callback = (entityId: string, updates: {
            position?: [number, number];
            mass?: number;
            friction?: number;
            velocity?: [number, number];
            angularVelocity?: number;
        }) => {
            console.log(`[SimulationLayer] Updating entity ${entityId}:`, updates);
            
            const body = matterBodyMapRef.current.get(entityId);
            if (!body) {
                console.warn(`[SimulationLayer] Body ${entityId} not found in matterBodyMapRef`);
                return;
            }
            
            // Apply updates to Matter.js body immediately (Frontend)
            if (updates.position) {
                // Scene coords (Y-up) → Matter.js coords (Y-down)
                Matter.Body.setPosition(body, { 
                    x: updates.position[0], 
                    y: -updates.position[1] 
                });
            }
            
            if (updates.mass !== undefined) {
                Matter.Body.setMass(body, updates.mass);
            }
            
            if (updates.friction !== undefined) {
                body.friction = updates.friction;
            }
            
            if (updates.velocity) {
                Matter.Body.setVelocity(body, { 
                    x: updates.velocity[0], 
                    y: -updates.velocity[1] 
                });
            }
            
            if (updates.angularVelocity !== undefined) {
                Matter.Body.setAngularVelocity(body, -updates.angularVelocity);
            }
            
            console.log(`[SimulationLayer] Entity ${entityId} updated in Frontend Matter.js`);
            
            // Debounced Backend sync (for persistence)
            if (debouncedBackendSyncRef.current) {
                const backendUpdates: any = {};
                
                if (updates.position) {
                    backendUpdates.position_m = updates.position;
                }
                if (updates.mass !== undefined) {
                    backendUpdates.mass_kg = updates.mass;
                }
                if (updates.friction !== undefined) {
                    backendUpdates.material = { friction: updates.friction };
                }
                if (updates.velocity) {
                    backendUpdates.velocity_m_s = updates.velocity;
                }
                
                debouncedBackendSyncRef.current.debouncedUpdate({
                    [entityId]: backendUpdates
                });
                
                console.log(`[SimulationLayer] Debounced backend sync queued for ${entityId}`);
            }
        };
        
        registerUpdateEntityCallback(callback);
    }, [registerUpdateEntityCallback]);

    const clamp = (value: number, min: number, max: number) =>
        Math.min(Math.max(value, min), max);

    const computeClampRect = useCallback((width: number, height: number) => {
        if (width <= 0 || height <= 0) {
            return { minX: 0, maxX: width, minY: 0, maxY: height };
        }
        const imgW = imageSizePx?.width ?? width;
        const imgH = imageSizePx?.height ?? height;
        if (!imgW || !imgH) {
            return { minX: 0, maxX: width, minY: 0, maxY: height };
        }
        const scale = Math.min(width / imgW, height / imgH);
        const renderW = imgW * scale;
        const renderH = imgH * scale;
        const offsetX = (width - renderW) / 2;
        const offsetY = (height - renderH) / 2;
        const minX = Number.isFinite(offsetX) ? offsetX : 0;
        const minY = Number.isFinite(offsetY) ? offsetY : 0;
        const maxX = Number.isFinite(renderW) ? minX + renderW : width;
        const maxY = Number.isFinite(renderH) ? minY + renderH : height;
        if (maxX <= minX || maxY <= minY) {
            return { minX: 0, maxX: width, minY: 0, maxY: height };
        }
        return { minX, maxX, minY, maxY };
    }, [imageSizePx]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        if (objectPosition.x === 0 && objectPosition.y === 0) {
            onObjectPositionChange({ x: rect.width / 2, y: rect.height / 2 });
            return;
        }
        const bounds = computeClampRect(rect.width, rect.height);
        const clampedX = clamp(objectPosition.x, bounds.minX, bounds.maxX);
        const clampedY = clamp(objectPosition.y, bounds.minY, bounds.maxY);
        if (clampedX !== objectPosition.x || clampedY !== objectPosition.y) {
            onObjectPositionChange({ x: clampedX, y: clampedY });
        }
    }, [objectPosition, onObjectPositionChange, dimensions.width, dimensions.height, computeClampRect]);

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
        const bounds = computeClampRect(rect.width, rect.height);
        const rawX = event.clientX - rect.left;
        const rawY = event.clientY - rect.top;
        const x = clamp(rawX, bounds.minX, bounds.maxX);
        const y = clamp(rawY, bounds.minY, bounds.maxY);
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

    const renderScene = useMemo(() => {
        if (!scene) {
            renderSceneRef.current = null;
            return null;
        }
        
        // OPTIMIZATION: In edit mode with modified scene, return cached renderScene
        // This prevents Matter.js re-initialization on every drag
        // Use ref check only (no editingEnabled in dependency to avoid re-render on mode change)
        if (sceneModifiedRef.current && renderSceneRef.current) {
            console.log('[SimulationLayer] 📌 Using cached renderScene (scene modified)');
            return renderSceneRef.current;
        }
        
        const newRenderScene = convertSceneForRender(scene, activeTransform);
        renderSceneRef.current = newRenderScene;
        return newRenderScene;
    }, [scene, activeTransform]);

    const applyFrameToMatter = useCallback((frame: any) => {
        if (!frame) return;
        const bodyMap = matterBodyMapRef.current;
        if (!bodyMap || bodyMap.size === 0) return;

        const updateBody = (id: string, positionValue: unknown, angleValue: unknown, velocityValue: unknown, angularVelocityValue: unknown) => {
            const matterBody = bodyMap.get(id);
            if (!matterBody) return;

            const scenePosition = toVec2(positionValue);
            if (scenePosition) {
                const [xPx, yPx] = sceneMetersToCanvas(scenePosition, activeTransform);
                Matter.Body.setPosition(matterBody, { x: xPx, y: yPx });
            }

            if (typeof angleValue === 'number' && Number.isFinite(angleValue)) {
                Matter.Body.setAngle(matterBody, -angleValue);
            }

            const velocity = convertVelocity(velocityValue, metersToPx);
            if (velocity) {
                Matter.Body.setVelocity(matterBody, { x: velocity[0], y: velocity[1] });
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
    }, [activeTransform, metersToPx]);

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
        if (!renderScene || !renderHost) {
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

        // OPTIMIZATION: Skip scene regeneration if editing and scene was modified locally
        // This prevents drag-induced scene changes from causing full Matter re-initialization
        // Use ref for immediate check (state update may be delayed)
        console.log('[SimulationLayer] 🔍 Skip check:', {
            editingEnabled,
            sceneModified: sceneModifiedRef.current,
            hasEngine: !!matterEngineRef.current,
            willSkip: editingEnabled && sceneModifiedRef.current && matterEngineRef.current
        });
        
        if (editingEnabled && sceneModifiedRef.current && matterEngineRef.current) {
            console.log('[SimulationLayer] ⏭️ Skipping scene regeneration (edit mode + modified scene)');
            return;
        }
        
        console.log('[SimulationLayer] ⚠️ NOT skipping - proceeding with Matter.js re-initialization');

        // PRESERVE POSITIONS: Save current body positions before destroying Matter scene
        // This ensures dragged positions survive re-initialization
        const savedPositions = new Map<string, { x: number; y: number }>();
        if (editingEnabled && matterEngineRef.current) {
            const currentBodies = Matter.Composite.allBodies(matterEngineRef.current.world);
            currentBodies.forEach(body => {
                const label = (body as any).label || body.id?.toString();
                if (label) {
                    savedPositions.set(label, { x: body.position.x, y: body.position.y });
                }
            });
            if (savedPositions.size > 0) {
                console.log('[SimulationLayer] 💾 Saved positions for', savedPositions.size, 'bodies before re-init');
            }
        }

        destroyMatterScene();

        try {
            const built = initializeMatterScene(renderScene);
            matterEngineRef.current = built.engine;
            matterBodyMapRef.current = built.bodyMap;
            pulleyConstraintsRef.current = built.pulleyConstraints;
            
            // Store original static state for all bodies
            const allBodies = Matter.Composite.allBodies(built.engine.world);
            allBodies.forEach(body => {
                (body as any).__originallyStatic = body.isStatic;
            });
            console.log('[SimulationLayer] 📝 Stored original static state for', allBodies.length, 'bodies');

            // RESTORE POSITIONS: Apply saved positions after re-initialization
            if (savedPositions.size > 0) {
                allBodies.forEach(body => {
                    const label = (body as any).label || body.id?.toString();
                    const saved = savedPositions.get(label);
                    if (saved) {
                        Matter.Body.setPosition(body, { x: saved.x, y: saved.y });
                    }
                });
                console.log('[SimulationLayer] 🔄 Restored positions for', savedPositions.size, 'bodies after re-init');
            }

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
            
            // Enable pointer events on canvas for editing
            render.canvas.style.pointerEvents = 'auto';
            console.log('[SimulationLayer] 🎨 Canvas pointer-events set to auto');

            render.bounds.min.x = 0;
            render.bounds.max.x = width;
            render.bounds.min.y = 0;
            render.bounds.max.y = height;
            render.options.hasBounds = true;
            render.options.wireframes = false;

            matterRenderRef.current = render;
            Matter.Render.run(render);
            
            // Visual feedback: Hover / select / activation highlighting
            Matter.Events.on(render, 'afterRender', () => {
                const canvas = render.canvas;
                const context = render.context;
                const bodies = Matter.Composite.allBodies(built.engine.world);
                
                // Draw pulley ropes
                if (scene && scene.constraints) {
                    scene.constraints.forEach((constraint: any) => {
                        if (constraint.type === 'ideal_fixed_pulley') {
                            // Find the two bodies connected by pulley
                            const bodyA = bodies.find(b => (b as any).label === constraint.body_a);
                            const bodyB = bodies.find(b => (b as any).label === constraint.body_b);
                            const anchor = constraint.pulley_anchor_m;
                            
                            if (bodyA && bodyB && anchor) {
                                context.strokeStyle = '#6b7280'; // Gray rope
                                context.lineWidth = 2;
                                context.setLineDash([4, 2]); // Dashed line for rope
                                
                                // Draw rope from bodyA to pulley
                                context.beginPath();
                                context.moveTo(bodyA.position.x, bodyA.position.y);
                                if ('x' in anchor && 'y' in anchor) {
                                    context.lineTo(anchor.x, anchor.y);
                                } else if (Array.isArray(anchor)) {
                                    // If anchor is [x, y] array
                                    const [ax, ay] = anchor;
                                    context.lineTo(ax, -ay); // Y-down conversion
                                }
                                context.stroke();
                                
                                // Draw rope from pulley to bodyB
                                context.beginPath();
                                if ('x' in anchor && 'y' in anchor) {
                                    context.moveTo(anchor.x, anchor.y);
                                } else if (Array.isArray(anchor)) {
                                    const [ax, ay] = anchor;
                                    context.moveTo(ax, -ay);
                                }
                                context.lineTo(bodyB.position.x, bodyB.position.y);
                                context.stroke();
                                
                                // Draw pulley wheel
                                const wheelRadius = constraint.wheel_radius_m || 0.1;
                                const wheelRadiusPixels = wheelRadius * 100; // Assuming 1m = 100px scale
                                context.setLineDash([]); // Solid line
                                context.strokeStyle = '#374151'; // Darker gray for wheel
                                context.lineWidth = 3;
                                context.beginPath();
                                if ('x' in anchor && 'y' in anchor) {
                                    context.arc(anchor.x, anchor.y, wheelRadiusPixels, 0, 2 * Math.PI);
                                } else if (Array.isArray(anchor)) {
                                    const [ax, ay] = anchor;
                                    context.arc(ax, -ay, wheelRadiusPixels, 0, 2 * Math.PI);
                                }
                                context.stroke();
                                
                                // Reset line dash
                                context.setLineDash([]);
                            }
                        }
                    });
                }
                
                // Draw hover highlight
                const currentHoveredId = hoveredBodyIdRef.current;
                if (currentHoveredId) {
                    const hoveredBody = bodies.find(b => (b as any).label === currentHoveredId);
                    if (hoveredBody) {
                        const isStatic = hoveredBody.isStatic;
                        context.strokeStyle = isStatic ? '#3b82f6' : '#10b981'; // Blue for static, green for dynamic
                        context.lineWidth = 2;
                        context.beginPath();
                        const vertices = hoveredBody.vertices;
                        context.moveTo(vertices[0].x, vertices[0].y);
                        for (let i = 1; i < vertices.length; i++) {
                            context.lineTo(vertices[i].x, vertices[i].y);
                        }
                        context.closePath();
                        context.stroke();
                    }
                }
                
                // Draw selected highlight (thicker)
                const currentSelectedId = selectedEntityIdRef.current;
                if (currentSelectedId) {
                    const selectedBody = bodies.find(b => (b as any).label === currentSelectedId);
                    if (selectedBody) {
                        context.strokeStyle = '#f59e0b'; // Orange for selected
                        context.lineWidth = 3;
                        context.beginPath();
                        const vertices = selectedBody.vertices;
                        context.moveTo(vertices[0].x, vertices[0].y);
                        for (let i = 1; i < vertices.length; i++) {
                            context.lineTo(vertices[i].x, vertices[i].y);
                        }
                        context.closePath();
                        context.stroke();
                    }
                }

                // Draw activation highlight (purple glow + short flash)
                if (activatedBodyId) {
                    const activatedBody = bodies.find(b => (b as any).label === activatedBodyId);
                    if (activatedBody) {
                        const now = performance.now();
                        const elapsed = now - activationTimestampRef.current;
                        const flashFactor = Math.max(0, 1 - elapsed / ACTIVATION_FLASH_MS);
                        context.save();
                        context.shadowColor = 'rgba(168,85,247,0.85)';
                        context.shadowBlur = 10 + 10 * flashFactor;
                        context.strokeStyle = '#a855f7';
                        context.lineWidth = 4 + 2 * flashFactor;
                        context.beginPath();
                        const vertices = activatedBody.vertices;
                        context.moveTo(vertices[0].x, vertices[0].y);
                        for (let i = 1; i < vertices.length; i++) {
                            context.lineTo(vertices[i].x, vertices[i].y);
                        }
                        context.closePath();
                        context.stroke();
                        context.restore();
                    }
                }
            });

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
            // OPTIMIZATION: Skip cleanup if scene was modified in edit mode
            // This preserves the Matter.js world for the next useEffect cycle
            if (sceneModifiedRef.current && editingEnabled) {
                console.log('[SimulationLayer] ⏭️ Skipping cleanup (preserving Matter world)');
                return;
            }
            destroyMatterScene();
        };
    }, [renderScene, destroyMatterScene, containerW, containerH, frames, applyFrameToMatter, playing, globalChat.activeBoxId]);

    // Dynamic MouseConstraint management: Add when editing enabled + stopped, remove otherwise
    useEffect(() => {
        const engine = matterEngineRef.current;
        const render = matterRenderRef.current;
        
        if (!engine || !render || !scene) {
            return;
        }

        // Remove existing mouse constraint if any
        const existingMouseConstraint = matterMouseConstraintRef.current;
        if (existingMouseConstraint) {
            Matter.World.remove(engine.world, existingMouseConstraint);
            matterMouseConstraintRef.current = null;
            console.log('[SimulationLayer] MouseConstraint removed');
        }

        // Add mouse constraint only when editing is enabled AND simulation is stopped
        if (editingEnabled && !playing) {
            console.log('[SimulationLayer] 🎯 Adding MouseConstraint (Edit mode enabled)');
            console.log('[SimulationLayer] 📊 Scene bodies:', scene?.bodies?.map((b: any) => b.id) || []);
            console.log('[SimulationLayer] 📊 Matter.js bodies:', Matter.Composite.allBodies(engine.world).map(b => (b as any).label || b.id));
            
            const mouse = Matter.Mouse.create(render.canvas);
            console.log('[SimulationLayer] 🖱️ Matter.Mouse created:', mouse);
            console.log('[SimulationLayer] 🖱️ Mouse element:', mouse.element);
            console.log('[SimulationLayer] 🖱️ Mouse element === canvas:', mouse.element === render.canvas);
            
            const mouseConstraint = Matter.MouseConstraint.create(engine, {
                mouse: mouse,
                constraint: {
                    stiffness: 0.2,
                    render: {
                        visible: false,
                    },
                },
                collisionFilter: {
                    mask: 0xFFFFFFFF, // Interact with all collision groups
                }
            });
            
            console.log('[SimulationLayer] 🖱️ MouseConstraint created');
            console.log('[SimulationLayer] 🖱️ MouseConstraint.mouse attached to canvas');

            // Override canStartDrag to allow static bodies
            (mouseConstraint as any).canStartDrag = function(body: Matter.Body) {
                return true; // Allow dragging ALL bodies (static + dynamic)
            };

            // Track dragged body (mouseConstraint.body becomes null on enddrag)
            let draggedBody: Matter.Body | null = null;

            // Click to select entity (activation happens in startdrag)
            const mousedownHandler = (event: any) => {
                console.log('[SimulationLayer] 🖱️ MOUSEDOWN event triggered');
                const mouse = event.mouse;
                console.log('[SimulationLayer] 📍 Mouse position:', mouse.position);
                
                const bodies = Matter.Composite.allBodies(engine.world);
                console.log('[SimulationLayer] 🔍 Checking', bodies.length, 'bodies for collision');
                
                // Find clicked body
                const clickedBody = bodies.find(body => {
                    const boundsCheck = Matter.Bounds.contains(body.bounds, mouse.position);
                    const verticesCheck = Matter.Vertices.contains(body.vertices, mouse.position);
                    const bodyId = body.label || body.id?.toString() || 'unknown';
                    
                    console.log(`[SimulationLayer]   - Body ${bodyId}:`, {
                        bounds: body.bounds,
                        boundsCheck,
                        verticesCheck,
                        vertices: body.vertices.length,
                    });
                    
                    return boundsCheck && verticesCheck;
                });
                
                if (clickedBody) {
                    const bodyId = clickedBody.label || clickedBody.id?.toString() || 'unknown';
                    console.log('[SimulationLayer] ✅ Body CLICKED:', bodyId);
                    
                    // Just select - activation will happen in startdrag
                    setSelectedEntityId(bodyId);
                    console.log('[SimulationLayer] 📌 Body selected (activation deferred to startdrag):', bodyId);
                } else {
                    // Clicked empty space - deselect
                    console.log('[SimulationLayer] ⚪ Empty space clicked - deselecting');
                    setSelectedEntityId(null);
                    setActivatedBodyId(null);
                    activatedBodyIdRef.current = null;
                }
            };
            
            Matter.Events.on(mouseConstraint, 'mousedown', mousedownHandler);
            
            // Hover detection (mouse move)
            Matter.Events.on(mouseConstraint, 'mousemove', (event: any) => {
                const mouse = event.mouse;
                const bodies = Matter.Composite.allBodies(engine.world);
                
                // Find hovered body
                const hoveredBody = bodies.find(body => 
                    Matter.Bounds.contains(body.bounds, mouse.position) &&
                    Matter.Vertices.contains(body.vertices, mouse.position)
                );
                
                if (hoveredBody) {
                    const bodyId = hoveredBody.label || hoveredBody.id?.toString() || 'unknown';
                    if (hoveredBodyId !== bodyId) {
                        console.log('[SimulationLayer] 🔍 Hovering over:', bodyId);
                    }
                    setHoveredBodyId(bodyId);
                    setCursor('grab');
                } else {
                    if (hoveredBodyId !== null) {
                        console.log('[SimulationLayer] 🔍 Hover ended');
                    }
                    setHoveredBodyId(null);
                    setCursor('default');
                }
            });

            // Allow dragging of all bodies (static and dynamic)
            Matter.Events.on(mouseConstraint, 'startdrag', (event: any) => {
                const body = event.body;
                if (!body) return;
                const bodyId = body.label || body.id?.toString() || 'unknown';
                const isStatic = (body as Matter.Body).isStatic;
                
                console.log('[SimulationLayer] 🎯 STARTDRAG event on:', bodyId, { isStatic });
                
                // CRITICAL FIX: Activate body immediately on startdrag
                // This ensures activation happens BEFORE drag check
                const now = performance.now();
                setActivatedBodyId(bodyId);
                activatedBodyIdRef.current = bodyId;
                activationTimestampRef.current = now;
                console.log('[SimulationLayer] ✨ Body activated for dragging:', bodyId);
                
                // Now both static and dynamic bodies are activated and can be dragged
                if (isStatic) {
                    console.log('[SimulationLayer] ✅ Static body drag allowed:', bodyId);
                } else {
                    console.log('[SimulationLayer] ✅ Dynamic body drag allowed:', bodyId);
                }
                
                // Store reference to dragged body
                draggedBody = body;
                
                // Static bodies: Don't convert to dynamic (causes NaN)
                if (body.isStatic) {
                    (body as any).__wasStatic = true;
                    (body as any).__staticDragStart = { 
                        x: body.position.x, 
                        y: body.position.y,
                        angle: body.angle
                    };
                    console.log(`[SimulationLayer] 📌 Static body drag initiated:`, bodyId);
                } else {
                    console.log(`[SimulationLayer] 🏃 Dynamic body dragging:`, bodyId);
                }
            });

            // Backend sync on drag end
            Matter.Events.on(mouseConstraint, 'enddrag', async (event: any) => {
                const body = draggedBody;
                if (!body) {
                    console.warn('[SimulationLayer] No dragged body stored');
                    return;
                }

                const bodyId = body.label || body.id?.toString() || 'unknown';
                
                // For static bodies that were dragged
                if ((body as any).__wasStatic) {
                    delete (body as any).__wasStatic;
                    delete (body as any).__staticDragStart;
                    console.log(`[SimulationLayer] Static body ${bodyId} drag completed`);
                }
                
                // Check if body has valid position
                if (!body.position || !Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
                    console.error(`[SimulationLayer] Invalid body position for ${bodyId}:`, body.position);
                    draggedBody = null;
                    return;
                }

                // Convert canvas (Matter) coordinates back to scene meters using activeTransform
                // body.position is already in canvas space; activeTransform handles origin/scale.
                const newPosition: [number, number] = [
                    (body.position.x - activeTransform.originPx[0]) * activeTransform.pixelsToMeters,
                    (activeTransform.originPx[1] - body.position.y) * activeTransform.pixelsToMeters,
                ];

                console.log(`[SimulationLayer] 🎯 Body ${bodyId} dragged to (scene):`, newPosition);
                console.log(`[SimulationLayer] 📍 Matter.js position (canvas px):`, body.position);

                // CRITICAL FIX: Set ref BEFORE state to ensure skip logic works immediately
                sceneModifiedRef.current = true;
                
                // Set sceneModified flag BEFORE updateBodyLocal to activate skip logic
                setSceneModified(true);
                
                // Update scene data for parameters panel
                // The skip logic (line ~715) prevents Matter world re-initialization
                updateBodyLocal(bodyId, { position_m: newPosition });
                
                console.log(`[SimulationLayer] ✅ Scene data updated, skip logic active`);

                // Sync to backend (debounced) and trigger resimulation on Play later
                const conversationId = globalChat.activeBoxId;
                if (conversationId && debouncedBackendSyncRef.current) {
                    try {
                        console.log(`[SimulationLayer] 📤 Syncing ${bodyId} position to backend...`);
                        // Queue update and flush at drag end so backend stays authoritative
                        debouncedBackendSyncRef.current.debouncedUpdate({
                            [bodyId]: { position_m: newPosition }
                        });
                        await debouncedBackendSyncRef.current.flush();
                        
                        console.log(`[SimulationLayer] ✅ Position update synced to backend`);
                    } catch (error) {
                        console.error('[SimulationLayer] Backend sync failed:', error);
                    }
                }
                
                // Deactivate after drag (require new double-click for static; dynamic will re-activate on next drag)
                if ((body as Matter.Body).isStatic) {
                    setActivatedBodyId(null);
                    activatedBodyIdRef.current = null;
                }
                draggedBody = null;
            });

            // While dragging a static body, manually update its position to the mouse
            Matter.Events.on(mouseConstraint, 'mousemove', (event: any) => {
                if (!draggedBody) return;
                if (!(draggedBody as Matter.Body).isStatic) return;
                // Only move if activated
                const bodyId = draggedBody.label || (draggedBody as any).id?.toString() || 'unknown';
                if (activatedBodyIdRef.current !== bodyId) return;
                const mousePos = event.mouse.position;
                // Preserve angle
                Matter.Body.setPosition(draggedBody, { x: mousePos.x, y: mousePos.y });
            });

            
            Matter.World.add(engine.world, mouseConstraint);
            render.mouse = mouse;
            matterMouseConstraintRef.current = mouseConstraint;
            
            console.log('[SimulationLayer] MouseConstraint added (editing enabled + simulation stopped)');
        } else {
            console.log('[SimulationLayer] MouseConstraint not added (editing disabled or simulation playing)');
        }        return () => {
            // Cleanup mouse constraint when effect re-runs or unmounts
            const mouseConstraint = matterMouseConstraintRef.current;
            if (mouseConstraint && engine) {
                console.log('[SimulationLayer] 🧹 Removing MouseConstraint from world');
                Matter.World.remove(engine.world, mouseConstraint);
                matterMouseConstraintRef.current = null;
            }
        };
    }, [editingEnabled, playing, scene, globalChat.activeBoxId, setSelectedEntityId, setHoveredBodyId, setCursor]);
    // REMOVED: activatedBodyId from dependencies - it should NOT trigger MouseConstraint recreation during drag

    // Body static state management based on simulation mode
    useEffect(() => {
        const engine = matterEngineRef.current;
        if (!engine || !scene) {
            return;
        }

        const bodies = Matter.Composite.allBodies(engine.world);
        
        if (playing) {
            // Play mode: Restore bodies to original state
            console.log('[SimulationLayer] ▶️ Play mode: Restoring body dynamics');
            
            // If scene was modified, trigger resimulation with updated scene
            const wasModified = sceneModifiedRef.current;
            
            // Reset sceneModified flag when entering play mode
            // This allows the scene to be regenerated properly if needed
            sceneModifiedRef.current = false;
            setSceneModified(false);
            
            // Trigger resimulation if scene was modified
            if (wasModified) {
                console.log('[SimulationLayer] 🔄 Scene was modified, triggering resimulation...');
                // Resimulate with current scene (already updated via updateBodyLocal)
                updateSceneAndResimulate((prev: any) => prev).catch((error: any) => {
                    console.error('[SimulationLayer] Resimulation failed:', error);
                });
            }
            
            bodies.forEach(body => {
                const originallyStatic = (body as any).__originallyStatic;
                if (originallyStatic !== undefined && body.isStatic !== originallyStatic) {
                    Matter.Body.setStatic(body, originallyStatic);
                }
            });
        } else {
            // Not playing (edit mode, paused, or reset): Make all non-originally-static bodies static
            console.log('[SimulationLayer] � Stopped mode: Making all dynamic bodies static');
            bodies.forEach(body => {
                const originallyStatic = (body as any).__originallyStatic;
                // If originally dynamic, make it static to prevent falling
                if (originallyStatic === false && !body.isStatic) {
                    Matter.Body.setStatic(body, true);
                }
            });
        }
    }, [playing, scene]);

    // Initialize debounced backend sync
    useEffect(() => {
        const conversationId = globalChat.activeBoxId;
        // Only enable debounced backend sync when simulation exists and is stopped (editable)
        if (!conversationId || playing) {
            debouncedBackendSyncRef.current = null;
            return;
        }

        debouncedBackendSyncRef.current = createDebouncedBatchUpdate(conversationId, 1000);

        return () => {
            // Flush pending updates on unmount
            if (debouncedBackendSyncRef.current) {
                debouncedBackendSyncRef.current.flush().catch(console.error);
            }
        };
    }, [globalChat.activeBoxId, playing]);

    // Rendering loop: Always runs for visual feedback
    // Physics engine: ONLY updates when playing
    useEffect(() => {
        console.log('[SimulationLayer] 🔄 Rendering loop effect triggered:', { 
            playing, 
            hasScene: !!scene,
            hasEngine: !!matterEngineRef.current,
            hasRender: !!matterRenderRef.current
        });
        
        if (!scene) {
            console.log('[SimulationLayer] ⚠️ No scene - skipping render loop');
            return;
        }

        const engine = matterEngineRef.current;
        const render = matterRenderRef.current;
        
        if (!engine || !render) {
            console.log('[SimulationLayer] ⚠️ No engine or render - skipping render loop');
            return;
        }

        console.log('[SimulationLayer] ✅ Starting render loop (playing:', playing, ')');
        
        let lastTime = performance.now();
        let frameCount = 0;
        let lastLogTime = performance.now();

        const animate = (currentTime: number) => {
            const deltaTime = (currentTime - lastTime) / 1000;
            lastTime = currentTime;
            frameCount++;

            // Update physics engine ONLY when playing
            if (playing) {
                Matter.Engine.update(engine, deltaTime * 1000);

                // Enforce pulley constraints if any
                if (pulleyConstraintsRef.current.length > 0) {
                    enforcePulleyConstraints(pulleyConstraintsRef.current);
                }
                
                // Log every 5 seconds instead of every 60 frames
                if (currentTime - lastLogTime >= 5000) {
                    console.log('[SimulationLayer] 🎬 Physics running (frame', frameCount, ')');
                    lastLogTime = currentTime;
                }
            } else {
                // Edit mode: Still update engine for MouseConstraint to work
                // All bodies are already static in edit mode, so no physics simulation happens
                Matter.Engine.update(engine, 16);
            }
            // When not playing (edit mode or paused), NO physics updates
            // This prevents gravity from pulling objects down

            // Always render (for visual feedback in edit mode)
            Matter.Render.world(render);

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            console.log('[SimulationLayer] 🛑 Stopping render loop');
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [playing, scene]);

    // Playback Mode: Frame-based rendering (when playing)
    useEffect(() => {
        if (!playing) {
            return;
        }

        if (!currentFrame) return;
        applyFrameToMatter(currentFrame);
        const render = matterRenderRef.current;
        if (render) {
            Matter.Render.world(render);
        }
    }, [playing, currentFrame, applyFrameToMatter]);

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
                // console.debug('[SimulationLayer] mapping delta', payload);
            }
        }
    }, [activeTransform, bodyPoints, scene]);

    useEffect(() => () => destroyMatterScene(), [destroyMatterScene]);

    return (
        <div className="relative h-full w-full">
            <div
                ref={containerRef}
                className="absolute inset-4 rounded-md bg-primary/5 overflow-hidden shadow-sm"
                style={{ 
                    pointerEvents: enabled ? 'auto' : 'none',
                    cursor: (editingEnabled && !playing && scene) ? cursor : 'default'
                }}
            >
                {renderImageDataUrl && detectionFit && (
                    <img
                        src={renderImageDataUrl}
                        alt="Scene reference"
                        className="absolute pointer-events-none select-none"
                        style={{
                            left: detectionFit.offsetX,
                            top: detectionFit.offsetY,
                            width: (imageSizePx?.width ?? containerW) * detectionFit.scale,
                            height: (imageSizePx?.height ?? containerH) * detectionFit.scale,
                        }}
                    />
                )}
                {!renderImageDataUrl ? (
                    <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40 pointer-events-none" />
                ) : null}

                {/* Matter.js canvas layer - enable pointer events when editing mode is enabled and simulation is stopped */}
                <div 
                    ref={renderHostRef} 
                    className="absolute inset-0"
                    style={{
                        pointerEvents: (editingEnabled && !playing && scene) ? 'auto' : 'none',
                        zIndex: 10, // Above background image
                    }}
                />

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
                {normalizationReport && normalizationReport.applied ? (
                    <div className="absolute top-2 right-2 pointer-events-none text-[11px] font-medium text-muted-foreground">
                        <span className="rounded bg-muted/70 px-2 py-1 shadow-sm backdrop-blur">
                            Normalized scene delta=({normalizationReport.translation_m[0].toFixed(2)}m,
                            {normalizationReport.translation_m[1].toFixed(2)}m)
                            {normalizationReport.scale ? ` x${normalizationReport.scale.toFixed(2)}` : ''}
                        </span>
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
