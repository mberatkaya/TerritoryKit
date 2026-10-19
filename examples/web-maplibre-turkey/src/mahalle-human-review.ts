const QUEUE_URL = new URL(
  "../../../reports/tr-adm3/sprint-2e-source-evidence/human-review-queue.json",
  import.meta.url
).href;

const LEDGER_URL = new URL(
  "../../../reports/tr-adm3/sprint-2f-human-review/human-review-decision-ledger.json",
  import.meta.url
).href;

const STORAGE_KEY = "territorykit-mahalle-human-review-export-v1";

type QueueRecord = {
  reviewRecordId: string;
  stableZoneId: string | null;
  district: string;
  parentAdm2Id: string | null;
  settlementIds: string[];
  seedNames?: string[];
  coordinates?: number[][];
  ambiguityReasonCodes: string[];
  reviewPriority: number;
  proposedAction?: string;
  evidenceLinks?: string[];
};

type QueueDoc = {
  summary: Record<string, number>;
  records: QueueRecord[];
};

type StagedDecision = {
  reviewRecordId: string;
  state: string;
  reviewerId: string;
  rationale: string;
  approvedSemanticLabel?: string;
  reviewedAt: string;
  queuePins: {
    stableZoneId: string | null;
    parentAdm2Id: string | null;
    settlementIds: string[];
    ambiguityReasonCodes: string[];
  };
};

const statusEl = document.querySelector<HTMLElement>("#status");
const districtFilter = document.querySelector<HTMLSelectElement>("#district-filter");
const categoryFilter = document.querySelector<HTMLSelectElement>("#category-filter");
const recordList = document.querySelector<HTMLElement>("#record-list");
const recordDetail = document.querySelector<HTMLElement>("#record-detail");
const progressEl = document.querySelector<HTMLElement>("#progress");
const form = document.querySelector<HTMLFormElement>("#decision-form");

let queue: QueueDoc | null = null;
let activeRecordId: string | null = null;
let staged = loadStaged();

function loadStaged(): StagedDecision[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StagedDecision[]) : [];
  } catch {
    return [];
  }
}

function saveStaged() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(staged));
}

function filteredRecords(): QueueRecord[] {
  if (!queue) {
    return [];
  }
  const district = districtFilter?.value ?? "all";
  const category = categoryFilter?.value ?? "all";
  return queue.records
    .filter((record) => district === "all" || record.district === district)
    .filter(
      (record) => category === "all" || record.ambiguityReasonCodes.includes(category as never)
    )
    .sort((left, right) => left.reviewPriority - right.reviewPriority);
}

function renderProgress() {
  if (!queue || !progressEl) {
    return;
  }
  const stagedIds = new Set(staged.map((row) => row.reviewRecordId));
  progressEl.innerHTML = `
    <div><strong>Baseline records:</strong> ${queue.records.length}</div>
    <div><strong>Staged local decisions:</strong> ${staged.length}</div>
    <div><strong>Still pending (not staged locally):</strong> ${
      queue.records.length - stagedIds.size
    }</div>
  `;
}

function renderList() {
  if (!recordList) {
    return;
  }
  const rows = filteredRecords();
  recordList.innerHTML = rows
    .map((record) => {
      const stagedMark = staged.some((row) => row.reviewRecordId === record.reviewRecordId)
        ? "• staged"
        : "";
      return `<div class="review-record ${
        record.reviewRecordId === activeRecordId ? "active" : ""
      }" data-id="${record.reviewRecordId}">
        <div><strong>${record.district}</strong> ${stagedMark}</div>
        <div style="font-size:0.8rem">${record.ambiguityReasonCodes.join(", ")}</div>
      </div>`;
    })
    .join("");

  recordList.querySelectorAll(".review-record").forEach((element) => {
    element.addEventListener("click", () => {
      const id = element.getAttribute("data-id");
      if (!id) {
        return;
      }
      activeRecordId = id;
      renderList();
      renderDetail();
    });
  });
}

function renderDetail() {
  if (!recordDetail || !queue || !activeRecordId) {
    return;
  }
  const record = queue.records.find((row) => row.reviewRecordId === activeRecordId);
  if (!record) {
    recordDetail.innerHTML = "<p>Select a record.</p>";
    return;
  }

  const badges = record.ambiguityReasonCodes
    .map((code) => `<span class="badge">${code}</span>`)
    .join("");
  const seeds = (record.seedNames ?? []).map((name) => `<li>${name}</li>`).join("");
  const coords = (record.coordinates ?? [])
    .map((pair) => `<li>${pair[1]}, ${pair[0]}</li>`)
    .join("");
  const links = (record.evidenceLinks ?? [])
    .map((link) => `<li><code>${link}</code></li>`)
    .join("");

  recordDetail.innerHTML = `
    <h2>${record.district} — ${record.proposedAction ?? "review"}</h2>
    <p><strong>Review record ID:</strong> <code>${record.reviewRecordId}</code></p>
    <p><strong>Zone ID:</strong> <code>${record.stableZoneId ?? "—"}</code></p>
    <p><strong>Parent ADM2:</strong> <code>${record.parentAdm2Id ?? "—"}</code></p>
    <div>${badges}</div>
    <h4>Candidate settlement names</h4>
    <ul>${seeds || "<li>—</li>"}</ul>
    <h4>Seed coordinates</h4>
    <ul>${coords || "<li>—</li>"}</ul>
    <h4>Evidence links</h4>
    <ul>${links || "<li>—</li>"}</ul>
  `;
}

async function bootstrap() {
  const response = await fetch(QUEUE_URL);
  if (!response.ok) {
    throw new Error(`Review queue missing (${response.status}). Run Sprint 2E/2F generators.`);
  }
  const loadedQueue = (await response.json()) as QueueDoc;
  queue = loadedQueue;

  const districts = [...new Set(loadedQueue.records.map((row) => row.district))].sort();
  if (districtFilter) {
    districtFilter.innerHTML =
      `<option value="all">All districts</option>` +
      districts.map((name) => `<option value="${name}">${name}</option>`).join("");
    districtFilter.addEventListener("change", () => {
      renderList();
      renderProgress();
    });
  }
  categoryFilter?.addEventListener("change", () => {
    renderList();
    renderProgress();
  });

  activeRecordId = filteredRecords()[0]?.reviewRecordId ?? null;
  renderProgress();
  renderList();
  renderDetail();

  if (statusEl) {
    statusEl.textContent = `Loaded ${loadedQueue.records.length} review records (local export workflow).`;
  }

  try {
    const ledgerResponse = await fetch(LEDGER_URL);
    if (ledgerResponse.ok && statusEl) {
      statusEl.textContent += " Ledger template available.";
    }
  } catch {
    // optional
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!queue || !activeRecordId) {
    return;
  }
  const record = queue.records.find((row) => row.reviewRecordId === activeRecordId);
  if (!record) {
    return;
  }

  const reviewerId = (document.querySelector<HTMLInputElement>("#reviewer-id")?.value ?? "").trim();
  const rationale = (document.querySelector<HTMLTextAreaElement>("#rationale")?.value ?? "").trim();
  const state = document.querySelector<HTMLSelectElement>("#decision-state")?.value ?? "rejected";
  const approvedLabel =
    document.querySelector<HTMLInputElement>("#approved-label")?.value?.trim() ?? "";

  if (!reviewerId || !rationale) {
    alert("Reviewer ID and rationale are required.");
    return;
  }
  if (state === "approved-semantic-label" && !approvedLabel) {
    alert("Approved semantic label is required for approved-semantic-label decisions.");
    return;
  }

  const decision: StagedDecision = {
    reviewRecordId: record.reviewRecordId,
    state,
    reviewerId,
    rationale,
    reviewedAt: new Date().toISOString(),
    queuePins: {
      stableZoneId: record.stableZoneId,
      parentAdm2Id: record.parentAdm2Id,
      settlementIds: [...record.settlementIds],
      ambiguityReasonCodes: [...record.ambiguityReasonCodes]
    },
    ...(approvedLabel ? { approvedSemanticLabel: approvedLabel } : {})
  };

  staged = staged.filter((row) => row.reviewRecordId !== record.reviewRecordId);
  staged.push(decision);
  saveStaged();
  renderProgress();
  renderList();
  alert("Decision staged locally. Use export to download JSON for offline validation/import.");
});

document.querySelector("#export-decisions")?.addEventListener("click", () => {
  const payload = {
    schemaVersion: "territorykit-tr-mahalle-human-review-local-export@1",
    exportedAt: new Date().toISOString(),
    note: "Local-only export buffer. Not production approval. Validate with dataset mahalle-human-review validators before merge.",
    decisions: staged
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mahalle-human-review-export-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

bootstrap().catch((error) => {
  if (statusEl) {
    statusEl.textContent = error instanceof Error ? error.message : String(error);
  }
});
