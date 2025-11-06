'use client';

import { Button } from '@/components/ui/button';
import { CornerDownLeft, Mic, Image as ImageIcon, X } from 'lucide-react';
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';

type ChatInputProps = {
    input: string;
    onInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    onFormSubmit: (e: FormEvent<HTMLFormElement>) => void;
    isLoading: boolean;
    placeholder?: string;
    onImageSelect?: (file: File | null) => void;
    selectedImage?: File | null;
};

export function ChatInput({ 
    input, 
    onInputChange, 
    onFormSubmit, 
    isLoading, 
    placeholder,
    onImageSelect,
    selectedImage
}: ChatInputProps) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            // This is a bit of a hack to submit the form
            (e.target as HTMLTextAreaElement).form?.requestSubmit();
        }
    };

    const handleImageClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            onImageSelect?.(file);
            
            // Create preview URL
            const reader = new FileReader();
            reader.onloadend = () => {
                setPreviewUrl(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleRemoveImage = () => {
        onImageSelect?.(null);
        setPreviewUrl(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    return (
        <div className="space-y-2">
            {/* Image Preview */}
            {previewUrl && (
                <div className="relative inline-block rounded-lg border border-input bg-background p-2">
                    <img
                        src={previewUrl}
                        alt="Selected image"
                        className="h-32 w-auto rounded object-contain"
                    />
                    <Button
                        type="button"
                        variant="destructive"
                        size="icon"
                        className="absolute -right-2 -top-2 h-6 w-6 rounded-full"
                        onClick={handleRemoveImage}
                    >
                        <X className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {/* Input Form */}
            <form
                onSubmit={onFormSubmit}
                className="relative overflow-hidden rounded-lg border border-input bg-background focus-within:border-primary"
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                />
                <textarea
                    id="message"
                    name="message"
                    placeholder={placeholder || "e.g., Set the ramp angle to 45°, friction μ=0.2"}
                    className="w-full min-h-12 resize-none border-none bg-transparent p-3 text-sm text-foreground outline-none focus:border-none focus:outline-none focus:ring-0 focus-visible:border-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
                    value={input}
                    onChange={onInputChange}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading}
                    autoFocus
                />
                <div className="flex items-center p-3 pt-0">
                    <Button 
                        type="button" 
                        variant="ghost" 
                        size="icon" 
                        disabled={isLoading}
                        onClick={handleImageClick}
                        title="Upload image"
                    >
                        <ImageIcon className="h-4 w-4" />
                        <span className="sr-only">Upload Image</span>
                    </Button>
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
        </div>
    );
}
