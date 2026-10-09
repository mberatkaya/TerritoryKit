# Sprint 1 — Kaynak yönetişimi ve kapanış kanıtları

**Program:** Dört sprintlik uygulama yol haritasının 1. sprinti (kaynak ve yönetişim kapanışı).

| Dosya                                                            | Açıklama                                          |
| ---------------------------------------------------------------- | ------------------------------------------------- |
| [source-governance-status.md](source-governance-status.md)       | ADM0–ADM2 provenance ve Path B özet kararı        |
| [source-governance-status.json](source-governance-status.json)   | Makine okunur yönetişim durumu                    |
| [licensing-evidence-matrix.md](licensing-evidence-matrix.md)     | ADM0–ADM2 lisans kanıt matrisi                    |
| [licensing-evidence-matrix.json](licensing-evidence-matrix.json) | Makine okunur lisans matrisi                      |
| [adm3-readiness-report.json](adm3-readiness-report.json)         | 81 il kayıt durumu ve engeller                    |
| [path-a-vs-path-b-matrix.md](path-a-vs-path-b-matrix.md)         | HDX migrasyonu vs geoBoundaries metadata hizalama |
| [path-a-vs-path-b-matrix.json](path-a-vs-path-b-matrix.json)     | Makine okunur karar matrisi                       |
| [human-approvals-required.json](human-approvals-required.json)   | İnsan onayı gereken kalemler                      |
| [sprint-2-istanbul-handoff.md](sprint-2-istanbul-handoff.md)     | Sprint 2 uygulama devri                           |

JSON dosyalarını yeniden üretmek:

```sh
pnpm data:tr:sprint1:governance
```

**Uyarı:** Teknik inceleme hukuki onay değildir. `legalReviewStatus: PENDING_REVIEW` olan kalemler açıkça bekleyen incelemedir.
