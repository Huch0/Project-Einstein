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
    const { frames, currentIndex, backgroundImage, detections, imageSizePx, scale_m_per_px, scene, playing } = useSimulation();
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

                        {/* Detection overlay (show only when not playing to avoid conflicting visuals) */}
                        {backgroundImage && imageSizePx && detections.length > 0 && !playing && (
                            <DetectionOverlay
                                containerRef={containerRef}
                                imageSize={imageSizePx}
                                boxes={detections.map(d => ({ 
                                    id: d.id, 
                                    label: d.label, 
                                    bbox: d.bbox_px,
                                    polygon_px: d.polygon_px  // pass polygon from SAM
                                }))}
                                containerSize={dimensions}
                            />
                        )}
                {/* Bodies rendering (debug) - hide when background + detections are present to avoid confusion */}
                {backgroundImage && detections.length > 0 ? null : currentFrame && (currentFrame as any).bodies && (currentFrame as any).bodies.map((b: any) => {
                    // Convert (x_m,y_m) meters (y down positive) → pixels in render box
                    const x_m = b.position_m[0];
                    const y_m = b.position_m[1];
                    const x = originPxX + x_m * containerPxPerMeter;
                    const y = originPxY + y_m * containerPxPerMeter;
                    return (
                        <div
                            key={b.id}
                            className="absolute flex items-center justify-center rounded-md bg-blue-500/80 text-white text-xs font-mono"
                            style={{ width: 24, height: 24, transform: `translate(${x - 12}px, ${y - 12}px)` }}
                        >
                            {b.id}
                        </div>
                    );
                })}
                {/* If frames come straight from backend meta.simulation.frames with positions dict, render simple dots (debug) */}
                                {backgroundImage && detections.length > 0 ? null : currentFrame && !(currentFrame as any).bodies && (currentFrame as any).positions && Object.entries((currentFrame as any).positions).map(([id, pos]) => {
                    const [x_m, y_m] = pos as [number, number];
                                        const x = originPxX + x_m * containerPxPerMeter;
                                        const y = originPxY + y_m * containerPxPerMeter;
                    return (
                        <div key={id} className="absolute rounded-full bg-amber-500/80" style={{ width: 12, height: 12, transform: `translate(${x - 6}px, ${y - 6}px)` }} />
                    );
                })}

                                {/* Moving SAM boxes for masses (align detection rectangles to body motion) */}
                                {scene && currentFrame && backgroundImage && imageSizePx && detections.length > 0 && (
                                    (() => {
                                        // Build lookup for initial scene positions
                                        const initialPos: Record<string, [number, number]> = {};
                                        for (const b of (scene as any).bodies || []) {
                                            initialPos[b.id] = b.position_m as [number, number];
                                        }
                                        const frameBodies: Record<string, [number, number]> = {};
                                        // Check positions first (Rapier format), then bodies (legacy format)
                                        if ((currentFrame as any).positions) {
                                            Object.assign(frameBodies, (currentFrame as any).positions);
                                        } else if ((currentFrame as any).bodies) {
                                            for (const b of (currentFrame as any).bodies) {
                                                frameBodies[b.id] = b.position_m as [number, number];
                                            }
                                        }
                                         const elems: JSX.Element[] = [];
                                         const dims = { s, offsetX, offsetY };

                                         // Compute dynamic mapping from detection ids to body ids by nearest initial x
                                         const detCentersPx: Record<string, number> = {};
                                         const getDet = (id: string) => detections.find(d => d.id === id);
                                         const detA = getDet('massA');
                                         const detB = getDet('massB');
                                         if (detA) detCentersPx['massA'] = offsetX + (detA.bbox_px[0] + detA.bbox_px[2] / 2) * s;
                                         if (detB) detCentersPx['massB'] = offsetX + (detB.bbox_px[0] + detB.bbox_px[2] / 2) * s;
                                         const bodyInitPxX: Record<string, number> = {};
                                         for (const id of Object.keys(initialPos)) {
                                             const [ix, iy] = initialPos[id];
                                             bodyInitPxX[id] = originPxX + ix * containerPxPerMeter;
                                         }
                                         const bodyForDet = (detId: 'massA' | 'massB'): string | null => {
                                             const cx = detCentersPx[detId];
                                             if (cx == null) return null;
                                             // among known bodies, pick closest in x
                                             const ids = Object.keys(bodyInitPxX);
                                             if (ids.length === 0) return null;
                                             let best: string | null = null;
                                             let bestDx = Infinity;
                                             for (const bid of ids) {
                                                 const dx = Math.abs(bodyInitPxX[bid] - cx);
                                                 if (dx < bestDx) { bestDx = dx; best = bid; }
                                             }
                                             return best;
                                         };

                                         const mapA = bodyForDet('massA') || 'm1';
                                         const mapB = bodyForDet('massB') || (mapA === 'm1' ? 'm2' : 'm1');
                                         console.log('[Frame render] detections→body mapping:', { massA: mapA, massB: mapB });
                                         console.log('[Frame render] initialPos:', initialPos, 'frameBodies:', frameBodies);
                                         console.log('[Frame render] currentIndex:', currentIndex, 'frames.length:', frames.length);
                                         if (currentIndex < frames.length) {
                                             const frame = frames[currentIndex];
                                             console.log('[Frame render] frames[currentIndex]:', frame);
                                             console.log('[Frame render] frame.positions:', (frame as any).positions);
                                             console.log('[Frame render] frame.bodies:', (frame as any).bodies);
                                             if ((frame as any).bodies && (frame as any).bodies.length > 0) {
                                                 console.log('[Frame render] frame.bodies[0]:', (frame as any).bodies[0]);
                                                 console.log('[Frame render] frame.bodies[1]:', (frame as any).bodies[1]);
                                             }
                                         }

                                                      const moveRect = (detId: string, bodyId: string) => {
                                            const det = detections.find(d => d.id === detId);
                                            if (!det) return;
                                            const init = initialPos[bodyId];
                                            const cur = frameBodies[bodyId];
                                            if (!init || !cur) {
                                                console.warn(`[moveRect] missing data for ${detId}→${bodyId}, init:`, init, 'cur:', cur);
                                                return;
                                            }
                                                        const [bx, by, bw, bh] = det.bbox_px;
                                                        // Delta-based movement: start exactly at detection bbox and apply world delta (calibrated scale)
                                                        const dx_m = cur[0] - init[0];
                                                        const dy_m = cur[1] - init[1];
                                                        const dx = dx_m * containerPxPerMeter;
                                                        const dy = dy_m * containerPxPerMeter;
                                                        
                                                        console.log(`[moveRect] ${detId}→${bodyId}: bbox=[${bx},${by},${bw},${bh}], init_m=[${init}], cur_m=[${cur}], Δm=[${dx_m.toFixed(3)},${dy_m.toFixed(3)}], Δpx=[${dx.toFixed(1)},${dy.toFixed(1)}]`);
                                                        
                                                        // Render moving polygon if available, otherwise fallback to bbox
                                                        if (det.polygon_px && det.polygon_px.length > 0) {
                                                            // SVG polygon rendering with transform for movement
                                                            const points = det.polygon_px.map(([px, py]) => {
                                                                const sx = dims.offsetX + px * s + dx;
                                                                const sy = dims.offsetY + py * s + dy;
                                                                return `${sx},${sy}`;
                                                            }).join(' ');
                                                            
                                                            elems.push(
                                                                <svg
                                                                    key={`mov-${detId}`}
                                                                    className="absolute inset-0 pointer-events-none"
                                                                    style={{ zIndex: 2 }}
                                                                >
                                                                    <polygon
                                                                        points={points}
                                                                        fill="rgba(34, 211, 238, 0.3)"
                                                                        stroke="rgb(34, 211, 238)"
                                                                        strokeWidth="2"
                                                                    />
                                                                </svg>
                                                            );
                                                        } else {
                                                            // Fallback to bbox rendering with background sprite
                                                            const patchW = bw * s;
                                                            const patchH = bh * s;
                                                            const left = dims.offsetX + bx * s + dx;
                                                            const top = dims.offsetY + by * s + dy;
                                                            const width = patchW;
                                                            const height = patchH;
                                                            const bgSize = `${renderW}px ${renderH}px`;
                                                            const bgPos = `${-(offsetX + bx * s)}px ${-(offsetY + by * s)}px`;
                                                            elems.push(
                                                                <div
                                                                    key={`mov-${detId}`}
                                                                    style={{
                                                                        position: 'absolute',
                                                                        left,
                                                                        top,
                                                                        width,
                                                                        height,
                                                                        backgroundImage: `url(${backgroundImage})`,
                                                                        backgroundSize: bgSize,
                                                                        backgroundPosition: bgPos,
                                                                        backgroundRepeat: 'no-repeat',
                                                                        border: '2px solid rgba(34,211,238,0.9)',
                                                                        borderRadius: 4,
                                                                        pointerEvents: 'none',
                                                                        zIndex: 2,
                                                                    }}
                                                                />
                                                            );
                                                        }
                                        };
                                        moveRect('massA', mapA);
                                        moveRect('massB', mapB);
                                        return <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 2 }}>{elems}</div>;
                                    })()
                                )}
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
