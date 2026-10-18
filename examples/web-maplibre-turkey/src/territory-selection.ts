import type { TerritoryZone } from "@territory-kit/dataset";
import type { TerritoryDetails } from "./types.js";

function readTerritoryRecord(zone: TerritoryZone): Record<string, unknown> | undefined {
  const territory = zone.properties?.territory;
  return territory && typeof territory === "object"
    ? (territory as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function formatArea(zone: TerritoryZone): string {
  const territory = readTerritoryRecord(zone);
  const hectares = territory?.areaHectares;
  if (typeof hectares === "number" && Number.isFinite(hectares)) {
    return `${hectares.toFixed(2)} ha`;
  }
  const sqm = territory?.areaSquareMeters;
  if (typeof sqm === "number" && Number.isFinite(sqm)) {
    return `${(sqm / 10_000).toFixed(2)} ha`;
  }
  return "— (ölçüm yok)";
}

export function buildTerritorySelectionRows(
  details: TerritoryDetails
): ReadonlyArray<readonly [string, string]> {
  const zone = details.zone;
  const territory = readTerritoryRecord(zone);
  const boundaryKind = readString(territory?.boundaryKind);
  const sourceClass =
    readString(territory?.boundarySourceClass) ?? readString(territory?.sourceClass);
  const confidence = readString(territory?.confidence);
  const administrative = territory?.administrative === true;
  const authoritative = territory?.authoritative === true;
  const estimated =
    boundaryKind === "estimated" || sourceClass === "smart-derived" || sourceClass === "generated";
  const districtName = readString(zone.properties?.districtName);
  const provinceName = readString(zone.properties?.provinceName);
  const license =
    readString(territory?.license) ??
    readString((territory?.source as Record<string, unknown>)?.license);
  const attribution =
    readString(territory?.attribution) ??
    readString((territory?.source as Record<string, unknown>)?.attribution);

  const rows: Array<readonly [string, string]> = [
    ["Ad", zone.localName ?? zone.name ?? String(zone.properties?.name ?? zone.id)],
    ["Kararlı ID", zone.id],
    ["Düzey", `ADM${zone.level}`],
    ["İl", provinceName ?? details.parent?.name ?? "—"],
    [
      "İlçe",
      districtName ?? (zone.level === 2 ? (zone.name ?? zone.id) : (details.parent?.name ?? "—"))
    ],
    ["Alan", formatArea(zone)],
    ["Kaynak sınıfı", sourceClass ?? "—"],
    ["Sınır türü", boundaryKind ?? (estimated ? "estimated" : "—")],
    ["Resmî idari", administrative ? "evet" : "hayır"],
    ["Yetkili", authoritative ? "evet" : "hayır"]
  ];

  if (confidence) {
    rows.push(["Güven", confidence]);
  }

  if (estimated) {
    rows.push([
      "Oyun zonu",
      "Tahmini GAME zonu — resmî mahalle sınırı iddiası yok; TerritoryKit üretimi."
    ]);
  }

  if (license) {
    rows.push(["Lisans", license]);
  }

  if (attribution) {
    rows.push(["Atıf", attribution]);
  }

  return rows;
}
