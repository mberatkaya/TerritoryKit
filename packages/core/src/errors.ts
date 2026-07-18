import { TerritoryError } from "@territory-kit/dataset";

export class TerritoryZoneNotFoundError extends TerritoryError {
  readonly zoneId: string;

  constructor(zoneId: string) {
    super("ZONE_NOT_FOUND", `Territory zone '${zoneId}' was not found.`, {
      details: { zoneId }
    });
    this.name = "TerritoryZoneNotFoundError";
    this.zoneId = zoneId;
  }
}
