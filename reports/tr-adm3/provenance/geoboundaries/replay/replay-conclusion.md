# Tam ülke builder replay sonucu

- **Sınıflandırma:** `GEOGRAPHICALLY_EQUIVALENT_WITH_DIFFERENCES`
- **Path B teknik öneri:** `PARTIAL` (lisans onayı değildir)
- **Migrasyon yetkisi:** `NOT_AUTHORIZED`
- **Serileştirilmiş geometri uyuşmazlığı:** 44 bölge (kimlik eşleşen çiftler)
- **Determinizm (dataset.json SHA-256):** iki koşu bayt-identical

Canonical `datasets/generated/countries/TR/dataset.json` üzerine yazılmadı. Replay `dataset.json` SHA-256 canonical ile aynı olması beklenmez.

Kök neden: onaylanmış `dependency-version` iddiası yok; çoğu uyuşmazlık `unresolved` + olası açıklama (tarihsel repair/runtime kanıtı eksik). geoBoundaries ADM2 source-lock `sourceFeatureCount: 999` vs simplified GeoJSON 973 farkı korunur.
