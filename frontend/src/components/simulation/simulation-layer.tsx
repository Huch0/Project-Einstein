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
import { runMatterSimulation } from '@/simulation/matterRunner';
import { createDebouncedBatchUpdate } from '@/lib/simulation-api';
import { useGlobalChat } from '@/contexts/global-chat-context';
import { createTransformStore, useTransformStore, useTransformController } from '@/simulation/transform-store';
import SimulationRenderer from './simulation-renderer';
import SimulationInteraction from './simulation-interaction';

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
        
        let collider: any = undefined;
        if (body.collider && typeof body.collider === 'object') {
            collider = { type: body.collider.type };
            if (typeof body.collider.width_m === 'number') {
                collider.width_m = convertLength(body.collider.width_m, scale) ?? body.collider.width_m;
            }
            if (typeof body.collider.height_m === 'number') {
                collider.height_m = convertLength(body.collider.height_m, scale) ?? body.collider.height_m;
            }
            if (typeof body.collider.radius_m === 'number') {
                collider.radius_m = convertLength(body.collider.radius_m, scale) ?? body.collider.radius_m;
            }
            if (Array.isArray(body.collider.points_m)) {
                collider.points_m = body.collider.points_m.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
            if (Array.isArray(body.collider.polygon_m)) {
                collider.polygon_m = body.collider.polygon_m.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
            if (Array.isArray(body.collider.vertices)) {
                collider.vertices = body.collider.vertices.map((point: unknown) => projectPoint(point) ?? [0, 0]);
            }
        }

        let render: any = undefined;
        if (body.render && typeof body.render === 'object') {
            render = {};
            if ('fillStyle' in body.render) render.fillStyle = body.render.fillStyle;
            if ('strokeStyle' in body.render) render.strokeStyle = body.render.strokeStyle;
            if ('lineWidth' in body.render) render.lineWidth = body.render.lineWidth;
        }

        return {
            id: body.id,
            type: body.type,
            mass_kg: body.mass_kg,
            position_m: position ?? body.position_m,
            velocity_m_s: velocity ?? body.velocity_m_s,
            angular_velocity_rad_s: Number.isFinite(angularVelocity) ? angularVelocity : body.angular_velocity_rad_s,
            collider,
            render,
            material: body.material,
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
        // Create a clean object without spreading (which can cause circular refs)
        const next: any = {
            type: constraint.type,
            body_a: constraint.body_a,
            body_b: constraint.body_b,
        };
        
        const ropeKeys = ['rope_length_m', 'length_m', 'rest_length_m'];
        for (const key of ropeKeys) {
            if (key in constraint) {
                const converted = convertLength(constraint[key], scale);
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
            if (key in constraint) {
                const projected = projectAnchor(constraint[key]);
                if (projected) {
                    next[key] = projected;
                }
            }
        }

        // For pulley constraints, store the pulley body ID (not coordinates)
        if ('pulley_anchor_m' in constraint) {
            // Keep original anchor for reference, but renderer will use live pulley body position
            next.pulley_anchor_m = constraint.pulley_anchor_m;
        }
        
        // Copy wheel_radius_m without conversion (it's already in meters)
        if ('wheel_radius_m' in constraint && typeof constraint.wheel_radius_m === 'number') {
            next.wheel_radius_m = constraint.wheel_radius_m;
        }
        
        // Store pulley body ID if available
        if ('pulley_body_id' in constraint) {
            next.pulley_body_id = constraint.pulley_body_id;
        }
        
        if ('stiffness' in constraint) {
            next.stiffness = constraint.stiffness;
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
    // Shared transform store to unify with whiteboard/canvas
    const transformStoreRef = useRef<ReturnType<typeof createTransformStore> | null>(null);
    if (!transformStoreRef.current) {
        transformStoreRef.current = createTransformStore({ container: dimensions });
    }
    const transformState = useTransformStore(transformStoreRef.current);
    const { setContainer, setMappingAndImage, setCamera } = useTransformController(transformStoreRef.current);
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
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
    
    // Drag state that survives render object recreation
    const dragStateRef = useRef<{
        manualDragBody: Matter.Body | null;
        manualDragOffset: { x: number; y: number } | null;
    }>({
        manualDragBody: null,
        manualDragOffset: null,
    });
    
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                // devicePixelRatio를 곱하지 않은 CSS 픽셀 크기
                // Matter.js는 내부에서 pixelRatio 옵션을 받으므로 여기서는 CSS 크기만 넘김
                const { width, height } = entry.contentRect;
                
                // 크기가 유의미하게 변했을 때만 업데이트 (성능 최적화)
                setRenderSize(prev => {
                    if (Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1) return prev;
                    return { width, height };
                });
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, []);

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
            try {
                Matter.Render.stop(render);
                render.canvas.remove();
                render.textures = {};
            } catch {}
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

    // TODO(role-split): Extract the following blocks into dedicated components/modules
    // - SimulationRenderer: responsible for drawing using transformState.transform
    // - SimulationInteraction: pointer/mouse constraints, hover/selection, activation
    // - SimulationSync: debounced backend sync and updateEntityCallback bridging
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
            
            // Resolve to matter body by id; if not found, try by source_segment_id mapping
            let body = matterBodyMapRef.current.get(entityId);
            if (!body) {
                // Try resolve by source_segment_id if scene carries it and map has not been built with that key
                const sceneBody = scene?.bodies?.find((b: any) => String(b?.source_segment_id ?? '') === String(entityId));
                if (sceneBody?.id) {
                    body = matterBodyMapRef.current.get(sceneBody.id) ?? null as any;
                }
            }
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

    // Keep transform store in sync with container size, mapping and image
    useEffect(() => {
        setContainer({ width: dimensions.width, height: dimensions.height });
    }, [dimensions.width, dimensions.height, setContainer]);

    useEffect(() => {
        const mapping = scene?.mapping ?? null;
        const img = imageSizePx ? { width: imageSizePx.width, height: imageSizePx.height } : null;
        setMappingAndImage(mapping, img);
    }, [scene?.mapping, imageSizePx?.width, imageSizePx?.height, setMappingAndImage]);

    // Placeholder camera link (will be replaced by unified provider). For now we assume origin adjustments only.
    useEffect(() => {
        // Keep camera neutral (no pan) & zoom = 1 until whiteboard provider unification.
        setCamera({ position: { x: 0, y: 0 }, zoom: 1 });
    }, [setCamera]);

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
    const containerW = renderSize.width || dimensions.width;
    const containerH = renderSize.height || dimensions.height;
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

    // Build a fallback pseudo-scene from first frame bodies if real scene is absent (enables editing after simulation-only loads)
    const effectiveScene = useMemo(() => {
        if (scene) return scene;
        const firstFrame: any = frames.length > 0 ? frames[0] : null;
        if (firstFrame && Array.isArray(firstFrame.bodies) && firstFrame.bodies.length > 0) {
            console.log('[SimulationLayer] ⚙️ Fallback scene synthesized from first frame bodies');
            return {
                world: { gravity_m_s2: 9.81, time_step_s: 0.016 },
                bodies: firstFrame.bodies,
                constraints: [],
                __fallback: true,
            };
        }
        return null;
    }, [scene, frames]);

    const renderScene = useMemo(() => {
        // If no scene, clear cache
        if (!effectiveScene) {
            renderSceneRef.current = null;
            return null;
        }
        // EDIT MODE CACHING STRATEGY (UPDATED):
        // When user drags an object, sceneModifiedRef is set to true.
        // We DON'T want to regenerate Matter scene in this case because:
        // 1. Matter body is already at the correct position (from drag)
        // 2. Regenerating would cause canvas recreation and position reset
        // So: Keep using cached renderScene when sceneModified is true!
        // Only regenerate when scene actually needs rebuilding (not just position updates).
        const shouldCache = editingEnabled && !playing && matterEngineRef.current;
        if (shouldCache && renderSceneRef.current) {
            // IMPORTANT: Even if sceneModifiedRef is true, use cache!
            // The scene state update is just persisting the drag position,
            // but Matter body is already positioned correctly.
            console.log('[SimulationLayer] 📦 Using cached renderScene (edit mode)');
            return renderSceneRef.current; // stable reference prevents unnecessary re-init
        }
        const newRenderScene = convertSceneForRender(effectiveScene, activeTransform);
        renderSceneRef.current = newRenderScene;
        console.log('[SimulationLayer] 🆕 Created new renderScene');
        return newRenderScene;
    }, [effectiveScene, activeTransform, editingEnabled, playing]);

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
        // In EDIT MODE, derive overlay positions directly from live Matter bodies (prevents revert illusion)
        const engine = matterEngineRef.current;
        if (!playing && engine) {
            try {
                const liveBodies = Matter.Composite.allBodies(engine.world);
                return liveBodies.map(b => {
                    const label = (b as any).label || b.id?.toString() || 'body';
                    // Convert Matter (canvas px) back to scene meters for uniform shape
                    const metersX = (b.position.x - activeTransform.originPx[0]) * activeTransform.pixelsToMeters;
                    const metersY = (activeTransform.originPx[1] - b.position.y) * activeTransform.pixelsToMeters;
                    const position_m: [number, number] = [metersX, metersY];
                    const [xCanvas, yCanvas] = sceneMetersToCanvas(position_m, activeTransform);
                    const vertices = b.vertices?.map(v => [v.x, v.y] as [number, number]);
                    const meta = bodyMetadata.get(label);
                    return { id: label, x: xCanvas, y: yCanvas, meta, position: position_m, angle: -b.angle, vertices };
                });
            } catch {}
        }
        // PLAYBACK MODE: use currentFrame data (frame-based positions)
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
        if (rawPoints.length === 0) return [];
        return rawPoints.map(({ id, position, angle, vertices }) => {
            const [x, y] = sceneMetersToCanvas(position, activeTransform);
            const meta = bodyMetadata.get(id);
            return { id, x, y, meta, position, angle, vertices };
        });
    }, [playing, currentFrame, activeTransform, bodyMetadata]);
    const detectionFit = useMemo(() => {
        if (containerW <= 0 || containerH <= 0) {
            return null;
        }
        if (mappingTransform.hasMapping) {
            const offsetX = mappingTransform.letterboxOffset.x;
            const offsetY = mappingTransform.letterboxOffset.y;
            const scale = mappingTransform.letterboxScale;
            return { scale, offsetX, offsetY };
        }
        if (imageSizePx) {
            const fit = computeLetterboxFit(imageSizePx, { width: containerW, height: containerH });
            return fit;
        }
        return null;
    }, [
        mappingTransform.hasMapping,
        mappingTransform.letterboxScale,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        JSON.stringify(mappingTransform.letterboxOffset),
        imageSizePx?.width,
        imageSizePx?.height,
        containerW,
        containerH
    ]);

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
        if (!renderScene) {
            return;
        }

        const width = containerW;
        const height = containerH;

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

            // Renderer is now handled by SimulationRenderer component
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

    // Interaction logic now rendered inside JSX return

    // Body static state management based on simulation mode
    useEffect(() => {
        const engine = matterEngineRef.current;
        if (!engine || !effectiveScene) return;
        const bodies = Matter.Composite.allBodies(engine.world);

        // IMPORTANT: If editing is enabled, force pause mode regardless of playing state
        if (editingEnabled) {
            console.log('[SimulationLayer] ✏️ Edit mode ACTIVE: forcing pause behavior');
            engine.gravity.x = 0;
            engine.gravity.y = 0;
            bodies.forEach(body => {
                Matter.Body.setVelocity(body, { x: 0, y: 0 });
                Matter.Body.setAngularVelocity(body, 0);
            });
            return; // Don't process play mode logic
        }

        if (playing) {
            console.log('[SimulationLayer] ▶️ Play mode: restoring gravity & original static flags');
            // Restore gravity (if previously zeroed)
            const g = effectiveScene?.world?.gravity_m_s2 ?? 9.81;
            engine.gravity.y = g;
            engine.gravity.x = 0;

            // If user edited positions before play, apply current Matter body positions directly as starting state
            if (sceneModifiedRef.current) {
                console.log('[SimulationLayer] 🚀 Scene was modified, copying Matter positions to scene');
                try {
                    const sceneBodies = (effectiveScene as any)?.bodies;
                    if (Array.isArray(sceneBodies)) {
                        const currentBodies = Matter.Composite.allBodies(engine.world);
                        console.log('[SimulationLayer] 📊 Matter bodies:', currentBodies.length, 'Scene bodies:', sceneBodies.length);
                        currentBodies.forEach(b => {
                            const label = (b as any).label || b.id?.toString();
                            if (!label) return;
                            const sceneBody = sceneBodies.find((sb: any) => String(sb.id) === String(label) || String(sb.source_segment_id) === String(label));
                            if (sceneBody) {
                                // Convert current Matter position (canvas px) back to scene meters
                                const px = b.position.x;
                                const py = b.position.y;
                                const metersX = (px - activeTransform.originPx[0]) * activeTransform.pixelsToMeters;
                                const metersY = (activeTransform.originPx[1] - py) * activeTransform.pixelsToMeters;
                                const oldPos = sceneBody.position_m;
                                sceneBody.position_m = [metersX, metersY];
                                console.log('[SimulationLayer] 📍 Updated', label, 'position:', oldPos, '→', [metersX, metersY]);
                            } else {
                                console.warn('[SimulationLayer] ⚠️ Scene body not found for Matter body:', label);
                            }
                        });
                        console.log('[SimulationLayer] 🚀 Applied edited Matter positions to scene bodies prior to resimulation');
                    }
                } catch (e) {
                    console.warn('[SimulationLayer] Failed to apply edited positions to scene before play', e);
                }
            } else {
                console.log('[SimulationLayer] ℹ️ Scene not modified, using original positions');
            }

            const wasModified = sceneModifiedRef.current;
            sceneModifiedRef.current = false;
            setSceneModified(false);
            if (wasModified) {
                console.log('[SimulationLayer] 🔄 Resimulating with updated positions');
                // IMPORTANT: Pass the modified effectiveScene, not (prev) => prev
                // [수정 후] 2번째 인자로 true(autoPlay)를 전달해야 합니다!
                updateSceneAndResimulate(effectiveScene, true).catch((error: any) => {
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
            // Edit / paused mode: keep dynamics for drag; neutralize gravity & velocity instead of forcing static.
            console.log('[SimulationLayer] ✏️ Edit mode: zeroing gravity & freezing velocities (no static coercion)');
            engine.gravity.x = 0;
            engine.gravity.y = 0;
            bodies.forEach(body => {
                // Freeze motion without altering static flag for dynamic bodies
                Matter.Body.setVelocity(body, { x: 0, y: 0 });
                Matter.Body.setAngularVelocity(body, 0);
            });
        }
    }, [playing, effectiveScene, editingEnabled, updateSceneAndResimulate, activeTransform]);
    // Added editingEnabled to deps to ensure edit mode always overrides play mode

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
    // Render loop is managed by SimulationRenderer

    // Playback Mode: Frame-based rendering (when playing)
    useEffect(() => {
        // Don't apply frames if editing is enabled (even if playing is somehow true)
        if (editingEnabled) return;
        if (!playing) return;
        if (!currentFrame) return;
        applyFrameToMatter(currentFrame);
        const render = matterRenderRef.current;
        if (render) Matter.Render.world(render);
    }, [playing, currentFrame, applyFrameToMatter, editingEnabled]);

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
                    cursor: (editingEnabled && !playing && (scene || effectiveScene)) ? cursor : 'default'
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

                {/* Matter.js renderer */}
                <SimulationRenderer
                    engineRef={matterEngineRef}
                    constraints={renderScene?.constraints || []}
                    scale={activeTransform.metersToPixels}
                    width={containerW}
                    height={containerH}
                    playing={playing}
                    pointerEnabled={Boolean(editingEnabled && !playing && effectiveScene)}
                    hoveredBodyId={hoveredBodyId}
                    selectedBodyId={selectedEntityId}
                    activatedBodyIdRef={activatedBodyIdRef}
                    activationTimestampRef={activationTimestampRef}
                    pulleyConstraintsRef={pulleyConstraintsRef}
                    // pulleyConstraints={pulleyConstraintsRef.current}
                    // onRenderCreated={(render) => {
                    //     matterRenderRef.current = render;
                    //     if (frames.length > 0) {
                    //         try {
                    //             applyFrameToMatter(frames[0]);
                    //             Matter.Render.world(render);
                    //         } catch {}
                    //     }
                    // }}
                    onRenderCreated={(render) => {
                        matterRenderRef.current = render;
                        
                        // [수정된 부분] 🚨 편집 모드이고 이미 수정된 상태라면, 초기 위치로 돌리지 않도록 막습니다.
                        const shouldSkipReset = editingEnabled && sceneModifiedRef.current;

                        if (!shouldSkipReset && frames.length > 0) {
                            try {
                                applyFrameToMatter(frames[0]);
                                Matter.Render.world(render);
                            } catch {}
                        }
                    }}
                />
                <SimulationInteraction
                    engine={matterEngineRef.current}
                    render={matterRenderRef.current}
                    scene={effectiveScene}
                    editingEnabled={editingEnabled}
                    playing={playing}
                    hoveredBodyId={hoveredBodyId}
                    setHoveredBodyId={setHoveredBodyId}
                    selectedEntityId={selectedEntityId}
                    setSelectedEntityId={setSelectedEntityId}
                    setActivatedBodyId={setActivatedBodyId}
                    activatedBodyIdRef={activatedBodyIdRef}
                    activationTimestampRef={activationTimestampRef}
                    activeTransform={activeTransform}
                    updateBodyLocal={updateBodyLocal}
                    setSceneModified={setSceneModified}
                    sceneModifiedRef={sceneModifiedRef}
                    debouncedBackendSyncRef={debouncedBackendSyncRef}
                    globalConversationId={globalChat.activeBoxId}
                    setCursor={setCursor}
                    containerEl={containerRef.current}
                    dragStateRef={dragStateRef}
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
