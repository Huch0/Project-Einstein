"use client";

import { useEffect, useRef, useState } from 'react';
import { Hand, UploadCloud, FlaskConical } from 'lucide-react';

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

import { WhiteboardProvider, useWhiteboardStore } from '@/whiteboard/context';
import WhiteboardCanvas from '@/whiteboard/WhiteboardCanvas';
import type { InteractionMode } from '@/whiteboard/types';
import { cn } from '@/lib/utils';
import { calculateImageNodeBounds } from '@/whiteboard/utils';
import { 
    SAMPLE_PULLEY_IMAGE, 
    SAMPLE_IMAGE_SIZE,
    createTestSimulationPayload 
} from '@/lib/test-fixtures';
import { useSimulation } from '@/simulation/SimulationContext';

const INITIAL_MODE: InteractionMode = 'simulation';

interface SimulationCanvasStackProps {
    className?: string;
}

export default function SimulationCanvasStack({ className }: SimulationCanvasStackProps = {}) {
    return (
        <WhiteboardProvider>
            <SimulationCanvasInner className={className} />
        </WhiteboardProvider>
    );
}

function SimulationCanvasInner({ className }: SimulationCanvasStackProps) {
    const wrapperRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const [mode, setMode] = useState<InteractionMode>(INITIAL_MODE);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [open, setOpen] = useState(false);
    const { strokeNodes, clearStrokes, createImageBox, createSimulationBox, setSelection } = useWhiteboardStore();
    const { loadSimulationRun } = useSimulation();

    const hasCanvasContent = strokeNodes.length > 0;

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
    const handleClear = () => {
        clearStrokes();
    };

    const handleImageSelection = (file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            const image = new Image();
            image.onload = () => {
                const bounds = calculateImageNodeBounds(image.naturalWidth, image.naturalHeight);
                const totalWidth = bounds.width;
                const totalHeight = bounds.height;
                const defaultX = dimensions.width > 0 ? Math.max(0, (dimensions.width - totalWidth) / 2) : 160;
                const defaultY = dimensions.height > 0 ? Math.max(0, (dimensions.height - totalHeight) / 2) : 120;
                const nodeId = createImageBox({
                    source: { kind: 'upload', uri: dataUrl },
                    originalSize: { width: image.naturalWidth, height: image.naturalHeight },
                    initial: {
                        bounds,
                        transform: { x: defaultX, y: defaultY, scaleX: 1, scaleY: 1, rotation: 0 },
                    },
                });
                setSelection([nodeId]);
            };
            image.src = dataUrl;
        };
        reader.readAsDataURL(file);
    };

    const handleAddImageClick = () => {
        imageInputRef.current?.click();
    };

    const handleAddTestSimulation = async () => {
        console.log('[SimulationWrapper] Adding test simulation...');
        
        // Calculate positions for side-by-side layout
        const imageWidth = 400;
        const imageHeight = 300;
        const simWidth = 600;
        const simHeight = 400;
        const gap = 40;
        
        const totalWidth = imageWidth + gap + simWidth;
        const startX = dimensions.width > 0 ? Math.max(40, (dimensions.width - totalWidth) / 2) : 80;
        const imageY = dimensions.height > 0 ? Math.max(40, (dimensions.height - imageHeight) / 2) : 100;
        const simY = dimensions.height > 0 ? Math.max(40, (dimensions.height - simHeight) / 2) : 100;
        
        // Create image box (left side)
        const imageNodeId = createImageBox({
            source: { kind: 'upload', uri: SAMPLE_PULLEY_IMAGE },
            originalSize: { width: SAMPLE_IMAGE_SIZE.width, height: SAMPLE_IMAGE_SIZE.height },
            initial: {
                bounds: { width: imageWidth, height: imageHeight },
                transform: { x: startX, y: imageY, scaleX: 1, scaleY: 1, rotation: 0 },
            },
        });
        
        console.log('[SimulationWrapper] Image box created:', imageNodeId);
        
        // Create simulation box (right side)
        const simNodeId = createSimulationBox({
            bounds: { width: simWidth, height: simHeight },
            transform: { x: startX + imageWidth + gap, y: simY, scaleX: 1, scaleY: 1, rotation: 0 },
            name: 'Test Atwood Machine',
        });
        
        console.log('[SimulationWrapper] Simulation box created:', simNodeId);
        
        // Load test simulation data into global simulation context
        try {
            const testPayload = createTestSimulationPayload();
            await loadSimulationRun(testPayload);
            console.log('[SimulationWrapper] Test simulation loaded successfully');
        } catch (error) {
            console.error('[SimulationWrapper] Failed to load test simulation:', error);
        }
        
        // Select both boxes
        setSelection([imageNodeId, simNodeId]);
    };

    return (
        <div
            ref={wrapperRef}
            className={cn('flex h-full w-full flex-col', className)}
        >
            {/* Top bezel toolbar */}
            <div className="flex items-center justify-between rounded-none border-b bg-background/80 px-2 py-2 shadow-none backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
                <div className="flex gap-1">
                    <Button
                        type="button"
                        size="sm"
                        variant={mode === 'pan' ? 'default' : 'outline'}
                        onClick={() => setMode('pan')}
                        aria-pressed={mode === 'pan'}
                    >
                        <Hand className="mr-2 h-4 w-4" />
                        Pan Mode
                    </Button>
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
                        size="sm"
                        onClick={handleAddTestSimulation}
                        className="border-dashed"
                    >
                        <FlaskConical className="mr-2 h-4 w-4" />
                        Add Test Simulation
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddImageClick}
                    >
                        <UploadCloud className="mr-2 h-4 w-4" />
                        Add Image
                    </Button>
                    <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (!file) return;
                            handleImageSelection(file);
                            event.target.value = '';
                        }}
                    />
                </div>
            </div>
            {/* Content area (no overlap with toolbar) */}
            <div ref={contentRef} className="relative flex-1 min-h-0">
                <WhiteboardCanvas mode={mode} dimensions={dimensions} />
            </div>
        </div>
    );
}
