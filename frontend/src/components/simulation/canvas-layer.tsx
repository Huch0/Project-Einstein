import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';

export type CanvasStroke = {
    tool: 'pen';
    points: Array<{ x: number; y: number }>;
};

export type CanvasLayerProps = {
    strokes: CanvasStroke[];
    onStrokesChange: Dispatch<SetStateAction<CanvasStroke[]>>;
    enabled: boolean;
    dimensions: { width: number; height: number };
};

export function CanvasLayer({ strokes, onStrokesChange, enabled, dimensions }: CanvasLayerProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawing = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const { width, height } = dimensions;
        if (!width || !height) return;

        canvas.width = width;
        canvas.height = height;
    }, [dimensions]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#1d4ed8';
        context.lineWidth = 2;
        context.lineJoin = 'round';
        context.lineCap = 'round';

        strokes.forEach((stroke) => {
            if (stroke.points.length < 2) return;
            context.beginPath();
            stroke.points.forEach((point, index) => {
                if (index === 0) {
                    context.moveTo(point.x, point.y);
                } else {
                    context.lineTo(point.x, point.y);
                }
            });
            context.stroke();
        });
    }, [strokes, dimensions]);

    const getRelativePoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    };

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled) return;
        const point = getRelativePoint(event);
        isDrawing.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        onStrokesChange((prev) => [...prev, { tool: 'pen', points: [point] }]);
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!enabled || !isDrawing.current) return;
        const point = getRelativePoint(event);
        onStrokesChange((prevStrokes) => {
            if (prevStrokes.length === 0) return prevStrokes;
            const updated = [...prevStrokes];
            const lastStroke = updated[updated.length - 1];
            updated[updated.length - 1] = {
                ...lastStroke,
                points: [...lastStroke.points, point],
            };
            return updated;
        });
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDrawing.current) return;
        isDrawing.current = false;
        event.currentTarget.releasePointerCapture(event.pointerId);
    };

    const handlePointerLeave = () => {
        isDrawing.current = false;
    };

    return (
        <canvas
            ref={canvasRef}
            className="absolute inset-4 z-10 touch-none"
            style={{ pointerEvents: enabled ? 'auto' : 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerLeave}
        />
    );
}
