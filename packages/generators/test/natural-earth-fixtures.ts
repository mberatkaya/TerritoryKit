import {
  NATURAL_EARTH_ADM0_DATASET_NAME,
  NATURAL_EARTH_ADM0_SOURCE_URL,
  NATURAL_EARTH_ATTRIBUTION,
  NATURAL_EARTH_PROVIDER,
  NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE
} from "../src/index.js";
import type { NaturalEarthSourceDescriptor } from "../src/index.js";

export function createNaturalEarthSourceDescriptor(
  overrides: Partial<NaturalEarthSourceDescriptor> = {}
): NaturalEarthSourceDescriptor {
  return {
    provider: NATURAL_EARTH_PROVIDER,
    datasetName: NATURAL_EARTH_ADM0_DATASET_NAME,
    version: "fixture-1",
    sourcePath: "synthetic-natural-earth-adm0.geojson",
    sourceUrl: NATURAL_EARTH_ADM0_SOURCE_URL,
    sourceSha256: "fixture-sha",
    license: NATURAL_EARTH_PUBLIC_DOMAIN_LICENSE,
    attribution: NATURAL_EARTH_ATTRIBUTION,
    sourceDate: "fixture-1",
    importedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}

export function createNaturalEarthValidFixture(): unknown {
  return {
    type: "FeatureCollection",
    name: "Synthetic Natural Earth ADM0 fixture",
    features: [
      feature("TUR", {
        ISO_A2: "TR",
        ISO_A2_EH: "TR",
        ADM0_A3: "TUR",
        NAME: "Turkiye",
        NAME_EN: "Turkey",
        FORMAL_EN: "Republic of Turkiye",
        CONTINENT: "Asia",
        geometry: polygon([
          [
            [25, 36],
            [30, 36],
            [35, 36],
            [45, 36],
            [45, 42],
            [35, 42],
            [25, 42],
            [25, 36]
          ]
        ])
      }),
      feature("ISL", {
        ISO_A2: "IS",
        ADM0_A3: "ISL",
        NAME: "Islandia",
        NAME_EN: "Islandia",
        geometry: multipolygon([
          [
            [
              [-20, 60],
              [-19, 60],
              [-19, 61],
              [-20, 61],
              [-20, 60]
            ]
          ],
          [
            [
              [-18, 60],
              [-17, 60],
              [-17, 61],
              [-18, 61],
              [-18, 60]
            ]
          ]
        ])
      }),
      feature("DEU", {
        ISO_A2: "DE",
        ADM0_A3: "DEU",
        NAME: "Holeland",
        NAME_EN: "Holeland",
        geometry: polygon([
          [
            [5, 47],
            [15, 47],
            [15, 55],
            [5, 55],
            [5, 47]
          ],
          [
            [8, 49],
            [9, 49],
            [9, 50],
            [8, 50],
            [8, 49]
          ]
        ])
      }),
      feature("FJI", {
        ISO_A2: "FJ",
        ADM0_A3: "FJI",
        NAME: "Dateline",
        NAME_EN: "Dateline",
        geometry: polygon([
          [
            [178, -18],
            [179, -18],
            [179, -17],
            [178, -17],
            [178, -18]
          ]
        ])
      }),
      feature("XAA", {
        ISO_A2: "-99",
        ISO_A2_EH: "XA",
        ADM0_A3: "XAA",
        NAME: "Fallbackland",
        NAME_EN: "Fallbackland",
        geometry: polygon([
          [
            [60, 10],
            [61, 10],
            [61, 11],
            [60, 11],
            [60, 10]
          ]
        ])
      }),
      feature("QBA", {
        ISO_A2: "QB",
        ADM0_A3: "QBA",
        NAME_EN: "English Name Only",
        FORMAL_EN: "Formal Fallback Republic",
        geometry: polygon([
          [
            [70, 10],
            [71, 10],
            [71, 11],
            [70, 11],
            [70, 10]
          ]
        ])
      })
    ]
  };
}

export function createNaturalEarthMixedIssueFixture(): unknown {
  const fixture = createNaturalEarthValidFixture() as {
    features: Array<Record<string, unknown>>;
  };

  return {
    ...fixture,
    features: [
      ...fixture.features,
      feature("DUP", {
        ISO_A2: "TR",
        ADM0_A3: "DUP",
        NAME: "Duplicate Turkiye",
        geometry: polygon([
          [
            [50, 0],
            [51, 0],
            [51, 1],
            [50, 1],
            [50, 0]
          ]
        ])
      }),
      feature("NULL", {
        ISO_A2: "NL",
        ADM0_A3: "NUL",
        NAME: "Null Geometry",
        geometry: null
      }),
      feature("POINT", {
        ISO_A2: "PT",
        ADM0_A3: "PNT",
        NAME: "Point Geometry",
        geometry: { type: "Point", coordinates: [0, 0] }
      }),
      feature("MISSING-CODE", {
        NAME: "No Code",
        geometry: polygon([
          [
            [80, 0],
            [81, 0],
            [81, 1],
            [80, 1],
            [80, 0]
          ]
        ])
      }),
      {
        type: "Feature",
        id: "BAD-PROPS",
        properties: null,
        geometry: polygon([
          [
            [82, 0],
            [83, 0],
            [83, 1],
            [82, 1],
            [82, 0]
          ]
        ])
      },
      feature("EMPTY", {
        ISO_A2: "EM",
        ADM0_A3: "EMP",
        NAME: "Empty Coordinates",
        geometry: { type: "Polygon", coordinates: [] }
      }),
      feature("NO-NAME", {
        ISO_A2: "MN",
        ADM0_A3: "MNA",
        geometry: polygon([
          [
            [84, 0],
            [85, 0],
            [85, 1],
            [84, 1],
            [84, 0]
          ]
        ])
      })
    ]
  };
}

function feature(
  id: string,
  options: Record<string, unknown> & {
    geometry: unknown;
  }
): Record<string, unknown> {
  const { geometry, ...properties } = options;

  return {
    type: "Feature",
    id,
    properties,
    geometry
  };
}

function polygon(coordinates: number[][][]): Record<string, unknown> {
  return {
    type: "Polygon",
    coordinates
  };
}

function multipolygon(coordinates: number[][][][]): Record<string, unknown> {
  return {
    type: "MultiPolygon",
    coordinates
  };
}
