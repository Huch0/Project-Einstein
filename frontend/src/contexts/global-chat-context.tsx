'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';

export type Message = {
    role: 'user' | 'assistant' | 'system';
    content: string;
    boxId?: string; // Optional: which simulation box this message is related to
};

export type SimulationData = {
    scene: any;
    frames: any[];
    imageWidth?: number;
    imageHeight?: number;
    boxId?: string; // Which simulation box created this
};

export type SimulationBoxInfo = {
    id: string;
    name: string;
    conversationId?: string;
    hasImage: boolean;
    hasSimulation: boolean;
};

export type SimulationBoxUpdate = Partial<Omit<SimulationBoxInfo, 'id'>>;

interface GlobalChatContextType {
    messages: Message[];
    addMessage: (message: Message) => void;
    clearMessages: () => void;
    conversationId: string | null;
    setConversationId: (id: string | null) => void;
    simulationData: SimulationData | null;
    setSimulationData: (data: SimulationData | null) => void;
    activeBoxId: string | null;
    setActiveBoxId: (id: string | null) => void;
    simulationBoxes: Map<string, SimulationBoxInfo>;
    registerSimulationBox: (info: SimulationBoxInfo) => void;
    unregisterSimulationBox: (boxId: string) => void;
    updateSimulationBox: (boxId: string, updates: SimulationBoxUpdate) => void;
}

const GlobalChatContext = createContext<GlobalChatContextType | null>(null);

export function GlobalChatProvider({ children }: { children: ReactNode }) {
    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'assistant',
            content: "Welcome! I'm your physics simulation assistant. Create a simulation box on the canvas or chat with me here.",
        },
    ]);
    const [conversationId, setConversationId] = useState<string | null>(null);
    const [simulationData, setSimulationData] = useState<SimulationData | null>(null);
    const [activeBoxId, setActiveBoxId] = useState<string | null>(null);
    const [simulationBoxes, setSimulationBoxes] = useState<Map<string, SimulationBoxInfo>>(new Map());

    const addMessage = useCallback((message: Message) => {
        setMessages((prev) => [...prev, message]);
    }, []);

    const clearMessages = useCallback(() => {
        setMessages([
            {
                role: 'assistant',
                content: "Welcome! I'm your physics simulation assistant. Create a simulation box on the canvas or chat with me here.",
            },
        ]);
        setConversationId(null);
        setSimulationData(null);
    }, []);

    const registerSimulationBox = useCallback((info: SimulationBoxInfo) => {
        setSimulationBoxes((prev) => {
            const next = new Map(prev);
            next.set(info.id, info);
            return next;
        });
    }, []);

    const unregisterSimulationBox = useCallback((boxId: string) => {
        setSimulationBoxes((prev) => {
            const next = new Map(prev);
            next.delete(boxId);
            return next;
        });
    }, []);

    const updateSimulationBox = useCallback((boxId: string, updates: SimulationBoxUpdate) => {
        setSimulationBoxes((prev) => {
            const next = new Map(prev);
            const existing = next.get(boxId);
            if (existing) {
                next.set(boxId, { ...existing, ...updates });
            }
            return next;
        });
    }, []);

    const contextValue = useMemo(() => ({
        messages,
        addMessage,
        clearMessages,
        conversationId,
        setConversationId,
        simulationData,
        setSimulationData,
        activeBoxId,
        setActiveBoxId,
        simulationBoxes,
        registerSimulationBox,
        unregisterSimulationBox,
        updateSimulationBox,
    }), [
        messages,
        addMessage,
        clearMessages,
        conversationId,
        setConversationId,
        simulationData,
        setSimulationData,
        activeBoxId,
        setActiveBoxId,
        simulationBoxes,
        registerSimulationBox,
        unregisterSimulationBox,
        updateSimulationBox,
    ]);

    return (
        <GlobalChatContext.Provider value={contextValue}>
            {children}
        </GlobalChatContext.Provider>
    );
}

export function useGlobalChat() {
    const context = useContext(GlobalChatContext);
    if (!context) {
        throw new Error('useGlobalChat must be used within GlobalChatProvider');
    }
    return context;
}
