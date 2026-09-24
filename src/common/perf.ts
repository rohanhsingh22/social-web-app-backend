// Lightweight performance timing for slow-path diagnosis.
// Uses Logger.debug so production (LOG_LEVEL=log) stays quiet; enable with
// LOG_LEVEL=debug to see per-segment breakdowns.
export const perfNow = (): number => Date.now();

export const perfElapsedMs = (start: number): number => Date.now() - start;

export const formatPerfMs = (ms: number): string => `${ms.toFixed(1)}ms`;
