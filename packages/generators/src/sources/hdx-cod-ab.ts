import { readFile } from "node:fs/promises";
import { TERRITORY_ADMIN_LEVELS, normalizeTerritoryAdminLevel } from "@territory-kit/dataset";
import type { TerritoryAdminLevel } from "@territory-kit/dataset";
import { TerritorySourceError, createSourceIssue } from "./errors.js";
import { transformGenericGeoJson } from "./generic-geojson.js";
import type { GenericGeoJsonSourceOptions } from "./generic-geojson.js";
import type {
  TerritorySourceAdapter,
  TerritorySourceContext,
  TerritorySourceIssue,
  TerritorySourceTransformResult
} from "./types.js";
import { verifySourceArtifact } from "./verification.js";

export const HDX_COD_AB_SOURCE_ADAPTER_ID = "hdx-cod-ab" as const;
export const HDX_COD_AB_LICENSE = "CC BY-IGO" as const;
export const HDX_COD_AB_TURKEY_SOURCE_URL = "https://data.humdata.org/dataset/cod-ab-tur" as const;
export const HDX_COD_AB_TURKEY_ATTRIBUTION =
  "OCHA Common Operational Dataset: Türkiye Administrative Boundaries" as const;

export interface HdxCodAbSourceOptions {
  countryCode: string;
  adminLevel: TerritoryAdminLevel | string;
  sourceDate?: string;
  sourceUrl?: string;
  datasetId?: string;
  datasetVersion?: string;
  buildDate?: string;
  attribution?: string;
}

export const hdxCodAbSourceAdapter: TerritorySourceAdapter<HdxCodAbSourceOptions, unknown> = {
  id: HDX_COD_AB_SOURCE_ADAPTER_ID,
  displayName: "HDX / OCHA COD-AB",
  supportedAdminLevels: ["ADM0", "ADM1", "ADM2"],
  capabilities: {
    localFile: true,
    remoteFetch: true,
    cache: true,
    attributionRequired: true
  },
  describe() {
    return {
      id: HDX_COD_AB_SOURCE_ADAPTER_ID,
      displayName: "HDX / OCHA COD-AB",
      supportedAdminLevels: ["ADM0", "ADM1", "ADM2"],
      supportedTransports: ["local", "remote"],
      inputFormats: ["GeoJSON FeatureCollection"],
      defaultSourceUrl: HDX_COD_AB_TURKEY_SOURCE_URL,
      defaultLicense: HDX_COD_AB_LICENSE,
      attributionRequired: true,
      options: [
        { name: "countryCode", required: true, description: "ISO 3166-1 alpha-2 country code." },
        { name: "adminLevel", required: true, description: "ADM0, ADM1, or ADM2." }
      ],
      exampleCommand:
        "territory import hdx-cod-ab --country TR --admin-level ADM2 --input ./tur_admin2.geojson --output ./dist/tr-adm2"
    };
  },
  validateOptions(options) {
    const issues: TerritorySourceIssue[] = [];
    const adminLevel = safeNormalizeAdminLevel(options.adminLevel);

    if (!options.countryCode) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: "--country is required.",
          provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
          details: { option: "countryCode" }
        })
      );
    }

    if (!adminLevel) {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: "--admin-level must be ADM0, ADM1, or ADM2 for HDX COD-AB Turkey.",
          provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
          details: { option: "adminLevel" }
        })
      );
    }

    if (options.countryCode && options.countryCode.toUpperCase() !== "TR") {
      issues.push(
        createSourceIssue({
          stage: "resolve",
          code: "SOURCE_OPTIONS_INVALID",
          message: "The built-in HDX COD-AB adapter currently has reviewed mappings only for TR.",
          provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
          details: { option: "countryCode" }
        })
      );
    }

    return issues;
  },
  fetch(request, context) {
    return context.resolveArtifact(HDX_COD_AB_SOURCE_ADAPTER_ID, request);
  },
  verify(artifact, context) {
    return verifySourceArtifact(artifact, context, context.request);
  },
  async parse(artifact) {
    try {
      return JSON.parse(await readFile(artifact.localPath, "utf8")) as unknown;
    } catch (error) {
      throw new TerritorySourceError({
        code: "SOURCE_PARSE_FAILED",
        message: error instanceof Error ? error.message : String(error),
        stage: "parse",
        provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
        details: { sourcePath: artifact.localPath },
        cause: error
      });
    }
  },
  async transform(parsed, options, context) {
    return transformHdxCodAb(parsed, options, context);
  }
};

export function transformHdxCodAb(
  parsed: unknown,
  options: HdxCodAbSourceOptions,
  context: TerritorySourceContext
): TerritorySourceTransformResult {
  const adminLevel = normalizeTerritoryAdminLevel(String(options.adminLevel));
  const mapping = hdxTurkeyMapping(adminLevel);

  if (!mapping) {
    return {
      dataset: transformGenericGeoJson(
        { type: "FeatureCollection", features: [] },
        {
          countryCode: options.countryCode,
          adminLevel,
          nameProperty: "missing",
          provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
          license: HDX_COD_AB_LICENSE,
          attribution: options.attribution ?? HDX_COD_AB_TURKEY_ATTRIBUTION
        },
        context
      ).dataset,
      manifestMetadata: {},
      attribution: {
        provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
        text: options.attribution ?? HDX_COD_AB_TURKEY_ATTRIBUTION,
        license: HDX_COD_AB_LICENSE,
        sourceUrl: options.sourceUrl ?? HDX_COD_AB_TURKEY_SOURCE_URL
      },
      issues: [
        createSourceIssue({
          stage: "transform",
          code: "SOURCE_LEVEL_UNSUPPORTED",
          message: `HDX COD-AB Turkey mapping does not support ${adminLevel}.`,
          provider: HDX_COD_AB_SOURCE_ADAPTER_ID
        })
      ],
      statistics: {
        inputFeatureCount: 0,
        acceptedFeatureCount: 0,
        skippedFeatureCount: 0,
        warningCount: 0,
        errorCount: 1
      }
    };
  }

  return transformGenericGeoJson(
    parsed,
    {
      countryCode: options.countryCode,
      adminLevel,
      idProperty: mapping.idProperty,
      nameProperty: mapping.nameProperty,
      ...(mapping.parentProperty ? { parentProperty: mapping.parentProperty } : {}),
      codeProperty: mapping.idProperty,
      localType: mapping.localType,
      provider: HDX_COD_AB_SOURCE_ADAPTER_ID,
      sourceUrl: options.sourceUrl ?? HDX_COD_AB_TURKEY_SOURCE_URL,
      sourceDate: options.sourceDate ?? "2026-01-26",
      license: HDX_COD_AB_LICENSE,
      attribution: options.attribution ?? HDX_COD_AB_TURKEY_ATTRIBUTION,
      datasetId: options.datasetId ?? `hdx-cod-ab-tr-${adminLevel.toLowerCase()}`,
      ...(options.datasetVersion ? { datasetVersion: options.datasetVersion } : {}),
      ...(options.buildDate ? { buildDate: options.buildDate } : {})
    } satisfies GenericGeoJsonSourceOptions,
    context
  );
}

function hdxTurkeyMapping(
  adminLevel: TerritoryAdminLevel
):
  | { idProperty: string; nameProperty: string; parentProperty?: string; localType: string }
  | undefined {
  switch (adminLevel) {
    case "ADM0":
      return {
        idProperty: "adm0_pcode",
        nameProperty: "adm0_name1",
        localType: "country"
      };
    case "ADM1":
      return {
        idProperty: "adm1_pcode",
        nameProperty: "adm1_name1",
        parentProperty: "adm0_pcode",
        localType: "province"
      };
    case "ADM2":
      return {
        idProperty: "adm2_pcode",
        nameProperty: "adm2_name1",
        parentProperty: "adm1_pcode",
        localType: "district"
      };
    default:
      return undefined;
  }
}

function safeNormalizeAdminLevel(
  input: TerritoryAdminLevel | string
): TerritoryAdminLevel | undefined {
  try {
    const level = normalizeTerritoryAdminLevel(String(input));
    return TERRITORY_ADMIN_LEVELS.includes(level) && hdxTurkeyMapping(level) ? level : undefined;
  } catch {
    return undefined;
  }
}
