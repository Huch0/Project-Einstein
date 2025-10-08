'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Code, Download, Bot } from 'lucide-react';
import { handleGenerateCode } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

export default function CodePanel() {
  const { toast } = useToast();
  const [code, setCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const onGenerateCode = async () => {
    setIsLoading(true);
    setCode(null);
    try {
      const result = await handleGenerateCode();
      if (result.error) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: result.error,
        });
      } else {
        setCode(result.code ?? 'No code generated.');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'An unexpected error occurred while generating code.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <div className="flex justify-between items-start">
            <div>
                <CardTitle className="font-headline text-lg">Export to Code</CardTitle>
                <CardDescription className="mt-1">
                Generate a Python script to reproduce the simulation.
                </CardDescription>
            </div>
            <Button onClick={onGenerateCode} disabled={isLoading}>
                <Bot className="mr-2 h-4 w-4" />
                {isLoading ? 'Generating...' : 'Generate Code'}
            </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 min-h-0">
        <div className="relative h-full rounded-md border bg-muted/50">
          <ScrollArea className="h-full">
            <pre className="p-4 text-sm">
              {isLoading ? (
                <div className="space-y-2">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-full" />
                </div>
              ) : (
                <code className="font-code">{code || '// Click "Generate Code" to see the Python script here'}</code>
              )}
            </pre>
          </ScrollArea>
           {code && !isLoading && (
            <Button variant="ghost" size="icon" className="absolute top-2 right-2">
              <Download className="h-4 w-4" />
              <span className="sr-only">Download Code</span>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
