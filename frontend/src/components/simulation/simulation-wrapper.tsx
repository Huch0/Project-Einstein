
"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSimulation } from '@/simulation/SimulationContext';
import { UploadCloud, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { CanvasLayer, type CanvasStroke } from './canvas-layer';
import {
    SimulationLayer,
    type SimulationObjectPosition,
} from './simulation-layer';

type InteractionMode = 'simulation' | 'draw';

const INITIAL_MODE: InteractionMode = 'simulation';

export default function SimulationCanvasStack() {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const { setBackgroundImage, parseAndBind } = useSimulation();

    const [mode, setMode] = useState<InteractionMode>(INITIAL_MODE);
    const [strokes, setStrokes] = useState<CanvasStroke[]>([]);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [objectPosition, setObjectPosition] = useState<SimulationObjectPosition>({ x: 0, y: 0 });
    const [open, setOpen] = useState(false);

    const hasCanvasContent = strokes.length > 0;

    useEffect(() => {
        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries[0]) return;
            const { width, height } = entries[0].contentRect;
            setDimensions({ width, height });
        });

        const content = contentRef.current;
        if (content) {
            resizeObserver.observe(content);
        }

        return () => {
            if (content) {
                resizeObserver.unobserve(content);
            }
        };
    }, []);
    const handleObjectPositionChange = useCallback((position: SimulationObjectPosition) => {
        setObjectPosition(position);
    }, []);

    const handleClear = () => {
        setStrokes([]);
    };

    return (
        <div ref={wrapperRef} className="flex h-full w-full flex-col p-2 md:p-4 gap-2">
            {/* Top bezel toolbar */}
            <div className="flex items-center justify-between rounded-md border bg-background/80 px-2 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/60">
                <div className="flex gap-1">
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'simulation' ? 'default' : 'outline'}
                        onClick={() => setMode('simulation')}
                        aria-pressed={mode === 'simulation'}
                    >
                        Simulation Mode
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'draw' ? 'default' : 'outline'}
                        onClick={() => setMode('draw')}
                        aria-pressed={mode === 'draw'}
                    >
                        Draw Mode
                    </Button>
                </div>
                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleClear}
                        disabled={!hasCanvasContent}
                        aria-label="Clear drawing"
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    <Dialog open={open} onOpenChange={setOpen}>
                        <DialogTrigger asChild>
                            <Button type="button" onClick={() => setOpen(true)}>
                                <UploadCloud className="mr-2 h-4 w-4" />
                                Upload Diagram
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                                <DialogTitle>Upload Physics Diagram</DialogTitle>
                                <DialogDescription>
                                    Upload an image or PDF of a physics diagram to convert it into a simulation.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid flex-1 gap-2">
                                <Label htmlFor="diagram-file" className="sr-only">
                                    Diagram File
                                </Label>
                                <Input id="diagram-file" type="file" accept="image/*" onChange={async (e) => {
                                    const file = e.target.files?.[0];
                                    if (!file) return;
                                    
                                    // Load image as data URL first (ensure it's loaded before parse)
                                    const dataUrl = await new Promise<string>((resolve, reject) => {
                                        const reader = new FileReader();
                                        reader.onload = ev => resolve(ev.target?.result as string);
                                        reader.onerror = reject;
                                        reader.readAsDataURL(file);
                                    });
                                    
                                    setBackgroundImage(dataUrl);
                                    
                                    // Now trigger backend parse (+simulate=1 via SimulationContext)
                                    try {
                                        await parseAndBind(file);
                                    } catch (err) {
                                        // eslint-disable-next-line no-console
                                        console.error('Parse failed', err);
                                    }
                                }} />
                            </div>
                            <Button type="button" className="w-full" onClick={() => setOpen(false)}>
                                Set As Background
                            </Button>
                        </DialogContent>
                    </Dialog>
                </div>
            </div>
            {/* Content area (no overlap with toolbar) */}
            <div ref={contentRef} className="relative flex-1 min-h-0">
                <SimulationLayer
                    enabled={mode === 'simulation'}
                    objectPosition={objectPosition}
                    onObjectPositionChange={handleObjectPositionChange}
                    dimensions={dimensions}
                />

                <CanvasLayer
                    enabled={mode === 'draw'}
                    strokes={strokes}
                    onStrokesChange={setStrokes}
                    dimensions={dimensions}
                />
            </div>
        </div>
    );
}
