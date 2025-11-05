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
    const { frames, currentIndex, detections, imageSizePx, scale_m_per_px, scene, playing } = useSimulation();
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

    // Compute object-contain layout box for background image
    const rect = containerRef.current?.getBoundingClientRect();
    const containerW = rect?.width || dimensions.width;
    const containerH = rect?.height || dimensions.height;
    const imgW = imageSizePx?.width || containerW;
    const imgH = imageSizePx?.height || containerH;
    const s = Math.min(containerW / imgW, containerH / imgH);
    const renderW = imgW * s;
    const renderH = imgH * s;
    const offsetX = (containerW - renderW) / 2;
    const offsetY = (containerH - renderH) / 2;
    
    // Mapping: meters -> container pixels (image px/m * object-contain scale)
    const basePxPerMeter = (scale_m_per_px ? (1 / scale_m_per_px) : 100) * s;
    let containerPxPerMeter = basePxPerMeter;
    // World origin policy: anchor_centered (backend mapping.origin_mode) → center of image
    let originPxX = offsetX + renderW / 2;
    let originPxY = offsetY + renderH / 2;

    // Calibration: if we have detections and initial scene bodies, solve a best-fit affine mapping
    if (scene && detections.length > 0 && (scene as any).bodies?.length >= 1) {
        try {
            const bodiesInit: Record<string, [number, number]> = {};
            for (const b of (scene as any).bodies) {
                bodiesInit[b.id] = b.position_m as [number, number];
            }
            const getDetCenterPx = (id: string) => {
                const det = detections.find(d => d.id === id);
                if (!det) return null;
                const [bx, by, bw, bh] = det.bbox_px as [number, number, number, number];
                const cx = offsetX + (bx + bw / 2) * s;
                const cy = offsetY + (by + bh / 2) * s;
                return [cx, cy] as [number, number];
            };
            const ids = Object.keys(bodiesInit);
            const detA = getDetCenterPx('massA');
            const detB = getDetCenterPx('massB');
            
            if (detA) {
                // Pick nearest in x
                let nearest: string | null = null;
                let bestDx = Infinity;
                const bodyInitPxX = (bid: string) => offsetX + renderW / 2 + (bodiesInit[bid][0]) * basePxPerMeter;
                for (const bid of ids) {
                    const dx = Math.abs(bodyInitPxX(bid) - detA[0]);
                    if (dx < bestDx) { bestDx = dx; nearest = bid; }
                }
                const ref1Id = nearest ?? ids[0];
                const ref1Det = detA;
                const ref1M = bodiesInit[ref1Id];
                
                if (detB && ids.length >= 2) {
                    // Two-point alignment
                    const ref2Id = ids.find(id => id !== ref1Id) ?? ref1Id;
                    const ref2Det = detB;
                    const ref2M = bodiesInit[ref2Id];
                    const denomX = (ref2M[0] - ref1M[0]);
                    const denomY = (ref2M[1] - ref1M[1]);
                    const sx = Math.abs(denomX) > 1e-9 ? (ref2Det[0] - ref1Det[0]) / denomX : basePxPerMeter;
                    const sy = Math.abs(denomY) > 1e-9 ? (ref2Det[1] - ref1Det[1]) / denomY : basePxPerMeter;
                    const ox = ref1Det[0] - sx * ref1M[0];
                    const oy = ref1Det[1] - sy * ref1M[1];
                    const sCal = (isFinite(sx) && isFinite(sy) && sx > 0 && sy > 0) ? (0.5 * (sx + sy)) : basePxPerMeter;
                    
                    if (isFinite(sCal) && sCal > 1e-6) {
                        containerPxPerMeter = sCal;
                        originPxX = ox;
                        originPxY = oy;
                    }
                } else {
                    // One-point alignment
                    originPxX = ref1Det[0] - ref1M[0] * containerPxPerMeter;
                    originPxY = ref1Det[1] - ref1M[1] * containerPxPerMeter;
                }
            }
        } catch (err) {
            console.error('[Calibration] error:', err);
        }
    }

    const bodyPoints = useMemo<Array<{ id: string; x: number; y: number }>>(() => {
        const frame = currentFrame as any;
        if (!frame) return [];

        if (Array.isArray(frame.bodies) && frame.bodies.length > 0) {
            return frame.bodies
                .filter((body: any) => Array.isArray(body?.position_m))
                .map((body: any) => {
                    const [x_m, y_m] = body.position_m as [number, number];
                    return {
                        id: body.id ?? 'body',
                        x: originPxX + x_m * containerPxPerMeter,
                        y: originPxY + y_m * containerPxPerMeter,
                    };
                });
        }

        if (frame.positions && typeof frame.positions === 'object') {
            return Object.entries(frame.positions).map(([id, pos]) => {
                const [x_m, y_m] = pos as [number, number];
                return {
                    id,
                    x: originPxX + x_m * containerPxPerMeter,
                    y: originPxY + y_m * containerPxPerMeter,
                };
            });
        }

        return [];
    }, [currentFrame, containerPxPerMeter, originPxX, originPxY]);

    return (
        <div
            ref={containerRef}
            className="absolute inset-4 rounded-md bg-primary/5 overflow-hidden relative"
            style={{ pointerEvents: enabled ? 'auto' : 'none' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        >
            <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-muted/40 pointer-events-none" />

            {imageSizePx && detections.length > 0 && !playing && (
                <DetectionOverlay
                    containerRef={containerRef}
                    imageSize={imageSizePx}
                    boxes={detections.map((d) => ({
                        id: d.id,
                        label: d.label,
                        bbox: d.bbox_px,
                        polygon_px: d.polygon_px,
                    }))}
                    containerSize={dimensions}
                />
            )}

            {bodyPoints.length === 0 && !playing ? (
                <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground pointer-events-none">
                    Simulation frames will appear here once available.
                </div>
            ) : null}

            {bodyPoints.map(({ id, x, y }) => (
                <div
                    key={`${id}-${x}-${y}`}
                    className="absolute flex flex-col items-center gap-1 text-[10px] font-semibold text-muted-foreground pointer-events-none"
                    style={{ transform: `translate(${x - 8}px, ${y - 8}px)` }}
                >
                    <div className="h-4 w-4 rounded-full bg-primary shadow-md shadow-primary/40" />
                    <span className="px-1 py-0.5 rounded bg-background/80 backdrop-blur-sm">{id}</span>
                </div>
            ))}
        </div>
    );
}

type OverlayBox = { 
    id: string; 
    label: string; 
    bbox: [number, number, number, number]; 
    polygon_px?: Array<[number, number]>;
};

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
                        
                        // If polygon available, render as SVG path instead of rect
                        if (b.polygon_px && b.polygon_px.length > 0) {
                            const points = b.polygon_px.map(([px, py]) => {
                                const sx = dims.offsetX + px * dims.scale;
                                const sy = dims.offsetY + py * dims.scale;
                                return `${sx},${sy}`;
                            }).join(' ');
                            
                            return (
                                <div key={b.id} style={{ position: 'absolute', inset: 0 }}>
                                    <svg className="absolute inset-0 w-full h-full overflow-visible">
                                        <polygon
                                            points={points}
                                            fill="none"
                                            stroke="rgb(52, 211, 153)"
                                            strokeWidth="2"
                                            opacity="0.8"
                                        />
                                    </svg>
                                    <div 
                                        className="absolute px-1 py-0.5 text-[10px] leading-none rounded bg-emerald-500 text-white shadow"
                                        style={{ left, top: top - 16 }}
                                    >
                                        {b.label}
                                    </div>
                                </div>
                            );
                        }
                        
                        // Fallback to bbox rect
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
