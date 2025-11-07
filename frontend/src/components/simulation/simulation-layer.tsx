import { useEffect, useMemo, useRef, useCallback } from 'react';
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
        simulationMode,
        setSelectedEntityId,
        registerUpdateEntityCallback 
    } = useSimulation();
    const currentFrame = frames[currentIndex];
    const globalChat = useGlobalChat();
    
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
            
            // Apply updates to Matter.js body
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
            
            console.log(`[SimulationLayer] Entity ${entityId} updated in Frontend`);
        };
        
        registerUpdateEntityCallback(callback);
    }, [registerUpdateEntityCallback]);

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

    const renderScene = useMemo(() => {
        if (!scene) {
            return null;
        }
        return convertSceneForRender(scene, activeTransform);
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

        destroyMatterScene();

        try {
            const built = initializeMatterScene(renderScene);
            matterEngineRef.current = built.engine;
            matterBodyMapRef.current = built.bodyMap;
            pulleyConstraintsRef.current = built.pulleyConstraints;

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

            render.bounds.min.x = 0;
            render.bounds.max.x = width;
            render.bounds.min.y = 0;
            render.bounds.max.y = height;
            render.options.hasBounds = true;
            render.options.wireframes = false;

            matterRenderRef.current = render;
            Matter.Render.run(render);

            // Add mouse constraint for interactive mode
            if (simulationMode === 'interactive') {
                const mouse = Matter.Mouse.create(render.canvas);
                const mouseConstraint = Matter.MouseConstraint.create(built.engine, {
                    mouse: mouse,
                    constraint: {
                        stiffness: 0.2,
                        render: {
                            visible: false,
                        },
                    },
                    // CRITICAL: Allow mouse to interact with static bodies
                    collisionFilter: {
                        mask: 0xFFFFFFFF, // Interact with all collision groups
                    }
                });

                // Override canStartDrag to allow static bodies
                (mouseConstraint as any).canStartDrag = function(body: Matter.Body) {
                    return true; // Allow dragging ALL bodies (static + dynamic)
                };

                // Track dragged body (mouseConstraint.body becomes null on enddrag)
                let draggedBody: Matter.Body | null = null;

                // Click to select entity
                Matter.Events.on(mouseConstraint, 'mousedown', (event: any) => {
                    const mouse = event.mouse;
                    const bodies = Matter.Composite.allBodies(built.engine.world);
                    
                    // Find clicked body
                    const clickedBody = bodies.find(body => 
                        Matter.Bounds.contains(body.bounds, mouse.position) &&
                        Matter.Vertices.contains(body.vertices, mouse.position)
                    );
                    
                    if (clickedBody) {
                        const bodyId = clickedBody.label || clickedBody.id?.toString() || 'unknown';
                        console.log('[SimulationLayer] Body clicked:', bodyId);
                        setSelectedEntityId(bodyId);
                    } else {
                        // Clicked empty space - deselect
                        console.log('[SimulationLayer] Empty space clicked - deselecting');
                        setSelectedEntityId(null);
                    }
                });

                // Allow dragging of all bodies (static and dynamic)
                Matter.Events.on(mouseConstraint, 'startdrag', (event: any) => {
                    const body = event.body;
                    if (!body) return;
                    
                    // Store reference to dragged body
                    draggedBody = body;
                    
                    // Static bodies: Don't convert to dynamic (causes NaN)
                    // Instead, mark them and handle position updates manually
                    if (body.isStatic) {
                        (body as any).__wasStatic = true;
                        (body as any).__staticDragStart = { 
                            x: body.position.x, 
                            y: body.position.y,
                            angle: body.angle
                        };
                        console.log(`[SimulationLayer] Static body ${body.label || body.id} drag initiated (will update manually)`);
                    } else {
                        console.log(`[SimulationLayer] Dynamic body ${body.label || body.id} dragging`);
                    }
                });

                // Backend sync on drag end
                Matter.Events.on(mouseConstraint, 'enddrag', async (event: any) => {
                    // Use stored body reference (mouseConstraint.body is null here)
                    const body = draggedBody;
                    if (!body) {
                        console.warn('[SimulationLayer] No dragged body stored');
                        return;
                    }

                    const bodyId = body.label || body.id?.toString() || 'unknown';
                    
                    // For static bodies that were dragged
                    if ((body as any).__wasStatic) {
                        // Static bodies stay static, just clean up markers
                        delete (body as any).__wasStatic;
                        delete (body as any).__staticDragStart;
                        console.log(`[SimulationLayer] Static body ${bodyId} drag completed at (${body.position.x.toFixed(2)}, ${body.position.y.toFixed(2)})`);
                    }
                    
                    // Check if body has valid position
                    if (!body.position || !Number.isFinite(body.position.x) || !Number.isFinite(body.position.y)) {
                        console.error(`[SimulationLayer] Invalid body position for ${bodyId}:`, body.position);
                        draggedBody = null;
                        return;
                    }

                    // Matter.js position is in canvas pixels with Y-down
                    const matterX = body.position.x;
                    const matterY = body.position.y;
                    
                    // Scene coordinates: Y-up (invert Y from Matter.js)
                    const sceneX = matterX;
                    const sceneY = -matterY;
                    
                    const newPosition: [number, number] = [sceneX, sceneY];

                    console.log(`[SimulationLayer] Body ${bodyId} dragged to (scene):`, newPosition, 
                        `(canvas: ${matterX.toFixed(2)}, ${matterY.toFixed(2)})`);

                    // Sync to backend (debounced)
                    const conversationId = globalChat.activeBoxId;
                    if (conversationId && debouncedBackendSyncRef.current) {
                        try {
                            await debouncedBackendSyncRef.current.flush();
                            
                            debouncedBackendSyncRef.current.debouncedUpdate({
                                [bodyId]: { position_m: newPosition }
                            });
                        } catch (error) {
                            console.error('[SimulationLayer] Backend sync failed:', error);
                        }
                    }
                    
                    // Clear stored reference
                    draggedBody = null;
                });

                Matter.World.add(built.engine.world, mouseConstraint);
                render.mouse = mouse;
                matterMouseConstraintRef.current = mouseConstraint;
                
                console.log('[SimulationLayer] MouseConstraint added for interactive mode');
            }

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
    }, [renderScene, destroyMatterScene, containerW, containerH, frames, applyFrameToMatter, simulationMode, globalChat.activeBoxId]);

    // Initialize debounced backend sync
    useEffect(() => {
        const conversationId = globalChat.activeBoxId;
        if (!conversationId || simulationMode !== 'interactive') {
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
    }, [globalChat.activeBoxId, simulationMode]);

    // Interactive Mode: Real-time physics engine update loop
    useEffect(() => {
        if (simulationMode !== 'interactive' || !scene) {
            return;
        }

        const engine = matterEngineRef.current;
        const render = matterRenderRef.current;
        
        if (!engine || !render) {
            return;
        }

        let lastTime = performance.now();

        const animate = (currentTime: number) => {
            const deltaTime = (currentTime - lastTime) / 1000; // Convert to seconds
            lastTime = currentTime;

            // Update physics engine only if playing (automatic simulation)
            // BUT always render to show drag interactions even when paused
            if (playing) {
                Matter.Engine.update(engine, deltaTime * 1000); // Matter.js expects milliseconds

                // Enforce pulley constraints
                if (pulleyConstraintsRef.current.length > 0) {
                    enforcePulleyConstraints(pulleyConstraintsRef.current);
                }
            } else {
                // When paused, still update engine with zero delta to process mouse interactions
                Matter.Engine.update(engine, 0);
            }

            // Always render the current state (to show drag feedback)
            Matter.Render.world(render);

            animationFrameRef.current = requestAnimationFrame(animate);
        };

        animationFrameRef.current = requestAnimationFrame(animate);

        return () => {
            if (animationFrameRef.current !== null) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
        };
    }, [simulationMode, playing, scene]);

    // Playback Mode: Frame-based rendering
    useEffect(() => {
        if (simulationMode !== 'playback') {
            return;
        }

        if (!currentFrame) return;
        applyFrameToMatter(currentFrame);
        const render = matterRenderRef.current;
        if (render) {
            Matter.Render.world(render);
        }
    }, [simulationMode, currentFrame, applyFrameToMatter]);

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
                onPointerDown={simulationMode === 'interactive' ? undefined : handlePointerDown}
                onPointerMove={simulationMode === 'interactive' ? undefined : handlePointerMove}
                onPointerUp={simulationMode === 'interactive' ? undefined : handlePointerUp}
                onPointerCancel={simulationMode === 'interactive' ? undefined : handlePointerUp}
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
                <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40 pointer-events-none" />

                {/* Matter.js render host - MUST allow pointer events for interactive mode */}
                <div 
                    ref={renderHostRef} 
                    className="absolute inset-0"
                    style={{ 
                        pointerEvents: simulationMode === 'interactive' ? 'auto' : 'none' 
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
