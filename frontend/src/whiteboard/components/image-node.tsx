"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Loader2, Sparkles, Trash2, Upload } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWhiteboardStore } from '@/whiteboard/context';
import {
    IMAGE_NODE_MIN_HEIGHT,
    IMAGE_NODE_MIN_WIDTH,
    SIMULATION_BOX_MIN_HEIGHT,
    SIMULATION_BOX_MIN_WIDTH,
} from '@/whiteboard/constants';
import { calculateImageNodeBounds, getImageContentHeight } from '@/whiteboard/utils';
import type { CameraState, ImageNode as ImageNodeType, InteractionMode } from '@/whiteboard/types';
import { useSimulation } from '@/simulation/SimulationContext';
import {
    uploadDiagram,
    sendInitSimulation,
    type InitSimRequest,
} from '@/lib/agent-api';
import { runMatterSimulation } from '@/simulation/matterRunner';
import { useGlobalChat } from '@/contexts/global-chat-context';

interface ImageNodeProps {
    node: ImageNodeType;
    mode: InteractionMode;
    camera: CameraState;
}

type ResizeHandle =
    | 'top-left'
    | 'top'
    | 'top-right'
    | 'right'
    | 'bottom-right'
    | 'bottom'
    | 'bottom-left'
    | 'left';

const HANDLE_SIZE = 14;
const HANDLE_OFFSET = HANDLE_SIZE / 2;

const RESIZE_HANDLES: Array<{
    id: ResizeHandle;
    style: CSSProperties;
    cursor: CSSProperties['cursor'];
}> = [
    { id: 'top-left', style: { top: -HANDLE_OFFSET, left: -HANDLE_OFFSET }, cursor: 'nwse-resize' },
    { id: 'top', style: { top: -HANDLE_OFFSET, left: '50%', transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { id: 'top-right', style: { top: -HANDLE_OFFSET, right: -HANDLE_OFFSET }, cursor: 'nesw-resize' },
    { id: 'right', style: { top: '50%', right: -HANDLE_OFFSET, transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
    { id: 'bottom-right', style: { bottom: -HANDLE_OFFSET, right: -HANDLE_OFFSET }, cursor: 'nwse-resize' },
    { id: 'bottom', style: { bottom: -HANDLE_OFFSET, left: '50%', transform: 'translateX(-50%)' }, cursor: 'ns-resize' },
    { id: 'bottom-left', style: { bottom: -HANDLE_OFFSET, left: -HANDLE_OFFSET }, cursor: 'nesw-resize' },
    { id: 'left', style: { top: '50%', left: -HANDLE_OFFSET, transform: 'translateY(-50%)' }, cursor: 'ew-resize' },
];

export default function ImageNode({ node, mode, camera }: ImageNodeProps) {
    const {
        updateNode,
        removeNode,
        setSelection,
        createSimulationBox,
        state: { selection },
    } = useWhiteboardStore();
    const { loadSimulationRun } = useSimulation();
    const { registerImageBox, unregisterImageBox } = useGlobalChat();

    const replaceInputRef = useRef<HTMLInputElement>(null);
    const draggable = mode === 'pan';
    const resizable = mode !== 'draw';
    const isSelected = selection.includes(node.id);
    const [isConverting, setIsConverting] = useState(false);
    const [conversionError, setConversionError] = useState<string | null>(null);

    // Register image box with GlobalChatContext
    useEffect(() => {
        if (node.source.uri) {
            registerImageBox({
                id: node.id,
                name: 'Image Box', // Default name, can be customized later
                imagePath: node.source.uri,
                uploadedAt: new Date(),
            });
        }

        return () => {
            unregisterImageBox(node.id);
        };
    }, [node.id, node.source.uri, registerImageBox, unregisterImageBox]);

    const dragState = useRef<{
        pointerId: number | null;
        startX: number;
        startY: number;
        originX: number;
        originY: number;
    }>({ pointerId: null, startX: 0, startY: 0, originX: node.transform.x, originY: node.transform.y });

    const resizeState = useRef<{
        pointerId: number | null;
        startX: number;
        startY: number;
        originWidth: number;
        originHeight: number;
        originX: number;
        originY: number;
        handle: ResizeHandle | null;
        target: HTMLDivElement | null;
    }>({
        pointerId: null,
        startX: 0,
        startY: 0,
        originWidth: node.bounds.width,
        originHeight: node.bounds.height,
        originX: node.transform.x,
        originY: node.transform.y,
        handle: null,
        target: null,
    });

    const dataUrlToFile = useCallback(async (uri: string) => {
        const response = await fetch(uri);
        if (!response.ok) {
            throw new Error('Unable to load image data for conversion');
        }
        const blob = await response.blob();
        const mimeType = blob.type || 'image/png';
        const extension = mimeType.includes('/') ? mimeType.split('/')[1] : 'png';
        const filename = `image-box-${node.id}.${extension}`;
        return new File([blob], filename, { type: mimeType });
    }, [node.id]);

    const commitNode = useCallback(
        (next: { x?: number; y?: number; width?: number; height?: number }) => {
            updateNode(node.id, (current) => {
                if (current.type !== 'image') {
                    return current;
                }
                return {
                    ...current,
                    transform: {
                        ...current.transform,
                        x: next.x ?? current.transform.x,
                        y: next.y ?? current.transform.y,
                    },
                    bounds: {
                        width: next.width ?? current.bounds.width,
                        height: next.height ?? current.bounds.height,
                    },
                };
            });
        },
        [node.id, updateNode]
    );

    const handleConvertToSimulation = useCallback(async () => {
        if (isConverting) return;
        if (!node.source.uri) {
            setConversionError('No image available to convert.');
            return;
        }
        setIsConverting(true);
        setConversionError(null);
        try {
            const imageFile = await dataUrlToFile(node.source.uri);
            const { image_id, width_px, height_px } = await uploadDiagram(imageFile);

            const initRequest: InitSimRequest = {
                image_id,
            };
            console.debug('[ImageNode] /init_sim request sent')

            const initResponse = await sendInitSimulation(initRequest);
            // eslint-disable-next-line no-console
            console.debug('[ImageNode] /init_sim response', initResponse);
            if (initResponse.status !== 'initialized') {
                const details = initResponse.initialization.errors?.join(', ') || 'Unknown error';
                throw new Error(`Initialization failed: ${details}`);
            }

            if (!initResponse.ready_for_simulation) {
                throw new Error('Initialization incomplete. The scene is not ready for simulation.');
            }

            const scene = initResponse.initialization.scene as any;
            if (!scene) {
                throw new Error('Initialization did not return a physics scene.');
            }

            const defaultDuration = typeof scene?.world?.simulation_duration_s === 'number'
                ? scene.world.simulation_duration_s
                : undefined;

            const localSimulation = runMatterSimulation(scene, {
                duration_s: defaultDuration,
            });

            const frames = localSimulation.frames;
            const framesCount = frames.length;
            const totalSimTime = framesCount > 0 ? frames[framesCount - 1].t : defaultDuration;

            const labelEntities = initResponse.initialization.entities
                ? initResponse.initialization.entities.map((entity) => ({
                      segment_id: entity.segment_id,
                      label: entity.type,
                      props: entity.props,
                  }))
                : undefined;

            const scaleMetersPerPx = typeof (scene as any)?.mapping?.scale_m_per_px === 'number'
                ? (scene as any).mapping.scale_m_per_px
                : null;

            await loadSimulationRun({
                frames,
                meta: {
                    frames_count: framesCount,
                    simulation_time_s: totalSimTime,
                    time_step_s: localSimulation.dt,
                },
                scene,
                imageSizePx:
                    typeof width_px === 'number' && typeof height_px === 'number'
                        ? { width: width_px, height: height_px }
                        : null,
                scale_m_per_px: scaleMetersPerPx,
                labels: labelEntities
                    ? {
                          entities: labelEntities,
                      }
                    : null,
            });

            const width = Math.max(SIMULATION_BOX_MIN_WIDTH, node.bounds.width);
            const height = Math.max(SIMULATION_BOX_MIN_HEIGHT, node.bounds.height);
            const horizontalSpacing = 32;
            const simNodeId = createSimulationBox({
                transform: {
                    ...node.transform,
                    x: node.transform.x + node.bounds.width + horizontalSpacing,
                },
                bounds: { width, height },
                metadata: {
                    sourceImageNodeId: node.id,
                    conversion: {
                            framesCount,
                            imageWidth: width_px,
                            imageHeight: height_px,
                            conversationId: initResponse.conversation_id,
                            imageId: initResponse.image_id,
                            warnings: initResponse.initialization.warnings,
                        },
                },
            });

            updateNode(simNodeId, (current) => {
                if (current.type !== 'simulation-box') {
                    return current;
                }
                return {
                    ...current,
                    conversationId: initResponse.conversation_id,
                    agentState: {
                        segments_count: initResponse.initialization.segments_count,
                        entities_count: initResponse.initialization.entities_count,
                        scene_kind: (initResponse.initialization.scene as any)?.kind,
                        has_scene: !!initResponse.initialization.scene,
                        frames_count: framesCount,
                    },
                };
            });

            setSelection([simNodeId]);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Conversion failed';
            setConversionError(message);
        } finally {
            setIsConverting(false);
        }
    }, [
        createSimulationBox,
        dataUrlToFile,
        isConverting,
        node.bounds.height,
        node.bounds.width,
        node.id,
        node.source.uri,
        node.transform,
        loadSimulationRun,
        setSelection,
        updateNode,
    ]);

    const isInteractiveTarget = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return target.closest('[data-node-action="true"]') !== null;
    };

    const handleDragPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggable) return;
        if (isInteractiveTarget(event.target)) return;
        event.stopPropagation();
        event.preventDefault();
        setSelection([node.id]);
        dragState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: node.transform.x,
            originY: node.transform.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handleDragPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
        const state = dragState.current;
        if (!draggable || state.pointerId !== event.pointerId) return;
        const deltaX = (event.clientX - state.startX) / camera.zoom;
        const deltaY = (event.clientY - state.startY) / camera.zoom;
        commitNode({ x: state.originX + deltaX, y: state.originY + deltaY });
    };

    const handleDragPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (dragState.current.pointerId !== event.pointerId) return;
        dragState.current.pointerId = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>, handle: ResizeHandle) => {
        if (!resizable) {
            setSelection([node.id]);
            return;
        }
        event.stopPropagation();
        event.preventDefault();
        setSelection([node.id]);
        resizeState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originWidth: node.bounds.width,
            originHeight: node.bounds.height,
            originX: node.transform.x,
            originY: node.transform.y,
            handle,
            target: event.currentTarget,
        };
        event.currentTarget.setPointerCapture(event.pointerId);

        const handleMove = (moveEvent: PointerEvent) => {
            if (moveEvent.pointerId !== event.pointerId) return;
            const deltaX = (moveEvent.clientX - resizeState.current.startX) / camera.zoom;
            const deltaY = (moveEvent.clientY - resizeState.current.startY) / camera.zoom;

            const { originWidth, originHeight, originX, originY, handle: activeHandle } = resizeState.current;
            if (!activeHandle) return;

            let nextWidth = originWidth;
            let nextHeight = originHeight;
            let nextX = originX;
            let nextY = originY;

            const affectsLeft = activeHandle.includes('left');
            const affectsRight = activeHandle.includes('right');
            const affectsTop = activeHandle.includes('top');
            const affectsBottom = activeHandle.includes('bottom');

            if (affectsLeft) {
                const rawWidth = originWidth - deltaX;
                const clampedWidth = Math.max(IMAGE_NODE_MIN_WIDTH, rawWidth);
                const widthDiff = originWidth - clampedWidth;
                nextWidth = clampedWidth;
                nextX = originX + widthDiff;
            } else if (affectsRight) {
                const rawWidth = originWidth + deltaX;
                nextWidth = Math.max(IMAGE_NODE_MIN_WIDTH, rawWidth);
            }

            if (affectsTop) {
                const rawHeight = originHeight - deltaY;
                const clampedHeight = Math.max(IMAGE_NODE_MIN_HEIGHT, rawHeight);
                const heightDiff = originHeight - clampedHeight;
                nextHeight = clampedHeight;
                nextY = originY + heightDiff;
            } else if (affectsBottom) {
                const rawHeight = originHeight + deltaY;
                nextHeight = Math.max(IMAGE_NODE_MIN_HEIGHT, rawHeight);
            }

            commitNode({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
        };

        const handleUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== event.pointerId) return;
            resizeState.current.pointerId = null;
            resizeState.current.target?.releasePointerCapture(event.pointerId);
            resizeState.current.handle = null;
            resizeState.current.target = null;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);
    };

    const handleReplaceImage = useCallback(
        (file: File) => {
            if (isConverting) return;
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const image = new Image();
                image.onload = () => {
                    const nextBounds = calculateImageNodeBounds(image.naturalWidth, image.naturalHeight);
                    setConversionError(null);
                    updateNode(node.id, (current) => {
                        if (current.type !== 'image') {
                            return current;
                        }
                        return {
                            ...current,
                            source: { kind: 'upload', uri: dataUrl },
                            originalSize: { width: image.naturalWidth, height: image.naturalHeight },
                            bounds: nextBounds,
                        };
                    });
                };
                image.src = dataUrl;
            };
            reader.readAsDataURL(file);
        },
        [isConverting, node.id, updateNode]
    );

    const contentHeight = useMemo(() => getImageContentHeight(node.bounds.height), [node.bounds.height]);

    useEffect(() => {
        return () => {
            const current = resizeState.current;
            if (current.pointerId !== null && current.target) {
                current.target.releasePointerCapture(current.pointerId);
            }
            resizeState.current.pointerId = null;
            resizeState.current.target = null;
            resizeState.current.handle = null;
        };
    }, []);

    const containerStyle = useMemo(
        () => ({
            width: node.bounds.width,
            height: node.bounds.height,
            transform: `translate(${node.transform.x}px, ${node.transform.y}px)`,
        }),
        [node.bounds.height, node.bounds.width, node.transform.x, node.transform.y]
    );

    const containerClassName = cn(
        'absolute select-none',
        mode === 'draw' ? 'pointer-events-none' : 'pointer-events-auto'
    );

    return (
        <div
            className={containerClassName}
            style={containerStyle}
            data-whiteboard-node="true"
            onPointerDown={(event) => {
                if (mode === 'draw' || isInteractiveTarget(event.target)) {
                    return;
                }
                setSelection([node.id]);
                event.stopPropagation();
            }}
        >
            <div
                className={cn(
                    'flex h-9 w-full items-center justify-between rounded-t-md border border-b-0 bg-background px-3 text-xs font-medium uppercase tracking-wide shadow-sm touch-none',
                    isSelected ? 'border-primary/70' : 'border-border',
                    draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                )}
                onPointerDown={handleDragPointerDown}
                onPointerMove={handleDragPointerMove}
                onPointerUp={handleDragPointerUp}
                onPointerCancel={handleDragPointerUp}
            >
                <div className="flex items-center gap-2 text-muted-foreground">
                    <GripHorizontal className="h-3 w-3" />
                    <span>Image Box</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        className={cn(
                            'rounded p-1 text-muted-foreground transition-colors bg-background',
                            isConverting || !node.source.uri
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-accent hover:text-accent-foreground'
                        )}
                        onClick={handleConvertToSimulation}
                        aria-label="Convert to simulation"
                        data-node-action="true"
                        disabled={isConverting || !node.source.uri}
                        title={node.source.uri ? 'Convert to simulation' : 'Upload an image first'}
                    >
                        {isConverting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                        )}
                    </button>
                    <button
                        type="button"
                        className={cn(
                            'rounded p-1 text-muted-foreground transition-colors bg-background',
                            isConverting
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-accent hover:text-accent-foreground'
                        )}
                        onClick={() => replaceInputRef.current?.click()}
                        aria-label="Replace image"
                        data-node-action="true"
                        disabled={isConverting}
                    >
                        <Upload className="h-3.5 w-3.5" />
                    </button>
                    <button
                        type="button"
                        className={cn(
                            'rounded p-1 text-muted-foreground transition-colors bg-background',
                            isConverting
                                ? 'cursor-not-allowed opacity-60'
                                : 'hover:bg-destructive hover:text-destructive-foreground'
                        )}
                        onClick={() => removeNode(node.id)}
                        aria-label="Remove image box"
                        data-node-action="true"
                        disabled={isConverting}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            <div
                className={cn(
                    'relative w-full overflow-hidden rounded-b-md border bg-background shadow',
                    isSelected ? 'border-primary/70' : 'border-border'
                )}
                style={{ height: contentHeight }}
            >
                {conversionError && (
                    <div className="absolute left-2 right-2 top-2 z-20 rounded bg-destructive/90 px-2 py-1 text-xs text-destructive-foreground shadow">
                        {conversionError}
                    </div>
                )}
                {isConverting && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 text-xs text-muted-foreground">
                        Converting…
                    </div>
                )}
                {node.source.uri ? (
                    <img
                        src={node.source.uri}
                        alt="Whiteboard upload"
                        className="h-full w-full object-contain bg-muted"
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                        No image selected
                    </div>
                )}
            </div>
            {isSelected && resizable ? (
                <div className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute inset-0 rounded-md border border-primary/60 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]" />
                    {RESIZE_HANDLES.map(({ id, style, cursor }) => (
                        <div
                            key={id}
                            role="presentation"
                            className="absolute flex items-center justify-center rounded-sm border border-primary bg-background pointer-events-auto shadow-sm transition-colors hover:bg-primary/10 touch-none"
                            style={{ ...style, width: HANDLE_SIZE, height: HANDLE_SIZE, cursor }}
                            data-node-action="true"
                            onPointerDown={(event) => handleResizePointerDown(event, id)}
                        >
                            <span className="sr-only">Resize</span>
                        </div>
                    ))}
                </div>
            ) : null}
            <input
                ref={replaceInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                data-node-action="true"
                disabled={isConverting}
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    handleReplaceImage(file);
                    event.target.value = '';
                }}
            />
        </div>
    );
}
