"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useWhiteboardStore } from '@/whiteboard/context';
import type {
    CameraState,
    InteractionMode,
    SimulationBoxNode as SimulationBoxNodeType,
} from '@/whiteboard/types';
import {
    SimulationLayer,
    type SimulationObjectPosition,
} from '@/components/simulation/simulation-layer';

interface SimulationBoxNodeProps {
    node: SimulationBoxNodeType;
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

const MIN_BOUNDS = { width: 240, height: 200 };
const HEADER_HEIGHT = 40;
const HANDLE_SIZE = 16;
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

export default function SimulationBoxNode({ node, mode, camera }: SimulationBoxNodeProps) {
    const {
        updateNode,
        removeNode,
        setSelection,
        state: { selection },
    } = useWhiteboardStore();
    const [objectPosition, setObjectPosition] = useState<SimulationObjectPosition>({ x: 0, y: 0 });

    const draggable = mode === 'pan';
    const resizable = mode !== 'draw';
    const isSelected = selection.includes(node.id);

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
        cleanup: (() => void) | null;
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
        cleanup: null,
        target: null,
    });

    const handleObjectPositionChange = useCallback((position: SimulationObjectPosition) => {
        setObjectPosition(position);
    }, []);

    const commitTransform = useCallback(
        (next: { x?: number; y?: number; width?: number; height?: number }) => {
            updateNode(node.id, (current) => {
                if (current.type !== 'simulation-box') {
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
        commitTransform({ x: state.originX + deltaX, y: state.originY + deltaY });
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
        resizeState.current.cleanup?.();
        if (resizeState.current.pointerId !== null && resizeState.current.target) {
            resizeState.current.target.releasePointerCapture(resizeState.current.pointerId);
        }
        resizeState.current.pointerId = null;
        resizeState.current.target = null;
        resizeState.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originWidth: node.bounds.width,
            originHeight: node.bounds.height,
            originX: node.transform.x,
            originY: node.transform.y,
            handle,
            cleanup: null,
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
                const clampedWidth = Math.max(MIN_BOUNDS.width, rawWidth);
                const widthDiff = originWidth - clampedWidth;
                nextWidth = clampedWidth;
                nextX = originX + widthDiff;
            } else if (affectsRight) {
                const rawWidth = originWidth + deltaX;
                nextWidth = Math.max(MIN_BOUNDS.width, rawWidth);
            }

            if (affectsTop) {
                const rawHeight = originHeight - deltaY;
                const clampedHeight = Math.max(MIN_BOUNDS.height, rawHeight);
                const heightDiff = originHeight - clampedHeight;
                nextHeight = clampedHeight;
                nextY = originY + heightDiff;
            } else if (affectsBottom) {
                const rawHeight = originHeight + deltaY;
                nextHeight = Math.max(MIN_BOUNDS.height, rawHeight);
            }

            commitTransform({ x: nextX, y: nextY, width: nextWidth, height: nextHeight });
        };

        const handleUp = (upEvent: PointerEvent) => {
            if (upEvent.pointerId !== event.pointerId) return;
            resizeState.current.pointerId = null;
            resizeState.current.cleanup?.();
            resizeState.current.cleanup = null;
            resizeState.current.target?.releasePointerCapture(upEvent.pointerId);
            resizeState.current.target = null;
            resizeState.current.handle = null;
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };

        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
        window.addEventListener('pointercancel', handleUp);

        resizeState.current.cleanup = () => {
            window.removeEventListener('pointermove', handleMove);
            window.removeEventListener('pointerup', handleUp);
            window.removeEventListener('pointercancel', handleUp);
        };
    };

    useEffect(() => {
        return () => {
            resizeState.current.cleanup?.();
            resizeState.current.cleanup = null;
            if (resizeState.current.pointerId !== null && resizeState.current.target) {
                resizeState.current.target.releasePointerCapture(resizeState.current.pointerId);
            }
            resizeState.current.pointerId = null;
            resizeState.current.target = null;
            resizeState.current.handle = null;
        };
    }, []);

    const handleResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.stopPropagation();
        if (resizeState.current.pointerId !== event.pointerId) return;
        resizeState.current.pointerId = null;
        resizeState.current.cleanup?.();
        resizeState.current.cleanup = null;
        resizeState.current.target?.releasePointerCapture(event.pointerId);
        resizeState.current.target = null;
        resizeState.current.handle = null;
    };

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
                    'flex h-10 items-center justify-between rounded-t-lg border border-b-0 bg-background/95 px-3 text-xs font-medium uppercase tracking-wide shadow-sm touch-none',
                    isSelected ? 'border-primary/70' : 'border-border',
                    draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                )}
                onPointerDown={handleDragPointerDown}
                onPointerMove={handleDragPointerMove}
                onPointerUp={handleDragPointerUp}
                onPointerCancel={handleDragPointerUp}
            >
                <span className="flex items-center gap-2 text-muted-foreground">
                    <GripHorizontal className="h-3 w-3" />
                    Simulation Box
                </span>
                <button
                    type="button"
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted"
                    onClick={() => removeNode(node.id)}
                    aria-label="Remove simulation box"
                    data-node-action="true"
                >
                    <Trash2 className="h-3.5 w-3.5" />
                </button>
            </div>
            <div
                className={cn(
                    'relative w-full overflow-hidden rounded-b-lg border bg-background/90 shadow',
                    isSelected ? 'border-primary/70' : 'border-border'
                )}
                style={{ height: Math.max(MIN_BOUNDS.height - HEADER_HEIGHT, node.bounds.height - HEADER_HEIGHT) }}
            >
                <SimulationLayer
                    enabled={mode === 'simulation'}
                    objectPosition={objectPosition}
                    onObjectPositionChange={handleObjectPositionChange}
                    dimensions={{ width: node.bounds.width, height: Math.max(MIN_BOUNDS.height - HEADER_HEIGHT, node.bounds.height - HEADER_HEIGHT) }}
                />
            </div>
            {isSelected && resizable ? (
                <div className="pointer-events-none absolute inset-0 z-10">
                    <div className="absolute inset-0 rounded-lg border border-primary/60 shadow-[0_0_0_1px_rgba(37,99,235,0.35)]" />
                    {RESIZE_HANDLES.map(({ id, style, cursor }) => (
                        <div
                            key={id}
                            role="presentation"
                            className="absolute flex items-center justify-center rounded-sm border border-primary bg-background pointer-events-auto shadow-sm transition-colors hover:bg-primary/10 touch-none"
                            style={{ ...style, width: HANDLE_SIZE, height: HANDLE_SIZE, cursor }}
                            data-node-action="true"
                            onPointerDown={(event) => handleResizePointerDown(event, id)}
                            onPointerUp={handleResizePointerUp}
                            onPointerCancel={handleResizePointerUp}
                        >
                            <span className="sr-only">Resize handle {id.replace('-', ' ')}</span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
