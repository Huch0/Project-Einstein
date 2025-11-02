/**
 * SimulationBox Agent Context Hook
 * 
 * Manages agent conversation state for each simulation box.
 * Now syncs with GlobalChatContext for unified chat experience.
 */

import { useCallback, useEffect, useState } from 'react';
import { useGlobalChat } from '@/contexts/global-chat-context';
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
  const globalChat = useGlobalChat();
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
      console.log('[SimulationBoxAgent] Starting image upload:', {
        boxId,
        fileName: file.name,
        fileSize: file.size,
      });
      
      const response = await startAgentSimulation(file, conversationId);
      
      console.log('[SimulationBoxAgent] Image uploaded:', {
        boxId,
        conversationId: response.conversation_id,
        state: response.state,
        toolCallsCount: response.tool_calls?.length || 0,
        message: response.assistant_message,
      });
      
      // Log tool calls if any
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log('[SimulationBoxAgent] Tool calls executed:', 
          response.tool_calls.map(tc => ({
            tool: tc.name,
            hasResult: !!tc.result,
            hasError: !!tc.error
          }))
        );
      } else {
        console.warn('[SimulationBoxAgent] ⚠️ No tool calls were executed!');
      }
      
      setConversationId(response.conversation_id);
      setAgentState(response.state);
      
      // Sync with GlobalChat
      globalChat.setActiveBoxId(boxId);
      globalChat.setConversationId(response.conversation_id);
      globalChat.addMessage({
        role: 'user',
        content: `[Uploaded image to "${boxName || boxId}"]`,
        boxId,
      });
      if (response.assistant_message) {
        globalChat.addMessage({
          role: 'assistant',
          content: response.assistant_message,
          boxId,
        });
      }
      
      // Update simulation data if available
      const stateAny = response.state as any;
      if (stateAny?.frames && stateAny?.scene) {
        globalChat.setSimulationData({
          scene: stateAny.scene,
          frames: stateAny.frames,
          imageWidth: stateAny.image?.width_px || 800,
          imageHeight: stateAny.image?.height_px || 600,
          boxId,
        });
      }
      
      onConversationUpdate?.(response.conversation_id, response.state);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      console.error('[SimulationBoxAgent] Upload error:', err);
    } finally {
      setLoading(false);
    }
  }, [boxId, boxName, conversationId, onConversationUpdate, globalChat]);

  const sendMessage = useCallback(async (message: string) => {
    setLoading(true);
    setError(undefined);

    try {
      // Prepend box name to message if available
      const contextualMessage = boxName 
        ? `[Regarding "${boxName}" simulation box] ${message}`
        : message;
      
      // Add user message to GlobalChat
      globalChat.setActiveBoxId(boxId);
      globalChat.addMessage({
        role: 'user',
        content: contextualMessage,
        boxId,
      });
      
      const response = await sendAgentMessage({
        message: contextualMessage,
        conversation_id: conversationId,
      });

      console.log('[SimulationBoxAgent] Full response:', response);
      console.log('[SimulationBoxAgent] Response details:', {
        conversation_id: response.conversation_id,
        message: response.assistant_message,
        tool_calls_count: response.tool_calls?.length || 0,
        state: response.state,
      });

      setConversationId(response.conversation_id);
      setAgentState(response.state);
      
      // Sync with GlobalChat
      globalChat.setConversationId(response.conversation_id);
      if (response.assistant_message) {
        globalChat.addMessage({
          role: 'assistant',
          content: response.assistant_message,
          boxId,
        });
      }
      
      // Update simulation data if available
      const stateAny = response.state as any;
      if (stateAny?.frames && stateAny?.scene) {
        globalChat.setSimulationData({
          scene: stateAny.scene,
          frames: stateAny.frames,
          imageWidth: stateAny.image?.width_px || 800,
          imageHeight: stateAny.image?.height_px || 600,
          boxId,
        });
      }
      
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
  }, [boxId, boxName, conversationId, onConversationUpdate, globalChat]);

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
