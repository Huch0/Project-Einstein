import { useEffect, useRef } from 'react';
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
    const { frames, currentIndex, backgroundImage } = useSimulation();
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
                {/* Background diagram placeholder (test1.jpg) if present in /public */}
                                {backgroundImage ? (
                                    <div
                                        className="absolute inset-0 opacity-25 bg-center bg-contain bg-no-repeat pointer-events-none"
                                        style={{ backgroundImage: `url(${backgroundImage})` }}
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground font-mono pointer-events-none select-none">
                                        Upload a diagram to use it as a background
                                    </div>
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
