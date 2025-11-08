"use client";

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Play, Pause, StepForward, RotateCcw, Box } from 'lucide-react';
import { useMemo, useState, useCallback, useEffect } from 'react';
import { useSimulation } from '@/simulation/SimulationContext';
import { useGlobalChat } from '@/contexts/global-chat-context';
import { updateBody } from '@/lib/simulation-api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
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
    updateSceneAndResimulate,
    updateBodyLocal,
    sceneModified,
    setSceneModified,
    selectedEntityId: contextSelectedEntityId,
    setSelectedEntityId: setContextSelectedEntityId,
    updateEntityCallback,
    editingEnabled,
    setEditingEnabled,
    hasEverPlayed,
    frames,
    currentIndex,
    setFrameIndex,
  } = useSimulation();
  const globalChat = useGlobalChat();
  const { toast } = useToast();
  const [scope, setScope] = useState<Scope>('global');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Sync Context selectedEntityId to local state and auto-switch to entity scope
  useEffect(() => {
    if (contextSelectedEntityId !== null && contextSelectedEntityId !== selectedEntityId) {
      setSelectedEntityId(contextSelectedEntityId);
      
      // Auto-switch to entity scope only if entities are available
      if (labels?.entities && labels.entities.length > 0) {
        setScope('entity');
      }
    }
  }, [contextSelectedEntityId, selectedEntityId, labels?.entities]);
  
  // Sync local selectedEntityId to Context
  const handleEntitySelect = useCallback((entityId: string) => {
    setSelectedEntityId(entityId);
    setContextSelectedEntityId(entityId);
  }, [setContextSelectedEntityId]);
  
  // Physics parameters (must be at top level, not conditionally called)
  const [friction, setFriction] = useState(0.5);
  const [entityRestitution, setEntityRestitution] = useState(1);
  const [density, setDensity] = useState(1.0);
  const [velocityState, setVelocityState] = useState<VelocityState>(() => ({ ...DEFAULT_VELOCITY_STATE }));
  const [positionState, setPositionState] = useState<PositionState>(() => ({ ...DEFAULT_POSITION_STATE }));
  const [gravityX, setGravityX] = useState(0);
  const [gravityY, setGravityY] = useState(gravity);

  // Backend sync helper for material updates
  const syncMaterialToBackend = useCallback(async (
    bodyId: string,
    material: { friction?: number; restitution?: number },
    resimulate: boolean = false
  ) => {
    const conversationId = selectedBoxId || globalChat.activeBoxId;
    if (!conversationId) {
      console.warn('[ParametersPanel] No conversation ID for backend sync');
      return;
    }

    setIsUpdating(true);
    try {
      await updateBody(conversationId, bodyId, { material }, resimulate);
      
      if (resimulate) {
        toast({
          title: '✅ Material Updated',
          description: `Body ${bodyId} material synced with resimulation`,
        });
      }
    } catch (error) {
      console.error('[ParametersPanel] Backend sync failed:', error);
      toast({
        title: '⚠️ Sync Failed',
        description: 'Material changes saved locally only',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  }, [selectedBoxId, globalChat.activeBoxId, toast]);

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
    const entitiesList = labels?.entities ?? [];
    
    // Debug: Log entities to see actual structure
    if (entitiesList.length > 0) {
      console.log('[ParametersPanel] 📋 Entities structure:', entitiesList);
    }
    
    return entitiesList;
  }, [labels, selectedBox]);
  
  // SIMPLIFIED: Use body.id directly as entity ID (no complex mapping needed)
  // The scene.bodies already have the correct IDs that should be used for entity selection
  const bodyIdToSegmentId = useMemo(() => {
    const mapping = new Map<string, string>();
    
    if (scene?.bodies && entities.length > 0) {
      console.group('[ParametersPanel] � Entity Mapping Debug');
      console.log('Scene bodies:', scene.bodies.map((b: any) => ({ 
        id: b.id, 
        label: b.label,
        type: b.type 
      })));
      console.log('Entities:', entities.map(e => ({ 
        segment_id: e.segment_id, 
        label: e.label, 
        props: e.props 
      })));
      
      // Try to establish mapping
      scene.bodies.forEach((body: any) => {
        const entity = entities.find(e => {
          // Check all possible matching strategies
          if (e.segment_id === body.id) return true;
          if (e.props && (e.props as any).body_id === body.id) return true;
          if (e.props && (e.props as any).id === body.id) return true;
          return false;
        });
        
        if (entity) {
          mapping.set(body.id, entity.segment_id);
        }
      });
      
      console.log('Mapping result:', Object.fromEntries(mapping));
      console.groupEnd();
    }
    
    return mapping;
  }, [scene?.bodies, entities]);
  
  // SIMPLIFIED: Direct ID usage (prefer body.id over complex normalization)
  const normalizedSelectedEntityId = useMemo(() => {
    if (!selectedEntityId) return null;
    
    // STRATEGY 1: Direct body.id usage (most common case)
    // If the selectedEntityId exists as a body.id in scene, use it directly
    if (scene?.bodies?.some((b: any) => b.id === selectedEntityId)) {
      console.log('[ParametersPanel] ✅ Using body.id directly:', selectedEntityId);
      return selectedEntityId;
    }
    
    // STRATEGY 2: Check if it's already a valid segment_id
    if (entities.some(e => e.segment_id === selectedEntityId)) {
      console.log('[ParametersPanel] ✅ Using segment_id:', selectedEntityId);
      return selectedEntityId;
    }
    
    // STRATEGY 3: Try mapping (fallback)
    const segmentId = bodyIdToSegmentId.get(selectedEntityId);
    if (segmentId) {
      console.log('[ParametersPanel] ✅ Using mapped segment_id:', segmentId);
      return segmentId;
    }
    
    // STRATEGY 4: No mapping found, use as-is
    console.warn('[ParametersPanel] ⚠️ No mapping found, using ID as-is:', selectedEntityId);
    return selectedEntityId;
  }, [selectedEntityId, entities, bodyIdToSegmentId, scene?.bodies]);
  
  // Validate selectedEntityId exists in scene or entities
  useEffect(() => {
    if (!selectedEntityId) return;
    
    const normalized = normalizedSelectedEntityId;
    
    // Check if it exists in scene bodies
    const inScene = scene?.bodies?.some((b: any) => b.id === normalized);
    
    // Check if it exists in entities
    const inEntities = entities.some(e => e.segment_id === normalized);
    
    if (!inScene && !inEntities && entities.length > 0) {
      console.group('[ParametersPanel] 🔍 Entity Validation');
      console.warn('Selected body ID:', selectedEntityId);
      console.warn('Normalized ID:', normalized);
      console.warn('In scene bodies:', inScene);
      console.warn('In entities:', inEntities);
      console.table([
        { type: 'Scene Bodies', ids: scene?.bodies?.map((b: any) => b.id).join(', ') },
        { type: 'Entities', ids: entities.map(e => e.segment_id).join(', ') },
        { type: 'Mapping', ids: Array.from(bodyIdToSegmentId.entries()).map(([k,v]) => `${k}→${v}`).join(', ') }
      ]);
      console.groupEnd();
    }
  }, [selectedEntityId, entities, normalizedSelectedEntityId, bodyIdToSegmentId, scene?.bodies]);

  useEffect(() => {
    if (!normalizedSelectedEntityId || !scene?.bodies) {
      setVelocityState({ ...DEFAULT_VELOCITY_STATE });
      setPositionState({ ...DEFAULT_POSITION_STATE });
      setEntityRestitution(1);
      return;
    }

    // SIMPLIFIED: Direct body.id lookup (normalizedSelectedEntityId is already the body.id)
    const body = scene.bodies.find((b: any) => b.id === normalizedSelectedEntityId);
    
    if (!body) {
      console.warn(`[ParametersPanel] Body not found for ID: ${normalizedSelectedEntityId}`);
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
  }, [normalizedSelectedEntityId, scene?.bodies]);

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
          <div className="flex gap-2">
            {sceneModified && !playing && (
              <span className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border border-amber-300/60">
                Edited
              </span>
            )}
            {/* Interactive editing is available when simulation is stopped; no separate mode toggle */}
            {/* Entity Scope Toggle */}
            {labels && scene?.bodies?.length ? (
              <div className="flex gap-1 rounded-md border bg-background p-1">
                <Button type="button" variant={scope === 'global' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('global')} aria-pressed={scope==='global'}>Global</Button>
                <Button type="button" variant={scope === 'entity' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('entity')} aria-pressed={scope==='entity'} disabled={!scene?.bodies || scene.bodies.length === 0}>Entity</Button>
              </div>
            ) : null}
          </div>
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
                <div className="grid grid-cols-5 gap-2">
                  <Button 
                    variant="outline" 
                    size="icon" 
                    aria-label="Play" 
                    onClick={() => { 
                      setEditingEnabled(false); // Disable editing when playing
                      setPlaying(true); 
                    }} 
                    disabled={playing || editingEnabled}
                    title={editingEnabled ? "Disable Edit mode to play" : "Play simulation"}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    aria-label="Pause" 
                    onClick={() => setPlaying(false)} 
                    disabled={!playing}
                  >
                    <Pause className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    aria-label="Step Forward" 
                    disabled={playing || editingEnabled}
                    title="Step forward one frame"
                  >
                    <StepForward className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="outline" 
                    size="icon" 
                    aria-label="Reset" 
                    onClick={() => {
                      resetSimulation();
                      setEditingEnabled(false); // Reset also disables editing
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant={editingEnabled ? "default" : "outline"} 
                    size="icon" 
                    aria-label="Edit Mode" 
                    onClick={() => {
                      console.log('[ParametersPanel] 🖊️ Edit button clicked:', {
                        currentEditingEnabled: editingEnabled,
                        playing,
                        hasEverPlayed,
                      });
                      
                      if (editingEnabled) {
                        console.log('[ParametersPanel] → Disabling edit mode');
                        setEditingEnabled(false);
                      } else {
                        console.log('[ParametersPanel] → Enabling edit mode (stopping simulation)');
                        setPlaying(false); // Stop simulation before editing
                        setEditingEnabled(true);
                      }
                    }}
                    disabled={playing || hasEverPlayed}
                    title={
                      playing 
                        ? "Stop simulation to edit" 
                        : hasEverPlayed 
                          ? "Reset simulation to enable editing" 
                          : editingEnabled 
                            ? "Editing enabled" 
                            : "Enable edit mode"
                    }
                  >
                    <Box className="h-4 w-4" />
                  </Button>
                </div>
                {editingEnabled && !playing && scene && (
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium">
                    ✏️ Edit Mode: Click objects to select, double-click to drag
                  </p>
                )}
                {playing && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    ▶️ Simulation running
                  </p>
                )}
                {!playing && !editingEnabled && hasEverPlayed && scene && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    ⏸️ Paused: Press Reset to enable editing, or Play to continue
                  </p>
                )}
                {!playing && !editingEnabled && !hasEverPlayed && scene && (
                  <p className="text-xs text-muted-foreground">
                    🎮 Ready: Press Play to run simulation or Edit to modify objects
                  </p>
                )}
                
                {/* Timeline Scrubber */}
                {frames.length > 0 && (
                  <div className="grid gap-2 pt-2 border-t">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="timeline" className="text-xs font-medium">Timeline</Label>
                      <span className="text-xs text-muted-foreground">
                        Frame {currentIndex + 1} / {frames.length}
                        {frames[currentIndex]?.t !== undefined && ` (${frames[currentIndex].t.toFixed(2)}s)`}
                      </span>
                    </div>
                    <Slider
                      id="timeline"
                      value={[currentIndex]}
                      min={0}
                      max={Math.max(0, frames.length - 1)}
                      step={1}
                      onValueChange={(v) => {
                        if (!playing) {
                          setFrameIndex(v[0]);
                        }
                      }}
                      disabled={playing}
                      className="cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>0.00s</span>
                      <span>{frames.length > 0 && frames[frames.length - 1]?.t !== undefined 
                        ? `${frames[frames.length - 1].t.toFixed(2)}s` 
                        : `${duration.toFixed(2)}s`}
                      </span>
                    </div>
                  </div>
                )}
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
          {scope === 'entity' && scene?.bodies && scene.bodies.length > 0 && (
            <>
              {/* Entity Selector */}
              <div className="space-y-2">
                <Label>Select Entity</Label>
                <Select 
                  value={normalizedSelectedEntityId || undefined} 
                  onValueChange={handleEntitySelect}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select an entity...">
                      {normalizedSelectedEntityId && (() => {
                        // Display the body.id or segment_id
                        const body = scene?.bodies?.find((b: any) => b.id === normalizedSelectedEntityId);
                        return body?.id || normalizedSelectedEntityId;
                      })()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {/* List all scene bodies as selectable entities */}
                    {scene?.bodies?.map((body: any) => (
                      <SelectItem key={body.id} value={body.id}>
                        {body.id} {body.label ? `(${body.label})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Entity Parameters */}
              {normalizedSelectedEntityId && (() => {
                // SIMPLIFIED: Find body directly by normalizedSelectedEntityId
                // This works whether normalizedSelectedEntityId is a body.id or segment_id
                const sceneBody = scene?.bodies?.find((b: any) => b.id === normalizedSelectedEntityId);
                
                if (!sceneBody) {
                  console.warn(`[ParametersPanel] ⚠️ No scene body found for ID: ${normalizedSelectedEntityId}`);
                  return (
                    <div className="text-sm text-muted-foreground py-4">
                      Selected entity not found in scene bodies.
                      <div className="text-xs mt-2">
                        Selected ID: <code>{normalizedSelectedEntityId}</code>
                      </div>
                    </div>
                  );
                }
                
                // Try to find matching entity for metadata (optional)
                const entity = entities.find(e => e.segment_id === normalizedSelectedEntityId) || {
                  segment_id: normalizedSelectedEntityId,
                  label: sceneBody.label || 'Unknown',
                  props: {}
                };
                
                const currentMass = sceneBody?.mass_kg ?? 3.0;

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
                          
                          if (!playing && updateEntityCallback) {
                            // Interactive Mode: Update Frontend Matter.js immediately
                            // Backend sync happens automatically via debounced callback
                            updateEntityCallback(entity.segment_id, { mass: m });
                            // Optimistic local scene mutation (no resim during edit mode)
                            if (editingEnabled) {
                              updateBodyLocal(entity.segment_id, { mass_kg: m });
                              setSceneModified(true);
                            } else if (scene?.bodies) {
                              // If not in edit mode, apply & resim immediately
                              updateSceneAndResimulate((prev: any | null) => {
                                if (!prev?.bodies) return prev;
                                const updatedBodies = prev.bodies.map((b: any) =>
                                  b.id === entity.segment_id ? { ...b, mass_kg: m } : b,
                                );
                                return { ...prev, bodies: updatedBodies };
                              });
                            }
                          } else {
                            // Playback Mode: Update scene (backend resimulation)
                            if (scene?.bodies) {
                              updateSceneAndResimulate((prev: any | null) => {
                                if (!prev?.bodies) return prev;
                                const updatedBodies = prev.bodies.map((b: any) =>
                                  b.id === entity.segment_id ? { ...b, mass_kg: m } : b,
                                );
                                return { ...prev, bodies: updatedBodies };
                              });
                            }
                          }
                        }} 
                      />
                    </div>

                    {/* Friction Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`friction-${entity.segment_id}`}>Friction</Label>
                        <span className="text-sm text-muted-foreground">{friction.toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`friction-${entity.segment_id}`}
                        value={[friction]} 
                        min={0} 
                        max={1} 
                        step={0.05} 
                        disabled={isUpdating}
                        onValueChange={(v) => { 
                          setFriction(v[0]);
                          const frictionValue = v[0];
                          
                          if (!playing && updateEntityCallback) {
                            // Interactive Mode: Update Frontend Matter.js immediately
                            updateEntityCallback(entity.segment_id, { friction: frictionValue });
                            if (editingEnabled) {
                              updateBodyLocal(entity.segment_id, { material: { ...(sceneBody.material ?? {}), friction: frictionValue } });
                              setSceneModified(true);
                            } else if (scene?.bodies) {
                              updateSceneAndResimulate((prev: any | null) => {
                                if (!prev?.bodies) return prev;
                                const updatedBodies = prev.bodies.map((b: any) => {
                                  if (b.id !== entity.segment_id) return b;
                                  const material = { ...(b.material ?? {}), friction: frictionValue };
                                  return { ...b, material };
                                });
                                return { ...prev, bodies: updatedBodies };
                              });
                            }
                          } else {
                            // Playback Mode: Update scene (backend resimulation)
                            if (scene?.bodies) {
                              updateSceneAndResimulate((prev: any | null) => {
                                if (!prev?.bodies) return prev;
                                const updatedBodies = prev.bodies.map((b: any) => {
                                  if (b.id !== entity.segment_id) return b;
                                  const material = { ...(b.material ?? {}), friction: frictionValue };
                                  return { ...b, material };
                                });
                                return { ...prev, bodies: updatedBodies };
                              });
                            }
                          }
                        }} 
                      />
                    </div>
                    
                    {/* Restitution Parameter */}
                    <div className="grid gap-2">
                      <div className="flex justify-between items-center">
                        <Label htmlFor={`restitution-${entity.segment_id}`}>Restitution (Bounce)</Label>
                        <span className="text-sm text-muted-foreground">{restitution.toFixed(2)}</span>
                      </div>
                      <Slider 
                        id={`restitution-${entity.segment_id}`}
                        value={[restitution]} 
                        min={0} 
                        max={1} 
                        step={0.05} 
                        disabled={isUpdating}
                        onValueChange={(v) => { 
                          setEntityRestitution(v[0]);
                          // Update scene body material
                          const restitutionValue = v[0];
                          if (editingEnabled) {
                            updateBodyLocal(entity.segment_id, { material: { ...(sceneBody.material ?? {}), restitution: restitutionValue } });
                            setSceneModified(true);
                          } else if (scene?.bodies) {
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
                        onValueCommit={(v) => {
                          // Sync to backend when user finishes dragging slider
                          if (!playing) {
                            syncMaterialToBackend(entity.segment_id, { restitution: v[0] }, false);
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
                          if (editingEnabled) {
                            // Optimistic only in edit mode
                            const angleRad = degToRad(velocityState.angleDeg);
                            const vx = v[0] * Math.cos(angleRad);
                            const vy = v[0] * Math.sin(angleRad);
                            updateBodyLocal(entity.segment_id, { velocity_m_s: [vx, vy] });
                            setVelocityState(prev => ({
                              ...prev,
                              magnitude: v[0],
                              vxText: formatVelocityText(vx),
                              vyText: formatVelocityText(vy),
                            }));
                            setSceneModified(true);
                          } else {
                            handleVelocityMagnitudeChange(entity.segment_id, v[0]);
                          }
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
                          if (editingEnabled) {
                            const normalized = normalizeAngleDeg(v[0]);
                            const angleRad = degToRad(normalized);
                            const vx = velocityState.magnitude * Math.cos(angleRad);
                            const vy = velocityState.magnitude * Math.sin(angleRad);
                            updateBodyLocal(entity.segment_id, { velocity_m_s: [vx, vy] });
                            setVelocityState(prev => ({
                              ...prev,
                              angleDeg: normalized,
                              vxText: formatVelocityText(vx),
                              vyText: formatVelocityText(vy),
                            }));
                            setSceneModified(true);
                          } else {
                            handleVelocityAngleChange(entity.segment_id, v[0]);
                          }
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
                                editingEnabled ? (() => {
                                  const value = event.target.value;
                                  setVelocityState(prev => ({ ...prev, vxText: value }));
                                  if (!isPartialNumberInput(value) && !isPartialNumberInput(velocityState.vyText)) {
                                    const vxNum = parseFloat(value);
                                    const vyNum = parseFloat(velocityState.vyText);
                                    if (Number.isFinite(vxNum) && Number.isFinite(vyNum)) {
                                      updateBodyLocal(entity.segment_id, { velocity_m_s: [vxNum, vyNum] });
                                      setSceneModified(true);
                                    }
                                  }
                                })() : handleVelocityComponentInput(entity.segment_id, 'vx', event.target.value)
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
                                editingEnabled ? (() => {
                                  const value = event.target.value;
                                  setVelocityState(prev => ({ ...prev, vyText: value }));
                                  if (!isPartialNumberInput(value) && !isPartialNumberInput(velocityState.vxText)) {
                                    const vyNum = parseFloat(value);
                                    const vxNum = parseFloat(velocityState.vxText);
                                    if (Number.isFinite(vxNum) && Number.isFinite(vyNum)) {
                                      updateBodyLocal(entity.segment_id, { velocity_m_s: [vxNum, vyNum] });
                                      setSceneModified(true);
                                    }
                                  }
                                })() : handleVelocityComponentInput(entity.segment_id, 'vy', event.target.value)
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
                              if (editingEnabled) {
                                updateBodyLocal(entity.segment_id, { angular_velocity_rad_s: av } as any);
                                setSceneModified(true);
                              } else if (scene?.bodies) {
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
