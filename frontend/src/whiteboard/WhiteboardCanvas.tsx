"use client";

import { useCallback } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { CanvasLayer } from '@/components/simulation/canvas-layer';

import { useWhiteboardStore } from './context';
import type { CameraState, InteractionMode } from './types';
import WhiteboardScene from './WhiteboardScene';

interface WhiteboardCanvasProps {
    mode: InteractionMode;
    dimensions: { width: number; height: number };
}

export default function WhiteboardCanvas({ mode, dimensions }: WhiteboardCanvasProps) {
    const {
        state: { camera },
        setCamera,
        setSelection,
    } = useWhiteboardStore();

    const handleCameraChange = useCallback(
        (next: CameraState) => {
            setCamera({ position: next.position, zoom: next.zoom });
        },
        [setCamera]
    );

    const handlePointerDownCapture = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }
            if (target.closest('[data-whiteboard-node="true"], [data-node-action="true"]')) {
                return;
            }
            setSelection([]);
        },
        [setSelection]
    );

    return (
        <div className="relative h-full w-full" onPointerDownCapture={handlePointerDownCapture}>
            <CanvasLayer mode={mode} dimensions={dimensions} camera={camera} onCameraChange={handleCameraChange} />
            <WhiteboardScene mode={mode} />
        </div>
    );
}
