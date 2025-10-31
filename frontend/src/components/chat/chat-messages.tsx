import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bot, User, Info } from 'lucide-react';
import type { Message } from './chat-panel';

export function ChatMessages({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {messages.map((message, index) => (
        <div key={index} className={cn('flex items-start gap-4 text-sm')}>
          <Avatar className={cn('h-8 w-8', message.role === 'user' ? 'order-2' : '')}>
            {message.role === 'assistant' ? (
                <AvatarFallback>
                    <Bot className="h-5 w-5"/>
                </AvatarFallback>
            ) : message.role === 'system' ? (
                <AvatarFallback>
                    <Info className="h-5 w-5"/>
                </AvatarFallback>
            ) : (
                <AvatarFallback>
                    <User className="h-5 w-5"/>
                </AvatarFallback>
            )}
          </Avatar>
          <div className={cn(
            'flex-1 rounded-lg p-3',
            message.role === 'user' 
              ? 'bg-primary text-primary-foreground' 
              : message.role === 'system'
              ? 'bg-muted border'
              : 'bg-card border'
          )}>
            <p className="whitespace-pre-wrap">{message.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
