'use client';

import { useState } from 'react';
import { useGlobalChat } from '@/contexts/global-chat-context';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Box, ImageIcon, Zap, Image as ImageIconLucide } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SelectBoxModalProps {
    open: boolean;
    onClose: () => void;
    onSelect: (boxIds: string[]) => void;
    initialSelected?: string[];
}

export function SelectBoxModal({ open, onClose, onSelect, initialSelected = [] }: SelectBoxModalProps) {
    const { getAllBoxes } = useGlobalChat();
    const [selectedIds, setSelectedIds] = useState<string[]>(initialSelected);
    
    const allBoxes = getAllBoxes();

    const handleToggle = (boxId: string) => {
        setSelectedIds(prev => 
            prev.includes(boxId) 
                ? prev.filter(id => id !== boxId)
                : [...prev, boxId]
        );
    };

    const handleConfirm = () => {
        onSelect(selectedIds);
        onClose();
    };

    const handleCancel = () => {
        setSelectedIds(initialSelected);
        onClose();
    };

    return (
        <Dialog open={open} onOpenChange={handleCancel}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Select Context Boxes</DialogTitle>
                    <DialogDescription>
                        Choose simulation or image boxes to attach as context. The AI will have access to this information.
                    </DialogDescription>
                </DialogHeader>

                {allBoxes.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                        <Box className="mx-auto h-12 w-12 opacity-20 mb-2" />
                        <p>No boxes available.</p>
                        <p className="text-xs mt-1">Create simulation or image boxes on the canvas first.</p>
                    </div>
                ) : (
                    <ScrollArea className="max-h-[400px] pr-4">
                        <div className="space-y-2">
                            {allBoxes.map((box) => {
                                const isSelected = selectedIds.includes(box.id);
                                const isSimulation = box.type === 'simulation';
                                
                                return (
                                    <div
                                        key={box.id}
                                        className={cn(
                                            'flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                                            isSelected ? 'border-primary bg-primary/5' : 'border-input hover:bg-accent'
                                        )}
                                        onClick={() => handleToggle(box.id)}
                                    >
                                        <Checkbox
                                            checked={isSelected}
                                            onCheckedChange={() => handleToggle(box.id)}
                                            className="mt-1"
                                        />
                                        
                                        <div className="flex items-start gap-3 flex-1">
                                            {isSimulation ? (
                                                <Box className="h-5 w-5 mt-0.5 flex-shrink-0 text-blue-600" />
                                            ) : (
                                                <ImageIconLucide className="h-5 w-5 mt-0.5 flex-shrink-0 text-green-600" />
                                            )}
                                            
                                            <div className="flex-1 text-left">
                                                <div className="font-medium">{box.name}</div>
                                                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                                                    <span className="flex items-center gap-1">
                                                        {isSimulation ? '🔷 Simulation' : '🖼️ Image'}
                                                    </span>
                                                    
                                                    {isSimulation && 'hasImage' in box && box.hasImage && (
                                                        <span className="flex items-center gap-1">
                                                            <ImageIcon className="h-3 w-3" />
                                                            Image
                                                        </span>
                                                    )}
                                                    {isSimulation && 'hasSimulation' in box && box.hasSimulation && (
                                                        <span className="flex items-center gap-1">
                                                            <Zap className="h-3 w-3" />
                                                            Running
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                )}

                <DialogFooter>
                    <Button variant="outline" onClick={handleCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={selectedIds.length === 0}>
                        Attach {selectedIds.length > 0 && `(${selectedIds.length})`}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
