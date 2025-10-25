"use client";

import { createContext, useContext, useMemo, useReducer } from 'react';

import {
    IDENTITY_TRANSFORM,
    createIsoTimestamp,
    isStrokeNode,
    type CameraState,
    type NodeId,
    type SimulationBoxNode,
    type StrokeNode,
    type WhiteboardNode,
    type WhiteboardState,
} from './types';

type WhiteboardAction =
    | { type: 'add-node'; node: WhiteboardNode }
    | { type: 'update-node'; id: NodeId; updater: (node: WhiteboardNode) => WhiteboardNode }
    | { type: 'remove-node'; id: NodeId }
    | { type: 'remove-nodes-by-type'; nodeType: WhiteboardNode['type'] }
    | { type: 'set-selection'; selection: NodeId[] }
    | { type: 'set-camera'; camera: Partial<CameraState> };

const initialState: WhiteboardState = {
    id: 'whiteboard-0',
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    nodes: {},
    orderedNodeIds: [],
    selection: [],
    createdAt: createIsoTimestamp(),
    updatedAt: createIsoTimestamp(),
};

function withUpdatedTimestamp(state: WhiteboardState): WhiteboardState {
    return { ...state, updatedAt: createIsoTimestamp() };
}

function whiteboardReducer(state: WhiteboardState, action: WhiteboardAction): WhiteboardState {
    switch (action.type) {
        case 'add-node': {
            const { node } = action;
            if (state.nodes[node.id]) {
                return state;
            }
            const nextIndex = state.orderedNodeIds.length;
            const nodeWithOrder: WhiteboardNode = { ...node, zIndex: nextIndex };
            return withUpdatedTimestamp({
                ...state,
                nodes: { ...state.nodes, [node.id]: nodeWithOrder },
                orderedNodeIds: [...state.orderedNodeIds, node.id],
            });
        }
        case 'update-node': {
            const current = state.nodes[action.id];
            if (!current) return state;
            const updatedNode = action.updater(current);
            return withUpdatedTimestamp({
                ...state,
                nodes: { ...state.nodes, [action.id]: updatedNode },
            });
        }
        case 'remove-node': {
            if (!state.nodes[action.id]) return state;
            const { [action.id]: _removed, ...rest } = state.nodes;
            return withUpdatedTimestamp({
                ...state,
                nodes: rest,
                orderedNodeIds: state.orderedNodeIds.filter((id) => id !== action.id),
                selection: state.selection.filter((id) => id !== action.id),
            });
        }
        case 'remove-nodes-by-type': {
            const remainingNodes: Record<NodeId, WhiteboardNode> = {};
            const remainingIds: NodeId[] = [];
            for (const id of state.orderedNodeIds) {
                const node = state.nodes[id];
                if (!node || node.type === action.nodeType) continue;
                remainingNodes[id] = node;
                remainingIds.push(id);
            }
            const remainingSelection = state.selection.filter((id) => {
                const node = state.nodes[id];
                return node?.type !== action.nodeType;
            });
            return withUpdatedTimestamp({
                ...state,
                nodes: remainingNodes,
                orderedNodeIds: remainingIds,
                selection: remainingSelection,
            });
        }
        case 'set-selection': {
            return withUpdatedTimestamp({
                ...state,
                selection: action.selection,
            });
        }
        case 'set-camera': {
            return withUpdatedTimestamp({
                ...state,
                camera: {
                    position: action.camera.position ?? state.camera.position,
                    zoom: action.camera.zoom ?? state.camera.zoom,
                },
            });
        }
        default:
            return state;
    }
}

const createNodeId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `node-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

export interface WhiteboardStoreValue {
    state: WhiteboardState;
    strokeNodes: StrokeNode[];
    addNode: (node: WhiteboardNode) => void;
    updateNode: (id: NodeId, updater: (node: WhiteboardNode) => WhiteboardNode) => void;
    removeNode: (id: NodeId) => void;
    clearStrokes: () => void;
    setSelection: (selection: NodeId[]) => void;
    setCamera: (camera: Partial<CameraState>) => void;
    createSimulationBox: (initial?: Partial<Pick<SimulationBoxNode, 'transform' | 'bounds'>>) => NodeId;
}

const WhiteboardContext = createContext<WhiteboardStoreValue | null>(null);

export function WhiteboardProvider({ children }: { children: React.ReactNode }) {
    const [state, dispatch] = useReducer(whiteboardReducer, initialState);

    const strokeNodes = useMemo(() => {
        return state.orderedNodeIds
            .map((id) => state.nodes[id])
            .filter((node): node is StrokeNode => isStrokeNode(node));
    }, [state.nodes, state.orderedNodeIds]);

    const value = useMemo<WhiteboardStoreValue>(() => {
        return {
            state,
            strokeNodes,
            addNode: (node) => dispatch({ type: 'add-node', node }),
            updateNode: (id, updater) => dispatch({ type: 'update-node', id, updater }),
            removeNode: (id) => dispatch({ type: 'remove-node', id }),
            clearStrokes: () => dispatch({ type: 'remove-nodes-by-type', nodeType: 'stroke' }),
            setSelection: (selection) => dispatch({ type: 'set-selection', selection }),
            setCamera: (camera) => dispatch({ type: 'set-camera', camera }),
            createSimulationBox: (initial) => {
                const id = createNodeId();
                const node = createSimulationBoxNode({ id, initial });
                dispatch({ type: 'add-node', node });
                return id;
            },
        };
    }, [state, strokeNodes]);

    return <WhiteboardContext.Provider value={value}>{children}</WhiteboardContext.Provider>;
}

export function useWhiteboardStore(): WhiteboardStoreValue {
    const context = useContext(WhiteboardContext);
    if (!context) {
        throw new Error('useWhiteboardStore must be used within a WhiteboardProvider');
    }
    return context;
}

export function createStrokeNode(partial: Pick<StrokeNode, 'id' | 'points' | 'tool' | 'strokeColor' | 'strokeWidth' | 'opacity' | 'compositeOperation'>): StrokeNode {
    return {
        id: partial.id,
        type: 'stroke',
        tool: partial.tool,
        points: partial.points,
        strokeColor: partial.strokeColor,
        strokeWidth: partial.strokeWidth,
        opacity: partial.opacity,
        compositeOperation: partial.compositeOperation,
        parentId: null,
        transform: IDENTITY_TRANSFORM,
        zIndex: 0,
    };
}

export function createSimulationBoxNode({
    id,
    initial,
}: {
    id?: NodeId;
    initial?: Partial<Pick<SimulationBoxNode, 'transform' | 'bounds'>>;
}): SimulationBoxNode {
    const nodeId = id ?? createNodeId();
    const transform = initial?.transform ?? { x: 160, y: 120, scaleX: 1, scaleY: 1, rotation: 0 };
    const bounds = initial?.bounds ?? { width: 420, height: 280 };
    return {
        id: nodeId,
        type: 'simulation-box',
        parentId: null,
        transform,
        zIndex: 0,
        bounds,
        linkedSimulationId: 'default',
        childIds: [],
    };
}
