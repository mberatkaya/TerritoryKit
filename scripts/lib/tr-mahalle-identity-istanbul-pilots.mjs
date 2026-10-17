/**
 * Istanbul settlement-identity pilot registry (pinned rc.8 gameplay + OSM barrier seeds).
 */
export const ISTANBUL_SETTLEMENT_IDENTITY_PILOTS = [
  {
    district: "Fatih",
    slug: "fatih",
    adm2Suffix: "54988432b39641834885080",
    expectedParentNames: ["Fatih"],
    identityLayerVersion: "tr-mahalle-identity-fatih-pilot@2026-10-15",
    altBPreviewPath:
      "reports/tr-adm3/mahalle-first-program/fatih-alternative-b-semantic-association.json",
    officialPolygonNote:
      "No independently verified official mahalle polygons in gameplay or identity layer.",
    stressPhase: "regression"
  },
  {
    district: "Adalar",
    slug: "adalar",
    adm2Suffix: "54988432b94516152709384",
    expectedParentNames: ["Prince Islands", "Adalar"],
    identityLayerVersion: "tr-mahalle-identity-adalar-pilot@2026-10-17",
    officialPolygonNote:
      "Seed-only semantics; island multipolygon parent validated against rc.8 shard.",
    stressPhase: "A",
    stressFocus: ["island-multipolygon", "coastline-boundary-point", "disconnected-components"]
  },
  {
    district: "Eyüpsultan",
    slug: "eyupsultan",
    adm2Suffix: "54988432b93840376788897",
    expectedParentNames: ["Eyüpsultan"],
    identityLayerVersion: "tr-mahalle-identity-eyupsultan-pilot@2026-10-17",
    officialPolygonNote: "Sparse OSM locality seeds; expect unseeded gameplay zones.",
    stressPhase: "B",
    stressFocus: ["sparse-seeds", "low-network-coverage", "unseeded-zones"]
  },
  {
    district: "Kadıköy",
    slug: "kadikoy",
    adm2Suffix: "54988432b89638439219394",
    expectedParentNames: ["Kadıköy"],
    identityLayerVersion: "tr-mahalle-identity-kadikoy-pilot@2026-10-17",
    officialPolygonNote:
      "Municipal mahalle SHP bundle remains BLOCKED_BY_SOURCE (structurally invalid acquisition); identity layer uses OSM seeds only.",
    officialDataPolicy: {
      status: "BLOCKED_BY_SOURCE",
      acquisitionEvidencePath: "reports/tr-adm3/audit/kadikoy-acquisition.json",
      licenseReview: "REVIEW_REQUIRED",
      note: "Do not treat seed associations as licensed official mahalle boundaries."
    },
    stressPhase: "C",
    stressFocus: ["dense-urban", "multi-seed-zones", "duplicate-source-identity"]
  },
  {
    district: "Üsküdar",
    slug: "uskudar",
    adm2Suffix: "54988432b79162079631621",
    expectedParentNames: ["Üsküdar"],
    identityLayerVersion: "tr-mahalle-identity-uskudar-pilot@2026-10-17",
    officialPolygonNote: "Seed-only semantics on pinned rc.8 gameplay geometry.",
    stressPhase: "expansion"
  },
  {
    district: "Çatalca",
    slug: "catalca",
    adm2Suffix: "54988432b71345383711908",
    expectedParentNames: ["Çatalca"],
    identityLayerVersion: "tr-mahalle-identity-catalca-pilot@2026-10-17",
    officialPolygonNote: "Rural/low road-density district; wide unseeded zones expected.",
    stressPhase: "expansion"
  },
  {
    district: "Başakşehir",
    slug: "basaksehir",
    adm2Suffix: "54988432b67026781349893",
    expectedParentNames: ["Başakşehir"],
    identityLayerVersion: "tr-mahalle-identity-basaksehir-pilot@2026-10-17",
    officialPolygonNote: "Sprint 2D expansion pilot (not in Sprint 2 geometry handoff).",
    stressPhase: "expansion"
  },
  {
    district: "Esenyurt",
    slug: "esenyurt",
    adm2Suffix: "54988432b2777192469074",
    expectedParentNames: ["Esenyurt"],
    identityLayerVersion: "tr-mahalle-identity-esenyurt-pilot@2026-10-17",
    officialPolygonNote: "Sprint 2D expansion pilot (not in Sprint 2 geometry handoff).",
    stressPhase: "expansion"
  }
];

export const FATIH_REGRESSION_METRICS = {
  zoneCount: 30,
  ambiguousZoneCount: 15,
  singleSeedZoneCount: 10,
  unseededZoneCount: 5,
  distinctSeedsRepresented: 71,
  zoneIdSetSha256: "334ba60d9e4bf65c2acfce7d3724e7bf430ec082ad897459a902c19d3660852f",
  geometryHashSetSha256: "3b4c2dd9214f6aa1023277a3426e100bd9c2902f5c06e4a49b2478e462866645"
};

export function pilotBySlug(slug) {
  const row = ISTANBUL_SETTLEMENT_IDENTITY_PILOTS.find((entry) => entry.slug === slug);
  if (!row) {
    throw new Error(`Unknown Istanbul identity pilot slug: ${slug}`);
  }
  return row;
}
