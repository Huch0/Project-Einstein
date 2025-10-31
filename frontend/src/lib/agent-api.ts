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
