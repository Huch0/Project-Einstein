'use client';

import { Button } from '@/components/ui/button';
import { CornerDownLeft, Mic } from 'lucide-react';
import type { FormEvent } from 'react';

type ChatInputProps = {
    input: string;
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onFormSubmit: (e: FormEvent<HTMLFormElement>) => void;
    isLoading: boolean;
};

export function ChatInput({ input, onInputChange, onFormSubmit, isLoading }: ChatInputProps) {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // This is a bit of a hack to submit the form
            (e.target as HTMLTextAreaElement).form?.requestSubmit();
        }
    };

    return (
        <form
            onSubmit={onFormSubmit}
            className="relative overflow-hidden rounded-lg border border-input bg-background focus-within:border-primary"
        >
            <textarea
                id="message"
                name="message"
                placeholder="e.g., Set the ramp angle to 45°, friction μ=0.2"
                className="w-full min-h-12 resize-none border-none bg-transparent p-3 text-sm text-foreground outline-none focus:border-none focus:outline-none focus:ring-0 focus-visible:border-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                value={input}
                onChange={onInputChange}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
                autoFocus
            />
            <div className="flex items-center p-3 pt-0">
                <Button type="button" variant="ghost" size="icon" disabled={isLoading}>
                    <Mic className="h-4 w-4" />
                    <span className="sr-only">Use Microphone</span>
                </Button>
                <Button type="submit" size="sm" className="ml-auto gap-1.5" disabled={isLoading}>
                    Send
                    <CornerDownLeft className="h-3.5 w-3.5" />
                </Button>
            </div>
        </form>
    );
}
