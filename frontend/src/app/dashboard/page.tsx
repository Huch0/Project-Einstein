"use client";

import { useEffect, useState, type ReactNode } from 'react';

import ChatPanel from '@/components/chat/chat-panel';
import ControlPane from '@/components/simulation/control-pane';
import SimulationWrapper from '@/components/simulation/simulation-wrapper';
import { GlobalChatProvider } from '@/contexts/global-chat-context';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { cn } from '@/lib/utils';

type PaneShellProps = {
    title: string;
    hint?: string;
    children: ReactNode;
    className?: string;
    bodyClassName?: string;
    headerClassName?: string;
};

function PaneShell({ title, hint, children, className, bodyClassName, headerClassName }: PaneShellProps) {
    return (
        <section className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
            <div
                className={cn(
                    'flex items-center justify-between border-b px-4 py-3',
                    headerClassName
                )}
            >
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {title}
                </h2>
                {hint ? (
                    <span className="text-xs font-medium text-muted-foreground">{hint}</span>
                ) : null}
            </div>
            <div className={cn('flex-1 min-h-0', bodyClassName)}>{children}</div>
        </section>
    );
}

export default function DashboardPage() {
    const [shouldStackPanels, setShouldStackPanels] = useState(false);

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 1023px)');
        const updateFromQuery = () => setShouldStackPanels(mediaQuery.matches);

        updateFromQuery();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', updateFromQuery);
            return () => {
                mediaQuery.removeEventListener('change', updateFromQuery);
            };
        }

        const legacyListener = () => updateFromQuery();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mediaQuery as any).addListener(legacyListener);
        return () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (mediaQuery as any).removeListener(legacyListener);
        };
    }, []);

    const horizontalResizeHint = shouldStackPanels
        ? 'Drag handle to adjust panel height'
        : 'Drag handle to adjust width';
    const verticalResizeHint = 'Drag handle to adjust height';

    return (
        <GlobalChatProvider>
            <div className="flex min-h-screen flex-col bg-muted/10">
                <ResizablePanelGroup direction="vertical" className="flex-1 overflow-hidden border-t bg-background">
                    <ResizablePanel defaultSize={65} minSize={20}>
                        <ResizablePanelGroup
                            direction={shouldStackPanels ? 'vertical' : 'horizontal'}
                        >
                            <ResizablePanel
                                defaultSize={shouldStackPanels ? 60 : 65}
                                minSize={shouldStackPanels ? 40 : 35}
                            >
                                <PaneShell
                                    title="Simulation Canvas"
                                    hint={horizontalResizeHint}
                                    headerClassName="px-2 py-3 sm:px-3"
                                    bodyClassName="flex-1 min-h-0 overflow-hidden p-0"
                                >
                                    <SimulationWrapper className="gap-0 m-0 p-0" />
                                </PaneShell>
                            </ResizablePanel>
                            <ResizableHandle
                                withHandle
                                aria-label={
                                    shouldStackPanels
                                        ? 'Resize simulation canvas and chat vertically'
                                        : 'Resize simulation canvas and chat horizontally'
                                }
                            />
                            <ResizablePanel
                                defaultSize={shouldStackPanels ? 40 : 35}
                                minSize={shouldStackPanels ? 30 : 25}
                            >
                                <PaneShell
                                    title="Assistant Chat"
                                    hint={horizontalResizeHint}
                                    headerClassName="px-2 py-3 sm:px-3"
                                    bodyClassName="flex-1 min-h-0"
                                >
                                    <ChatPanel padding="flush" />
                                </PaneShell>
                            </ResizablePanel>
                        </ResizablePanelGroup>
                    </ResizablePanel>
                    <ResizableHandle withHandle aria-label="Resize simulation controls section" />
                    <ResizablePanel defaultSize={35} minSize={20}>
                        <PaneShell
                            title="Simulation Controls"
                            hint={verticalResizeHint}
                            headerClassName="px-2 py-3 sm:px-3"
                            bodyClassName="flex-1 min-h-0 overflow-hidden"
                        >
                            <ControlPane />
                        </PaneShell>
                    </ResizablePanel>
                </ResizablePanelGroup>
            </div>
        </GlobalChatProvider>
    );
}
