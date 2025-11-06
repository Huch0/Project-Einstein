"use client";

import React, { useRef, useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Pause, RotateCcw, Download } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  computeCanvasTransform,
  sceneMetersToCanvas,
  createBoundingTransform,
} from "@/simulation/coords";

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
    points_m?: Array<[number, number]>;
    polygon_m?: Array<[number, number]>;
  };
  notes?: string | null;
}

interface Constraint {
  type: "rope" | "spring" | "hinge" | "fixed" | "distance" | "ideal_fixed_pulley";
  body_a?: string;
  body_b?: string;
  point_a_m?: [number, number];
  point_b_m?: [number, number];
  length_m?: number;
  pulley_anchor_m?: [number, number];
  rope_length_m?: number;
  wheel_radius_m?: number;
  [key: string]: unknown;
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
  positions?: Record<string, [number, number]>;
  velocities?: Record<string, [number, number]>;
  forces?: Record<string, [number, number]>;
  bodies?: Array<{
    id: string;
    position_m: [number, number];
    angle_rad?: number;
  }>;
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

  const sceneBodyMap = useMemo(() => {
    const map = new Map<string, Body>();
    if (Array.isArray(scene?.bodies)) {
      for (const body of scene.bodies) {
        map.set(body.id, body);
      }
    }
    return map;
  }, [scene]);

  const frameBounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let found = false;

    for (const frame of frames) {
      if (Array.isArray(frame?.bodies)) {
        for (const body of frame.bodies) {
          const tuple = body?.position_m;
          if (!Array.isArray(tuple) || tuple.length < 2) continue;
          const x = Number(tuple[0]);
          const y = Number(tuple[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }

      if (frame?.positions) {
        for (const tuple of Object.values(frame.positions)) {
          if (!Array.isArray(tuple) || tuple.length < 2) continue;
          const x = Number(tuple[0]);
          const y = Number(tuple[1]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          found = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (!found) {
      return null;
    }

    if (Math.abs(maxX - minX) < 1e-6) {
      minX -= 0.5;
      maxX += 0.5;
    }
    if (Math.abs(maxY - minY) < 1e-6) {
      minY -= 0.5;
      maxY += 0.5;
    }

    return { minX, maxX, minY, maxY } as const;
  }, [frames]);

  const mappingTransform = React.useMemo(() => {
    const mappingSource = (scene as any)?.mapping as { origin_px?: unknown; scale_m_per_px?: unknown } | undefined;
    return computeCanvasTransform({
      mapping: mappingSource,
      imageSize: { width: imageWidth, height: imageHeight },
      containerSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
    });
  }, [scene, imageWidth, imageHeight]);

  const fallbackTransform = React.useMemo(() => {
    if (mappingTransform.hasMapping || !frameBounds) {
      return null;
    }
    return createBoundingTransform({
      bounds: frameBounds,
      containerSize: { width: CANVAS_WIDTH, height: CANVAS_HEIGHT },
      padding: PADDING,
    });
  }, [mappingTransform, frameBounds]);

  const activeTransform = fallbackTransform ?? mappingTransform;
  const pxPerMeter = activeTransform.metersToPixels;

  const worldToCanvas = (x: number, y: number): [number, number] =>
    sceneMetersToCanvas([x, y], activeTransform);

  // Draw function
  const drawFrame = (ctx: CanvasRenderingContext2D, frameIndex: number) => {
    const frame = frames[frameIndex];
    if (!frame) return;
    if (!Number.isFinite(pxPerMeter) || pxPerMeter <= 0) return;

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

    const frameBodyMap = new Map<string, { position: [number, number]; angle?: number }>();
    if (Array.isArray(frame.bodies)) {
      for (const entry of frame.bodies) {
        const tuple = entry?.position_m;
        if (!Array.isArray(tuple) || tuple.length < 2) continue;
        const x = Number(tuple[0]);
        const y = Number(tuple[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        frameBodyMap.set(entry.id, { position: [x, y], angle: entry.angle_rad });
      }
    }

    if (frame.positions) {
      for (const [id, tuple] of Object.entries(frame.positions)) {
        if (!Array.isArray(tuple) || tuple.length < 2) continue;
        const x = Number(tuple[0]);
        const y = Number(tuple[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (!frameBodyMap.has(id)) {
          frameBodyMap.set(id, { position: [x, y] });
        } else {
          const existing = frameBodyMap.get(id)!;
          existing.position = [x, y];
        }
      }
    }

    const resolveBodyPosition = (bodyId?: string): [number, number] | null => {
      if (!bodyId) return null;
      const frameEntry = frameBodyMap.get(bodyId);
      if (frameEntry) {
        return frameEntry.position;
      }
      const sceneBody = sceneBodyMap.get(bodyId);
      const tuple = sceneBody?.position_m;
      if (Array.isArray(tuple) && tuple.length >= 2) {
        const x = Number(tuple[0]);
        const y = Number(tuple[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return [x, y];
        }
      }
      return null;
    };

    const resolveBodyAngle = (bodyId?: string): number => {
      if (!bodyId) return 0;
      const frameEntry = frameBodyMap.get(bodyId);
      if (frameEntry?.angle !== undefined) {
        return frameEntry.angle;
      }
      const sceneBody = sceneBodyMap.get(bodyId);
      if (sceneBody?.angle_rad !== undefined) {
        return sceneBody.angle_rad;
      }
      return 0;
    };

    // Helper to resolve constraint anchors
    const resolveAnchor = (
      constraint: Constraint,
      side: "a" | "b",
      fallback: [number, number] | null
    ): [number, number] | null => {
      const suffix = side === "a" ? "a" : "b";
      const upper = side === "a" ? "A" : "B";
      const directKeys = [
        `anchor_${suffix}_world_m`,
        `anchor${upper}World_m`,
        `point_${suffix}_world_m`,
        `point${upper}World_m`,
        `anchor_${suffix}_absolute_m`,
        `anchor${upper}Absolute_m`,
      ];
      for (const key of directKeys) {
        const value = (constraint as any)[key];
        if (Array.isArray(value) && value.length >= 2) {
          const x = Number(value[0]);
          const y = Number(value[1]);
          if (Number.isFinite(x) && Number.isFinite(y)) {
            return [x, y];
          }
        }
      }
      const offsetKeys = [
        `anchor_${suffix}_m`,
        `anchor${upper}_m`,
        `point_${suffix}_m`,
        `point${upper}_m`,
        `offset_${suffix}_m`,
        `offset${upper}_m`,
      ];
      for (const key of offsetKeys) {
        const value = (constraint as any)[key];
        if (Array.isArray(value) && value.length >= 2 && fallback) {
          const ox = Number(value[0]);
          const oy = Number(value[1]);
          if (Number.isFinite(ox) && Number.isFinite(oy)) {
            return [fallback[0] + ox, fallback[1] + oy];
          }
        }
      }
      return fallback;
    };

    // Draw constraints first (behind bodies)
    scene.constraints.forEach((constraint) => {
      const posA = resolveBodyPosition(constraint.body_a);
      const posB = resolveBodyPosition(constraint.body_b);
      const fallbackA = posA ? ([posA[0], posA[1]] as [number, number]) : null;
      const fallbackB = posB ? ([posB[0], posB[1]] as [number, number]) : null;

      if (constraint.type === "ideal_fixed_pulley") {
        const pulleyAnchorRaw = (constraint as any).pulley_anchor_m;
        const pulleyAnchor = Array.isArray(pulleyAnchorRaw) && pulleyAnchorRaw.length >= 2
          ? ([Number(pulleyAnchorRaw[0]), Number(pulleyAnchorRaw[1])] as [number, number])
          : null;
        if (!pulleyAnchor) {
          return;
        }
        const anchorCanvas = worldToCanvas(pulleyAnchor[0], pulleyAnchor[1]);
        const anchorA = resolveAnchor(constraint, "a", fallbackA);
        const anchorB = resolveAnchor(constraint, "b", fallbackB);

        ctx.strokeStyle = "#8b5cf6";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);

        if (anchorA) {
          const [x1, y1] = worldToCanvas(anchorA[0], anchorA[1]);
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(anchorCanvas[0], anchorCanvas[1]);
          ctx.stroke();
        }

        if (anchorB) {
          const [x2, y2] = worldToCanvas(anchorB[0], anchorB[1]);
          ctx.beginPath();
          ctx.moveTo(anchorCanvas[0], anchorCanvas[1]);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }

        ctx.setLineDash([]);
        const pulleyRadius = Number((constraint as any).wheel_radius_m) || 0.1;
        const visualRadius = Math.max(pulleyRadius * pxPerMeter, 4);
        ctx.beginPath();
        ctx.strokeStyle = "#6366f1";
        ctx.lineWidth = 1.5;
        ctx.arc(anchorCanvas[0], anchorCanvas[1], visualRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = "rgba(99,102,241,0.12)";
        ctx.arc(anchorCanvas[0], anchorCanvas[1], visualRadius, 0, Math.PI * 2);
        ctx.fill();
        return;
      }

      const start = resolveAnchor(constraint, "a", fallbackA);
      const end = resolveAnchor(constraint, "b", fallbackB);
      if (!start || !end) {
        return;
      }

      const [x1, y1] = worldToCanvas(start[0], start[1]);
      const [x2, y2] = worldToCanvas(end[0], end[1]);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);

      switch (constraint.type) {
        case "rope":
          ctx.strokeStyle = "#8b5cf6";
          ctx.lineWidth = 2;
          ctx.setLineDash([6, 4]);
          break;
        case "spring":
          ctx.strokeStyle = "#f97316";
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          break;
        case "distance":
          ctx.strokeStyle = "#64748b";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          break;
        default:
          ctx.strokeStyle = "#6b7280";
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw bodies
    scene.bodies.forEach((body) => {
      const position = resolveBodyPosition(body.id);
      if (!position) return;

      const [cx, cy] = worldToCanvas(position[0], position[1]);
      const angle = resolveBodyAngle(body.id);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, -1);
      if (angle) {
        ctx.rotate(angle);
      }

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

      if (body.collider.type === "circle") {
        const radius = Math.max((body.collider.radius_m ?? 0.1) * pxPerMeter, 2);
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(radius, 0);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (body.collider.type === "rectangle") {
        const w = (body.collider.width_m ?? 0.1) * pxPerMeter;
        const h = (body.collider.height_m ?? 0.1) * pxPerMeter;
        ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.strokeRect(-w / 2, -h / 2, w, h);
      } else if (body.collider.type === "polygon" && body.collider.vertices) {
        const vertices = body.collider.vertices;
        if (vertices.length >= 3) {
          ctx.beginPath();
          for (let i = 0; i < vertices.length; i++) {
            const vx = position[0] + vertices[i][0];
            const vy = position[1] + vertices[i][1];
            const [vxCanvas, vyCanvas] = worldToCanvas(vx, vy);
            const localX = vxCanvas - cx;
            const localY = -(vyCanvas - cy);
            if (i === 0) {
              ctx.moveTo(localX, localY);
            } else {
              ctx.lineTo(localX, localY);
            }
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }

      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
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
  }, [currentFrame, scene, frames, activeTransform, pxPerMeter]);

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
