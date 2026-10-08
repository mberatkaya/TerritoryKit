import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  inspectTurkeyGeoBoundariesParentLineage,
  verifyTurkeyGeoBoundariesParentLineage
} from "../packages/generators/dist/turkey-adm3.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, "reports/tr-adm3/provenance/geoboundaries");
const DEFAULT_PARENT_DATASET = path.join(REPO_ROOT, "datasets/generated/countries/TR/dataset.json");
const DEFAULT_SOURCE_LOCK = path.join(
  REPO_ROOT,
  "datasets/generated/countries/TR/sources.lock.json"
);
const GEOBOUNDARIES_CACHE_ROOT = path.join(REPO_ROOT, ".territory/cache/sources/geoboundaries");

async function writeTextFile(filePath, contents) {
  const text = contents.endsWith("\n") ? contents : `${contents}\n`;
  await writeFile(filePath, text, "utf8");
}

export function isGeoBoundariesParentAuditCliEntry(argv = process.argv) {
  const entry = argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

function parseAuditCliArgs(argv) {
  const options = {
    outputDir: DEFAULT_OUTPUT_DIR,
    parentDatasetPath: DEFAULT_PARENT_DATASET,
    sourceLockPath: DEFAULT_SOURCE_LOCK,
    geoBoundariesCacheRoot: GEOBOUNDARIES_CACHE_ROOT,
    diagnosticMode: false,
    strict: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--output-dir") {
      options.outputDir = path.resolve(argv[++index] ?? DEFAULT_OUTPUT_DIR);
    } else if (token === "--parent-dataset") {
      options.parentDatasetPath = path.resolve(argv[++index] ?? DEFAULT_PARENT_DATASET);
    } else if (token === "--source-lock") {
      options.sourceLockPath = path.resolve(argv[++index] ?? DEFAULT_SOURCE_LOCK);
    } else if (token === "--geoboundaries-cache") {
      options.geoBoundariesCacheRoot = path.resolve(argv[++index] ?? GEOBOUNDARIES_CACHE_ROOT);
    } else if (token === "--diagnostic") {
      options.diagnosticMode = true;
      options.strict = false;
    } else if (token === "--allow-incomplete-evidence") {
      options.strict = false;
    }
  }
  return options;
}

export async function generateGeoBoundariesParentReports({
  outputDir = DEFAULT_OUTPUT_DIR,
  parentDatasetPath = DEFAULT_PARENT_DATASET,
  sourceLockPath = DEFAULT_SOURCE_LOCK,
  geoBoundariesCacheRoot = GEOBOUNDARIES_CACHE_ROOT,
  diagnosticMode = false,
  strict = true
} = {}) {
  const inspectedCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8"
  }).trim();
  const generatedAt = new Date().toISOString();

  const inspection = await inspectTurkeyGeoBoundariesParentLineage({
    parentDatasetPath,
    sourceLockPath,
    geoBoundariesCacheRoot
  });
  const verification = verifyTurkeyGeoBoundariesParentLineage(inspection, {
    diagnosticMode,
    strict
  });

  await mkdir(outputDir, { recursive: true });

  const sourceCandidates = {
    schemaVersion: "territorykit-tr-geoboundaries-source-candidates@1",
    inspectedCommit,
    generatedAt,
    sourceLockPath: path.relative(REPO_ROOT, sourceLockPath),
    candidates: inspection.candidates
  };
  const sourceByteVerification = {
    schemaVersion: "territorykit-tr-geoboundaries-byte-verification@1",
    inspectedCommit,
    generatedAt,
    geoBoundariesUpstreamBytesVerified: inspection.geoBoundariesUpstreamBytesVerified,
    entries: inspection.byteVerification.map((entry) => ({
      ...entry,
      ...(entry.artifactPath ? { artifactPath: path.relative(REPO_ROOT, entry.artifactPath) } : {})
    }))
  };
  const canonicalParentInventory = {
    schemaVersion: "territorykit-tr-geoboundaries-canonical-parent@1",
    inspectedCommit,
    generatedAt,
    parentDatasetPath: path.relative(REPO_ROOT, parentDatasetPath),
    gitTracked: false,
    gitignoreNote:
      "datasets/generated/ is gitignored; canonical parent is a local generation artifact.",
    parentDatasetVersion: inspection.parentDatasetVersion,
    parentDatasetSha256: inspection.parentDatasetSha256,
    parentInventoryStatus: inspection.parentInventoryStatus,
    expectedInventory: { ADM0: 1, ADM1: 81, ADM2: 973 }
  };
  const identityComparison = {
    schemaVersion: "territorykit-tr-geoboundaries-identity-comparison@1",
    inspectedCommit,
    generatedAt,
    rows: inspection.identityComparison
  };
  const geometryEquivalence = {
    schemaVersion: "territorykit-tr-geoboundaries-geometry-equivalence@1",
    inspectedCommit,
    generatedAt,
    geographicEquivalenceStatus: "NOT_ASSESSED",
    rows: inspection.geometryComparison
  };

  await writeTextFile(
    path.join(outputDir, "source-candidates.json"),
    JSON.stringify(sourceCandidates, null, 2)
  );
  await writeTextFile(
    path.join(outputDir, "source-byte-verification.json"),
    JSON.stringify(sourceByteVerification, null, 2)
  );
  await writeTextFile(
    path.join(outputDir, "canonical-parent-inventory.json"),
    JSON.stringify(canonicalParentInventory, null, 2)
  );
  await writeTextFile(
    path.join(outputDir, "identity-comparison.json"),
    JSON.stringify(identityComparison, null, 2)
  );
  await writeTextFile(
    path.join(outputDir, "geometry-equivalence.json"),
    JSON.stringify(geometryEquivalence, null, 2)
  );

  const pathBFeasibility = `# Path B (geoBoundaries metadata realignment) feasibility

**İnceleme commit:** \`${inspectedCommit}\`  
**Üretim zamanı (UTC):** ${generatedAt}  
**Sınıflandırma:** \`${inspection.pathBFeasibility}\`

## Özet

${inspection.pathBFeasibilitySummary}

## Kanıt durumu

| Alan | Durum |
| --- | --- |
| geoBoundaries bayt doğrulaması | ${inspection.geoBoundariesUpstreamBytesVerified ? "EVET" : "HAYIR"} |
| Ebeveyn envanter | ${inspection.parentInventoryStatus} |
| Lisans inceleme | ${inspection.licenseReviewStatus} |
| Resmî devlet verisi iddiası | Hayır — geoBoundaries açık veri sınırları geçerli |

## Eksik kanıt

${inspection.missingEvidence.length > 0 ? inspection.missingEvidence.map((item) => `- ${item}`).join("\n") : "- (yok)"}

## ADR-006 notu

Bu rapor ADR-006 (HDX/OCHA COD-AB varsayılanı) kararını **değiştirmez**. Path B yalnızca ayrı yetkilendirilmiş bir migrasyon PR'si için ön koşul kanıtı sağlar.

## Yeniden üretim

\`\`\`sh
pnpm data:tr:geoboundaries:parent:audit
\`\`\`

Yerel önbellek gerekir: \`.territory/cache/sources/geoboundaries\` ve gitignore altındaki \`datasets/generated/countries/TR/\`.
`;

  const migrationImpact = `# Path B migrasyon etki planı (yalnızca plan)

**İnceleme commit:** \`${inspectedCommit}\`  
**Durum:** Migrasyon uygulanmadı — etki analizi taslağı

## ADM0–ADM2 kimlikler

- Mevcut canonical ebeveyn \`tr:adm1:tr-XX\` / ilçe kimlikleri **korunur** (Path B geometri baytlarını değiştirmez).
- \`properties.territory.source.sourceId\` alanları geoBoundaries \`shapeID\` ile hizalıdır.
- \`datasets/sources/TR/national.json\` ve rc.7 \`source-lock\` HDX üye SHA-256 değerleri Path B'de **catalog realignment** gerektirir.

## ADM3 clipping

- ADM3 üretimi ebeveyn ADM2 poligonlarına bağlıdır; metadata-only Path B, clipping girdisini değiştirmez.
- Yine de \`source-lock\` ve attribution metinleri tüketici raporlarını etkiler — rc.7 replay zorunlu.

## Zone ID referansları

- Render/MVT ve \`identity-map.json\` stable ID'leri değişmez (geometri migrasyonu yok).

## Source-lock / manifest

- \`national.json\` → geoBoundaries gbOpen pin (\`sources.lock.json\` ile uyumlu).
- \`datasets/registry/countries.json\` provider alanı gözden geçirilmeli.
- ADR-006 supersede **onay gerektirir**.

## Geri alma

- HDX catalog lock'a dönüş Path A veya metadata geri alma commit'i ile mümkün; geometri değişmezse ID geri alma gerekmez.
`;

  await writeTextFile(path.join(outputDir, "path-b-feasibility.md"), pathBFeasibility);
  await writeTextFile(path.join(outputDir, "migration-impact-plan.md"), migrationImpact);
  await writeTextFile(
    path.join(outputDir, "README.md"),
    `# geoBoundaries ebeveyn soy kanıtı (Path B)

Türkiye ADM0–ADM2 canonical ebeveyn poligonlarının geoBoundaries gbOpen kaynağıyla hizalanabilirliği.

| Dosya | Amaç |
| --- | --- |
| [source-candidates.json](./source-candidates.json) | Pinlenmiş gbOpen release adayları |
| [source-byte-verification.json](./source-byte-verification.json) | SHA-256 bayt doğrulaması |
| [canonical-parent-inventory.json](./canonical-parent-inventory.json) | Yerel canonical artifact envanteri |
| [identity-comparison.json](./identity-comparison.json) | shapeID ↔ zone eşleşmeleri |
| [geometry-equivalence.json](./geometry-equivalence.json) | Onarım sonrası serileştirilmiş geometri hash |
| [path-b-feasibility.md](./path-b-feasibility.md) | Path B sınıflandırması |
| [migration-impact-plan.md](./migration-impact-plan.md) | Migrasyon etki planı (uygulanmadı) |

HDX karşılaştırma kanıtı: [../](../) (PR #104).
`
  );

  const auditComplete =
    verification.verified ||
    (diagnosticMode && inspection.pathBFeasibility !== "PATH_B_NOT_SUPPORTED");

  return {
    inspection,
    verification,
    outputDir,
    auditComplete,
    inspectedCommit,
    generatedAt
  };
}

async function runCli() {
  const cliOptions = parseAuditCliArgs(process.argv.slice(2));
  const result = await generateGeoBoundariesParentReports(cliOptions);
  const exitOk = cliOptions.diagnosticMode
    ? result.inspection.pathBFeasibility !== "PATH_B_NOT_SUPPORTED"
    : result.verification.verified;
  console.log(
    JSON.stringify(
      {
        ok: exitOk,
        verified: result.verification.verified,
        pathBFeasibility: result.inspection.pathBFeasibility,
        geoBoundariesUpstreamBytesVerified: result.inspection.geoBoundariesUpstreamBytesVerified,
        parentInventoryStatus: result.inspection.parentInventoryStatus,
        outputDir: path.relative(REPO_ROOT, result.outputDir)
      },
      null,
      2
    )
  );
  process.exitCode = exitOk ? 0 : 1;
}

if (isGeoBoundariesParentAuditCliEntry()) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
