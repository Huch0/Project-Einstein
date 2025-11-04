"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { GripHorizontal, Trash2, Upload, MessageSquare, FlaskConical } from 'lucide-react';

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
import { useSimulationBoxAgent } from '@/hooks/use-simulation-box-agent';
import { AgentChatPanel } from '@/components/simulation/agent-chat-panel';
import { SimulationControls } from '@/components/simulation/simulation-controls';
import { useSimulation } from '@/simulation/SimulationContext';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useGlobalChat } from '@/contexts/global-chat-context';

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
        state: { selection, nodes, orderedNodeIds },
    } = useWhiteboardStore();
    const globalChat = useGlobalChat();
    const [objectPosition, setObjectPosition] = useState<SimulationObjectPosition>({ x: 0, y: 0 });
    const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
    useEffect(() => {
        const metadata = node.metadata as { backgroundImage?: unknown } | undefined;
        const storedImage = typeof metadata?.backgroundImage === 'string' ? metadata.backgroundImage : null;
        if (storedImage && storedImage !== backgroundImage) {
            setBackgroundImage(storedImage);
        }
    }, [node.metadata, backgroundImage]);
    
    // Get all simulation boxes for context insertion
    const availableBoxes = orderedNodeIds
        .map(id => nodes[id])
        .filter((n): n is SimulationBoxNodeType => n?.type === 'simulation-box' && n.id !== node.id)
        .map(n => ({ id: n.id, name: n.name }));
    
    // Simulation context (global for now - will be per-box in future)
    const {
        frames,
        playing,
        currentIndex,
        setPlaying,
        resetSimulation,
        dt,
        updateConfig,
    } = useSimulation();
    
    // Local state for playback speed (multiplier on dt)
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    
    // Agent integration
    const {
        conversationId,
        agentState,
        context: agentContext,
        loading: agentLoading,
        error: agentError,
        uploadImage,
        sendMessage,
        inspectSimulation,
    } = useSimulationBoxAgent({
        boxId: node.id,
        boxName: node.name,
        conversationId: node.conversationId,
        onConversationUpdate: (convId, state) => {
            // Update node with conversation ID and state
            updateNode(node.id, (current) => {
                if (current.type !== 'simulation-box') return current;
                return {
                    ...current,
                    conversationId: convId,
                    agentState: state,
                };
            });
        },
    });
    
    const [showChat, setShowChat] = useState(false);
    const [isEditingName, setIsEditingName] = useState(false);
    const [boxName, setBoxName] = useState(node.name || '');

    // Simulation control handlers
    const handlePlayPause = useCallback(() => {
        setPlaying(!playing);
    }, [playing, setPlaying]);

    const handleReset = useCallback(() => {
        resetSimulation();
    }, [resetSimulation]);

    const handleStep = useCallback(() => {
        // Step forward one frame (not implemented in context yet)
        // For now, we can temporarily set playing and let it advance
        if (currentIndex < frames.length - 1) {
            setPlaying(true);
            setTimeout(() => setPlaying(false), dt * 1000);
        }
    }, [currentIndex, frames.length, setPlaying, dt]);

    const handleFrameChange = useCallback((frameIndex: number) => {
        // Direct frame navigation (not exposed by context)
        // We'd need to add setCurrentIndex to context
        // For now, this is a placeholder
        console.log('[SimulationBox] Frame navigation not yet implemented:', frameIndex);
    }, []);

    const handleSpeedChange = useCallback((speed: number) => {
        setPlaybackSpeed(speed);
        // Adjust dt based on speed multiplier
        // Note: This inverts the relationship - higher speed = smaller dt
        const baseDt = 0.02; // Base dt from initial config
        updateConfig({ dt: baseDt / speed });
    }, [updateConfig]);

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

    // Register/unregister simulation box with GlobalChat (only on mount/unmount)
    useEffect(() => {
        const currentNode = nodes[node.id];
        if (currentNode?.type === 'simulation-box') {
            globalChat.registerSimulationBox({
                id: node.id,
                name: currentNode.name || `Box ${node.id.slice(0, 8)}`,
                conversationId,
                hasImage: !!backgroundImage,
                hasSimulation: frames.length > 0,
            });
        }

        return () => {
            globalChat.unregisterSimulationBox(node.id);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    // Update simulation box info when state changes
    useEffect(() => {
        const currentNode = nodes[node.id];
        if (currentNode?.type === 'simulation-box') {
            globalChat.updateSimulationBox(node.id, {
                name: currentNode.name || `Box ${node.id.slice(0, 8)}`,
                conversationId,
                hasImage: !!backgroundImage,
                hasSimulation: frames.length > 0,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id, conversationId, backgroundImage, frames.length]);

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
                    'flex h-10 items-center justify-between rounded-t-lg border border-b-0 bg-background px-3 text-xs font-medium uppercase tracking-wide shadow-sm touch-none',
                    isSelected ? 'border-primary/70' : 'border-border',
                    draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'
                )}
                onPointerDown={handleDragPointerDown}
                onPointerMove={handleDragPointerMove}
                onPointerUp={handleDragPointerUp}
                onPointerCancel={handleDragPointerUp}
            >
                <div className="flex items-center gap-2 text-muted-foreground flex-1">
                    <GripHorizontal className="h-3 w-3" />
                    
                    {/* Editable Box Name */}
                    {isEditingName ? (
                        <Input
                            value={boxName}
                            onChange={(e) => setBoxName(e.target.value)}
                            onBlur={() => {
                                setIsEditingName(false);
                                if (boxName.trim()) {
                                    updateNode(node.id, (current) => {
                                        if (current.type !== 'simulation-box') return current;
                                        return { ...current, name: boxName.trim() };
                                    });
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                    setBoxName(node.name || '');
                                    setIsEditingName(false);
                                }
                            }}
                            className="h-6 w-32 text-xs px-2"
                            autoFocus
                            data-node-action="true"
                        />
                    ) : (
                        <span 
                            className="cursor-text hover:text-foreground transition-colors"
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                setIsEditingName(true);
                            }}
                            data-node-action="true"
                        >
                            {node.name || 'Simulation Box'}
                        </span>
                    )}
                    
                    {agentState && (
                        <span className="text-[10px] bg-primary/20 px-1.5 py-0.5 rounded">
                            {agentState.scene_kind || `${agentState.entities_count} entities`}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    {/* Upload Image */}
                    <label
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer bg-background"
                        data-node-action="true"
                    >
                        <Upload className="h-3.5 w-3.5" />
                        <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    // Create preview URL for background
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                        const dataUrl = reader.result as string;
                                        setBackgroundImage(dataUrl);
                                        updateNode(node.id, (current) => {
                                            if (current.type !== 'simulation-box') return current;
                                            return {
                                                ...current,
                                                metadata: {
                                                    ...(current.metadata ?? {}),
                                                    backgroundImage: dataUrl,
                                                },
                                            };
                                        });
                                    };
                                    reader.readAsDataURL(file);
                                    
                                    // Upload to agent
                                    await uploadImage(file);
                                }
                            }}
                            disabled={agentLoading}
                        />
                    </label>
                    
                    {/* Inspect Simulation */}
                    {conversationId && (
                        <button
                            type="button"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground bg-background"
                            onClick={() => inspectSimulation()}
                            aria-label="Inspect simulation"
                            data-node-action="true"
                            disabled={agentLoading}
                        >
                            <FlaskConical className="h-3.5 w-3.5" />
                        </button>
                    )}
                    
                    {/* Chat with Agent */}
                    {conversationId && (
                        <button
                            type="button"
                            className={cn(
                                "rounded p-1 transition-colors hover:bg-accent hover:text-accent-foreground",
                                showChat ? "bg-primary text-primary-foreground" : "text-muted-foreground bg-background"
                            )}
                            onClick={() => setShowChat(!showChat)}
                            aria-label="Chat with agent"
                            data-node-action="true"
                        >
                            <MessageSquare className="h-3.5 w-3.5" />
                        </button>
                    )}
                    
                    {/* Remove Box */}
                    <button
                        type="button"
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground bg-background"
                        onClick={() => removeNode(node.id)}
                        aria-label="Remove simulation box"
                        data-node-action="true"
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </button>
                </div>
            </div>
            <div
                className={cn(
                    'relative w-full overflow-hidden rounded-b-lg border bg-background shadow',
                    isSelected ? 'border-primary/70' : 'border-border'
                )}
                style={{ height: Math.max(MIN_BOUNDS.height - HEADER_HEIGHT, node.bounds.height - HEADER_HEIGHT) }}
            >
                {/* Background Image - Only show when not in simulation mode */}
                {backgroundImage && !frames.length && (
                    <div 
                        className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-background"
                    >
                        <img 
                            src={backgroundImage} 
                            alt="Uploaded diagram"
                            className="max-w-full max-h-full object-contain"
                            style={{ opacity: 0.9 }}
                        />
                    </div>
                )}
                
                {/* Agent Error Display */}
                {agentError && (
                    <div className="absolute top-2 left-2 right-2 z-20 bg-destructive/90 text-destructive-foreground text-xs px-2 py-1 rounded">
                        {agentError}
                    </div>
                )}
                
                {/* Agent Loading Overlay */}
                {agentLoading && (
                    <div className="absolute inset-0 z-10 bg-background/50 flex items-center justify-center">
                        <div className="text-sm text-muted-foreground">Agent processing...</div>
                    </div>
                )}
                
                {/* Agent Chat Panel */}
                {showChat && (
                    <AgentChatPanel
                        boxName={node.name}
                        conversationId={conversationId}
                        context={agentContext}
                        onSendMessage={sendMessage}
                        onClose={() => setShowChat(false)}
                        loading={agentLoading}
                        availableBoxes={availableBoxes}
                    />
                )}
                
                {/* Simulation Viewport */}
                <div className="flex flex-col h-full relative z-10">
                    <div className="flex-1 overflow-hidden">
                        <SimulationLayer
                            enabled={mode === 'simulation'}
                            objectPosition={objectPosition}
                            onObjectPositionChange={handleObjectPositionChange}
                            dimensions={{ width: node.bounds.width, height: Math.max(MIN_BOUNDS.height - HEADER_HEIGHT, node.bounds.height - HEADER_HEIGHT) }}
                        />
                    </div>
                    
                    {/* Simulation Playback Controls */}
                    {frames.length > 0 && (
                        <div className="border-t border-border bg-background/95 p-2" data-node-action="true">
                            <SimulationControls
                                isPlaying={playing}
                                currentFrame={currentIndex}
                                totalFrames={frames.length}
                                playbackSpeed={playbackSpeed}
                                onPlayPause={handlePlayPause}
                                onReset={handleReset}
                                onStep={handleStep}
                                onFrameChange={handleFrameChange}
                                onSpeedChange={handleSpeedChange}
                                disabled={agentLoading}
                            />
                        </div>
                    )}
                </div>
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
