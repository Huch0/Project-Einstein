import Matter from 'matter-js';

const { Engine, World, Bodies, Body, Constraint } = Matter;

export interface MatterSimulationOptions {
    duration_s?: number;
    maxSteps?: number;
}

interface BuiltScene {
    engine: Matter.Engine;
    bodyMap: Map<string, Matter.Body>;
    pulleyConstraints: Array<{
        bodyA: Matter.Body;
        bodyB: Matter.Body;
        anchor: [number, number];
        totalLength: number;
    }>;
}

export type MatterSceneInstance = BuiltScene;

const toVec2 = (value: unknown): [number, number] | null => {
    if (Array.isArray(value) && value.length >= 2) {
        const x = Number(value[0]);
        const y = Number(value[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return [x, y];
        }
    }
    return null;
};

const toMatterVec = (value: unknown): [number, number] | null => {
    const tuple = toVec2(value);
    if (!tuple) return null;
    return [tuple[0], -tuple[1]];
};

const toMatterAngle = (value: unknown): number => {
    const angle = typeof value === 'number' ? value : 0;
    return -angle;
};

const fromMatterPosition = (body: Matter.Body): [number, number] => [
    body.position.x,
    -body.position.y,
];

const fromMatterVelocity = (body: Matter.Body): [number, number] => [
    body.velocity.x,
    -body.velocity.y,
];

function createBody(bodyDef: any): Matter.Body {
    const scenePosition = toVec2(bodyDef?.position_m) ?? [0, 0];
    const [matterX, matterY] = [scenePosition[0], -scenePosition[1]];
    const collider = bodyDef?.collider ?? null;
    const materialFriction = bodyDef?.material?.friction;
    const friction = typeof materialFriction === 'number' ? materialFriction : 0.0;
    const isStatic = bodyDef?.type === 'static';
    const isEnvironment = isStatic || ['surface', 'ground', 'ramp', 'rope', 'anchor'].includes(bodyDef?.id?.split('_')[0] ?? '');

    const commonOpts: Matter.IBodyDefinition = {
        isStatic,
        friction,
        frictionAir: 0.0,
        restitution: 0.0,
        label: bodyDef?.id ?? 'body',
        render: {
            fillStyle: isEnvironment ? 'rgba(120, 120, 140, 0.175)' : '#3b82f6',
            strokeStyle: isEnvironment ? 'rgba(255,255,255,0.35)' : '#111827',
            lineWidth: isEnvironment ? 1 : 2,
        },
    };

    let body: Matter.Body | Matter.Body[];

    if (collider?.type === 'circle') {
        const radius = Math.max(Math.abs(collider.radius_m ?? 0.05), 0.01);
        body = Bodies.circle(matterX, matterY, radius, commonOpts);
    } else if (collider?.type === 'rectangle') {
        const width = Math.max(Math.abs(collider.width_m ?? 0.1), 0.01);
        const height = Math.max(Math.abs(collider.height_m ?? 0.1), 0.01);
        const rectOptions: Matter.IChamferableBodyDefinition = {
            ...commonOpts,
            chamfer: undefined,
        };
        body = Bodies.rectangle(matterX, matterY, width, height, rectOptions);
    } else if (collider?.type === 'polygon' && Array.isArray(collider.vertices) && collider.vertices.length >= 3) {
        const baseScene = toVec2(bodyDef?.position_m) ?? [0, 0];
        const baseMatter = [baseScene[0], -baseScene[1]] as [number, number];
        const localVerts = (collider.vertices as Array<unknown>)
            .map((vert) => {
                const tuple = toVec2(vert);
                if (!tuple) return null;
                const vx = tuple[0];
                const vy = -tuple[1];
                return { x: vx - baseMatter[0], y: vy - baseMatter[1] };
            })
            .filter((vert): vert is { x: number; y: number } => Boolean(vert));

        body = Bodies.fromVertices(matterX, matterY, [localVerts], commonOpts, true);
    } else {
        body = Bodies.circle(matterX, matterY, 0.05, commonOpts);
    }

    const singleBody = Array.isArray(body) ? body[0] : body;
    if (!singleBody) {
        throw new Error(`Failed to create Matter body for ${bodyDef?.id ?? 'unknown'}`);
    }

    const initialAngle = toMatterAngle(bodyDef?.angle_rad);
    if (initialAngle !== 0) {
        Body.setAngle(singleBody, initialAngle);
    }

    if (!isStatic) {
        const targetMass = Number(bodyDef?.mass_kg);
        if (Number.isFinite(targetMass) && targetMass > 0) {
            Body.setMass(singleBody, targetMass);
        } else {
            const fallbackMass = Math.max(Number(bodyDef?.mass_default_kg ?? 1), 0.1);
            Body.setMass(singleBody, fallbackMass);
        }
    } else if (isEnvironment) {
        Body.setDensity(singleBody, 0.001);
    }

    return singleBody;
}

export function initializeMatterScene(scene: any): BuiltScene {
    const gravity = scene?.world?.gravity_m_s2 ?? 9.81;
    const engine = Engine.create({
        gravity: { x: 0, y: gravity },
    });

    const bodyMap = new Map<string, Matter.Body>();
    const pulleyConstraints: BuiltScene['pulleyConstraints'] = [];

    for (const bodyDef of scene?.bodies ?? []) {
        if (!bodyDef?.id) continue;
        const body = createBody(bodyDef);
        bodyMap.set(bodyDef.id, body);
        World.add(engine.world, body);
    }

    const ropeLikeKeys = new Set([
        'rope',
        'rope_constraint',
        'ropeconstraint',
        'rope_segment',
        'ropesegment',
        'distance',
        'spring',
    ]);

    for (const constraintDef of scene?.constraints ?? []) {
        const typeRaw = constraintDef?.type;
        const typeKey = typeof typeRaw === 'string' ? typeRaw.toLowerCase().replace(/[-\s]/g, '_') : '';

        if (typeKey === 'ideal_fixed_pulley') {
            const anchorScene = toVec2(constraintDef?.pulley_anchor_m);
            const anchor = anchorScene ? [anchorScene[0], -anchorScene[1]] as [number, number] : null;
            const ropeLength = Number(constraintDef?.rope_length_m);
            const bodyA = bodyMap.get(constraintDef?.body_a ?? '');
            const bodyB = bodyMap.get(constraintDef?.body_b ?? '');

            if (!anchor || !bodyA || !bodyB) {
                continue;
            }

            const distA = Math.hypot(bodyA.position.x - anchor[0], bodyA.position.y - anchor[1]);
            const distB = Math.hypot(bodyB.position.x - anchor[0], bodyB.position.y - anchor[1]);

            const ropeA = Constraint.create({
                pointA: { x: anchor[0], y: anchor[1] },
                bodyB: bodyA,
                length: distA,
                stiffness: 1.0,
                damping: 0.0,
            });

            const ropeB = Constraint.create({
                pointA: { x: anchor[0], y: anchor[1] },
                bodyB: bodyB,
                length: distB,
                stiffness: 1.0,
                damping: 0.0,
            });

            World.add(engine.world, [ropeA, ropeB]);
            const totalLength = Number.isFinite(ropeLength) ? ropeLength : distA + distB;
            pulleyConstraints.push({ bodyA, bodyB, anchor, totalLength });
            continue;
        }
        if (ropeLikeKeys.has(typeKey)) {
            const bodyA = bodyMap.get(constraintDef?.body_a ?? '');
            const bodyB = bodyMap.get(constraintDef?.body_b ?? '');
            if (!bodyA || !bodyB) {
                continue;
            }

            const pickAnchorValue = (...keys: string[]) => {
                for (const key of keys) {
                    const value = (constraintDef as any)[key];
                    if (value !== undefined && value !== null) {
                        return value;
                    }
                }
                return undefined;
            };

            const anchorA = toMatterVec(
                pickAnchorValue(
                    'anchor_a',
                    'anchorA',
                    'anchor_a_m',
                    'anchorA_m',
                    'point_a',
                    'pointA',
                    'point_a_m',
                    'pointA_m',
                    'offset_a',
                    'offsetA',
                    'offset_a_m',
                    'offsetA_m',
                ) ?? [0, 0],
            ) ?? [0, 0];

            const anchorB = toMatterVec(
                pickAnchorValue(
                    'anchor_b',
                    'anchorB',
                    'anchor_b_m',
                    'anchorB_m',
                    'point_b',
                    'pointB',
                    'point_b_m',
                    'pointB_m',
                    'offset_b',
                    'offsetB',
                    'offset_b_m',
                    'offsetB_m',
                ) ?? [0, 0],
            ) ?? [0, 0];

            const restLengthRaw = Number(
                pickAnchorValue('rope_length_m', 'length_m', 'rest_length_m'),
            );
            const defaultStiffness = typeKey === 'spring' ? 0.5 : typeKey === 'distance' ? 0.9 : 1;
            const defaultDamping = typeKey === 'spring' ? 0.2 : 0;
            const stiffnessRaw = Number(
                (constraintDef as any)?.tuning?.stiffness ??
                    (constraintDef as any)?.stiffness ??
                    defaultStiffness,
            );
            const dampingRaw = Number(
                (constraintDef as any)?.tuning?.damping ??
                    (constraintDef as any)?.damping ??
                    defaultDamping,
            );

            const stiffness = Number.isFinite(stiffnessRaw)
                ? Math.min(Math.max(stiffnessRaw, 0), 1)
                : defaultStiffness;
            const damping = Number.isFinite(dampingRaw)
                ? Math.max(dampingRaw, 0)
                : defaultDamping;

            let length: number | undefined =
                Number.isFinite(restLengthRaw) && restLengthRaw > 0 ? restLengthRaw : undefined;
            if (!length) {
                const ax = bodyA.position.x + anchorA[0];
                const ay = bodyA.position.y + anchorA[1];
                const bx = bodyB.position.x + anchorB[0];
                const by = bodyB.position.y + anchorB[1];
                const computed = Math.hypot(bx - ax, by - ay);
                length = Number.isFinite(computed) && computed > 0 ? computed : undefined;
            }

            const strokeStyle = typeKey === 'spring'
                ? '#f97316'
                : typeKey === 'distance'
                ? '#64748b'
                : '#8b5cf6';

            const rope = Constraint.create({
                bodyA,
                pointA: { x: anchorA[0], y: anchorA[1] },
                bodyB,
                pointB: { x: anchorB[0], y: anchorB[1] },
                length,
                stiffness,
                damping,
                render: {
                    strokeStyle,
                },
            });

            World.add(engine.world, rope);
            continue;
        }
    }

    return { engine, bodyMap, pulleyConstraints };
}

function enforcePulleyConstraints(constraints: BuiltScene['pulleyConstraints']) {
    for (const pulley of constraints) {
        const { bodyA, bodyB, anchor, totalLength } = pulley;
        const pA = bodyA.position;
        const pB = bodyB.position;
        const distA = Math.hypot(pA.x - anchor[0], pA.y - anchor[1]);
        const distB = Math.hypot(pB.x - anchor[0], pB.y - anchor[1]);
        const error = distA + distB - totalLength;

        if (Math.abs(error) < 1e-4) {
            continue;
        }

        const dirAx = (pA.x - anchor[0]) / distA;
        const dirAy = (pA.y - anchor[1]) / distA;
        const dirBx = (pB.x - anchor[0]) / distB;
        const dirBy = (pB.y - anchor[1]) / distB;

        const mA = bodyA.mass;
        const mB = bodyB.mass;
        const totalMass = mA + mB || 1;

        const corrA = -error * (mB / totalMass);
        const corrB = -error * (mA / totalMass);

        Body.setPosition(bodyA, {
            x: pA.x + dirAx * corrA,
            y: pA.y + dirAy * corrA,
        });

        Body.setPosition(bodyB, {
            x: pB.x + dirBx * corrB,
            y: pB.y + dirBy * corrB,
        });

        const vA = bodyA.velocity;
        const vB = bodyB.velocity;
        const vnA = vA.x * dirAx + vA.y * dirAy;
        const vnB = vB.x * dirBx + vB.y * dirBy;
        const totalVn = vnA + vnB;

        if (Math.abs(totalVn) > 1e-5) {
            const vCorrection = -totalVn * 0.5;
            Body.setVelocity(bodyA, {
                x: vA.x + dirAx * vCorrection,
                y: vA.y + dirAy * vCorrection,
            });
            Body.setVelocity(bodyB, {
                x: vB.x + dirBx * vCorrection,
                y: vB.y + dirBy * vCorrection,
            });
        }
    }
}

function snapshotFrame(time_s: number, bodyMap: Map<string, Matter.Body>) {
    return {
        t: Number(time_s.toFixed(4)),
        bodies: Array.from(bodyMap.entries()).map(([id, body]) => ({
            id,
            position_m: fromMatterPosition(body),
            velocity_m_s: fromMatterVelocity(body),
            angle_rad: -body.angle,
            angular_velocity_rad_s: -body.angularVelocity,
            vertices_world: body.vertices.map((v: Matter.Vector) => [v.x, -v.y] as [number, number]),
        })),
    };
}

export function runMatterSimulation(scene: any, options?: MatterSimulationOptions) {
    const { engine, bodyMap, pulleyConstraints } = initializeMatterScene(scene);
    const dt = scene?.world?.time_step_s ?? 0.016;
    const duration = options?.duration_s ?? 5;
    const maxSteps = options?.maxSteps ?? 1000;
    const steps = Math.min(Math.ceil(duration / dt), maxSteps);

    const frames = [snapshotFrame(0, bodyMap)];

    for (let i = 0; i < steps; i++) {
        Engine.update(engine, dt * 1000);
        if (pulleyConstraints.length > 0) {
            enforcePulleyConstraints(pulleyConstraints);
        }
        const t = (i + 1) * dt;
        frames.push(snapshotFrame(t, bodyMap));
    }

    return { frames, dt };
}
