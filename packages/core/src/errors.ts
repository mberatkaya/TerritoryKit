export class TerritoryZoneNotFoundError extends Error {
  readonly zoneId: string;

  constructor(zoneId: string) {
    super(`Territory zone '${zoneId}' was not found.`);
    this.name = "TerritoryZoneNotFoundError";
    this.zoneId = zoneId;
  }
}
