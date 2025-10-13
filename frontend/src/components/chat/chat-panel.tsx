
'use client';

import { useState, useRef, useEffect, type FormEvent } from 'react';
import { useToast } from '@/hooks/use-toast';

import { ScrollArea } from '@/components/ui/scroll-area';
import { sendChatTurn } from '@/lib/chat-api';
import { ChatMessages } from './chat-messages';
import { ChatInput } from './chat-input';

export type Message = {
    role: 'user' | 'assistant';
    content: string;
};

export default function ChatPanel() {
    const { toast } = useToast();
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: "Welcome to the Physics Lab Assistant! I can help you set up and refine your simulation. How can I assist you today? You can start by uploading a diagram or describing a scene.",
        },
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [conversationId, setConversationId] = useState<string | null>(null);

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


    const onFormSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!input.trim()) return;

        const userInput: Message = { role: 'user', content: input };
        setMessages((prev) => [...prev, userInput]);
        setInput('');
        setIsLoading(true);

        try {
            const chatResult = await sendChatTurn({
                conversationId,
                message: userInput.content,
            });
            setConversationId(chatResult.conversationId);

            if (chatResult.assistantMessages.length > 0) {
                const assistantMessages = chatResult.assistantMessages.map((assistantMessage) => ({
                    role: 'assistant' as const,
                    content: assistantMessage.content,
                }));
                setMessages((prev) => [...prev, ...assistantMessages]);
            }

            if (chatResult.toolMessages.length > 0) {
                console.debug('Received tool messages (not yet rendered):', chatResult.toolMessages);
            }
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error instanceof Error ? error.message : 'An unexpected error occurred.',
            });
            setMessages((prev) => prev.slice(0, -1));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-1 min-h-0 flex-col p-4 md:p-6">
                <ScrollArea className="flex-1" ref={scrollAreaRef}>
                    <ChatMessages messages={messages} />
                    {isLoading && <ChatMessages messages={[{ role: 'assistant', content: 'Thinking...' }]} />}
                </ScrollArea>
            </div>
            <div className="border-t bg-background/95 p-4 backdrop-blur-sm supports-[backdrop-filter]:bg-background/60 md:p-6">
                <ChatInput
                    input={input}
                    onInputChange={(e) => setInput(e.target.value)}
                    onFormSubmit={onFormSubmit}
                    isLoading={isLoading}
                />
            </div>
        </div>
    );
}
