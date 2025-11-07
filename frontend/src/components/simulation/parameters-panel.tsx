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

type Scope = 'global' | 'entity';

export default function ParametersPanel() {
  const { 
    gravity, dt, 
    updateConfig, resetSimulation, 
    playing, setPlaying, scene, labels,
    updateSceneAndResimulate,
    simulationMode, setSimulationMode,
    selectedEntityId: contextSelectedEntityId,
    setSelectedEntityId: setContextSelectedEntityId,
    updateEntityCallback
  } = useSimulation();
  const globalChat = useGlobalChat();
  const { toast } = useToast();
  const [scope, setScope] = useState<Scope>('global');
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  
  // Sync Context selectedEntityId to local state
  useEffect(() => {
    if (contextSelectedEntityId !== null && contextSelectedEntityId !== selectedEntityId) {
      console.log('[ParametersPanel] Entity selected from SimulationLayer:', contextSelectedEntityId);
      setSelectedEntityId(contextSelectedEntityId);
      setScope('entity'); // Auto-switch to entity scope
    }
  }, [contextSelectedEntityId, selectedEntityId]);
  
  // Sync local selectedEntityId to Context
  const handleEntitySelect = useCallback((entityId: string) => {
    setSelectedEntityId(entityId);
    setContextSelectedEntityId(entityId);
  }, [setContextSelectedEntityId]);
  
  // Physics parameters (must be at top level, not conditionally called)
  const [friction, setFriction] = useState(0.5);
  const [restitution, setRestitution] = useState(0.3);
  const [density, setDensity] = useState(1.0);

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
    // For now, use labels.entities as before
    // TODO: Fetch from selectedBox.conversationId context
    return labels?.entities ?? [];
  }, [labels, selectedBox]);

  return (
    <Card className="h-full flex flex-col">
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
            {/* Simulation Mode Toggle */}
            {scene && (
              <div className="flex gap-1 rounded-md border bg-background p-1">
                <Button 
                  type="button" 
                  variant={simulationMode === 'playback' ? 'default' : 'ghost'} 
                  size="sm" 
                  onClick={() => setSimulationMode('playback')}
                  aria-pressed={simulationMode === 'playback'}
                >
                  📹 Playback
                </Button>
                <Button 
                  type="button" 
                  variant={simulationMode === 'interactive' ? 'default' : 'ghost'} 
                  size="sm" 
                  onClick={() => setSimulationMode('interactive')}
                  aria-pressed={simulationMode === 'interactive'}
                >
                  🎮 Interactive
                </Button>
              </div>
            )}
            {/* Entity Scope Toggle */}
            {labels && labels.entities?.length ? (
              <div className="flex gap-1 rounded-md border bg-background p-1">
                <Button type="button" variant={scope === 'global' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('global')} aria-pressed={scope==='global'}>Global</Button>
                <Button type="button" variant={scope === 'entity' ? 'default' : 'ghost'} size="sm" onClick={() => setScope('entity')} aria-pressed={scope==='entity'} disabled={entities.length === 0}>Entity</Button>
              </div>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full px-6 py-4">
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
                  <Button variant="outline" size="icon" aria-label="Step Forward" disabled={simulationMode === 'interactive'}>
                    <StepForward className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" aria-label="Reset" onClick={() => resetSimulation()}>
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </div>
                {simulationMode === 'interactive' && (
                  <p className="text-xs text-muted-foreground">
                    🎮 Interactive Mode: Drag objects to interact with the simulation
                  </p>
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
                  <Label htmlFor="timestep">Time Step (dt)</Label>
                  <span className="text-sm text-muted-foreground">{dt.toFixed(3)} s</span>
                </div>
                <Slider id="timestep" value={[dt]} min={0.001} max={0.1} step={0.001} onValueChange={(v) => { updateConfig({ dt: v[0] }); }} />
              </div>
            </>
          )}
          {scope === 'entity' && entities.length > 0 && (
            <>
              {/* Entity Selector */}
              <div className="space-y-2">
                <Label>Select Entity</Label>
                <Select value={selectedEntityId ?? ''} onValueChange={handleEntitySelect}>
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
                          
                          if (simulationMode === 'interactive' && updateEntityCallback) {
                            // Interactive Mode: Update Frontend Matter.js immediately
                            updateEntityCallback(entity.segment_id, { mass: m });
                            console.log(`[ParametersPanel] Interactive: Mass updated to ${m}`);
                            
                            // TODO: Debounced Backend sync (resimulate=false)
                            // For now, also update scene for consistency
                            if (scene?.bodies) {
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
                          
                          if (simulationMode === 'interactive' && updateEntityCallback) {
                            // Interactive Mode: Update Frontend Matter.js immediately
                            updateEntityCallback(entity.segment_id, { friction: frictionValue });
                            console.log(`[ParametersPanel] Interactive: Friction updated to ${frictionValue}`);
                            
                            // Also update scene for consistency
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
                          setRestitution(v[0]);
                          // Update scene body material (local)
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
                        onValueCommit={(v) => {
                          // Sync to backend when user finishes dragging slider
                          if (simulationMode === 'interactive') {
                            syncMaterialToBackend(entity.segment_id, { restitution: v[0] }, false);
                          }
                        }}
                      />
                    </div>                    {/* Density Parameter */}
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
