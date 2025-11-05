export type NodeId = string;

export type WhiteboardDrawingTool = 'pen' | 'highlighter' | 'eraser';

export type InteractionMode = 'pan' | 'draw' | 'simulation';

export type StrokePoint = { x: number; y: number };

export interface CameraState {
    position: { x: number; y: number };
    zoom: number;
}

export interface Transform2D {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
}

export type WhiteboardNodeType = 'simulation-box' | 'image' | 'stroke' | 'simulation-object';

export interface BaseNode {
    id: NodeId;
    type: WhiteboardNodeType;
    parentId: NodeId | null;
    transform: Transform2D;
    zIndex: number;
    metadata?: Record<string, unknown>;
}

export interface StrokeNode extends BaseNode {
    type: 'stroke';
    tool: WhiteboardDrawingTool;
    points: StrokePoint[];
    strokeColor: string;
    strokeWidth: number;
    opacity: number;
    compositeOperation: GlobalCompositeOperation;
}

export interface SimulationBoxNode extends BaseNode {
    type: 'simulation-box';
    bounds: { width: number; height: number };
    linkedSimulationId: string;
    childIds: NodeId[];
    // User-defined name for the box
    name?: string;
    // Agent context integration
    conversationId?: string;
    agentState?: {
        segments_count: number;
        entities_count: number;
        scene_kind?: string;
        has_scene: boolean;
        frames_count: number;
    };
}

export interface ImageNode extends BaseNode {
    type: 'image';
    source: {
        kind: 'upload' | 'library' | 'url';
        uri: string;
    };
    originalSize: { width: number; height: number };
    bounds: { width: number; height: number };
    isPlacedInsideSimulationBox: boolean;
}

export interface SimulationObjectNode extends BaseNode {
    type: 'simulation-object';
    sourceImageId: NodeId | null;
    properties: {
        label: string;
        massKg?: number;
        chargeC?: number;
        velocity?: { x: number; y: number };
        customData?: Record<string, unknown>;
    };
}

export type WhiteboardNode =
    | StrokeNode
    | SimulationBoxNode
    | ImageNode
    | SimulationObjectNode;

export interface WhiteboardState {
    id: string;
    camera: CameraState;
    nodes: Record<NodeId, WhiteboardNode>;
    orderedNodeIds: NodeId[];
    selection: NodeId[];
    createdAt: string;
    updatedAt: string;
}

export const IDENTITY_TRANSFORM: Transform2D = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
};

export const createIsoTimestamp = () => new Date().toISOString();

export function isStrokeNode(node: WhiteboardNode | undefined): node is StrokeNode {
    return !!node && node.type === 'stroke';
}
