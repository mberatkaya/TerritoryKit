import type { ZoomLevelStrategy } from "./types.js";

export const defaultZoomLevelStrategy: ZoomLevelStrategy = {
  resolveLevel({ zoom, availableLevels }) {
    const requestedLevel = zoomToDefaultLevel(zoom);
    const sortedLevels = [...availableLevels].sort((left, right) => left - right);

    if (sortedLevels.length === 0) {
      return requestedLevel;
    }

    const exact = sortedLevels.find((level) => level === requestedLevel);

    if (exact !== undefined) {
      return exact;
    }

    const lowerOrEqual = sortedLevels.filter((level) => level <= requestedLevel).at(-1);

    return lowerOrEqual ?? sortedLevels[0] ?? requestedLevel;
  }
};

export function zoomToDefaultLevel(zoom: number): number {
  if (zoom <= 2) {
    return 0;
  }

  if (zoom <= 5) {
    return 1;
  }

  if (zoom <= 8) {
    return 2;
  }

  if (zoom <= 11) {
    return 3;
  }

  if (zoom <= 14) {
    return 4;
  }

  return 5;
}
