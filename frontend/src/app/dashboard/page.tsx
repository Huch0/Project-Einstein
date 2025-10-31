"use client";

import { useState } from 'react';
import { MessageCircle, SlidersHorizontal } from 'lucide-react';

import ChatPanel from '@/components/chat/chat-panel';
import ControlPane from '@/components/simulation/control-pane';
import SimulationWrapper from '@/components/simulation/simulation-wrapper';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { GlobalChatProvider } from '@/contexts/global-chat-context';

export default function DashboardPage() {
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isControlsOpen, setIsControlsOpen] = useState(false);

    return (
        <GlobalChatProvider>
            <div className="relative h-full min-h-0 overflow-hidden">
                <SimulationWrapper />

                <div className="pointer-events-none absolute inset-0 z-30">
                    <div className="pointer-events-auto absolute bottom-4 right-4 flex flex-col gap-2">
                    <Sheet
                        open={isChatOpen}
                        onOpenChange={(open) => {
                            setIsChatOpen(open);
                            if (open) {
                                setIsControlsOpen(false);
                            }
                        }}
                    >
                        <SheetTrigger asChild>
                            <Button
                                type="button"
                                size="icon"
                                className="h-12 w-12 rounded-full shadow-lg"
                                aria-label="Open assistant chat"
                            >
                                <MessageCircle className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent
                            side="right"
                            className="flex w-full max-w-2xl flex-col overflow-hidden p-0"
                        >
                            <div className="flex items-center justify-between border-b px-4 py-3 pr-12">
                                <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                    Assistant Chat
                                </SheetTitle>
                            </div>
                            <div className="flex-1 min-h-0">
                                <ChatPanel />
                            </div>
                        </SheetContent>
                    </Sheet>

                    <Sheet
                        open={isControlsOpen}
                        onOpenChange={(open) => {
                            setIsControlsOpen(open);
                            if (open) {
                                setIsChatOpen(false);
                            }
                        }}
                    >
                        <SheetTrigger asChild>
                            <Button
                                type="button"
                                size="icon"
                                variant="secondary"
                                className="h-12 w-12 rounded-full shadow-lg"
                                aria-label="Open simulation controls"
                            >
                                <SlidersHorizontal className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent
                            side="bottom"
                            className="flex h-[70vh] w-full flex-col overflow-hidden p-0 sm:h-[60vh]"
                        >
                            <div className="flex items-center justify-between border-b px-4 py-3 pr-12">
                                <SheetTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                                    Simulation Controls
                                </SheetTitle>
                            </div>
                            <div className="flex-1 min-h-0 overflow-y-auto">
                                <ControlPane />
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </div>
        </GlobalChatProvider>
    );
}
