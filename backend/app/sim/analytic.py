from __future__ import annotations

from typing import Dict, List


def simulate_pulley_scene(scene: Dict, total_time_s: float = 2.0, dt_s: float | None = None) -> Dict:
    """Generate simple analytic frames for a fixed pulley with two masses.

    Supports optional kinetic friction on the surface block via
    scene.meta.surface.mu_k (if present). Defaults to the ideal case.

    Conventions:
    - Massless rope, frictionless pulley wheel (except surface friction if provided)
    - Bodies move only vertically with equal/opposite displacement magnitude
    - y increases downward (consistent with our scene mapping)
    """
    world = scene.get("world", {})
    g = float(world.get("gravity_m_s2", 9.81))
    dt = float(world.get("time_step_s", 0.016)) if dt_s is None else float(dt_s)
    if dt <= 0:
        dt = 0.016

    bodies = {b["id"]: b for b in scene.get("bodies", [])}
    # Expect m1 and m2 by contract
    b1 = bodies.get("m1")
    b2 = bodies.get("m2")
    if not b1 or not b2:
        return {"frames": [], "energy": {}}

    m1 = float(b1.get("mass_kg", 1.0))
    m2 = float(b2.get("mass_kg", 1.0))
    x1, y1 = b1.get("position_m", [0.0, 0.0])
    x2, y2 = b2.get("position_m", [0.0, 0.0])

    # Direction: heavier mass goes down (positive y); other goes up (negative y)
    if m2 >= m1:
        s1, s2 = -1.0, 1.0
        m_heavy = m2
    else:
        s1, s2 = 1.0, -1.0
        m_heavy = m1

    # Optional kinetic friction coefficient on m1 (surface contact)
    mu_k = 0.0
    meta = scene.get("meta", {})
    try:
        surf_meta = meta.get("surface", {})
        if "mu_k" in surf_meta:
            mu_k = float(surf_meta.get("mu_k", 0.0))
    except Exception:
        mu_k = 0.0

    # Acceleration magnitude (sign handled by s1/s2). If friction provided,
    # apply along m1 side opposing motion. Assume horizontal contact so N = m1*g.
    denom = (m1 + m2)
    if denom == 0:
        a = 0.0
    else:
        if mu_k > 0.0:
            # Determine which way system tends to move without friction
            a_ideal = abs(m2 - m1) / denom * g
            # Net driving force considering friction opposing motion on m1 side
            # If m2 heavier (s2=+1), friction on m1 opposes rightward motion -> subtract mu*m1*g
            net = abs(m2 - m1) * g - mu_k * m1 * g
            if net < 0:
                net = 0.0
            a = net / denom
        else:
            a = abs(m2 - m1) / denom * g

    steps = max(1, int(total_time_s / dt))
    frames: List[Dict] = []
    for i in range(0, steps + 1):
        t = i * dt
        dy = 0.5 * a * t * t
        p1 = [float(x1), float(y1 + s1 * dy)]
        p2 = [float(x2), float(y2 + s2 * dy)]
        frames.append({"t": round(t, 5), "positions": {"m1": p1, "m2": p2}})

    # Very rough energy summary
    energy = {"kinetic": 0.0, "potential": 0.0}
    return {"frames": frames, "energy": energy}


__all__ = ["simulate_pulley_scene"]
