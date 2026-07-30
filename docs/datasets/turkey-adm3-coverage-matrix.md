# Turkey ADM3 Coverage Matrix

Source of truth: `datasets/registry/tr-adm3-sources.json`.

`nationwide complete` is false. ADM3 fallback remains `ADM2` for every province until a source is
approved, locked, and built.

## Regional Counts

| Region            | Total | Approved | Candidate | Blocked |
| ----------------- | ----: | -------: | --------: | ------: |
| Akdeniz           |     8 |        0 |         0 |       8 |
| Doğu Anadolu      |    14 |        0 |         0 |      14 |
| Ege               |     8 |        0 |         0 |       8 |
| Güneydoğu Anadolu |     9 |        0 |         0 |       9 |
| İç Anadolu        |    13 |        0 |         0 |      13 |
| Karadeniz         |    18 |        0 |         1 |      17 |
| Marmara           |    11 |        0 |         2 |       9 |

## Province Matrix

| Code | Province       | Region            | Status               | Feature count | Main blocker                                                                 |
| ---- | -------------- | ----------------- | -------------------- | ------------: | ---------------------------------------------------------------------------- |
| 01   | Adana          | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 02   | Adıyaman       | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 03   | Afyonkarahisar | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 04   | Ağrı           | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 05   | Amasya         | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 06   | Ankara         | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 07   | Antalya        | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 08   | Artvin         | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 09   | Aydın          | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 10   | Balıkesir      | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 11   | Bilecik        | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 12   | Bingöl         | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 13   | Bitlis         | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 14   | Bolu           | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 15   | Burdur         | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 16   | Bursa          | Marmara           | candidate            |          1074 | raw checksum unstable across repeated downloads                              |
| 17   | Çanakkale      | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 18   | Çankırı        | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 19   | Çorum          | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 20   | Denizli        | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 21   | Diyarbakır     | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 22   | Edirne         | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 23   | Elazığ         | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 24   | Erzincan       | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 25   | Erzurum        | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 26   | Eskişehir      | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 27   | Gaziantep      | Güneydoğu Anadolu | inaccessible         |           786 | current download host did not resolve                                        |
| 28   | Giresun        | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 29   | Gümüşhane      | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 30   | Hakkari        | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 31   | Hatay          | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 32   | Isparta        | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 33   | Mersin         | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 34   | İstanbul       | Marmara           | geometry-unavailable |             0 | no verified province-wide source; district-only sources need separate review |
| 35   | İzmir          | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 36   | Kars           | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 37   | Kastamonu      | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 38   | Kayseri        | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 39   | Kırklareli     | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 40   | Kırşehir       | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 41   | Kocaeli        | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 42   | Konya          | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 43   | Kütahya        | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 44   | Malatya        | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 45   | Manisa         | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 46   | Kahramanmaraş  | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 47   | Mardin         | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 48   | Muğla          | Ege               | license-unclear      |       unknown | informational-only notice and no redistribution license                      |
| 49   | Muş            | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 50   | Nevşehir       | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 51   | Niğde          | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 52   | Ordu           | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 53   | Rize           | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 54   | Sakarya        | Marmara           | candidate            |           677 | EPSG:5254 reprojection required                                              |
| 55   | Samsun         | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 56   | Siirt          | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 57   | Sinop          | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 58   | Sivas          | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 59   | Tekirdağ       | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 60   | Tokat          | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 61   | Trabzon        | Karadeniz         | candidate            |           716 | missing district parent field                                                |
| 62   | Tunceli        | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 63   | Şanlıurfa      | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 64   | Uşak           | Ege               | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 65   | Van            | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 66   | Yozgat         | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 67   | Zonguldak      | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 68   | Aksaray        | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 69   | Bayburt        | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 70   | Karaman        | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 71   | Kırıkkale      | İç Anadolu        | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 72   | Batman         | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 73   | Şırnak         | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 74   | Bartın         | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 75   | Ardahan        | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 76   | Iğdır          | Doğu Anadolu      | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 77   | Yalova         | Marmara           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 78   | Karabük        | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 79   | Kilis          | Güneydoğu Anadolu | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 80   | Osmaniye       | Akdeniz           | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
| 81   | Düzce          | Karadeniz         | geometry-unavailable |             0 | no verified province-wide licensed ADM3 geometry                             |
