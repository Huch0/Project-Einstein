/**
 * Unified Chat API Client (v0.4)
 * 
 * Supports two modes:
 * - Ask Mode: Normal conversation (educational Q&A)
 * - Agent Mode: Tool-enabled simulation pipeline
 * 
 * Features:
 * - Mode selection via parameter
 * - SSE streaming for Agent mode
 * - Type-safe responses
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

// ===========================
// Types
// ===========================

export type ChatMode = 'ask' | 'agent';

export interface UnifiedChatRequest {
  message: string;
  conversation_id?: string | null;
  mode: ChatMode;
  attachments?: Array<{
    type: string;
    id?: string;
    data?: string;
  }>;
  stream?: boolean;
}

export interface UnifiedChatResponse {
  message: string;
  conversation_id: string;
  mode: ChatMode;
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

// SSE Event Types
export type SSEEventType =
  | 'init'
  | 'thinking'
  | 'tool_start'
  | 'tool_complete'
  | 'tool_error'
  | 'state_update'
  | 'message'
  | 'done';

export interface SSEEvent {
  event: SSEEventType;
  data: any;
}

export interface ToolStartEvent {
  tool: string;
  index: number;
  total: number;
}

export interface ToolCompleteEvent {
  tool: string;
  success: boolean;
}

export interface ToolErrorEvent {
  tool: string;
  error: string;
}

export interface StateUpdateEvent {
  segments_count?: number;
  entities_count?: number;
  has_scene?: boolean;
  frames_count?: number;
}

export interface MessageEvent {
  content: string;
}

export interface DoneEvent {
  conversation_id: string;
}

// ===========================
// Non-Streaming API
// ===========================

/**
 * Send a unified chat message (Ask or Agent mode).
 * 
 * @param request - Chat request with mode selection
 * @returns Chat response with message and optional tool calls
 * 
 * @example Ask mode
 * ```typescript
 * const response = await sendUnifiedChat({
 *   message: "What is Newton's second law?",
 *   mode: "ask"
 * });
 * console.log(response.message);
 * ```
 * 
 * @example Agent mode
 * ```typescript
 * const response = await sendUnifiedChat({
 *   message: "Simulate this diagram",
 *   mode: "agent",
 *   attachments: [{type: "image", id: "img_123"}]
 * });
 * console.log(response.tool_calls);
 * ```
 */
export async function sendUnifiedChat(
  request: UnifiedChatRequest
): Promise<UnifiedChatResponse> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: request.message,
      conversation_id: request.conversation_id,
      mode: request.mode,
      attachments: request.attachments || [],
      stream: false,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `Chat failed: ${response.statusText}`);
  }

  return response.json();
}

// ===========================
// Streaming API (SSE)
// ===========================

export interface SSEStreamCallbacks {
  onInit?: (data: { conversation_id: string }) => void;
  onThinking?: (data: { status: string }) => void;
  onToolStart?: (data: ToolStartEvent) => void;
  onToolComplete?: (data: ToolCompleteEvent) => void;
  onToolError?: (data: ToolErrorEvent) => void;
  onStateUpdate?: (data: StateUpdateEvent) => void;
  onMessage?: (data: MessageEvent) => void;
  onDone?: (data: DoneEvent) => void;
  onError?: (error: Error) => void;
}

/**
 * Stream Agent mode execution with real-time progress updates.
 * 
 * Uses Server-Sent Events (SSE) to provide live tool execution status.
 * Only available in Agent mode.
 * 
 * @param request - Chat request (must have mode="agent")
 * @param callbacks - Event handlers for different SSE events
 * @returns EventSource instance (call .close() to stop)
 * 
 * @example
 * ```typescript
 * const eventSource = streamAgentChat(
 *   {
 *     message: "Simulate pulley system",
 *     mode: "agent",
 *     attachments: [{type: "image", id: "img_123"}]
 *   },
 *   {
 *     onToolStart: ({tool, index, total}) => {
 *       console.log(`[${index + 1}/${total}] Running ${tool}...`);
 *     },
 *     onToolComplete: ({tool, success}) => {
 *       console.log(`✓ ${tool} completed`);
 *     },
 *     onStateUpdate: (state) => {
 *       updateVisualization(state);
 *     },
 *     onMessage: ({content}) => {
 *       displayMessage(content);
 *     },
 *     onDone: ({conversation_id}) => {
 *       console.log('Stream complete:', conversation_id);
 *       eventSource.close();
 *     }
 *   }
 * );
 * ```
 */
export function streamAgentChat(
  request: UnifiedChatRequest,
  callbacks: SSEStreamCallbacks
): EventSource {
  if (request.mode !== 'agent') {
    throw new Error('Streaming only supported in Agent mode');
  }

  // Build query string
  const params = new URLSearchParams({
    message: request.message,
    mode: request.mode,
    stream: 'true',
  });

  if (request.conversation_id) {
    params.append('conversation_id', request.conversation_id);
  }

  if (request.attachments && request.attachments.length > 0) {
    params.append('attachments', JSON.stringify(request.attachments));
  }

  const url = `${API_BASE}/chat?${params.toString()}`;
  const eventSource = new EventSource(url);

  // Register event listeners
  if (callbacks.onInit) {
    eventSource.addEventListener('init', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onInit!(data);
      } catch (err) {
        console.error('Failed to parse init event:', err);
      }
    });
  }

  if (callbacks.onThinking) {
    eventSource.addEventListener('thinking', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onThinking!(data);
      } catch (err) {
        console.error('Failed to parse thinking event:', err);
      }
    });
  }

  if (callbacks.onToolStart) {
    eventSource.addEventListener('tool_start', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onToolStart!(data);
      } catch (err) {
        console.error('Failed to parse tool_start event:', err);
      }
    });
  }

  if (callbacks.onToolComplete) {
    eventSource.addEventListener('tool_complete', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onToolComplete!(data);
      } catch (err) {
        console.error('Failed to parse tool_complete event:', err);
      }
    });
  }

  if (callbacks.onToolError) {
    eventSource.addEventListener('tool_error', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onToolError!(data);
      } catch (err) {
        console.error('Failed to parse tool_error event:', err);
      }
    });
  }

  if (callbacks.onStateUpdate) {
    eventSource.addEventListener('state_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onStateUpdate!(data);
      } catch (err) {
        console.error('Failed to parse state_update event:', err);
      }
    });
  }

  if (callbacks.onMessage) {
    eventSource.addEventListener('message', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onMessage!(data);
      } catch (err) {
        console.error('Failed to parse message event:', err);
      }
    });
  }

  if (callbacks.onDone) {
    eventSource.addEventListener('done', (e) => {
      try {
        const data = JSON.parse(e.data);
        callbacks.onDone!(data);
      } catch (err) {
        console.error('Failed to parse done event:', err);
      }
    });
  }

  // Error handler
  eventSource.onerror = (err) => {
    console.error('SSE connection error:', err);
    if (callbacks.onError) {
      callbacks.onError(new Error('SSE connection failed'));
    }
    eventSource.close();
  };

  return eventSource;
}

// ===========================
// Convenience Functions
// ===========================

/**
 * Send Ask mode message (normal conversation).
 */
export async function sendAskMessage(
  message: string,
  conversationId?: string
): Promise<UnifiedChatResponse> {
  return sendUnifiedChat({
    message,
    conversation_id: conversationId,
    mode: 'ask',
  });
}

/**
 * Send Agent mode message (tool-enabled, non-streaming).
 */
export async function sendAgentMessage(
  message: string,
  attachments?: Array<{ type: string; id?: string; data?: string }>,
  conversationId?: string
): Promise<UnifiedChatResponse> {
  return sendUnifiedChat({
    message,
    conversation_id: conversationId,
    mode: 'agent',
    attachments,
  });
}

/**
 * Get conversation context (both Ask and Agent modes).
 */
export async function getConversationContext(
  conversationId: string
): Promise<any> {
  const response = await fetch(`${API_BASE}/chat/context/${conversationId}`);

  if (!response.ok) {
    throw new Error(`Failed to get context: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Delete conversation (both Ask and Agent modes).
 */
export async function deleteConversation(conversationId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/chat/context/${conversationId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(`Failed to delete conversation: ${response.statusText}`);
  }
}

/**
 * List all conversations.
 */
export async function listConversations(): Promise<any[]> {
  const response = await fetch(`${API_BASE}/chat/conversations`);

  if (!response.ok) {
    throw new Error(`Failed to list conversations: ${response.statusText}`);
  }

  return response.json();
}
