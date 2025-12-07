/**
 * Simulation API Client for Interactive Mode
 * 
 * Provides REST API client for scene updates and synchronization
 * with backend during Interactive Mode operations.
 */

// ===========================
// Types
// ===========================

export interface BatchSceneUpdateRequest {
  conversation_id: string;
  body_updates?: Record<string, BodyUpdate>;
  constraint_updates?: Record<string, ConstraintUpdate>;
  resimulate?: boolean;
  simulation_config?: SimulationConfig;
}

export interface BodyUpdate {
  position_m?: [number, number];
  velocity_m_s?: [number, number];
  angle_rad?: number;
  mass_kg?: number;
  material?: {
    friction?: number;
    restitution?: number;
    density_kg_m3?: number;
  };
}

export interface ConstraintUpdate {
  length_m?: number;
  stiffness?: number;
  damping?: number;
  rope_length_m?: number;
}

export interface SimulationConfig {
  duration_s?: number;
  frame_rate?: number;
}

export interface BatchSceneUpdateResponse {
  status: string;
  conversation_id: string;
  updated_bodies: string[];
  updated_constraints: string[];
  scene: any;
  frames?: any[];
  meta: {
    warnings?: string[];
    scene_history_length?: number;
    simulation?: any;
  };
}

// ===========================
// API Client
// ===========================

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/**
 * Batch update scene bodies and constraints.
 * 
 * Use Cases:
 * - Interactive Mode: Drag & drop position updates
 * - Parameters Panel: Mass, friction updates
 * - Constraint editing: Rope length updates
 * 
 * @param request - Batch update request
 * @returns Updated scene and optional simulation frames
 * 
 * @example
 * ```typescript
 * // Update body position (no resimulation)
 * const response = await batchUpdateScene({
 *   conversation_id: 'abc123',
 *   body_updates: {
 *     massA: { position_m: [0, 1.5] }
 *   },
 *   resimulate: false
 * });
 * ```
 * 
 * @example
 * ```typescript
 * // Update mass and resimulate
 * const response = await batchUpdateScene({
 *   conversation_id: 'abc123',
 *   body_updates: {
 *     massA: { mass_kg: 2.0 }
 *   },
 *   resimulate: true,
 *   simulation_config: { duration_s: 5.0 }
 * });
 * ```
 */
export async function batchUpdateScene(
  request: BatchSceneUpdateRequest
): Promise<BatchSceneUpdateResponse> {
  const response = await fetch(`${API_BASE_URL}/simulation/batch_update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(`Batch update failed: ${error.detail || response.statusText}`);
  }

  return response.json();
}

/**
 * Update single body (convenience wrapper).
 * 
 * @param conversationId - Conversation ID
 * @param bodyId - Body identifier
 * @param updates - Body updates
 * @param resimulate - Whether to resimulate after update
 * @returns Updated scene response
 * 
 * @example
 * ```typescript
 * await updateBody('abc123', 'massA', { position_m: [0, 1] });
 * ```
 */
export async function updateBody(
  conversationId: string,
  bodyId: string,
  updates: BodyUpdate,
  resimulate: boolean = false
): Promise<BatchSceneUpdateResponse> {
  return batchUpdateScene({
    conversation_id: conversationId,
    body_updates: {
      [bodyId]: updates,
    },
    resimulate,
  });
}

/**
 * Update multiple bodies at once.
 * 
 * @param conversationId - Conversation ID
 * @param bodyUpdates - Body updates by ID
 * @param resimulate - Whether to resimulate after update
 * @returns Updated scene response
 * 
 * @example
 * ```typescript
 * await updateBodies('abc123', {
 *   massA: { position_m: [0, 1] },
 *   massB: { position_m: [0, -1] }
 * });
 * ```
 */
export async function updateBodies(
  conversationId: string,
  bodyUpdates: Record<string, BodyUpdate>,
  resimulate: boolean = false
): Promise<BatchSceneUpdateResponse> {
  return batchUpdateScene({
    conversation_id: conversationId,
    body_updates: bodyUpdates,
    resimulate,
  });
}

/**
 * Update constraint (rope, spring, etc.).
 * 
 * @param conversationId - Conversation ID
 * @param constraintId - Constraint identifier
 * @param updates - Constraint updates
 * @param resimulate - Whether to resimulate after update
 * @returns Updated scene response
 * 
 * @example
 * ```typescript
 * await updateConstraint('abc123', 'rope1', { length_m: 1.5 });
 * ```
 */
export async function updateConstraint(
  conversationId: string,
  constraintId: string,
  updates: ConstraintUpdate,
  resimulate: boolean = false
): Promise<BatchSceneUpdateResponse> {
  return batchUpdateScene({
    conversation_id: conversationId,
    constraint_updates: {
      [constraintId]: updates,
    },
    resimulate,
  });
}

// ===========================
// Debounced Update Helper
// ===========================

/**
 * Creates a debounced batch update function.
 * Useful for Interactive Mode to avoid excessive API calls during dragging.
 * 
 * @param conversationId - Conversation ID
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced update function and flush function
 * 
 * @example
 * ```typescript
 * const { debouncedUpdate, flush } = createDebouncedBatchUpdate('abc123', 500);
 * 
 * // During drag
 * debouncedUpdate({ massA: { position_m: [x, y] } });
 * 
 * // On drag end
 * await flush();
 * ```
 */
export function createDebouncedBatchUpdate(
  conversationId: string,
  delay: number = 500
) {
  let timeoutId: NodeJS.Timeout | null = null;
  let pendingUpdates: {
    bodies: Record<string, BodyUpdate>;
    constraints: Record<string, ConstraintUpdate>;
  } = {
    bodies: {},
    constraints: {},
  };
  let lastResponse: BatchSceneUpdateResponse | null = null;

  const flush = async (): Promise<BatchSceneUpdateResponse | null> => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (Object.keys(pendingUpdates.bodies).length === 0 && 
        Object.keys(pendingUpdates.constraints).length === 0) {
      return null;
    }

    const updates = { ...pendingUpdates };
    pendingUpdates = { bodies: {}, constraints: {} };

    const resp = await batchUpdateScene({
      conversation_id: conversationId,
      body_updates: updates.bodies,
      constraint_updates: updates.constraints,
      resimulate: false,
    });
    lastResponse = resp;
    return resp;
  };

  const debouncedUpdate = (
    bodyUpdates?: Record<string, BodyUpdate>,
    constraintUpdates?: Record<string, ConstraintUpdate>
  ) => {
    if (bodyUpdates) {
      Object.assign(pendingUpdates.bodies, bodyUpdates);
    }
    if (constraintUpdates) {
      Object.assign(pendingUpdates.constraints, constraintUpdates);
    }

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(flush, delay);
  };

  return { debouncedUpdate, flush, getLastResponse: () => lastResponse };
}

/**
 * Resimulate scene with current backend state.
 * Triggers a new simulation run based on the latest scene modifications.
 * 
 * @param conversationId - Conversation ID
 * @param duration - Simulation duration in seconds (default: 5)
 * @returns Simulation result with new frames
 * 
 * @example
 * ```typescript
 * const result = await resimulateScene('abc123', 10);
 * console.log('New frames:', result.frames.length);
 * ```
 */
export async function resimulateScene(
  conversationId: string,
  duration: number = 5
): Promise<{ frames: any[]; scene: any }> {
  const response = await fetch(`${API_BASE_URL}/run_sim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conversation_id: conversationId,
      duration_s: duration,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(`Resimulation failed: ${error.detail || response.statusText}`);
  }

  return response.json();
}
