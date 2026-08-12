/**
 * The port version identifier.
 *
 * Adapter output is content-addressed on (port version, component, system) so
 * only cache misses are regenerated (architecture §8). This version advances
 * whenever a component is added or its prop shape changes.
 *
 * Format: MAJOR.MINOR — MAJOR bumps on a breaking shape change, MINOR on an
 * additive change (new optional prop or new component).
 */
export const PORT_VERSION = '0.1' as const;
