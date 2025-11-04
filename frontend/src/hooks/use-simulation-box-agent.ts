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
  sendInitSimulation,
  runSimulation,
  type AgentChatResponse,
  type AgentContext,
  type InitSimResponse,
  type RunSimResponse 
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
  
  // v0.5 New state
  isInitialized: boolean;
  readyForSimulation: boolean;
  initResult?: InitSimResponse;
  
  // Actions
  uploadImage: (file: File) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  inspectSimulation: () => Promise<void>;
  resetConversation: () => void;
  
  // v0.5 New actions
  runSimulation: () => Promise<void>;
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
  
  // v0.5 New state
  const [isInitialized, setIsInitialized] = useState(false);
  const [readyForSimulation, setReadyForSimulation] = useState(false);
  const [initResult, setInitResult] = useState<InitSimResponse>();

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
      console.log('[SimulationBoxAgent] Starting image upload and initialization (v0.5):', {
        boxId,
        fileName: file.name,
        fileSize: file.size,
      });
      
      // Step 1: Upload image to get image_id
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/diagram/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadResponse.ok) {
        throw new Error(`Image upload failed: ${uploadResponse.statusText}`);
      }
      
      const { image_id } = await uploadResponse.json();
      console.log('[SimulationBoxAgent] ✅ Image uploaded:', image_id);
      
      // Step 2: Call /init_sim for automated initialization
      const initResponse = await sendInitSimulation({
        image_id,
        conversation_id: conversationId,
      });
      
      console.log('[SimulationBoxAgent] Initialization result:', {
        status: initResponse.status,
        segments: initResponse.initialization.segments_count,
        entities: initResponse.initialization.entities_count,
        ready: initResponse.ready_for_simulation,
        warnings: initResponse.initialization.warnings,
      });
      
      setConversationId(initResponse.conversation_id);
      setInitResult(initResponse);
      
      if (initResponse.status === 'initialized') {
        setIsInitialized(true);
        setReadyForSimulation(initResponse.ready_for_simulation);
        
        // Sync with GlobalChat
        globalChat.setActiveBoxId(boxId);
        globalChat.setConversationId(initResponse.conversation_id);
        globalChat.addMessage({
          role: 'assistant',
          content: `✅ Initialization complete: ${initResponse.initialization.entities_count} entities detected. Ready for simulation.`,
          boxId,
        });
        
        // Show warnings if any
        if (initResponse.initialization.warnings.length > 0) {
          globalChat.addMessage({
            role: 'assistant',
            content: `⚠️ Warnings: ${initResponse.initialization.warnings.join(', ')}`,
            boxId,
          });
        }
      } else {
        throw new Error(`Initialization failed: ${initResponse.initialization.errors.join(', ')}`);
      }
      
      onConversationUpdate?.(initResponse.conversation_id, {
        image_id: initResponse.image_id,
        segments_count: initResponse.initialization.segments_count,
        entities_count: initResponse.initialization.entities_count,
        has_scene: !!initResponse.initialization.scene,
        frames_count: 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
      console.error('[SimulationBoxAgent] Upload error:', err);
      
      globalChat.addMessage({
        role: 'assistant',
        content: `❌ Initialization failed: ${message}`,
        boxId,
      });
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
    setIsInitialized(false);
    setReadyForSimulation(false);
    setInitResult(undefined);
  }, []);
  
  // v0.5 New action: Run simulation
  const handleRunSimulation = useCallback(async () => {
    if (!conversationId) {
      setError('No active conversation. Upload an image first.');
      return;
    }
    
    if (!readyForSimulation) {
      setError('Scene not initialized. Complete initialization first.');
      return;
    }
    
    setLoading(true);
    setError(undefined);
    
    try {
      console.log('[SimulationBoxAgent] Starting simulation for conversation:', conversationId);
      
      const simResponse = await runSimulation({
        conversation_id: conversationId,
        duration_s: 5.0,
        frame_rate: 60,
        analyze: true,
      });
      
      console.log('[SimulationBoxAgent] Simulation complete:', {
        status: simResponse.status,
        frames: simResponse.simulation.frames.length,
        hasAnalysis: !!simResponse.analysis,
      });
      
      if (simResponse.status === 'simulated') {
        // Update simulation data in GlobalChat
        globalChat.setSimulationData({
          scene: initResult?.initialization.scene || {},
          frames: simResponse.simulation.frames,
          imageWidth: 800,  // TODO: Get from init result
          imageHeight: 600,
          boxId,
        });
        
        // Add success message
        globalChat.addMessage({
          role: 'assistant',
          content: `✅ Simulation complete: ${simResponse.simulation.frames.length} frames generated.`,
          boxId,
        });
        
        // Add analysis insights if available
        if (simResponse.analysis?.pedagogical_insights) {
          const insights = simResponse.analysis.pedagogical_insights.join('\n• ');
          globalChat.addMessage({
            role: 'assistant',
            content: `📊 Analysis:\n• ${insights}`,
            boxId,
          });
        }
        
        // Update agent state
        setAgentState({
          ...agentState,
          frames_count: simResponse.simulation.frames.length,
          has_scene: true,
        } as any);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Simulation failed';
      setError(message);
      console.error('[SimulationBoxAgent] Simulation error:', err);
      
      globalChat.addMessage({
        role: 'assistant',
        content: `❌ Simulation failed: ${message}`,
        boxId,
      });
    } finally {
      setLoading(false);
    }
  }, [conversationId, readyForSimulation, initResult, boxId, globalChat, agentState]);

  return {
    conversationId,
    agentState,
    context,
    loading,
    error,
    
    // v0.5 New state
    isInitialized,
    readyForSimulation,
    initResult,
    
    uploadImage,
    sendMessage,
    inspectSimulation,
    resetConversation,
    
    // v0.5 New action
    runSimulation: handleRunSimulation,
  };
}
