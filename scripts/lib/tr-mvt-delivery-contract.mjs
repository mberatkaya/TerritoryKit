/**
 * Turkey national MVT delivery contract helpers (Sprint 3 reports + CI fixtures).
 * Consumer MapLibre `source-layer` must equal the encoded protobuf layer name.
 */

/** Encoded protobuf layer for territory-kit-tr-v2-playable ADM3 national tiles (rc.7+). */
export const TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER = "territory_adm3";

export function resolveDeclaredMvtSourceLayer(renderManifest, deliveryManifest) {
  const fromDelivery =
    deliveryManifest?.mvt && typeof deliveryManifest.mvt.sourceLayer === "string"
      ? deliveryManifest.mvt.sourceLayer
      : undefined;
  const renderLayer = renderManifest?.layers?.[0];
  const fromRender =
    renderLayer && typeof renderLayer.sourceLayer === "string"
      ? renderLayer.sourceLayer
      : undefined;
  return {
    deliveryManifestSourceLayer: fromDelivery ?? null,
    renderManifestSourceLayer: fromRender ?? null,
    renderArtifactLayerId: renderLayer?.id ?? null,
    consumerSourceLayerContract: TURKEY_V2_MVT_CONSUMER_SOURCE_LAYER
  };
}

export function layerHasParentAdm2Metadata(layer) {
  if (!layer || layer.length === 0) return false;
  for (let index = 0; index < layer.length; index++) {
    const props = layer.feature(index).properties ?? {};
    const parentAdm2Id = props.parentAdm2Id ?? props.parentId;
    if (typeof parentAdm2Id === "string" && parentAdm2Id.length > 0) return true;
  }
  return false;
}

export function findDistrictFeatureInLayer(layer, adm2Id) {
  if (!layer || layer.length === 0) return null;
  if (!layerHasParentAdm2Metadata(layer)) return null;
  for (let index = 0; index < layer.length; index++) {
    const feature = layer.feature(index);
    const props = feature.properties ?? {};
    const parentAdm2Id = props.parentAdm2Id ?? props.parentId;
    if (parentAdm2Id === adm2Id) {
      feature.loadGeometry();
      return { index, properties: props };
    }
  }
  return null;
}

/**
 * @param {object} input
 * @param {Uint8Array|Buffer} [input.bytes]
 * @param {string} input.expectedAdm2Id
 * @param {string} input.consumerSourceLayer
 * @param {string|null} [input.deliveryManifestSourceLayer]
 * @param {string|null} [input.renderManifestSourceLayer]
 * @param {string|null} [input.renderArtifactLayerId]
 */
export function classifyMvtDistrictSample(input) {
  const {
    bytes,
    expectedAdm2Id,
    consumerSourceLayer,
    deliveryManifestSourceLayer = null,
    renderManifestSourceLayer = null,
    renderArtifactLayerId = null
  } = input;

  if (!bytes || bytes.byteLength === 0) {
    return {
      classification: "INSUFFICIENT_EVIDENCE",
      encodedProtobufLayer: null,
      layerIds: [],
      districtClassification: "INSUFFICIENT_EVIDENCE"
    };
  }

  let tile;
  try {
    tile = input.decodeTile(bytes);
  } catch (error) {
    return {
      classification: "INVALID_MVT",
      message: error instanceof Error ? error.message : String(error),
      encodedProtobufLayer: null,
      layerIds: [],
      districtClassification: "INSUFFICIENT_EVIDENCE"
    };
  }

  const layerIds = Object.keys(tile.layers);
  if (layerIds.length === 0) {
    return {
      classification: "MISSING_LAYER",
      encodedProtobufLayer: null,
      layerIds,
      districtClassification: "DISTRICT_NOT_IN_TILE"
    };
  }

  const encodedProtobufLayer = layerIds.includes(consumerSourceLayer)
    ? consumerSourceLayer
    : layerIds.length === 1
      ? layerIds[0]
      : null;

  if (!encodedProtobufLayer || encodedProtobufLayer !== consumerSourceLayer) {
    return {
      classification: "MISSING_LAYER",
      encodedProtobufLayer: encodedProtobufLayer ?? layerIds[0] ?? null,
      layerIds,
      districtClassification: "DISTRICT_NOT_IN_TILE",
      firstFeatureParentAdm2Id: readFirstFeatureParent(tile, layerIds[0])
    };
  }

  const manifestDeclarationMismatch =
    (deliveryManifestSourceLayer && deliveryManifestSourceLayer !== encodedProtobufLayer) ||
    (renderManifestSourceLayer && renderManifestSourceLayer !== encodedProtobufLayer);

  const layer = tile.layers[encodedProtobufLayer];
  const parentMetadataPresent = layerHasParentAdm2Metadata(layer);
  const districtMatch = findDistrictFeatureInLayer(layer, expectedAdm2Id);
  const firstFeature = layer.length > 0 ? (layer.feature(0).properties ?? {}) : {};
  const wrongFirstFeature =
    parentMetadataPresent &&
    layer.length > 0 &&
    !districtMatch &&
    (firstFeature.parentAdm2Id ?? firstFeature.parentId) !== expectedAdm2Id;
  const districtClassification = !parentMetadataPresent
    ? "FEATURE_METADATA_ABSENT"
    : districtMatch
      ? "DISTRICT_VERIFIED"
      : "DISTRICT_NOT_IN_TILE";

  if (manifestDeclarationMismatch) {
    return {
      classification: "MANIFEST_LAYER_MISMATCH",
      encodedProtobufLayer,
      layerIds,
      renderArtifactLayerId,
      deliveryManifestSourceLayer,
      renderManifestSourceLayer,
      districtClassification,
      districtFeatureIndex: districtMatch?.index ?? null,
      sampleProperties: districtMatch?.properties ?? null,
      parentAdm2MetadataPresent: parentMetadataPresent,
      firstFeatureParentAdm2Id: firstFeature.parentAdm2Id ?? firstFeature.parentId ?? null,
      firstFeatureTerritoryId: firstFeature.territoryId ?? firstFeature.id ?? null,
      wrongDistrictIfUsedFirstFeature: wrongFirstFeature
    };
  }

  return {
    classification: "ACTUAL_LAYER_MATCH",
    encodedProtobufLayer,
    layerIds,
    renderArtifactLayerId,
    deliveryManifestSourceLayer,
    renderManifestSourceLayer,
    districtClassification,
    parentAdm2MetadataPresent: parentMetadataPresent,
    districtFeatureIndex: districtMatch?.index ?? null,
    sampleProperties: districtMatch
      ? {
          territoryId: districtMatch.properties.territoryId ?? districtMatch.properties.id,
          parentAdm2Id: districtMatch.properties.parentAdm2Id ?? districtMatch.properties.parentId,
          sourceClass: districtMatch.properties.sourceClass,
          boundaryKind: districtMatch.properties.boundaryKind,
          confidence: districtMatch.properties.confidence,
          administrative: districtMatch.properties.administrative
        }
      : null,
    firstFeatureParentAdm2Id: firstFeature.parentAdm2Id ?? firstFeature.parentId ?? null,
    firstFeatureTerritoryId: firstFeature.territoryId ?? firstFeature.id ?? null,
    wrongDistrictIfUsedFirstFeature: wrongFirstFeature
  };
}

function readFirstFeatureParent(tile, layerKey) {
  const layer = tile.layers[layerKey];
  if (!layer || layer.length === 0) return null;
  const props = layer.feature(0).properties ?? {};
  return props.parentAdm2Id ?? props.parentId ?? null;
}

export function aggregateMvtReadiness(samples) {
  if (!samples.length) {
    return {
      gate: "INSUFFICIENT_EVIDENCE",
      pass: false,
      sourceLayerGate: "INSUFFICIENT_EVIDENCE",
      districtRepresentativeGate: "INSUFFICIENT_EVIDENCE"
    };
  }
  const layerOk = samples.every(
    (row) =>
      row.classification === "ACTUAL_LAYER_MATCH" || row.classification === "INSUFFICIENT_EVIDENCE"
  );
  const sourceLayerPass =
    layerOk &&
    !samples.some(
      (row) =>
        row.classification === "MANIFEST_LAYER_MISMATCH" ||
        row.classification === "MISSING_LAYER" ||
        row.classification === "INVALID_MVT"
    );
  const districtVerifiedCount = samples.filter(
    (row) => row.districtClassification === "DISTRICT_VERIFIED"
  ).length;
  const districtMetadataAbsentCount = samples.filter(
    (row) => row.districtClassification === "FEATURE_METADATA_ABSENT"
  ).length;
  const districtRepresentativePass = samples.every((row) => {
    if (row.classification === "INSUFFICIENT_EVIDENCE") return true;
    return row.districtClassification === "DISTRICT_VERIFIED";
  });
  return {
    pass: sourceLayerPass,
    gate: sourceLayerPass ? "PASS" : "FAIL",
    sourceLayerGate: sourceLayerPass ? "PASS" : "FAIL",
    districtRepresentativeGate: districtRepresentativePass ? "PASS" : "FAIL",
    layerOk,
    districtVerifiedCount,
    districtMetadataAbsentCount,
    manifestMismatchCount: samples.filter((row) => row.classification === "MANIFEST_LAYER_MISMATCH")
      .length
  };
}

export function resolveCandidateRoot(env, defaultCandidate, rootResolver) {
  const raw = env.TERRITORY_TR_RC7_CANDIDATE;
  if (!raw) {
    return { candidateRoot: defaultCandidate, requestedExplicit: false };
  }
  return { candidateRoot: rootResolver(raw), requestedExplicit: true };
}
