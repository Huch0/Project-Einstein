
'use client';

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
    const { setBackgroundImage } = useSimulation();

    const [mode, setMode] = useState<InteractionMode>(INITIAL_MODE);
    const [strokes, setStrokes] = useState<CanvasStroke[]>([]);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [objectPosition, setObjectPosition] = useState<SimulationObjectPosition>({ x: 0, y: 0 });

    const hasCanvasContent = strokes.length > 0;

    useEffect(() => {
        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries[0]) return;
            const { width, height } = entries[0].contentRect;
            setDimensions({ width, height });
        });

        const wrapper = wrapperRef.current;
        if (wrapper) {
            resizeObserver.observe(wrapper);
        }

        return () => {
            if (wrapper) {
                resizeObserver.unobserve(wrapper);
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
        <div ref={wrapperRef} className="relative h-full w-full p-4 md:p-6">
            <div className="absolute top-4 right-4 z-20 flex flex-wrap items-center justify-end gap-2">
                <div className="flex gap-1 rounded-md bg-background/80 p-1 shadow-sm">
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
                <Dialog>
                    <DialogTrigger asChild>
                        <Button type="button">
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
                                                        <Input id="diagram-file" type="file" accept="image/*" onChange={(e) => {
                                                            const file = e.target.files?.[0];
                                                            if (!file) return;
                                                            const reader = new FileReader();
                                                            reader.onload = ev => {
                                                                const dataUrl = ev.target?.result as string;
                                                                setBackgroundImage(dataUrl);
                                                            };
                                                            reader.readAsDataURL(file);
                                                        }} />
                        </div>
                        <Button type="submit" className="w-full" onClick={(e)=> e.preventDefault()}>
                            Set As Background
                        </Button>
                    </DialogContent>
                </Dialog>
            </div>

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
    );
}
