"use client";

import SimulationBoxNode from '@/whiteboard/components/simulation-box-node';
import { useWhiteboardStore } from '@/whiteboard/context';
import type { InteractionMode } from '@/whiteboard/types';

interface WhiteboardSceneProps {
    mode: InteractionMode;
}

export default function WhiteboardScene({ mode }: WhiteboardSceneProps) {
    const {
        state: { orderedNodeIds, nodes, camera },
    } = useWhiteboardStore();

    if (orderedNodeIds.length === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none absolute inset-4 z-20">
            <div
                className="relative h-full w-full"
                style={{
                    transform: `translate(${camera.position.x}px, ${camera.position.y}px) scale(${camera.zoom})`,
                    transformOrigin: 'top left',
                }}
            >
                {orderedNodeIds.map((id) => {
                    const node = nodes[id];
                    if (!node) return null;
                    if (node.type === 'simulation-box') {
                        return <SimulationBoxNode key={id} node={node} mode={mode} camera={camera} />;
                    }
                    return null;
                })}
            </div>
        </div>
    );
}
