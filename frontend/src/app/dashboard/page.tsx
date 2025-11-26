"use client";

import { useEffect, useState, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { ImperativePanelHandle } from 'react-resizable-panels';

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
    const [chatCollapsed, setChatCollapsed] = useState(false);
    const [controlsCollapsed, setControlsCollapsed] = useState(false);
    
    const chatPanelRef = useRef<ImperativePanelHandle>(null);
    const controlsPanelRef = useRef<ImperativePanelHandle>(null);

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

    const horizontalResizeHint = 'Drag handle to adjust width';
    const verticalResizeHint = 'Drag handle to adjust height';

    return (
        <GlobalChatProvider>
            <div className="flex h-screen flex-col overflow-hidden bg-muted/10 relative">
                {/* Collapsed Chat Tab (desktop horizontal layout) */}
                {!shouldStackPanels && chatCollapsed && (
                    <div 
                        className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-primary text-primary-foreground px-4 py-2 rounded-l-md cursor-pointer hover:bg-primary/90 transition-all shadow-lg"
                        onClick={() => {
                            chatPanelRef.current?.expand();
                            setChatCollapsed(false);
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <ChevronLeft className="h-4 w-4" />
                            <span className="text-xs font-medium whitespace-nowrap">Chat</span>
                        </div>
                    </div>
                )}
                
                {/* Collapsed Controls Tab */}
                {controlsCollapsed && (
                    <div 
                        className="fixed bottom-0 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground px-6 py-2 rounded-t-md cursor-pointer hover:bg-primary/90 transition-all shadow-lg"
                        onClick={() => {
                            controlsPanelRef.current?.expand();
                            setControlsCollapsed(false);
                        }}
                    >
                        <div className="flex items-center gap-2">
                            <ChevronUp className="h-4 w-4" />
                            <span className="text-xs font-medium whitespace-nowrap">Simulation Controls</span>
                        </div>
                    </div>
                )}

                {shouldStackPanels ? (
                    <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0 overflow-hidden border-t bg-background">
                        <ResizablePanel defaultSize={45} minSize={30}>
                            <PaneShell
                                title="Simulation Canvas"
                                hint={verticalResizeHint}
                                headerClassName="px-2 py-3 sm:px-3"
                                bodyClassName="flex-1 min-h-0 overflow-hidden p-0"
                            >
                                <SimulationWrapper className="gap-0 m-0 p-0" />
                            </PaneShell>
                        </ResizablePanel>
                        <ResizableHandle withHandle aria-label="Resize simulation canvas and assistant chat" />
                        <ResizablePanel defaultSize={30} minSize={20}>
                            <PaneShell
                                title="Assistant Chat"
                                hint={verticalResizeHint}
                                headerClassName="px-2 py-3 sm:px-3"
                                bodyClassName="flex-1 min-h-0"
                            >
                                <ChatPanel padding="flush" />
                            </PaneShell>
                        </ResizablePanel>
                        <ResizableHandle withHandle aria-label="Resize assistant chat and simulation controls" />
                        <ResizablePanel ref={controlsPanelRef} defaultSize={25} minSize={0} collapsedSize={0} collapsible onCollapse={() => setControlsCollapsed(true)} onExpand={() => setControlsCollapsed(false)}>
                            {controlsCollapsed ? (
                                <div className="h-8 bg-background border-t" />
                            ) : (
                                <PaneShell
                                    title="Simulation Controls"
                                    hint={verticalResizeHint}
                                    headerClassName="px-2 py-3 sm:px-3"
                                    bodyClassName="flex-1 min-h-0 overflow-hidden"
                                >
                                    <ControlPane />
                                </PaneShell>
                            )}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                ) : (
                    <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 overflow-hidden border-t bg-background">
                        <ResizablePanel defaultSize={65} minSize={45}>
                            <ResizablePanelGroup direction="vertical" className="h-full min-h-0">
                                <ResizablePanel defaultSize={60} minSize={35}>
                                    <PaneShell
                                        title="Simulation Canvas"
                                        hint={verticalResizeHint}
                                        headerClassName="px-2 py-3 sm:px-3"
                                        bodyClassName="flex-1 min-h-0 overflow-hidden p-0"
                                    >
                                        <SimulationWrapper className="gap-0 m-0 p-0" />
                                    </PaneShell>
                                </ResizablePanel>
                                <ResizableHandle withHandle aria-label="Resize simulation canvas and simulation controls" />
                                <ResizablePanel ref={controlsPanelRef} defaultSize={40} minSize={0} collapsedSize={0} collapsible onCollapse={() => setControlsCollapsed(true)} onExpand={() => setControlsCollapsed(false)}>
                                    {controlsCollapsed ? (
                                        <div className="h-8 bg-background border-t" />
                                    ) : (
                                        <PaneShell
                                            title="Simulation Controls"
                                            hint={verticalResizeHint}
                                            headerClassName="px-2 py-3 sm:px-3"
                                            bodyClassName="flex-1 min-h-0 overflow-hidden"
                                        >
                                            <ControlPane />
                                        </PaneShell>
                                    )}
                                </ResizablePanel>
                            </ResizablePanelGroup>
                        </ResizablePanel>
                        <ResizableHandle
                            withHandle
                            aria-label="Resize main simulation area and assistant chat"
                        />
                        <ResizablePanel ref={chatPanelRef} defaultSize={35} minSize={0} collapsedSize={0} collapsible onCollapse={() => setChatCollapsed(true)} onExpand={() => setChatCollapsed(false)}>
                            {chatCollapsed ? (
                                <div className="w-8 bg-background border-l" />
                            ) : (
                                <PaneShell
                                    title="Assistant Chat"
                                    hint={horizontalResizeHint}
                                    headerClassName="px-2 py-3 sm:px-3"
                                    bodyClassName="flex-1 min-h-0"
                                >
                                    <ChatPanel padding="flush" />
                                </PaneShell>
                            )}
                        </ResizablePanel>
                    </ResizablePanelGroup>
                )}
            </div>
        </GlobalChatProvider>
    );
}
