import { DEMO_ADMIN_LEVELS, type DemoAdminLevel } from "./types.js";

export const LEVEL_ZOOM = {
  ADM1: { min: 5, enter: 6 },
  ADM2: { min: 8, enter: 9.2 },
  ADM3: { min: 12, enter: 12.6 }
} as const satisfies Record<DemoAdminLevel, { min: number; enter: number }>;

export function demoLevelForZoom(zoom: number): DemoAdminLevel {
  if (zoom >= LEVEL_ZOOM.ADM3.min) {
    return "ADM3";
  }

  if (zoom >= LEVEL_ZOOM.ADM2.min) {
    return "ADM2";
  }

  return "ADM1";
}

export function zoomForDemoLevel(level: DemoAdminLevel): number {
  return LEVEL_ZOOM[level].enter;
}

export function adminLevelDepth(level: DemoAdminLevel): number {
  return Number(level.slice(3));
}

export function childDemoLevel(level: DemoAdminLevel): DemoAdminLevel | undefined {
  const index = DEMO_ADMIN_LEVELS.indexOf(level);
  return DEMO_ADMIN_LEVELS[index + 1];
}

export function parentDemoLevel(level: DemoAdminLevel): DemoAdminLevel | undefined {
  const index = DEMO_ADMIN_LEVELS.indexOf(level);
  return DEMO_ADMIN_LEVELS[index - 1];
}

export function isDemoAdminLevel(value: string | undefined): value is DemoAdminLevel {
  return DEMO_ADMIN_LEVELS.includes(value as DemoAdminLevel);
}
