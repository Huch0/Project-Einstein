import { useEffect, useMemo, useRef } from 'react';
import { useSimulation } from '@/simulation/SimulationContext';

export type SimulationObjectPosition = { x: number; y: number };

export type SimulationLayerProps = {
    objectPosition: SimulationObjectPosition;
    onObjectPositionChange: (position: SimulationObjectPosition) => void;
    enabled: boolean;
    dimensions: { width: number; height: number };
};

export function SimulationLayer({
    objectPosition,
    onObjectPositionChange,
    enabled,
    dimensions,
}: SimulationLayerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const { frames, currentIndex, backgroundImage, detections, imageSizePx } = useSimulation();
    const currentFrame = frames[currentIndex];

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

        // Basic 2D mapping: physical coordinates (meters) -> pixels.
        const scale = 120; // px per meter (temporary constant)
        const originY = (dimensions.height - 32) / 2; // vertical center offset

        return (
                    <div
                        ref={containerRef}
                        className="absolute inset-4 rounded-md bg-primary/5 overflow-hidden"
                        style={{ pointerEvents: enabled ? 'auto' : 'none' }}
                    >
                        {/* Background diagram rendering */}
                        {backgroundImage ? (
                            <img src={backgroundImage} alt="diagram" className="absolute inset-0 w-full h-full object-contain select-none pointer-events-none" />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground font-mono pointer-events-none select-none">
                                Upload a diagram to use it as a background
                            </div>
                        )}

                        {/* Detection overlay */}
                                                {backgroundImage && imageSizePx && detections.length > 0 && (
                                                    <DetectionOverlay containerRef={containerRef} imageSize={imageSizePx} boxes={detections.map(d => ({ id: d.id, label: d.label, bbox: d.bbox_px }))} containerSize={dimensions} />
                        )}
                {/* Bodies rendering */}
                {currentFrame && currentFrame.bodies.map(b => {
                    // Interpret: m1 horizontal positive x to the right, m2 vertical downward positive y (we stored m2 position as [0,-s])
                    const [x, y] = b.id === 'm1'
                        ? [b.position_m[0] * scale + 40, originY]
                        : [dimensions.width / 2 + 120, originY + (-b.position_m[1]) * scale - 60];
                    return (
                        <div
                            key={b.id}
                            className="absolute flex items-center justify-center rounded-md bg-blue-500/80 text-white text-xs font-mono"
                            style={{ width: 40, height: 40, transform: `translate(${x}px, ${y}px)` }}
                        >
                            {b.id}
                        </div>
                    );
                })}
            </div>
        );
}

type OverlayBox = { id: string; label: string; bbox: [number, number, number, number] };

function DetectionOverlay({ containerRef, imageSize, boxes, containerSize }: { containerRef: React.RefObject<HTMLDivElement>; imageSize: { width: number; height: number }; boxes: OverlayBox[]; containerSize: { width: number; height: number } }) {
    // Compute object-contain letterboxing mapping
    const dims = useMemo(() => {
        const el = containerRef.current;
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const containerW = rect.width;
        const containerH = rect.height;
        const imgW = imageSize.width;
        const imgH = imageSize.height;
        const scale = Math.min(containerW / imgW, containerH / imgH);
        const renderW = imgW * scale;
        const renderH = imgH * scale;
        const offsetX = (containerW - renderW) / 2;
        const offsetY = (containerH - renderH) / 2;
        return { scale, offsetX, offsetY };
        }, [containerRef, imageSize.width, imageSize.height, containerSize.width, containerSize.height]);

    if (!dims) return null;
    return (
        <div className="absolute inset-0 pointer-events-none">
                    {boxes.map(b => {
                        const [x, y, w, h] = b.bbox;
                        const left = dims.offsetX + x * dims.scale;
                        const top = dims.offsetY + y * dims.scale;
                        const width = w * dims.scale;
                        const height = h * dims.scale;
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
