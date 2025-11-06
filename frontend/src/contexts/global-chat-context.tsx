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

export type ImageBoxInfo = {
    id: string;
    name: string;
    imagePath: string; // Local file path for uploaded images
    uploadedAt: Date;
};

export type BoxInfo = 
    | (SimulationBoxInfo & { type: 'simulation' })
    | (ImageBoxInfo & { type: 'image' });

export type SimulationBoxUpdate = Partial<Omit<SimulationBoxInfo, 'id'>>;
export type ImageBoxUpdate = Partial<Omit<ImageBoxInfo, 'id'>>;

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
    imageBoxes: Map<string, ImageBoxInfo>;
    registerImageBox: (info: ImageBoxInfo) => void;
    unregisterImageBox: (boxId: string) => void;
    updateImageBox: (boxId: string, updates: ImageBoxUpdate) => void;
    getAllBoxes: () => BoxInfo[];
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
    const [imageBoxes, setImageBoxes] = useState<Map<string, ImageBoxInfo>>(new Map());

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

    const registerImageBox = useCallback((info: ImageBoxInfo) => {
        setImageBoxes((prev) => {
            const next = new Map(prev);
            next.set(info.id, info);
            return next;
        });
    }, []);

    const unregisterImageBox = useCallback((boxId: string) => {
        setImageBoxes((prev) => {
            const next = new Map(prev);
            next.delete(boxId);
            return next;
        });
    }, []);

    const updateImageBox = useCallback((boxId: string, updates: ImageBoxUpdate) => {
        setImageBoxes((prev) => {
            const next = new Map(prev);
            const existing = next.get(boxId);
            if (existing) {
                next.set(boxId, { ...existing, ...updates });
            }
            return next;
        });
    }, []);

    const getAllBoxes = useCallback((): BoxInfo[] => {
        const allBoxes: BoxInfo[] = [];
        
        // Add simulation boxes
        simulationBoxes.forEach((box) => {
            allBoxes.push({ ...box, type: 'simulation' });
        });
        
        // Add image boxes
        imageBoxes.forEach((box) => {
            allBoxes.push({ ...box, type: 'image' });
        });
        
        // Sort by name
        return allBoxes.sort((a, b) => a.name.localeCompare(b.name));
    }, [simulationBoxes, imageBoxes]);

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
        imageBoxes,
        registerImageBox,
        unregisterImageBox,
        updateImageBox,
        getAllBoxes,
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
        imageBoxes,
        registerImageBox,
        unregisterImageBox,
        updateImageBox,
        getAllBoxes,
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
