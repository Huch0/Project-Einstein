"use client";

import React, { useRef, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Pause, RotateCcw, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface Body {
  id: string;
  type: "dynamic" | "static" | "kinematic";
  mass_kg: number;
  position_m: [number, number];
  angle_rad?: number;
  collider: {
    type: "circle" | "rectangle" | "polygon";
    radius_m?: number;
    width_m?: number;
    height_m?: number;
    vertices?: Array<[number, number]>;
  };
}

interface Constraint {
  type: "rope" | "spring" | "hinge" | "fixed" | "distance";
  body_a?: string;
  body_b?: string;
  point_a_m?: [number, number];
  point_b_m?: [number, number];
  length_m?: number;
}

interface Scene {
  version: string;
  world: {
    gravity_m_s2: number;
    time_step_s: number;
  };
  bodies: Body[];
  constraints: Constraint[];
}

interface Frame {
  t: number;
  positions: Record<string, [number, number]>;
  velocities?: Record<string, [number, number]>;
  forces?: Record<string, [number, number]>;
}

interface SimulationViewerProps {
  scene: Scene;
  frames: Frame[];
  imageWidth?: number;
  imageHeight?: number;
}

export function SimulationViewer({
  scene,
  frames,
  imageWidth = 800,
  imageHeight = 600,
}: SimulationViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // Calculate canvas scale (meters to pixels)
  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 600;
  const PADDING = 40;

  // Find min/max positions to determine scale
  const { minX, maxX, minY, maxY } = React.useMemo(() => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    frames.forEach((frame) => {
      Object.values(frame.positions).forEach(([x, y]) => {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      });
    });

    return { minX, maxX, minY, maxY };
  }, [frames]);

  const scaleX = (CANVAS_WIDTH - 2 * PADDING) / (maxX - minX || 1);
  const scaleY = (CANVAS_HEIGHT - 2 * PADDING) / (maxY - minY || 1);
  const scale = Math.min(scaleX, scaleY);

  const worldToCanvas = (x: number, y: number): [number, number] => {
    const canvasX = PADDING + (x - minX) * scale;
    const canvasY = CANVAS_HEIGHT - PADDING - (y - minY) * scale; // Flip Y
    return [canvasX, canvasY];
  };

  // Draw function
  const drawFrame = (ctx: CanvasRenderingContext2D, frameIndex: number) => {
    const frame = frames[frameIndex];
    if (!frame) return;

    // Clear canvas
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw grid
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const x = (CANVAS_WIDTH / 10) * i;
      const y = (CANVAS_HEIGHT / 10) * i;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }

    // Draw constraints first (behind bodies)
    scene.constraints.forEach((constraint) => {
      if (!constraint.body_a || !constraint.body_b) return;

      const posA = frame.positions[constraint.body_a];
      const posB = frame.positions[constraint.body_b];
      if (!posA || !posB) return;

      const [x1, y1] = worldToCanvas(posA[0], posA[1]);
      const [x2, y2] = worldToCanvas(posB[0], posB[1]);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      if (constraint.type === "rope") {
        ctx.strokeStyle = "#8b5cf6";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
      } else if (constraint.type === "spring") {
        ctx.strokeStyle = "#f97316";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
      } else {
        ctx.strokeStyle = "#6b7280";
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw bodies
    scene.bodies.forEach((body) => {
      const position = frame.positions[body.id];
      if (!position) return;

      const [cx, cy] = worldToCanvas(position[0], position[1]);

      ctx.save();
      ctx.translate(cx, cy);
      if (body.angle_rad) {
        ctx.rotate(-body.angle_rad); // Negate for canvas coords
      }

      // Set color based on body type
      if (body.type === "dynamic") {
        ctx.fillStyle = "#3b82f6";
        ctx.strokeStyle = "#1e40af";
      } else if (body.type === "static") {
        ctx.fillStyle = "#6b7280";
        ctx.strokeStyle = "#374151";
      } else {
        ctx.fillStyle = "#10b981";
        ctx.strokeStyle = "#047857";
      }

      ctx.lineWidth = 2;

      // Draw collider
      if (body.collider.type === "circle") {
        const radius = (body.collider.radius_m || 0.1) * scale;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        // Draw orientation line
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(radius, 0);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (body.collider.type === "rectangle") {
        const w = (body.collider.width_m || 0.1) * scale;
        const h = (body.collider.height_m || 0.1) * scale;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      } else if (body.collider.type === "polygon" && body.collider.vertices) {
        ctx.beginPath();
        const vertices = body.collider.vertices;
        const [x0, y0] = worldToCanvas(
          position[0] + vertices[0][0],
          position[1] + vertices[0][1]
        );
        ctx.moveTo(x0 - cx, y0 - cy);
        for (let i = 1; i < vertices.length; i++) {
          const [xi, yi] = worldToCanvas(
            position[0] + vertices[i][0],
            position[1] + vertices[i][1]
          );
          ctx.lineTo(xi - cx, yi - cy);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }

      // Draw body label
      ctx.fillStyle = "#ffffff";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(body.id, 0, 0);

      ctx.restore();
    });

    // Draw frame info
    ctx.fillStyle = "#000000";
    ctx.font = "14px monospace";
    ctx.textAlign = "left";
    ctx.fillText(`Frame: ${frameIndex + 1}/${frames.length}`, 10, 20);
    ctx.fillText(`Time: ${frame.t.toFixed(3)}s`, 10, 40);
  };

  // Animation loop
  useEffect(() => {
    if (!isPlaying || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const animate = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const deltaTime = timestamp - lastTimeRef.current;

      // Update frame based on playback speed
      const frameRate = 60; // Match simulation frame rate
      const frameTime = 1000 / frameRate;
      if (deltaTime >= frameTime / playbackSpeed) {
        setCurrentFrame((prev) => {
          const next = prev + 1;
          if (next >= frames.length) {
            setIsPlaying(false);
            return frames.length - 1;
          }
          return next;
        });
        lastTimeRef.current = timestamp;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, frames.length]);

  // Draw current frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawFrame(ctx, currentFrame);
  }, [currentFrame, scene, frames]);

  const handlePlayPause = () => {
    if (currentFrame >= frames.length - 1) {
      setCurrentFrame(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleRestart = () => {
    setCurrentFrame(0);
    setIsPlaying(false);
    lastTimeRef.current = 0;
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `simulation_frame_${currentFrame}.png`;
    link.href = canvas.toDataURL();
    link.click();
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Physics Simulation</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative border rounded-lg overflow-hidden bg-white">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handlePlayPause}
            disabled={frames.length === 0}
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleRestart}
            disabled={frames.length === 0}
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={handleDownload}
            disabled={frames.length === 0}
          >
            <Download className="h-4 w-4" />
          </Button>

          <div className="flex-1 mx-4">
            <Slider
              value={[currentFrame]}
              onValueChange={(value) => setCurrentFrame(value[0])}
              max={frames.length - 1}
              step={1}
              disabled={frames.length === 0}
            />
          </div>

          <div className="text-sm text-muted-foreground min-w-24">
            Speed: {playbackSpeed}x
          </div>
          <Slider
            value={[playbackSpeed]}
            onValueChange={(value) => setPlaybackSpeed(value[0])}
            min={0.25}
            max={2}
            step={0.25}
            className="w-24"
          />
        </div>

        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <div className="font-medium">Bodies</div>
            <div className="text-muted-foreground">{scene.bodies.length}</div>
          </div>
          <div>
            <div className="font-medium">Constraints</div>
            <div className="text-muted-foreground">{scene.constraints.length}</div>
          </div>
          <div>
            <div className="font-medium">Duration</div>
            <div className="text-muted-foreground">
              {frames.length > 0 ? `${frames[frames.length - 1].t.toFixed(2)}s` : "0s"}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
