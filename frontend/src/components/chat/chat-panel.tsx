
'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useToast } from '@/hooks/use-toast';
import { useGlobalChat } from '@/contexts/global-chat-context';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { MessageSquare, Bot } from 'lucide-react';
import { sendUnifiedChat, streamAgentChat, type ChatMode } from '@/lib/unified-chat-api';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';
import { SimulationViewer } from '@/components/simulation/simulation-viewer';
import { cn } from '@/lib/utils';

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

type ChatPanelProps = {
    padding?: 'default' | 'compact' | 'flush';
};

export default function ChatPanel({ padding = 'default' }: ChatPanelProps = {}) {
    const { toast } = useToast();
    const globalChat = useGlobalChat();
    
    const [mode, setMode] = useState<ChatMode>('agent'); // Default to agent mode
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [progressMessages, setProgressMessages] = useState<string[]>([]);
    const [selectedImage, setSelectedImage] = useState<File | null>(null);
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
    }, [globalChat.messages]);

    // Update welcome message when mode changes
    useEffect(() => {
        if (globalChat.messages.length === 0) {
            globalChat.addMessage({
                role: 'assistant',
                content: mode === 'ask'
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

    const handleModeToggle = (newMode: ChatMode) => {
        if (newMode !== mode) {
            // Close any active stream
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
            }
            setMode(newMode);
            setSelectedImage(null); // Clear image when switching modes
        }
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

            if (mode === 'agent') {
                // Agent mode: Use streaming for real-time progress
                const eventSource = streamAgentChat(
                    {
                        message: userInput.content,
                        conversation_id: globalChat.conversationId,
                        mode: 'agent',
                        attachments: attachments,
                    },
                    {
                        onInit: ({ conversation_id }) => {
                            globalChat.setConversationId(conversation_id);
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
                                globalChat.setSimulationData({
                                    scene: (state as any).scene,
                                    frames: (state as any).frames,
                                    imageWidth: (state as any).image?.width_px || 800,
                                    imageHeight: (state as any).image?.height_px || 600,
                                });
                            }
                        },
                        onMessage: ({ content }) => {
                            globalChat.addMessage({ role: 'assistant', content });
                            setProgressMessages([]);
                        },
                        onDone: ({ conversation_id }) => {
                            globalChat.setConversationId(conversation_id);
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
                    conversation_id: globalChat.conversationId,
                    mode: 'ask',
                });

                globalChat.setConversationId(response.conversation_id);
                globalChat.addMessage({ role: 'assistant', content: response.message });
                setIsLoading(false);
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
                
                {/* Simulation Box Context Display */}
                {mode === 'agent' && globalChat.simulationBoxes.size > 0 && (
                    <div className="mt-2 rounded-md bg-muted/50 p-2 text-xs">
                        <div className="font-medium text-muted-foreground mb-1">
                            Active Simulation Boxes ({globalChat.simulationBoxes.size}):
                        </div>
                        <div className="space-y-1">
                            {Array.from(globalChat.simulationBoxes.values()).map((box) => (
                                <div key={box.id} className="flex items-center gap-2 text-muted-foreground">
                                    <span className="font-mono text-[10px] bg-background px-1 rounded">
                                        {box.name}
                                    </span>
                                    {box.hasImage && <span className="text-[10px]">📸</span>}
                                    {box.hasSimulation && <span className="text-[10px]">⚡</span>}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
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
                    
                    {isLoading && mode === 'ask' && (
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
                        mode === 'ask'
                            ? 'Ask about physics concepts...'
                            : 'Describe what you want to simulate...'
                    }
                />
            </div>
        </div>
    );
}
