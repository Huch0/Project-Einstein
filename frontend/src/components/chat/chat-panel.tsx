
'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useToast } from '@/hooks/use-toast';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Bot } from 'lucide-react';
import { sendUnifiedChat, streamAgentChat, type ChatMode } from '@/lib/unified-chat-api';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';
import { SimulationViewer } from '@/components/simulation/simulation-viewer';

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
};

export type SimulationData = {
    scene: any;
    frames: any[];
    imageWidth?: number;
    imageHeight?: number;
};

export default function ChatPanel() {
    const { toast } = useToast();
    const [mode, setMode] = useState<ChatMode>('ask');
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: mode === 'ask'
                ? "Hello! I'm your physics tutor. Ask me anything about physics concepts, laws, or problem-solving strategies."
                : "Welcome to the Physics Lab Assistant! I can help you analyze diagrams and create simulations. Upload an image or describe what you want to simulate.",
        },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [progressMessages, setProgressMessages] = useState<string[]>([]);
    const [simulationData, setSimulationData] = useState<SimulationData | null>(null);
    const eventSourceRef = useRef<EventSource | null>(null);

    const scrollAreaRef = useRef<HTMLDivElement>(null);

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
    }, [messages]);

    // Update welcome message when mode changes
    useEffect(() => {
        setMessages([
            {
                role: 'assistant',
                content: mode === 'ask'
                    ? "Hello! I'm your physics tutor. Ask me anything about physics concepts, laws, or problem-solving strategies."
                    : "Welcome to the Physics Lab Assistant! I can help you analyze diagrams and create simulations. Upload an image or describe what you want to simulate.",
            },
        ]);
        setConversationId(null); // Reset conversation on mode change
    }, [mode]);

    // Cleanup EventSource on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const handleModeToggle = (newMode: ChatMode) => {
        if (newMode !== mode) {
            // Close any active stream
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            setMode(newMode);
        }
    };

    const onFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input.trim()) return;

        const userInput: Message = { role: 'user', content: input };
        setMessages((prev) => [...prev, userInput]);
        setInput('');
        setIsLoading(true);
        setProgressMessages([]);

        try {
            if (mode === 'agent') {
                // Agent mode: Use streaming for real-time progress
                const eventSource = streamAgentChat(
                    {
                        message: userInput.content,
                        conversation_id: conversationId,
                        mode: 'agent',
                        attachments: [], // TODO: Add image upload support
                    },
                    {
                        onInit: ({ conversation_id }) => {
                            setConversationId(conversation_id);
                        },
                        onThinking: ({ status }) => {
                            setProgressMessages((prev) => [...prev, `🤔 ${status}...`]);
                        },
                        onToolStart: ({ tool, index, total }) => {
                            setProgressMessages((prev) => [
                                ...prev,
                                `[${index + 1}/${total}] Running ${tool}...`,
                            ]);
                        },
                        onToolComplete: ({ tool, success }) => {
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
                            setProgressMessages((prev) => [
                                ...prev,
                                `❌ ${tool} failed: ${error}`,
                            ]);
                        },
                        onStateUpdate: (state) => {
                            console.debug('State update:', state);
                            
                            // Capture simulation data when frames are available
                            if ((state as any).frames && (state as any).scene) {
                                setSimulationData({
                                    scene: (state as any).scene,
                                    frames: (state as any).frames,
                                    imageWidth: (state as any).image?.width_px || 800,
                                    imageHeight: (state as any).image?.height_px || 600,
                                });
                            }
                        },
                        onMessage: ({ content }) => {
                            setMessages((prev) => [
                                ...prev,
                                { role: 'assistant', content },
                            ]);
                            setProgressMessages([]);
                        },
                        onDone: ({ conversation_id }) => {
                            setConversationId(conversation_id);
                            setIsLoading(false);
                            if (eventSourceRef.current) {
                                eventSourceRef.current.close();
                                eventSourceRef.current = null;
                            }
                        },
                        onError: (error) => {
                            toast({
                                variant: 'destructive',
                                title: 'Streaming Error',
                                description: error.message,
                            });
                            setIsLoading(false);
                            setProgressMessages([]);
                        },
                    }
                );

                eventSourceRef.current = eventSource;
            } else {
                // Ask mode: Simple request/response
                const response = await sendUnifiedChat({
                    message: userInput.content,
                    conversation_id: conversationId,
                    mode: 'ask',
                });

                setConversationId(response.conversation_id);
                setMessages((prev) => [
                    ...prev,
                    { role: 'assistant', content: response.message },
                ]);
                setIsLoading(false);
            }
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error instanceof Error ? error.message : 'An unexpected error occurred.',
            });
            setMessages((prev) => prev.slice(0, -1));
            setIsLoading(false);
            setProgressMessages([]);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Mode Toggle Header */}
            <div className="border-b bg-background/95 p-3 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60">
                <div className="flex items-center gap-2">
                    <Button
                        variant={mode === 'ask' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => handleModeToggle('ask')}
                        className="gap-2"
                    >
                        <MessageSquare className="h-4 w-4" />
                        Ask
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
                        {mode === 'ask' ? 'Chat mode' : 'Tool-enabled mode'}
                    </div>
                </div>
            </div>

            {/* Chat Messages */}
            <div className="flex flex-1 min-h-0 flex-col p-4 md:p-6">
                <ScrollArea className="flex-1" ref={scrollAreaRef}>
                    <ChatMessages messages={messages} />
                    
                    {/* Simulation Visualization */}
                    {simulationData && simulationData.frames.length > 0 && (
                        <div className="mt-6">
                            <SimulationViewer
                                scene={simulationData.scene}
                                frames={simulationData.frames}
                                imageWidth={simulationData.imageWidth}
                                imageHeight={simulationData.imageHeight}
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
                    
                    {isLoading && mode === 'ask' && (
                        <ChatMessages messages={[{ role: 'assistant', content: 'Thinking...' }]} />
                    )}
                </ScrollArea>
            </div>

            {/* Input Area */}
            <div className="border-t bg-background/95 p-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60 md:p-6">
                <ChatInput
                    input={input}
                    onInputChange={(e) => setInput(e.target.value)}
                    onFormSubmit={onFormSubmit}
                    isLoading={isLoading}
                    placeholder={
                        mode === 'ask'
                            ? 'Ask about physics concepts...'
                            : 'Describe what you want to simulate...'
                    }
                />
            </div>
        </div>
    );
}
