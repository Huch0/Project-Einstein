/**
 * Agent Chat Panel for SimulationBox
 * 
 * Natural language interface for simulation inspection and modification.
 */

import { useState, useRef, useEffect } from 'react';
import { Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AgentContext } from '@/lib/agent-api';

export interface AgentChatPanelProps {
  boxName?: string;  // Name of the simulation box
  conversationId?: string;
  context?: AgentContext;
  onSendMessage: (message: string) => Promise<void>;
  onClose: () => void;
  loading?: boolean;
}

export function AgentChatPanel({
  boxName,
  conversationId,
  context,
  onSendMessage,
  onClose,
  loading = false,
}: AgentChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [context?.messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const message = input.trim();
    setInput('');
    
    try {
      await onSendMessage(message);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-background/95 backdrop-blur">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {boxName ? `${boxName} - Agent Chat` : 'Agent Chat'}
          </span>
          {conversationId && (
            <span className="text-xs text-muted-foreground">
              {context?.entities.length || 0} entities · {context?.frames.length || 0} frames
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {!context || context.messages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              <p>No conversation yet.</p>
              <p className="text-xs mt-1">Upload an image to start!</p>
            </div>
          ) : (
            context.messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted'
                  }`}
                >
                  <div className="font-medium text-xs opacity-70 mb-1">
                    {msg.role === 'user' ? 'You' : 'Agent'}
                  </div>
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                  {msg.timestamp && (
                    <div className="text-xs opacity-50 mt-1">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span className="text-muted-foreground">Agent thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask the agent anything..."
            disabled={loading || !conversationId}
            className="flex-1"
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || loading || !conversationId}
            size="icon"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        
        {/* Quick Actions */}
        {conversationId && (
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onSendMessage('What is the system acceleration?')}
              disabled={loading}
            >
              Acceleration?
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onSendMessage('Check energy conservation')}
              disabled={loading}
            >
              Energy Check
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => onSendMessage('Increase mass A by 1kg')}
              disabled={loading}
            >
              Modify Mass
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
