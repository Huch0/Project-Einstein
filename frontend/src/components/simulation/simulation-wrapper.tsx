'use client';

import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UploadCloud, Trash2 } from 'lucide-react';

type LineData = {
  tool: string;
  points: number[];
};

export default function SimulationWrapper() {
  const [lines, setLines] = useState<LineData[]>([]);
  const isDrawing = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const resizeObserver = new ResizeObserver(entries => {
      if (entries[0]) {
        const { width, height } = entries[0].contentRect;
        setDimensions({ width, height });
      }
    });

    if (wrapperRef.current) {
      resizeObserver.observe(wrapperRef.current);
    }

    return () => {
      if (wrapperRef.current) {
        resizeObserver.unobserve(wrapperRef.current);
      }
    };
  }, []);

  const handleMouseUp = () => {
    isDrawing.current = false;
  };

  const handleClear = () => {
    setLines([]);
  };

  return (
    <div ref={wrapperRef} className="relative h-full w-full p-4 md:p-6">
      <div className="absolute inset-0 bg-muted/30 rounded-lg border-2 border-dashed border-muted-foreground/30 flex items-center justify-center -z-10">
        <p className="text-muted-foreground text-sm">Simulation Area</p>
      </div>

      {/* Placeholder for Simulation Canvas (e.g., PixiJS) */}
      <div
        id="simulation-canvas"
        className="absolute top-4 left-4 right-4 bottom-4 bg-primary/5 rounded-md flex items-center justify-center text-primary/50"
      >
        <p className="font-mono text-sm">[Simulation Canvas (PixiJS)]</p>
      </div>
      <div className="absolute top-6 right-6 flex gap-2">
        <Button variant="outline" size="icon" onClick={handleClear} aria-label="Clear drawing">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Dialog>
          <DialogTrigger asChild>
            <Button>
              <UploadCloud className="mr-2 h-4 w-4" />
              Upload Diagram
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Upload Physics Diagram</DialogTitle>
              <DialogDescription>
                Upload an image or PDF of a physics diagram to convert it into a
                simulation.
              </DialogDescription>
            </DialogHeader>
            <div className="grid flex-1 gap-2">
              <Label htmlFor="diagram-file" className="sr-only">
                Diagram File
              </Label>
              <Input id="diagram-file" type="file" />
            </div>
            <Button type="submit" className="w-full">
              Upload and Convert
            </Button>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
