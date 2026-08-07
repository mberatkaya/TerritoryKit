# Turkey ADM3 Source Health

Runtime and experimental health is stored in reports/tr-adm3/source-health.json. Offline health reflects registry state. Run `territory tr adm3 providers health --network` for bounded HTTP health checks; network checks are intentionally isolated from default CI and should run as integration checks.
