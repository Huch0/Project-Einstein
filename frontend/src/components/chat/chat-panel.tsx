
'use client';

import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useGlobalChat, type SimulationData } from '@/contexts/global-chat-context';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Bot, Plus, Image as ImageIcon, Box as BoxIcon, X } from 'lucide-react';
import { sendUnifiedChat, streamAgentChat, type ChatMode, type UnifiedChatRequest } from '@/lib/unified-chat-api';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';
import { SelectBoxModal } from './select-box-modal';
import { SimulationViewer } from '@/components/simulation/simulation-viewer';
import { cn } from '@/lib/utils';

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

type ChatPanelProps = {
    padding?: 'default' | 'compact' | 'flush';
};

type SimulationBoxContextPayload = {
    type: 'simulation';
    id: string;
    name: string;
    conversationId?: string;
    objects: Array<{
        type?: string;
        label?: string;
        mass_kg?: number;
    }>;
    parameters?: {
        world?: {
            gravity_m_s2?: number;
            time_step_s?: number;
        };
        summary?: {
            bodies?: number;
            constraints?: number;
        };
    };
};

type ImageBoxContextPayload = {
    type: 'image';
    id: string;
    name: string;
    imagePath: string;
};

type AttachedBoxContext = SimulationBoxContextPayload | ImageBoxContextPayload;
type BoxContextCache = Record<string, AttachedBoxContext>;

const MAX_CONTEXT_OBJECTS = 6;
const TOOL_LOGS_ENABLED = process.env.NEXT_PUBLIC_AGENT_TOOL_LOGS !== 'false';

const logToolDebug = (label: string, payload: Record<string, unknown>) => {
    if (!TOOL_LOGS_ENABLED) {
        return;
    }
    const timestamp = new Date().toISOString();
    console.info(`[AgentTool][${timestamp}] ${label}`, payload);
};

const summarizeEntities = (entities: any[]): SimulationBoxContextPayload['objects'] => {
    if (!Array.isArray(entities)) {
        return [];
    }
    return entities.slice(0, MAX_CONTEXT_OBJECTS).map((entity) => ({
        type: entity?.type,
        label: entity?.props?.label || entity?.props?.id || entity?.id,
        mass_kg: entity?.props?.mass_kg ?? entity?.props?.mass,
    }));
};

const summarizeSceneParameters = (sceneOrParameters: any): SimulationBoxContextPayload['parameters'] => {
    if (!sceneOrParameters || typeof sceneOrParameters !== 'object') {
        return undefined;
    }

    const worldSource = typeof sceneOrParameters.world === 'object'
        ? sceneOrParameters.world
        : ('gravity_m_s2' in sceneOrParameters || 'time_step_s' in sceneOrParameters)
            ? sceneOrParameters
            : undefined;

    const world = worldSource
        ? {
            gravity_m_s2: worldSource.gravity_m_s2,
            time_step_s: worldSource.time_step_s,
        }
        : undefined;

    const bodiesCount = typeof sceneOrParameters?.summary?.bodies === 'number'
        ? sceneOrParameters.summary.bodies
        : Array.isArray(sceneOrParameters?.bodies)
            ? sceneOrParameters.bodies.length
            : undefined;

    const constraintsCount = typeof sceneOrParameters?.summary?.constraints === 'number'
        ? sceneOrParameters.summary.constraints
        : Array.isArray(sceneOrParameters?.constraints)
            ? sceneOrParameters.constraints.length
            : undefined;

    const hasSummary = bodiesCount !== undefined || constraintsCount !== undefined;
    const summary = hasSummary
        ? {
            bodies: bodiesCount,
            constraints: constraintsCount,
        }
        : undefined;

    if (!world && !summary) {
        return undefined;
    }

    return { world, summary };
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const fetchConversationContext = async (conversationId: string) => {
    const response = await fetch(`${API_BASE}/chat/context/${conversationId}`);
    if (!response.ok) {
        throw new Error(`Context fetch failed (${response.status} ${response.statusText})`);
    }
    return response.json();
};

export default function ChatPanel({ padding = 'default' }: ChatPanelProps = {}) {
    const { toast } = useToast();
    const globalChat = useGlobalChat();
    const getAllBoxes = globalChat.getAllBoxes;
    
    const [mode, setMode] = useState<ChatMode>('agent'); // Default to agent mode
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [progressMessages, setProgressMessages] = useState<string[]>([]);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
    const [showBoxModal, setShowBoxModal] = useState(false);
    const [attachedBoxIds, setAttachedBoxIds] = useState<string[]>([]); // Multiple boxes
    const [boxContextCache, setBoxContextCache] = useState<BoxContextCache>({});
    const eventSourceRef = useRef<{ close: () => void } | null>(null);
    const toolsUsedRef = useRef(false);
    const conversationIdRef = useRef<string | null>(globalChat.conversationId);
    const pendingConversationRef = useRef<string | null>(null);

    const scrollAreaRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        conversationIdRef.current = globalChat.conversationId;
    }, [globalChat.conversationId]);

    const resolveBoxIdForConversation = useCallback((conversationId: string) => {
        let match: string | undefined;
        globalChat.simulationBoxes.forEach((box, boxId) => {
            if (!match && box.conversationId === conversationId) {
                match = boxId;
            }
        });
        return match;
    }, [globalChat.simulationBoxes]);

    const recordSimulationSnapshot = useCallback((conversationId: string, data: SimulationData) => {
        if (!conversationId) {
            return;
        }

        const resolvedBoxId = data.boxId ?? resolveBoxIdForConversation(conversationId);
        const snapshotPayload: SimulationData = {
            ...data,
            boxId: resolvedBoxId,
            conversationId,
            updatedAt: Date.now(),
        };

        globalChat.setSimulationSnapshot(conversationId, snapshotPayload);
        globalChat.setSimulationData(snapshotPayload);

        if (resolvedBoxId) {
            globalChat.updateSimulationBox(resolvedBoxId, {
                conversationId,
                hasSimulation: Array.isArray(snapshotPayload.frames)
                    ? snapshotPayload.frames.length > 0
                    : false,
            });
        }
    }, [globalChat, resolveBoxIdForConversation]);

    const scrollToBottom = () => {
        if (scrollAreaRef.current) {
            const viewport = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]') as HTMLDivElement | null;
            if (viewport) {
                viewport.scrollTop = viewport.scrollHeight;
            }
        }
    };

    useEffect(() => {
        scrollToBottom();
    }, [globalChat.messages]);

    // Update welcome message when mode changes
    useEffect(() => {
        if (globalChat.messages.length === 0) {
            globalChat.addMessage({
                role: 'assistant',
                content: mode === 'tutor'
                    ? "Hello! I'm your physics tutor. Ask me anything about physics concepts, laws, or problem-solving strategies."
                    : "Welcome to the Physics Lab Assistant! I can help you analyze diagrams and create simulations. Upload an image or describe what you want to simulate.",
            });
        }
    }, [mode]);

    // Cleanup EventSource on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const ensureBoxContexts = useCallback(async (boxIds: string[]): Promise<Record<string, AttachedBoxContext>> => {
        if (boxIds.length === 0) {
            return {};
        }

        const contexts: Record<string, AttachedBoxContext> = {};
        const missingBoxes: ReturnType<typeof getAllBoxes> = [];
        const updates: BoxContextCache = {};
        const allBoxes = getAllBoxes();

        for (const id of boxIds) {
            const cached = boxContextCache[id];
            if (cached) {
                if (cached.type === 'simulation') {
                    const normalized: SimulationBoxContextPayload = {
                        ...cached,
                        objects: summarizeEntities(cached.objects),
                        parameters: summarizeSceneParameters(cached.parameters),
                    };
                    contexts[id] = normalized;
                    updates[id] = normalized;
                } else {
                    contexts[id] = cached;
                }
            } else {
                const box = allBoxes.find((item) => item.id === id);
                if (box) {
                    missingBoxes.push(box);
                }
            }
        }

        if (missingBoxes.length === 0) {
            if (Object.keys(updates).length > 0) {
                setBoxContextCache((prev) => ({ ...prev, ...updates }));
            }
            return contexts;
        }

        const fetchedEntries = await Promise.all(
            missingBoxes.map(async (box) => {
                try {
                    if (box.type === 'simulation') {
                        let entities: any[] = [];
                        let scene: any = undefined;
                        if (box.conversationId) {
                            const response = await fetch(`${API_BASE}/chat/context/${box.conversationId}`);
                            if (response.ok) {
                                const data = await response.json();
                                entities = data?.entities || [];
                                scene = data?.scene || undefined;
                            }
                        }

                        const payload: SimulationBoxContextPayload = {
                            type: 'simulation',
                            id: box.id,
                            name: box.name,
                            conversationId: box.conversationId,
                            objects: summarizeEntities(entities),
                            parameters: summarizeSceneParameters(scene),
                        };
                        return [box.id, payload] as const;
                    }

                    const payload: ImageBoxContextPayload = {
                        type: 'image',
                        id: box.id,
                        name: box.name,
                        imagePath: box.imagePath,
                    };
                    return [box.id, payload] as const;
                } catch (error) {
                    toast({
                        variant: 'destructive',
                        title: 'Context error',
                        description:
                            error instanceof Error
                                ? error.message
                                : 'Failed to load context for selected box.',
                    });
                    return null;
                }
            })
        );

        for (const entry of fetchedEntries) {
            if (!entry) continue;
            updates[entry[0]] = entry[1];
            contexts[entry[0]] = entry[1];
        }

        if (Object.keys(updates).length > 0) {
            setBoxContextCache((prev) => ({ ...prev, ...updates }));
        }

        return contexts;
    }, [boxContextCache, getAllBoxes, toast]);

    const buildContextPayload = useCallback(async (): Promise<UnifiedChatRequest['context'] | undefined> => {
        if (attachedBoxIds.length === 0) {
            return undefined;
        }

        const contexts = await ensureBoxContexts(attachedBoxIds);
        const orderedContexts = attachedBoxIds
            .map((id) => contexts[id])
            .filter((ctx): ctx is AttachedBoxContext => Boolean(ctx));

        const boxes = orderedContexts.map((ctx) => {
            if (ctx.type === 'simulation') {
                return {
                    type: 'simulation' as const,
                    id: ctx.id,
                    name: ctx.name,
                    conversationId: ctx.conversationId,
                    objects: ctx.objects,
                    parameters: ctx.parameters,
                };
            }
            return {
                type: 'image' as const,
                id: ctx.id,
                name: ctx.name,
                imagePath: ctx.imagePath,
            };
        });

        if (boxes.length === 0) {
            return undefined;
        }

        const simulationBox = boxes.find((box) => box.type === 'simulation');
        const imageBox = boxes.find((box) => box.type === 'image');

        return {
            boxes,
            simulation_box: simulationBox,
            image_box: imageBox,
        };
    }, [attachedBoxIds, ensureBoxContexts]);

    const refreshSimulationContext = useCallback(async () => {
        try {
            const contexts = await ensureBoxContexts(attachedBoxIds);
            const targets: Array<{ boxId?: string; conversationId: string }> = [];
            const seen = new Set<string>();

            for (const boxId of attachedBoxIds) {
                const ctx = contexts[boxId];
                if (ctx?.type === 'simulation' && ctx.conversationId && !seen.has(ctx.conversationId)) {
                    targets.push({ boxId, conversationId: ctx.conversationId });
                    seen.add(ctx.conversationId);
                }
            }

            const fallbackConversation = globalChat.conversationId;
            if (fallbackConversation && !seen.has(fallbackConversation)) {
                targets.push({ conversationId: fallbackConversation });
                seen.add(fallbackConversation);
            }

            if (targets.length === 0) {
                return;
            }

            const snapshots = await Promise.all(
                targets.map(async (target) => {
                    try {
                        const snapshot = await fetchConversationContext(target.conversationId);
                        return { ...target, snapshot };
                    } catch (error) {
                        console.error('[ChatPanel] Context refresh failed:', error);
                        return null;
                    }
                })
            );

            const updatedCache: BoxContextCache = {};
            let latestSimulationData: SimulationData | null = null;

            for (const result of snapshots) {
                if (!result) continue;
                const { boxId, snapshot, conversationId } = result;
                const scene = snapshot?.scene || snapshot?.scene_state || null;
                const frames = Array.isArray(snapshot?.frames)
                    ? snapshot.frames
                    : Array.isArray(snapshot?.scene_state?.frames)
                        ? snapshot.scene_state.frames
                        : [];
                const meta = snapshot?.meta || snapshot?.scene_state?.meta;

                if (!latestSimulationData && scene) {
                    latestSimulationData = {
                        scene,
                        frames,
                        imageWidth: snapshot?.image_metadata?.width_px,
                        imageHeight: snapshot?.image_metadata?.height_px,
                        boxId,
                        conversationId,
                        meta,
                    };
                }

                if (boxId && contexts[boxId]?.type === 'simulation') {
                    const existing = contexts[boxId] as SimulationBoxContextPayload;
                    updatedCache[boxId] = {
                        ...existing,
                        conversationId,
                        objects: summarizeEntities(snapshot?.entities || []),
                        parameters: summarizeSceneParameters(scene || snapshot?.scene_state || existing.parameters),
                    };
                    globalChat.updateSimulationBox(boxId, {
                        conversationId,
                        hasSimulation: frames.length > 0,
                    });
                }

                if (scene) {
                    recordSimulationSnapshot(conversationId, {
                        scene,
                        frames,
                        imageWidth: snapshot?.image_metadata?.width_px,
                        imageHeight: snapshot?.image_metadata?.height_px,
                        boxId,
                        conversationId,
                        meta,
                    });
                }
            }

            if (Object.keys(updatedCache).length > 0) {
                setBoxContextCache((prev) => ({ ...prev, ...updatedCache }));
            }

            if (latestSimulationData?.scene && latestSimulationData.conversationId) {
                recordSimulationSnapshot(latestSimulationData.conversationId, latestSimulationData);
            }
        } catch (error) {
            console.error('[ChatPanel] Failed to refresh simulation context after tool call:', error);
        }
    }, [attachedBoxIds, ensureBoxContexts, globalChat, recordSimulationSnapshot]);

    const deriveConversationIdFromContext = useCallback((contextPayload?: UnifiedChatRequest['context']) => {
        if (!contextPayload) {
            return null;
        }

        const primary = contextPayload.simulation_box;
        if (primary?.conversationId) {
            return primary.conversationId;
        }

        const fallback = contextPayload.boxes?.find((box) => (
            box &&
            'type' in box &&
            (box as { type: string }).type === 'simulation' &&
            'conversationId' in box &&
            Boolean((box as { conversationId?: string }).conversationId)
        )) as { conversationId?: string } | undefined;

        return fallback?.conversationId ?? null;
    }, []);

    const handleModeToggle = (newMode: ChatMode) => {
        if (newMode !== mode) {
            // Close any active stream
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            setMode(newMode);
            setSelectedImage(null); // Clear image when switching modes
            // Keep attached boxes when switching modes for better UX
        }
    };

    const handleContextAttach = () => {
        setShowBoxModal(true);
    };

    const handleBoxSelect = (boxIds: string[]) => {
        setAttachedBoxIds(boxIds);
        void ensureBoxContexts(boxIds);
    };

    const handleRemoveAttachedBox = (boxId: string) => {
        setAttachedBoxIds(prev => prev.filter(id => id !== boxId));
    };

    const uploadImageToBackend = async (file: File): Promise<string> => {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/diagram/upload`, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`Image upload failed: ${response.statusText}`);
        }

        const data = await response.json();
        return data.image_id || data.id;
    };

    const onFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input.trim() && !selectedImage) return;

        // Build user message with simulation box context in agent mode
        let messageContent = input || 'Analyze this image';
        
        if (mode === 'agent' && globalChat.simulationBoxes.size > 0) {
            const boxContexts: string[] = [];
            globalChat.simulationBoxes.forEach((box) => {
                const details: string[] = [`"${box.name}"`];
                if (box.hasImage) details.push('has uploaded image');
                if (box.hasSimulation) details.push('has running simulation');
                if (box.conversationId) details.push(`conversation: ${box.conversationId.slice(0, 8)}`);
                boxContexts.push(`- Box ${details.join(', ')}`);
            });
            
            if (boxContexts.length > 0) {
                messageContent = `[Context: Current simulation boxes on canvas:\n${boxContexts.join('\n')}]\n\n${messageContent}`;
            }
        }

        const userInput: Message = { role: 'user', content: messageContent };
        globalChat.addMessage(userInput);
        setInput('');
        setIsLoading(true);
        setProgressMessages([]);

        try {
            // Upload image if selected
            let imageId: string | undefined;
            let attachments: Array<{ type: string; id: string }> = [];
            
            if (selectedImage) {
                try {
                    setProgressMessages(['📤 Uploading image...']);
                    imageId = await uploadImageToBackend(selectedImage);
                    attachments = [{ type: 'image', id: imageId }];
                    setProgressMessages(['✓ Image uploaded']);
                    setSelectedImage(null); // Clear after upload
                } catch (uploadError) {
                    toast({
                        variant: 'destructive',
                        title: 'Upload Failed',
                        description: uploadError instanceof Error ? uploadError.message : 'Failed to upload image',
                    });
                    setIsLoading(false);
                    setProgressMessages([]);
                    return;
                }
            }

            const contextPayload = await buildContextPayload();
            const derivedConversationId = deriveConversationIdFromContext(contextPayload);
            const conversationIdForRequest = derivedConversationId ?? globalChat.conversationId ?? undefined;

            if (derivedConversationId && derivedConversationId !== globalChat.conversationId) {
                globalChat.setConversationId(derivedConversationId);
            }

            conversationIdRef.current = conversationIdForRequest ?? null;
            pendingConversationRef.current = conversationIdRef.current;

            if (mode === 'agent') {
                // Agent mode: Use streaming for real-time progress
                const eventSource = streamAgentChat(
                    {
                        message: userInput.content,
                        conversation_id: conversationIdForRequest,
                        mode: 'agent',
                        attachments: attachments,
                        context: contextPayload,
                    },
                    {
                        onInit: ({ conversation_id }) => {
                            globalChat.setConversationId(conversation_id);
                            conversationIdRef.current = conversation_id;
                            pendingConversationRef.current = conversation_id;
                        },
                        onThinking: ({ status }) => {
                            setProgressMessages((prev) => [...prev, `🤔 ${status}...`]);
                        },
                        onToolStart: ({ tool, index, total }) => {
                            toolsUsedRef.current = true;
                            logToolDebug('tool_start', {
                                tool,
                                index,
                                total,
                                conversationId: globalChat.conversationId,
                            });
                            setProgressMessages((prev) => [
                                ...prev,
                                `[${index + 1}/${total}] Running ${tool}...`,
                            ]);
                        },
                        onToolComplete: ({ tool, success }) => {
                            logToolDebug('tool_complete', {
                                tool,
                                success,
                                conversationId: globalChat.conversationId,
                            });
                            if (success) {
                                setProgressMessages((prev) => {
                                    const updated = [...prev];
                                    const lastIndex = updated.length - 1;
                                    if (lastIndex >= 0) {
                                        updated[lastIndex] = `✓ ${tool} completed`;
                                    }
                                    return updated;
                                });
                            }
                        },
                        onToolError: ({ tool, error }) => {
                            logToolDebug('tool_error', {
                                tool,
                                error,
                                conversationId: globalChat.conversationId,
                            });
                            setProgressMessages((prev) => [
                                ...prev,
                                `❌ ${tool} failed: ${error}`,
                            ]);
                        },
                        onStateUpdate: (state) => {
                            const stateAny = state as Record<string, any>;
                            const conversationHint =
                                stateAny?.conversation_id ??
                                pendingConversationRef.current ??
                                conversationIdRef.current ??
                                globalChat.conversationId ??
                                null;

                            logToolDebug('state_update', {
                                ...state,
                                conversationId: conversationHint,
                            });

                            if (!conversationHint) {
                                return;
                            }

                            const previousSnapshot = globalChat.getSimulationSnapshot(conversationHint);
                            const sceneCandidate =
                                stateAny.scene ??
                                stateAny.scene_state ??
                                previousSnapshot?.scene ??
                                null;

                            const framesCandidate = Array.isArray(stateAny.frames)
                                ? stateAny.frames
                                : Array.isArray(stateAny.scene_state?.frames)
                                    ? stateAny.scene_state.frames
                                    : previousSnapshot?.frames ?? [];

                            if (!sceneCandidate && framesCandidate.length === 0) {
                                return;
                            }

                            const imageMeta = stateAny.image ?? stateAny.image_metadata;
                            const meta = stateAny.meta ?? stateAny.simulation_meta ?? previousSnapshot?.meta;

                            logToolDebug('scene_refresh', {
                                frames: framesCandidate.length,
                                hasScene: Boolean(sceneCandidate),
                                conversationId: conversationHint,
                            });

                            recordSimulationSnapshot(conversationHint, {
                                scene: sceneCandidate,
                                frames: framesCandidate,
                                imageWidth: imageMeta?.width_px ?? previousSnapshot?.imageWidth,
                                imageHeight: imageMeta?.height_px ?? previousSnapshot?.imageHeight,
                                meta,
                            });
                        },
                        onMessage: ({ content }) => {
                            const trimmed = typeof content === 'string' ? content.trim() : '';
                            if (!trimmed) {
                                console.debug('[ChatPanel] Skipping empty assistant message payload');
                                return;
                            }
                            logToolDebug('assistant_message', {
                                preview: trimmed.slice(0, 120),
                                conversationId: globalChat.conversationId,
                            });
                            globalChat.addMessage({ role: 'assistant', content });
                            setProgressMessages([]);
                            if (toolsUsedRef.current) {
                                logToolDebug('context_refresh', {
                                    reason: 'tools_used',
                                    conversationId: globalChat.conversationId,
                                });
                                toolsUsedRef.current = false;
                                void refreshSimulationContext();
                            }
                        },
                        onDone: ({ conversation_id }) => {
                            logToolDebug('stream_done', {
                                conversationId: conversation_id,
                            });
                            globalChat.setConversationId(conversation_id);
                            conversationIdRef.current = conversation_id;
                            pendingConversationRef.current = null;
                            setIsLoading(false);
                            // Keep attached boxes for next message (user can remove manually with X button)
                            if (eventSourceRef.current) {
                                eventSourceRef.current.close();
                                eventSourceRef.current = null;
                            }
                            toolsUsedRef.current = false;
                        },
                        onError: (error) => {
                            toast({
                                variant: 'destructive',
                                title: 'Streaming Error',
                                description: error.message,
                            });
                            setIsLoading(false);
                            setProgressMessages([]);
                            toolsUsedRef.current = false;
                            pendingConversationRef.current = null;
                        },
                    }
                );

                eventSourceRef.current = eventSource;
            } else {
                // Tutor mode: Simple request/response
                const response = await sendUnifiedChat({
                    message: userInput.content,
                    conversation_id: conversationIdForRequest,
                    mode: 'tutor',
                    context: contextPayload,
                });

                globalChat.setConversationId(response.conversation_id);
                globalChat.addMessage({ role: 'assistant', content: response.message });
                setIsLoading(false);
                
                // Keep attached boxes for next message (user can remove manually with X button)
            }
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error instanceof Error ? error.message : 'An unexpected error occurred.',
            });
            setIsLoading(false);
            setProgressMessages([]);
        }
    };

    const bodyPaddingClass =
        padding === 'flush'
            ? 'px-0 py-2 sm:px-1 md:px-2'
            : padding === 'compact'
                ? 'px-3 py-3 sm:px-4 md:px-5 md:py-4'
                : 'p-4 md:p-6';

    const inputPaddingClass =
        padding === 'flush'
            ? 'px-0 py-2 sm:px-1 sm:py-3 md:px-2 md:py-3'
            : padding === 'compact'
                ? 'px-3 py-3 md:px-5 md:py-4'
                : 'p-4 md:p-6';

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Mode Toggle Header */}
            <div className="border-b bg-background/95 px-3 py-3 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
                <div className="flex items-center gap-2">
                    <Button
                        variant={mode === 'tutor' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleModeToggle('tutor')}
                        className="gap-2"
                    >
                        <MessageSquare className="h-4 w-4" />
                        Tutor
                    </Button>
                    <Button
                        variant={mode === 'agent' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleModeToggle('agent')}
                        className="gap-2"
                    >
                        <Bot className="h-4 w-4" />
                        Agent
                    </Button>
                    <div className="ml-auto text-xs text-muted-foreground">
                        {mode === 'tutor' ? 'Tutor mode' : 'Tool-enabled mode'}
                    </div>
                </div>
                
                {/* All Boxes Display with + Button */}
                <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                    <div className="flex items-center justify-between mb-1">
                        <div className="font-medium text-muted-foreground">
                            Available Boxes ({getAllBoxes().length}):
                        </div>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={handleContextAttach}
                            title="Attach context boxes"
                        >
                            <Plus className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                    
                    {getAllBoxes().length === 0 ? (
                        <div className="text-[10px] text-muted-foreground py-1">
                            No boxes yet. Create simulation or image boxes on the canvas.
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {getAllBoxes().map((box) => {
                                const isAttached = attachedBoxIds.includes(box.id);
                                const isSimulation = box.type === 'simulation';
                                
                                return (
                                    <div 
                                        key={box.id} 
                                        className={cn(
                                            "flex items-center gap-2 text-muted-foreground rounded px-1 py-0.5 group",
                                            isAttached && "bg-primary/10 border border-primary/30"
                                        )}
                                    >
                                        <span className="text-[10px]">
                                            {isSimulation ? '🔷' : '🖼️'}
                                        </span>
                                        <span className="font-mono text-[10px] bg-background px-1 rounded flex-1">
                                            {box.name}
                                        </span>
                                        {isSimulation && 'hasImage' in box && box.hasImage && <span className="text-[10px]">📸</span>}
                                        {isSimulation && 'hasSimulation' in box && box.hasSimulation && <span className="text-[10px]">⚡</span>}
                                        {isAttached && (
                                            <>
                                                <span className="text-[10px] text-primary font-medium">
                                                    [Context]
                                                </span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-4 w-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                                    onClick={() => {
                                                        setAttachedBoxIds(prev => prev.filter(id => id !== box.id));
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Chat Messages */}
            <div className={cn('flex flex-1 min-h-0 flex-col', bodyPaddingClass)}>
                <ScrollArea className="flex-1" ref={scrollAreaRef}>
                    <ChatMessages messages={globalChat.messages} />
                    
                    {/* Simulation Visualization */}
                    {globalChat.simulationData && globalChat.simulationData.frames.length > 0 && (
                        <div className="mt-6">
                            <SimulationViewer
                                scene={globalChat.simulationData.scene}
                                frames={globalChat.simulationData.frames}
                                imageWidth={globalChat.simulationData.imageWidth}
                                imageHeight={globalChat.simulationData.imageHeight}
                            />
                        </div>
                    )}
                    
                    {/* Progress Messages (Agent mode streaming) */}
                    {progressMessages.length > 0 && (
                        <div className="mt-4 space-y-2">
                            {progressMessages.map((msg, i) => (
                                <div
                                    key={i}
                                    className="flex items-start gap-2 text-sm text-muted-foreground"
                                >
                                    <span className="font-mono">{msg}</span>
                                </div>
                            ))}
                        </div>
                    )}
                    
                    {isLoading && mode === 'tutor' && (
                        <ChatMessages messages={[{ role: 'assistant', content: 'Thinking...' }]} />
                    )}
                </ScrollArea>
            </div>

            {/* Input Area */}
            <div
                className={cn(
                    'border-t bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60',
                    inputPaddingClass
                )}
            >
                <ChatInput
                    input={input}
                    onInputChange={(e) => setInput(e.target.value)}
                    onFormSubmit={onFormSubmit}
                    isLoading={isLoading}
                    selectedImage={selectedImage}
                    onImageSelect={setSelectedImage}
                    placeholder={
                        mode === 'tutor'
                            ? 'Ask your tutor about physics concepts...'
                            : 'Describe what you want to simulate...'
                    }
                />
            </div>
            
            {/* Select Box Modal */}
            <SelectBoxModal
                open={showBoxModal}
                onClose={() => setShowBoxModal(false)}
                onSelect={handleBoxSelect}
                initialSelected={attachedBoxIds}
            />
        </div>
    );
}
