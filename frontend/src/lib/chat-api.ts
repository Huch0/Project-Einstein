const DEFAULT_API_BASE_URL = 'http://localhost:8000';

const apiBaseUrl = (() => {
  const envValue = process.env.NEXT_PUBLIC_BACKEND_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!envValue || envValue.trim().length === 0) {
    return DEFAULT_API_BASE_URL;
  }
  return envValue.replace(/\/$/, '');
})();

const createMessageId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export type AgentMessage = {
  id: string;
  role: 'assistant' | 'tool' | 'system' | 'user';
  content: string;
  metadata?: Record<string, unknown>;
};

export type ChatTurnPayload = {
  conversationId: string | null;
  message: string;
};

export type ChatTurnResult = {
  conversationId: string;
  assistantMessages: AgentMessage[];
  toolMessages: AgentMessage[];
};

function mapApiMessage(message: any): AgentMessage | null {
  if (!message || typeof message !== 'object') {
    return null;
  }
  if (typeof message.content !== 'string') {
    return null;
  }
  const role = typeof message.role === 'string' ? message.role : 'assistant';
  const normalizedRole = role.toLowerCase();
  if (!['assistant', 'tool', 'system', 'user'].includes(normalizedRole)) {
    return null;
  }
  return {
    id: String(message.id ?? createMessageId()),
    role: normalizedRole as AgentMessage['role'],
    content: message.content,
    metadata: message.metadata && typeof message.metadata === 'object' ? message.metadata : undefined,
  };
}

export async function sendChatTurn({ conversationId, message }: ChatTurnPayload): Promise<ChatTurnResult> {
  const response = await fetch(`${apiBaseUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      message,
      metadata: {},
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Chat request failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data?.conversation?.id) {
    throw new Error('Malformed chat response received from server.');
  }

  const apiMessages: AgentMessage[] = Array.isArray(data?.new_messages)
    ? data.new_messages
  .map((raw: unknown) => mapApiMessage(raw))
  .filter((msg: AgentMessage | null): msg is AgentMessage => Boolean(msg))
    : [];

  const assistantMessages = apiMessages.filter((msg) => msg.role === 'assistant');
  const toolMessages = apiMessages.filter((msg) => msg.role === 'tool');

  return {
    conversationId: data.conversation.id,
    assistantMessages,
    toolMessages,
  };
}

