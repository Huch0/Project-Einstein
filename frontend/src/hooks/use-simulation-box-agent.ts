/**
 * SimulationBox Agent Context Hook
 * 
 * Manages agent conversation state for each simulation box.
 */

import { useCallback, useEffect, useState } from 'react';
import { 
  sendAgentMessage, 
  getAgentContext, 
  startAgentSimulation,
  type AgentChatResponse,
  type AgentContext 
} from '@/lib/agent-api';

export interface UseSimulationBoxAgentProps {
  boxId: string;
  boxName?: string;  // Name of the simulation box
  conversationId?: string;
  onConversationUpdate?: (conversationId: string, state: AgentChatResponse['state']) => void;
}

export interface UseSimulationBoxAgentReturn {
  conversationId?: string;
  agentState?: AgentChatResponse['state'];
  context?: AgentContext;
  loading: boolean;
  error?: string;
  
  // Actions
  uploadImage: (file: File) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  inspectSimulation: () => Promise<void>;
  resetConversation: () => void;
}

export function useSimulationBoxAgent({
  boxId,
  boxName,
  conversationId: initialConversationId,
  onConversationUpdate,
}: UseSimulationBoxAgentProps): UseSimulationBoxAgentReturn {
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [agentState, setAgentState] = useState<AgentChatResponse['state']>();
  const [context, setContext] = useState<AgentContext>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  // Load context when conversation ID changes
  useEffect(() => {
    if (!conversationId) return;

    let cancelled = false;

    getAgentContext(conversationId)
      .then((ctx) => {
        if (!cancelled) {
          setContext(ctx);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[SimulationBoxAgent] Failed to load context:', err);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const uploadImage = useCallback(async (file: File) => {
    setLoading(true);
    setError(undefined);

    try {
      const response = await startAgentSimulation(file, conversationId);
      
      setConversationId(response.conversation_id);
      setAgentState(response.state);
      
      onConversationUpdate?.(response.conversation_id, response.state);
      
      console.log('[SimulationBoxAgent] Image uploaded:', {
        boxId,
        conversationId: response.conversation_id,
        state: response.state,
        message: response.assistant_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      console.error('[SimulationBoxAgent] Upload error:', err);
    } finally {
      setLoading(false);
    }
  }, [boxId, conversationId, onConversationUpdate]);

  const sendMessage = useCallback(async (message: string) => {
    setLoading(true);
    setError(undefined);

    try {
      // Prepend box name to message if available
      const contextualMessage = boxName 
        ? `[Regarding "${boxName}" simulation box] ${message}`
        : message;
      
      const response = await sendAgentMessage({
        message: contextualMessage,
        conversation_id: conversationId,
      });

      setConversationId(response.conversation_id);
      setAgentState(response.state);
      
      onConversationUpdate?.(response.conversation_id, response.state);

      console.log('[SimulationBoxAgent] Message sent:', {
        boxId,
        boxName,
        message: contextualMessage,
        response: response.assistant_message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Message failed';
      setError(message);
      console.error('[SimulationBoxAgent] Message error:', err);
    } finally {
      setLoading(false);
    }
  }, [boxId, boxName, conversationId, onConversationUpdate]);

  const inspectSimulation = useCallback(async () => {
    if (!conversationId) {
      setError('No active conversation');
      return;
    }

    await sendMessage(
      'Analyze the current simulation. Check energy conservation, constraint violations, and motion characteristics.'
    );
  }, [conversationId, sendMessage]);

  const resetConversation = useCallback(() => {
    setConversationId(undefined);
    setAgentState(undefined);
    setContext(undefined);
    setError(undefined);
  }, []);

  return {
    conversationId,
    agentState,
    context,
    loading,
    error,
    uploadImage,
    sendMessage,
    inspectSimulation,
    resetConversation,
  };
}
