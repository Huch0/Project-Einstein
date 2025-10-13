// Common frontend utilities (class name merge, numeric helpers, etc.)
import { type ClassValue, clsx } from 'clsx';

// Tailwind merge substitute (simple) – can extend later; currently clsx enough for baseline.
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function formatNumber(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : 'NaN';
}

// Physics helper (may move to distinct module later)
export function gravitationalPotentialEnergy(massKg: number, g: number, heightM: number): number {
  return massKg * g * heightM;
}

// Unique id helper
let _uid = 0;
export function nextId(prefix = 'id'): string {
  _uid += 1;
  return `${prefix}_${_uid}`;
}
