import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Layer, Line, Stage } from 'react-konva';
import type { Stage as KonvaStage } from 'konva/lib/Stage';
import type { KonvaEventObject } from 'konva/lib/Node';
import {
    PenLine,
    Highlighter as HighlighterIcon,
    Eraser as EraserIcon,
    Undo2,
    Redo2,
    Trash2,
    ChevronDown,
    ChevronUp,
    Palette,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type CanvasTool = 'pen' | 'highlighter' | 'eraser';

type StrokePoint = { x: number; y: number };

export type CanvasStroke = {
    id: string;
    tool: CanvasTool;
    color: string;
    width: number;
    opacity: number;
    compositeOperation: GlobalCompositeOperation;
    points: StrokePoint[];
};

export type CanvasLayerProps = {
    strokes: CanvasStroke[];
    onStrokesChange: Dispatch<SetStateAction<CanvasStroke[]>>;
    enabled: boolean;
    dimensions: { width: number; height: number };
};

const createStrokeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

export function CanvasLayer({
    strokes,
    onStrokesChange,
    enabled,
    dimensions,
}: CanvasLayerProps) {
    const presetColors = ['#1d4ed8', '#ef4444', '#22c55e', '#fbbf24', '#a855f7', '#0ea5e9', '#f97316', '#0f172a'];
    const stageRef = useRef<KonvaStage | null>(null);
    const isDrawing = useRef(false);
    const activePointerId = useRef<number | null>(null);
    const [activeTool, setActiveTool] = useState<CanvasTool>('pen');
    const [toolSettings, setToolSettings] = useState({
        pen: { color: '#1d4ed8', size: 3 },
        highlighter: { color: '#facc15', size: 12, opacity: 0.35 },
        eraser: { size: 24 },
    });
    const [redoStack, setRedoStack] = useState<CanvasStroke[]>([]);
    const [isToolbarRendered, setIsToolbarRendered] = useState(false);
    const [isToolbarVisible, setIsToolbarVisible] = useState(false);
    const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
    const isInternalStrokeUpdate = useRef(false);
    const colorInputRef = useRef<HTMLInputElement | null>(null);
    const [isColorPopoverOpen, setIsColorPopoverOpen] = useState(false);

    const commitStrokesChange = (action: SetStateAction<CanvasStroke[]>) => {
        isInternalStrokeUpdate.current = true;
        onStrokesChange((prev) => {
            const nextValue = typeof action === 'function' ? (action as (value: CanvasStroke[]) => CanvasStroke[])(prev) : action;

            if (nextValue === prev) {
                isInternalStrokeUpdate.current = false;
            }

            return nextValue;
        });
    };

    useEffect(() => {
        if (isInternalStrokeUpdate.current) {
            isInternalStrokeUpdate.current = false;
            return;
        }

        setRedoStack([]);
    }, [strokes]);

    useEffect(() => {
        if (!enabled) {
            setIsToolbarCollapsed(false);
            setIsColorPopoverOpen(false);
        }
    }, [enabled]);

    useEffect(() => {
        if (activeTool === 'eraser') {
            setIsColorPopoverOpen(false);
        }
    }, [activeTool]);

    useEffect(() => {
        let rafHandle: number | null = null;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

        if (enabled) {
            setIsToolbarRendered(true);
            rafHandle = requestAnimationFrame(() => {
                setIsToolbarVisible(true);
            });
        } else if (isToolbarRendered) {
            setIsToolbarVisible(false);
            timeoutHandle = setTimeout(() => {
                setIsToolbarRendered(false);
            }, 250);
        }

        return () => {
            if (rafHandle !== null) {
                cancelAnimationFrame(rafHandle);
            }
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        };
    }, [enabled, isToolbarRendered]);

    const appendPoint = (point: StrokePoint) => {
        commitStrokesChange((prev) => {
            if (!isDrawing.current || prev.length === 0) {
                return prev;
            }
            const updated = [...prev];
            const lastStroke = updated[updated.length - 1];
            updated[updated.length - 1] = {
                ...lastStroke,
                points: [...lastStroke.points, point],
            };
            return updated;
        });
    };

    const resolveStrokeConfig = () => {
        if (activeTool === 'highlighter') {
            return {
                tool: 'highlighter' as const,
                color: toolSettings.highlighter.color,
                width: toolSettings.highlighter.size,
                opacity: toolSettings.highlighter.opacity,
                compositeOperation: 'source-over' as const,
            };
        }

        if (activeTool === 'eraser') {
            return {
                tool: 'eraser' as const,
                color: '#000000',
                width: toolSettings.eraser.size,
                opacity: 1,
                compositeOperation: 'destination-out' as const,
            };
        }

        return {
            tool: 'pen' as const,
            color: toolSettings.pen.color,
            width: toolSettings.pen.size,
            opacity: 1,
            compositeOperation: 'source-over' as const,
        };
    };

    const getStagePointer = () => {
        const stage = stageRef.current;
        if (!stage) return null;
        return stage.getPointerPosition() ?? null;
    };

    const handlePointerDown = (event: KonvaEventObject<PointerEvent>) => {
        if (!enabled) return;
        const pointerPosition = getStagePointer();
        if (!pointerPosition) return;

        isDrawing.current = true;
        activePointerId.current = event.evt.pointerId ?? null;
        setRedoStack([]);
        const strokeConfig = resolveStrokeConfig();
        commitStrokesChange((prev) => [
            ...prev,
            {
                id: createStrokeId(),
                points: [{ x: pointerPosition.x, y: pointerPosition.y }],
                ...strokeConfig,
            },
        ]);
    };

    const handlePointerMove = (event: KonvaEventObject<PointerEvent>) => {
        if (!enabled || !isDrawing.current) return;
        if (activePointerId.current !== null && event.evt.pointerId !== activePointerId.current) return;

        const pointerPosition = getStagePointer();
        if (!pointerPosition) return;

        appendPoint({ x: pointerPosition.x, y: pointerPosition.y });
    };

    const endDrawing = () => {
        isDrawing.current = false;
        activePointerId.current = null;
    };

    const handlePointerUp = (event: KonvaEventObject<PointerEvent>) => {
        if (activePointerId.current !== null && event.evt.pointerId !== activePointerId.current) return;
        endDrawing();
    };

    const handlePointerLeave = () => {
        endDrawing();
    };

    const handleUndo = () => {
        if (strokes.length === 0) {
            return;
        }

        const removed = strokes[strokes.length - 1];
        const nextStrokes = strokes.slice(0, -1);

        commitStrokesChange(nextStrokes);
        if (removed) {
            setRedoStack((stack) => [...stack, removed]);
        }
    };

    const handleRedo = () => {
        if (redoStack.length === 0) {
            return;
        }

        const restored = redoStack[redoStack.length - 1];
        if (!restored) {
            return;
        }

        const nextRedo = redoStack.slice(0, -1);
        commitStrokesChange((strokesState) => [...strokesState, restored]);
        setRedoStack(nextRedo);
    };

    const handleClear = () => {
        commitStrokesChange(() => []);
        setRedoStack([]);
    };

    const currentSize =
        activeTool === 'pen'
            ? toolSettings.pen.size
            : activeTool === 'highlighter'
                ? toolSettings.highlighter.size
                : toolSettings.eraser.size;

    const handleSizeChange = (size: number) => {
        setToolSettings((prev) => {
            if (activeTool === 'pen') {
                return { ...prev, pen: { ...prev.pen, size } };
            }
            if (activeTool === 'highlighter') {
                return { ...prev, highlighter: { ...prev.highlighter, size } };
            }
            return { ...prev, eraser: { size } };
        });
    };

    const handleColorChange = (color: string) => {
        if (activeTool === 'eraser') return;
        setToolSettings((prev) => {
            if (activeTool === 'pen') {
                return { ...prev, pen: { ...prev.pen, color } };
            }
            return { ...prev, highlighter: { ...prev.highlighter, color } };
        });
    };

    const handleOpacityChange = (opacity: number) => {
        setToolSettings((prev) => ({
            ...prev,
            highlighter: { ...prev.highlighter, opacity },
        }));
    };

    if (!dimensions.width || !dimensions.height) {
        return null;
    }

    const displayColor =
        activeTool === 'highlighter'
            ? toolSettings.highlighter.color
            : toolSettings.pen.color;

    return (
    <div className="absolute inset-4 z-10">
            {(enabled || isToolbarRendered) && (
                <div
                    className={cn(
                        'pointer-events-auto absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-xl border border-border/60 bg-background/95 shadow-xl backdrop-blur-md transition-all duration-300 ease-out',
                        isToolbarCollapsed ? 'w-auto px-2 py-2' : 'w-[calc(100%-2rem)] max-w-2xl px-4 py-3',
                        isToolbarVisible
                            ? 'opacity-100 translate-y-0'
                            : 'pointer-events-none opacity-0 translate-y-6'
                    )}
                >
                    {isToolbarCollapsed ? (
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                size="icon"
                                variant="outline"
                                onClick={() => setIsToolbarCollapsed(false)}
                                aria-expanded={false}
                                aria-label="Expand drawing toolbar"
                                className="transition-transform duration-200 hover:scale-105"
                            >
                                <ChevronUp className="h-4 w-4" />
                            </Button>
                            <span className="hidden text-xs font-medium text-muted-foreground sm:inline">Drawing tools hidden</span>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-3 sm:gap-4">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Drawing tools</span>
                                <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setIsToolbarCollapsed(true)}
                                    aria-expanded={true}
                                    aria-label="Collapse drawing toolbar"
                                    className="h-8 w-8 text-muted-foreground transition-transform duration-200 hover:scale-105"
                                >
                                    <ChevronDown className="h-4 w-4" />
                                </Button>
                            </div>
                            <div className="flex flex-col gap-3 sm:gap-4 md:flex-row md:items-center md:justify-between">
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant={activeTool === 'pen' ? 'default' : 'outline'}
                                        onClick={() => setActiveTool('pen')}
                                        aria-pressed={activeTool === 'pen'}
                                        title="Pen"
                                        className="transition-transform duration-200 hover:scale-105"
                                    >
                                        <PenLine className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant={activeTool === 'highlighter' ? 'default' : 'outline'}
                                        onClick={() => setActiveTool('highlighter')}
                                        aria-pressed={activeTool === 'highlighter'}
                                        title="Highlighter"
                                        className="transition-transform duration-200 hover:scale-105"
                                    >
                                        <HighlighterIcon className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant={activeTool === 'eraser' ? 'default' : 'outline'}
                                        onClick={() => setActiveTool('eraser')}
                                        aria-pressed={activeTool === 'eraser'}
                                        title="Eraser"
                                        className="transition-transform duration-200 hover:scale-105"
                                    >
                                        <EraserIcon className="h-4 w-4" />
                                    </Button>
                                </div>
                                <div className="flex w-full flex-wrap gap-4">
                                    <div className="flex min-w-[220px] flex-col gap-3">
                                        <Label htmlFor="tool-color" className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                            Color
                                        </Label>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <Popover
                                                open={isColorPopoverOpen}
                                                onOpenChange={(nextOpen) => {
                                                    if (activeTool === 'eraser') return;
                                                    setIsColorPopoverOpen(nextOpen);
                                                }}
                                            >
                                                <PopoverTrigger asChild>
                                                    <button
                                                        type="button"
                                                        className={cn(
                                                            'relative flex h-10 w-10 items-center justify-center rounded-full border border-border shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                                            activeTool === 'eraser' ? 'cursor-not-allowed opacity-40' : null
                                                        )}
                                                        style={{ backgroundColor: displayColor }}
                                                        aria-label="Choose color"
                                                        disabled={activeTool === 'eraser'}
                                                    >
                                                        <Palette className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border border-border bg-background/90 p-0.5 text-muted-foreground" />
                                                    </button>
                                                </PopoverTrigger>
                                                <PopoverContent className="w-64 space-y-4" align="start">
                                                    <div className="space-y-2">
                                                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Presets</span>
                                                        <div className="grid grid-cols-4 gap-2">
                                                            {presetColors.map((hex) => (
                                                                <button
                                                                    key={hex}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        handleColorChange(hex);
                                                                        setIsColorPopoverOpen(false);
                                                                    }}
                                                                    className={cn(
                                                                        'h-8 w-8 rounded-full border border-border transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                                                                        displayColor === hex ? 'ring-2 ring-offset-1 ring-ring' : 'hover:scale-110 active:scale-95'
                                                                    )}
                                                                    style={{ backgroundColor: hex }}
                                                                    aria-label={`Select color ${hex}`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-2">
                                                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom</span>
                                                        <div className="flex items-center gap-3">
                                                            <button
                                                                type="button"
                                                                onClick={() => colorInputRef.current?.click()}
                                                                className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted shadow-sm transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                                                aria-label="Choose custom color"
                                                            >
                                                                <span className="h-5 w-5 rounded-full border border-border shadow-sm" style={{ backgroundColor: displayColor }} />
                                                            </button>
                                                            <span className="text-xs text-muted-foreground">{displayColor.toUpperCase()}</span>
                                                        </div>
                                                    </div>
                                                </PopoverContent>
                                            </Popover>
                                            <span className="text-xs font-medium text-muted-foreground">{displayColor.toUpperCase()}</span>
                                            <input
                                                id="tool-color"
                                                ref={colorInputRef}
                                                type="color"
                                                value={displayColor}
                                                onChange={(event) => {
                                                    handleColorChange(event.target.value);
                                                    setIsColorPopoverOpen(false);
                                                }}
                                                className="sr-only"
                                                aria-label="Stroke color"
                                                disabled={activeTool === 'eraser'}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex min-w-[200px] flex-1 flex-col gap-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="tool-size" className="text-xs font-medium">
                                                Size
                                            </Label>
                                            <span className="text-xs text-muted-foreground">{currentSize}px</span>
                                        </div>
                                        <Slider
                                            id="tool-size"
                                            className="w-full"
                                            min={activeTool === 'eraser' ? 12 : 1}
                                            max={activeTool === 'eraser' ? 64 : 24}
                                            step={activeTool === 'eraser' ? 2 : 1}
                                            value={[currentSize]}
                                            onValueChange={(value) => handleSizeChange(value[0] ?? currentSize)}
                                            aria-label="Stroke size"
                                        />
                                    </div>
                                    {activeTool === 'highlighter' ? (
                                        <div className="flex min-w-[180px] flex-1 flex-col gap-2">
                                            <div className="flex items-center justify-between">
                                                <Label htmlFor="highlight-opacity" className="text-xs font-medium">
                                                    Opacity
                                                </Label>
                                                <span className="text-xs text-muted-foreground">
                                                    {(toolSettings.highlighter.opacity * 100).toFixed(0)}%
                                                </span>
                                            </div>
                                            <Slider
                                                id="highlight-opacity"
                                                className="w-full"
                                                min={0.1}
                                                max={0.9}
                                                step={0.05}
                                                value={[toolSettings.highlighter.opacity]}
                                                onValueChange={(value) => handleOpacityChange(value[0] ?? toolSettings.highlighter.opacity)}
                                                aria-label="Highlighter opacity"
                                            />
                                        </div>
                                    ) : null}
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={handleUndo}
                                        disabled={strokes.length === 0}
                                        aria-label="Undo"
                                        className="transition-transform duration-200 hover:scale-105 disabled:cursor-not-allowed"
                                    >
                                        <Undo2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={handleRedo}
                                        disabled={redoStack.length === 0}
                                        aria-label="Redo"
                                        className="transition-transform duration-200 hover:scale-105 disabled:cursor-not-allowed"
                                    >
                                        <Redo2 className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="icon"
                                        onClick={handleClear}
                                        disabled={strokes.length === 0}
                                        aria-label="Clear drawing"
                                        className="transition-transform duration-200 hover:scale-105 disabled:cursor-not-allowed"
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
            <div
                className={cn('absolute inset-0', enabled ? 'pointer-events-auto' : 'pointer-events-none')}
            >
                <Stage
                    ref={stageRef}
                    width={dimensions.width}
                    height={dimensions.height}
                    listening={enabled}
                    style={{ touchAction: 'none' }}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerLeave}
                    onPointerLeave={handlePointerLeave}
                >
                    <Layer>
                        {strokes.map((stroke, index) => (
                            <Line
                                key={stroke.id ?? `stroke-${index}`}
                                points={stroke.points.flatMap((point) => [point.x, point.y])}
                                stroke={stroke.tool === 'eraser' ? '#ffffff' : stroke.color}
                                strokeWidth={stroke.width}
                                lineJoin="round"
                                lineCap="round"
                                opacity={stroke.opacity}
                                tension={0}
                                globalCompositeOperation={stroke.compositeOperation}
                            />
                        ))}
                    </Layer>
                </Stage>
            </div>
        </div>
    );
}
