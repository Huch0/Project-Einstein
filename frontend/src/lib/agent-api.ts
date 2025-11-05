/**
 * Agent API client for simulation pipeline orchestration.
 */

export interface AgentChatMessage {
  message: string;
  conversation_id?: string;
  attachments?: Array<{
    type: string;
    data?: string;
    id?: string;
  }>;
}

export interface AgentChatResponse {
  assistant_message: string;
  conversation_id: string;
  tool_calls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
  }>;
  state: {
    image_id?: string;
    segments_count: number;
    entities_count: number;
    scene_kind?: string;
    has_scene: boolean;
    frames_count: number;
  };
}

export interface AgentContext {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  image_id?: string;
  image_metadata?: Record<string, unknown>;
  segments: Array<unknown>;
  entities: Array<unknown>;
  scene_kind?: string;
  scene?: Record<string, unknown>;
  frames: Array<unknown>;
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
  }>;
  tool_calls: Array<{
    tool_name: string;
    arguments: Record<string, unknown>;
    result?: Record<string, unknown>;
    error?: string;
    timestamp: string;
  }>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Send message to agent chat endpoint.
 */
export async function sendAgentMessage(
  message: AgentChatMessage
): Promise<AgentChatResponse> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: message.message,
      conversation_id: message.conversation_id,
      mode: 'agent',
      attachments: message.attachments || [],
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Agent chat failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Get full conversation context.
 */
export async function getAgentContext(
  conversationId: string
): Promise<AgentContext> {
  const response = await fetch(`${API_BASE}/chat/context/${conversationId}`);

  if (!response.ok) {
    throw new Error(`Failed to get context: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete conversation context.
 */
export async function deleteAgentContext(conversationId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/context/${conversationId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete context: ${response.statusText}`);
  }
}

/**
 * Upload image and start agent-driven simulation workflow.
 */
export async function startAgentSimulation(
  imageFile: File,
  conversationId?: string
): Promise<AgentChatResponse> {
  // Upload image to backend first
  const formData = new FormData();
  formData.append('file', imageFile);
  
  const uploadResponse = await fetch(`${API_BASE}/diagram/upload`, {
    method: 'POST',
    body: formData,
  });
  
  if (!uploadResponse.ok) {
    throw new Error(`Image upload failed: ${uploadResponse.statusText}`);
  }
  
  const { image_id } = await uploadResponse.json();

  return sendAgentMessage({
    message: 'Analyze this physics diagram and create a simulation.',
    conversation_id: conversationId,
    attachments: [
      {
        type: 'image',
        id: image_id,
      },
    ],
  });
}

// ===========================
// v0.5: New Workflow API
// ===========================

export interface InitSimRequest {
  image_id: string;
  conversation_id?: string;
  options?: {
    auto_validate?: boolean;
    scale_m_per_px?: number;
    context?: string;
  };
}

export interface InitSimResponse {
  status: 'initialized' | 'failed' | 'in_progress';
  conversation_id: string;
  image_id: string;
  initialization: {
    segments_count: number;
    entities_count: number;
    entities?: Array<{
      segment_id: string;
      type: string;
      props: Record<string, unknown>;
      confidence?: number;
    }>;
    scene?: Record<string, unknown>;
    warnings: string[];
    errors: string[];
  };
  ready_for_simulation: boolean;
}

export interface RunSimRequest {
  conversation_id: string;
  duration_s?: number;
  frame_rate?: number;
  analyze?: boolean;
}

export interface RunSimResponse {
  status: 'simulated' | 'failed';
  conversation_id: string;
  simulation: {
    frames: Array<{
      t: number;
      positions: Record<string, [number, number]>;
      velocities?: Record<string, [number, number]>;
      forces?: Record<string, [number, number]>;
    }>;
    meta: {
      frames_count: number;
      simulation_time_s: number;
      engine: string;
    };
  };
  analysis?: {
    energy_conservation?: Record<string, unknown>;
    forces?: Record<string, unknown>;
    motion_summary?: Record<string, unknown>;
    pedagogical_insights?: string[];
  };
}

/**
 * Initialize simulation from uploaded image (v0.5).
 * 
 * Executes sequential pipeline:
 * 1. segment_image
 * 2. label_segments
 * 3. validate_entities
 * 4. build_physics_scene
 * 
 * Returns initialized scene ready for simulation.
 */
export async function sendInitSimulation(
  request: InitSimRequest
): Promise<InitSimResponse> {
  const response = await fetch(`${API_BASE}/init_sim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Initialization failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Run simulation on pre-initialized scene (v0.5).
 * 
 * Requires successful /init_sim call first.
 * Executes Matter.js simulation and optional physics analysis.
 */
export async function runSimulation(
  request: RunSimRequest
): Promise<RunSimResponse> {
  const response = await fetch(`${API_BASE}/run_sim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: request.conversation_id,
      duration_s: request.duration_s ?? 5.0,
      frame_rate: request.frame_rate ?? 60,
      analyze: request.analyze ?? true,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Simulation failed: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Check initialization status for a conversation (v0.5).
 */
export async function getInitSimStatus(
  conversationId: string
): Promise<{
  conversation_id: string;
  status: 'in_progress' | 'initialized' | 'failed';
  current_step?: string;
  progress: {
    segments_count: number;
    entities_count: number;
    has_scene: boolean;
  };
}> {
  const response = await fetch(`${API_BASE}/init_sim/status/${conversationId}`);

  if (!response.ok) {
    throw new Error(`Failed to get status: ${response.statusText}`);
  }

  return response.json();
}
