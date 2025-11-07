"use client";

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Pause, StepForward, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSimulation } from '@/simulation/SimulationContext';
import { useGlobalChat } from '@/contexts/global-chat-context';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

type Scope = 'global' | 'entity';

const normalizeAngleDeg = (value: number): number => ((value % 360) + 360) % 360;
const degToRad = (deg: number): number => (deg * Math.PI) / 180;
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;
const MAX_VELOCITY_DECIMALS = 4;
const formatVelocityText = (value: number): string =>
  Number.isFinite(value) ? Number(value.toFixed(MAX_VELOCITY_DECIMALS)).toString() : '0';
const isPartialNumberInput = (value: string): boolean => {
  if (value === '' || value === '-' || value === '+' || value === '.' || value === ',') {
    return true;
  }
  return /[.,]$/.test(value);
};
const MAX_POSITION_DECIMALS = 4;
const formatPositionText = (value: number): string =>
  Number.isFinite(value) ? Number(value.toFixed(MAX_POSITION_DECIMALS)).toString() : '0';

type VelocityState = {
  magnitude: number;
  angleDeg: number;
  vxText: string;
  vyText: string;
};

type PositionState = {
  xText: string;
  yText: string;
};

const DEFAULT_VELOCITY_STATE: VelocityState = {
  magnitude: 0,
  angleDeg: 0,
  vxText: '0',
  vyText: '0',
};

const DEFAULT_POSITION_STATE: PositionState = {
  xText: '0',
  yText: '0',
};

export default function ParametersPanel() {
  const { 
    gravity, dt, restitution, duration,
    updateConfig, resetSimulation, 
    playing, setPlaying, scene, labels,
    updateSceneAndResimulate
  } = useSimulation();
  const globalChat = useGlobalChat();
  const [scope, setScope] = useState<Scope>('global');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  
  // Physics parameters (must be at top level, not conditionally called)
  const [friction, setFriction] = useState(0.5);
  const [entityRestitution, setEntityRestitution] = useState(1);
  const [density, setDensity] = useState(1.0);
  const [velocityState, setVelocityState] = useState<VelocityState>(() => ({ ...DEFAULT_VELOCITY_STATE }));
  const [positionState, setPositionState] = useState<PositionState>(() => ({ ...DEFAULT_POSITION_STATE }));
  const [gravityX, setGravityX] = useState(0);
  const [gravityY, setGravityY] = useState(gravity);

  // Get simulation boxes from GlobalChatContext
  const simulationBoxes = useMemo(() => {
    return Array.from(globalChat.simulationBoxes.values());
  }, [globalChat.simulationBoxes]);

  // Get selected box data
  const selectedBox = useMemo(() => {
    if (!selectedBoxId) return null;
    return globalChat.simulationBoxes.get(selectedBoxId);
  }, [selectedBoxId, globalChat.simulationBoxes]);

  // Get entities from selected box or fallback to current scene
  const entities = useMemo(() => {
    // For now, use labels.entities as before
    // TODO: Fetch from selectedBox.conversationId context
    return labels?.entities ?? [];
  }, [labels, selectedBox]);

  useEffect(() => {
    if (!selectedEntityId || !scene?.bodies) {
      setVelocityState({ ...DEFAULT_VELOCITY_STATE });
      setPositionState({ ...DEFAULT_POSITION_STATE });
      setEntityRestitution(1);
      return;
    }

    const body = scene.bodies.find((b: any) => b.id === selectedEntityId);
    if (!body) {
      setVelocityState({ ...DEFAULT_VELOCITY_STATE });
      setPositionState({ ...DEFAULT_POSITION_STATE });
      setEntityRestitution(1);
      return;
    }

    const vx = Number(body.velocity_m_s?.[0]) || 0;
    const vy = Number(body.velocity_m_s?.[1]) || 0;
    const magnitude = Math.hypot(vx, vy);
    const angleDeg = normalizeAngleDeg(radToDeg(Math.atan2(vy, vx)));
    setVelocityState({
      magnitude,
      angleDeg,
      vxText: formatVelocityText(vx),
      vyText: formatVelocityText(vy),
    });

    const [px, py] = Array.isArray(body.position_m)
      ? [Number(body.position_m[0]) || 0, Number(body.position_m[1]) || 0]
      : [0, 0];
    setPositionState({
      xText: formatPositionText(px),
      yText: formatPositionText(py),
    });

    const restitutionValue = Number((body.material as any)?.restitution);
    if (Number.isFinite(restitutionValue)) {
      setEntityRestitution(restitutionValue);
    } else {
      setEntityRestitution(1);
    }
  }, [selectedEntityId, scene?.bodies]);

  const applyVelocityUpdate = useCallback(
    (entityId: string, vx: number, vy: number) => {
      updateSceneAndResimulate((prev: any | null) => {
        if (!prev?.bodies) {
          return prev;
        }

        let changed = false;
        const updatedBodies = prev.bodies.map((b: any) => {
          if (b.id !== entityId) {
            return b;
          }

          const prevVx = Number(b.velocity_m_s?.[0]) || 0;
          const prevVy = Number(b.velocity_m_s?.[1]) || 0;
          if (Math.abs(prevVx - vx) < 1e-6 && Math.abs(prevVy - vy) < 1e-6) {
            return b;
          }

          changed = true;
          return { ...b, velocity_m_s: [vx, vy] };
        });

        return changed ? { ...prev, bodies: updatedBodies } : prev;
      });
    },
    [updateSceneAndResimulate],
  );

  const handleVelocityMagnitudeChange = useCallback(
    (entityId: string, magnitude: number) => {
      setVelocityState((prev) => {
        const angleRad = degToRad(prev.angleDeg);
        const vx = magnitude * Math.cos(angleRad);
        const vy = magnitude * Math.sin(angleRad);
        const nextState = {
          magnitude,
          angleDeg: prev.angleDeg,
          vxText: formatVelocityText(vx),
          vyText: formatVelocityText(vy),
        };
        applyVelocityUpdate(entityId, vx, vy);
        return nextState;
      });
    },
    [applyVelocityUpdate],
  );

  const handleVelocityAngleChange = useCallback(
    (entityId: string, angleDeg: number) => {
      setVelocityState((prev) => {
        const normalized = normalizeAngleDeg(angleDeg);
        const angleRad = degToRad(normalized);
        const vx = prev.magnitude * Math.cos(angleRad);
        const vy = prev.magnitude * Math.sin(angleRad);
        const nextState = {
          magnitude: prev.magnitude,
          angleDeg: normalized,
          vxText: formatVelocityText(vx),
          vyText: formatVelocityText(vy),
        };
        applyVelocityUpdate(entityId, vx, vy);
        return nextState;
      });
    },
    [applyVelocityUpdate],
  );

  const handleVelocityComponentInput = useCallback(
    (entityId: string, component: 'vx' | 'vy', value: string) => {
      setVelocityState((prev) => {
        const next = {
          ...prev,
          vxText: component === 'vx' ? value : prev.vxText,
          vyText: component === 'vy' ? value : prev.vyText,
        };

        if (isPartialNumberInput(next.vxText) || isPartialNumberInput(next.vyText)) {
          return next;
        }

        const vx = Number.parseFloat(next.vxText);
        const vy = Number.parseFloat(next.vyText);
        if (Number.isFinite(vx) && Number.isFinite(vy)) {
          const magnitude = Math.hypot(vx, vy);
          const angleDeg = normalizeAngleDeg(radToDeg(Math.atan2(vy, vx)));
          applyVelocityUpdate(entityId, vx, vy);
          return {
            magnitude,
            angleDeg,
            vxText: formatVelocityText(vx),
            vyText: formatVelocityText(vy),
          };
        }

        return next;
      });
    },
    [applyVelocityUpdate],
  );

  const handlePositionInput = useCallback(
    (entityId: string, axis: 'x' | 'y', value: string) => {
      let updatePayload: { x: number; y: number; formatted: PositionState } | null = null;

      setPositionState((prev) => {
        const next: PositionState =
          axis === 'x'
            ? { ...prev, xText: value }
            : { ...prev, yText: value };

        if (isPartialNumberInput(next.xText) || isPartialNumberInput(next.yText)) {
          return next;
        }

        const x = Number.parseFloat(next.xText);
        const y = Number.parseFloat(next.yText);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          const formatted: PositionState = {
            xText: formatPositionText(x),
            yText: formatPositionText(y),
          };
          updatePayload = { x, y, formatted };
          return formatted;
        }

        return next;
      });

      if (updatePayload) {
        const { x, y } = updatePayload;
        updateSceneAndResimulate((prevScene: any | null) => {
          if (!prevScene?.bodies) {
            return prevScene;
          }
          const updatedBodies = prevScene.bodies.map((b: any) =>
            b.id === entityId ? { ...b, position_m: [x, y] } : b,
          );
          return { ...prevScene, bodies: updatedBodies };
        });
      }
    },
    [updateSceneAndResimulate],
  );

  return (
    <Card className="h-full flex flex-col min-h-0">
      <CardHeader className="space-y-4">
        {/* Simulation Box Selector */}
        <div className="space-y-2">
          <Label>Simulation Box</Label>
          <Select value={selectedBoxId ?? ''} onValueChange={(value) => {
            setSelectedBoxId(value);
            setSelectedEntityId(null); // Reset entity selection
          }}>
            <SelectTrigger>
              <SelectValue placeholder="Select a simulation box..." />
            </SelectTrigger>
            <SelectContent>
              {simulationBoxes.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">No simulation boxes available</div>
              ) : (
                simulationBoxes.map((box) => (
                  <SelectItem key={box.id} value={box.id}>
                    🔷 {box.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between">
          <CardTitle className="font-headline text-lg">Controls & Parameters</CardTitle>
          {labels && labels.entities?.length ? (
            <div className="flex gap-1 rounded-md border bg-background p-1">
              <Button type="button" variant={scope === 'global' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('global')} aria-pressed={scope==='global'}>Global</Button>
              <Button type="button" variant={scope === 'entity' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('entity')} aria-pressed={scope==='entity'} disabled={entities.length === 0}>Entity</Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0 min-h-0">
        <ScrollArea type="auto" className="h-full px-6 py-4">
          {!scene ? (
            <div className="flex items-center justify-center text-sm text-muted-foreground py-8">
              Upload an image to enable Controls & Parameters.
            </div>
          ) : !labels || !labels.entities?.length ? (
            <div className="flex items-center justify-center text-sm text-muted-foreground py-8">
              Analyzing diagram… parameters will appear after labeling.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h3 className="font-medium text-sm text-muted-foreground">Simulation Controls</h3>
                <div className="grid grid-cols-4 gap-2">
                  <Button variant="outline" size="icon" aria-label="Play" onClick={() => { setPlaying(true); }} disabled={playing}>
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Pause" onClick={() => setPlaying(false)} disabled={!playing}>
                    <Pause className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Step Forward">
                    <StepForward className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Reset" onClick={() => resetSimulation()}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="space-y-6">{scope === 'global' && (
            <>
                            <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="gravity">Gravity (m/s²)</Label>
                  <span className="text-sm text-muted-foreground">{gravity.toFixed(1)}</span>
                </div>
                <Slider 
                  id="gravity" 
                  value={[gravity]} 
                  max={20} 
                  step={0.1} 
                  onValueChange={(v) => { 
                    const g = v[0]; 
                    updateConfig({ gravity: g });
                    // Update scene world settings
                    if (scene) {
                      updateSceneAndResimulate((prev: any | null) => {
                        if (!prev) {
                          return prev;
                        }
                        const world = { ...(prev.world ?? {}), gravity_m_s2: g };
                        return { ...prev, world };
                      });
                    }
                  }} 
                />
              </div>
                            <div className="grid gap-2">
                              <div className="flex justify-between items-center">
                                <Label>Gravity Vector (x,y)</Label>
                                <span className="text-sm text-muted-foreground">[{gravityX.toFixed(2)}, {gravityY.toFixed(2)}]</span>
                              </div>
                              <div className="flex gap-2">
                                <Slider
                                  id="gravity-x"
                                  value={[gravityX]}
                                  min={-20}
                                  max={20}
                                  step={0.1}
                                  onValueChange={(v) => {
                                    const gx = v[0];
                                    setGravityX(gx);
                                    if (scene) {
                                      updateSceneAndResimulate((prev: any | null) => {
                                        if (!prev) return prev;
                                        const world = { ...(prev.world ?? {}), gravity_vec_m_s2: { x: gx, y: gravityY } };
                                        return { ...prev, world };
                                      });
                                    }
                                  }}
                                />
                                <Slider
                                  id="gravity-y"
                                  value={[gravityY]}
                                  min={-20}
                                  max={20}
                                  step={0.1}
                                  onValueChange={(v) => {
                                    const gy = v[0];
                                    setGravityY(gy);
                                    if (scene) {
                                      updateSceneAndResimulate((prev: any | null) => {
                                        if (!prev) return prev;
                                        const world = { ...(prev.world ?? {}), gravity_vec_m_s2: { x: gravityX, y: gy } };
                                        return { ...prev, world };
                                      });
                                    }
                                  }}
                                />
                              </div>
                            </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="timestep">Time Step (dt)</Label>
                  <span className="text-sm text-muted-foreground">{dt.toFixed(3)} s</span>
                </div>
                <Slider id="timestep" value={[dt]} min={0.001} max={0.1} step={0.001} onValueChange={(v) => { updateConfig({ dt: v[0] }); }} />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="duration">Duration (s)</Label>
                  <span className="text-sm text-muted-foreground">{duration.toFixed(1)}</span>
                </div>
                <Slider id="duration" value={[duration]} min={1} max={10} step={0.5} onValueChange={(v) => { updateConfig({ duration: v[0] as number }); }} />
              </div>
              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="global-restitution">Restitution</Label>
                  <span className="text-sm text-muted-foreground">{restitution.toFixed(2)}</span>
                </div>
                <Slider
                  id="global-restitution"
                  value={[restitution]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={(v) => {
                    const r = v[0];
                    updateConfig({ restitution: r });
                    if (scene) {
                      updateSceneAndResimulate((prev: any | null) => prev);
                    }
                  }}
                />
              </div>
            </>
          )}
          {scope === 'entity' && entities.length > 0 && (
            <>
              {/* Entity Selector */}
              <div className="space-y-2">
                <Label>Select Entity</Label>
                <Select value={selectedEntityId ?? ''} onValueChange={setSelectedEntityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an entity..." />
                  </SelectTrigger>
                  <SelectContent>
                    {entities.map((entity) => (
                      <SelectItem key={entity.segment_id} value={entity.segment_id}>
                        {entity.label} (ID: {entity.segment_id})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity Parameters */}
              {selectedEntityId && (() => {
                const entity = entities.find(e => e.segment_id === selectedEntityId);
                if (!entity) return null;
                
                // Get mass from scene.bodies (pure universal approach)
                const sceneBody = scene?.bodies?.find((b: any) => b.id === entity.segment_id);
                const currentMass = sceneBody?.mass_kg ?? 3.0; // Default 3kg if not found

                return (
                  <div className="space-y-4">
                    {/* Position Controls */}
                    <div className="grid gap-3">
                      <div className="flex justify-between items-center">
                        <Label>Position (m)</Label>
                        <span className="text-sm text-muted-foreground">
                          [{positionState.xText}, {positionState.yText}]
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <Label htmlFor={`position-x-${entity.segment_id}`} className="text-xs text-muted-foreground uppercase">
                            x
                          </Label>
                          <Input
                            id={`position-x-${entity.segment_id}`}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            value={positionState.xText}
                            onChange={(event) =>
                              handlePositionInput(entity.segment_id, 'x', event.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`position-y-${entity.segment_id}`} className="text-xs text-muted-foreground uppercase">
                            y
                          </Label>
                          <Input
                            id={`position-y-${entity.segment_id}`}
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            value={positionState.yText}
                            onChange={(event) =>
                              handlePositionInput(entity.segment_id, 'y', event.target.value)
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {/* Mass Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`mass-${entity.segment_id}`}>Mass (kg)</Label>
                        <span className="text-sm text-muted-foreground">{currentMass.toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`mass-${entity.segment_id}`}
                        value={[currentMass]} 
                        min={0.1} 
                        max={20} 
                        step={0.1} 
                        onValueChange={(v) => { 
                          const m = v[0];
                          // Update scene body mass (universal approach only)
                          if (scene?.bodies) {
                            updateSceneAndResimulate((prev: any | null) => {
                              if (!prev?.bodies) {
                                return prev;
                              }
                              const updatedBodies = prev.bodies.map((b: any) =>
                                b.id === entity.segment_id ? { ...b, mass_kg: m } : b,
                              );
                              return { ...prev, bodies: updatedBodies };
                            });
                          }
                        }} 
                      />
                    </div>

                    {/* Friction Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`friction-${entity.segment_id}`}>Friction</Label>
                        <span className="text-sm text-muted-foreground">{(sceneBody?.material?.friction ?? friction).toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`friction-${entity.segment_id}`}
                        value={[sceneBody?.material?.friction ?? friction]} 
                        min={0} 
                        max={1} 
                        step={0.01} 
                        onValueChange={(v) => { 
                          setFriction(v[0]);
                          // Update scene body material
                          if (scene?.bodies) {
                            const frictionValue = v[0];
                            updateSceneAndResimulate((prev: any | null) => {
                              if (!prev?.bodies) {
                                return prev;
                              }
                              const updatedBodies = prev.bodies.map((b: any) => {
                                if (b.id !== entity.segment_id) {
                                  return b;
                                }
                                const material = { ...(b.material ?? {}), friction: frictionValue };
                                return { ...b, material };
                              });
                              return { ...prev, bodies: updatedBodies };
                            });
                          }
                        }} 
                      />
                    </div>

                    {/* Restitution Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`restitution-${entity.segment_id}`}>Restitution (Bounciness)</Label>
                        <span className="text-sm text-muted-foreground">{(sceneBody?.material?.restitution ?? entityRestitution).toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`restitution-${entity.segment_id}`}
                        value={[sceneBody?.material?.restitution ?? entityRestitution]} 
                        min={0} 
                        max={1} 
                        step={0.01} 
                        onValueChange={(v) => { 
                          setEntityRestitution(v[0]);
                          // Update scene body material
                          if (scene?.bodies) {
                            const restitutionValue = v[0];
                            updateSceneAndResimulate((prev: any | null) => {
                              if (!prev?.bodies) {
                                return prev;
                              }
                              const updatedBodies = prev.bodies.map((b: any) => {
                                if (b.id !== entity.segment_id) {
                                  return b;
                                }
                                const material = { ...(b.material ?? {}), restitution: restitutionValue };
                                return { ...b, material };
                              });
                              return { ...prev, bodies: updatedBodies };
                            });
                          }
                        }} 
                      />
                    </div>

                    {/* Velocity Vector */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`velocity-mag-${entity.segment_id}`}>Velocity Magnitude (m/s)</Label>
                        <span className="text-sm text-muted-foreground">{velocityState.magnitude.toFixed(2)}</span>
                      </div>
                      <Slider
                        id={`velocity-mag-${entity.segment_id}`}
                        value={[velocityState.magnitude]}
                        min={0}
                        max={20}
                        step={0.1}
                        onValueChange={(v) => {
                          if (!selectedEntityId) return;
                          handleVelocityMagnitudeChange(entity.segment_id, v[0]);
                        }}
                      />
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`velocity-angle-${entity.segment_id}`}>Velocity Angle (deg)</Label>
                        <span className="text-sm text-muted-foreground">{velocityState.angleDeg.toFixed(0)}°</span>
                      </div>
                      <Slider
                        id={`velocity-angle-${entity.segment_id}`}
                        value={[velocityState.angleDeg]}
                        min={0}
                        max={359}
                        step={1}
                        onValueChange={(v) => {
                          if (!selectedEntityId) return;
                          handleVelocityAngleChange(entity.segment_id, v[0]);
                        }}
                      />
                      <div className="grid gap-3">
                        <Label>Velocity Components (m/s)</Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label htmlFor={`velocity-vx-${entity.segment_id}`} className="text-xs text-muted-foreground uppercase">vx</Label>
                            <Input
                              id={`velocity-vx-${entity.segment_id}`}
                              type="number"
                              step="0.1"
                              inputMode="decimal"
                              value={velocityState.vxText}
                              onChange={(event) =>
                                handleVelocityComponentInput(entity.segment_id, 'vx', event.target.value)
                              }
                            />
                          </div>
                          <div className="space-y-1">
                            <Label htmlFor={`velocity-vy-${entity.segment_id}`} className="text-xs text-muted-foreground uppercase">vy</Label>
                            <Input
                              id={`velocity-vy-${entity.segment_id}`}
                              type="number"
                              step="0.1"
                              inputMode="decimal"
                              value={velocityState.vyText}
                              onChange={(event) =>
                                handleVelocityComponentInput(entity.segment_id, 'vy', event.target.value)
                              }
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Density Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`density-${entity.segment_id}`}>Density (kg/m³)</Label>
                        <span className="text-sm text-muted-foreground">{density.toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`density-${entity.segment_id}`}
                        value={[density]} 
                        min={0.1} 
                        max={10} 
                        step={0.1} 
                        onValueChange={(v) => { 
                          setDensity(v[0]);
                          // TODO: Density affects mass calculation - needs more complex update
                          console.log('[ParametersPanel] Density update not yet implemented');
                        }} 
                      />
                    </div>

                    {/* Angular Velocity */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`angvel-${entity.segment_id}`}>Angular Velocity (rad/s)</Label>
                        <span className="text-sm text-muted-foreground">{(sceneBody?.angular_velocity_rad_s ?? 0).toFixed(2)}</span>
                      </div>
                      <Slider
                        id={`angvel-${entity.segment_id}`}
                        value={[sceneBody?.angular_velocity_rad_s ?? 0]}
                        min={-10}
                        max={10}
                        step={0.1}
                        onValueChange={(v) => {
                          const av = v[0];
                          if (scene?.bodies) {
                            updateSceneAndResimulate((prev: any | null) => {
                              if (!prev?.bodies) return prev;
                              const updatedBodies = prev.bodies.map((b: any) =>
                                b.id === entity.segment_id ? { ...b, angular_velocity_rad_s: av } : b,
                              );
                              return { ...prev, bodies: updatedBodies };
                            });
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })()}
            </>
          )}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Scope: <code>{scope}</code></div>
            <div>Bodies: <code>{scene?.bodies?.length ?? 0}</code></div>
            <div>Constraints: <code>{scene?.constraints?.length ?? 0}</code></div>
          </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
