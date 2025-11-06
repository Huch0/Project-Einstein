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
  context?: {
    simulation_box?: {
      id: string;
      name: string;
      conversationId?: string;
      objects?: any[];
      parameters?: any;
    };
    image_box?: {
      id: string;
      imagePath: string; // Local file path for images
      metadata?: any;
    };
    boxes?: Array<{
      type: 'simulation' | 'image';
      id: string;
      name: string;
      conversationId?: string;
      objects?: any[];
      parameters?: any;
      imagePath?: string; // Local file path for images
    }>;
  };
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
      context: request.context,
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
): { close: () => void } {
  if (request.mode !== 'agent') {
    throw new Error('Streaming only supported in Agent mode');
  }

  let abortController = new AbortController();
  let isClosed = false;

  // Use fetch with POST for large payloads (images)
  fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: request.message,
      conversation_id: request.conversation_id,
      mode: request.mode,
      stream: true,
      attachments: request.attachments || [],
      context: request.context,
    }),
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (!isClosed) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || line.startsWith(':')) continue;

          if (line.startsWith('event:')) {
            const eventType = line.substring(6).trim();
            continue;
          }

          if (line.startsWith('data:')) {
            const data = line.substring(5).trim();
            if (!data) continue;

            try {
              const parsed = JSON.parse(data);
              
              // Determine event type from the last event: line or from data structure
              // Since we're parsing SSE manually, we need to track the event type
              // For simplicity, we'll check the data structure
              
              if (parsed.conversation_id && callbacks.onInit) {
                callbacks.onInit(parsed);
              } else if (parsed.status && callbacks.onThinking) {
                callbacks.onThinking(parsed);
              } else if (parsed.tool && parsed.index !== undefined && callbacks.onToolStart) {
                callbacks.onToolStart(parsed);
              } else if (parsed.tool && parsed.success !== undefined && callbacks.onToolComplete) {
                callbacks.onToolComplete(parsed);
              } else if (parsed.tool && parsed.error && callbacks.onToolError) {
                callbacks.onToolError(parsed);
              } else if (parsed.segments_count !== undefined && callbacks.onStateUpdate) {
                callbacks.onStateUpdate(parsed);
              } else if (parsed.content && callbacks.onMessage) {
                callbacks.onMessage(parsed);
              } else if (parsed.conversation_id && callbacks.onDone) {
                callbacks.onDone(parsed);
              }
            } catch (err) {
              console.error('Failed to parse SSE data:', err);
            }
          }
        }
      }
    })
    .catch((err) => {
      if (err.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('SSE stream error:', err);
        if (callbacks.onError) {
          callbacks.onError(err);
        }
      }
    });

  return {
    close: () => {
      isClosed = true;
      abortController.abort();
    },
  };
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
