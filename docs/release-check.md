# Release Check

`pnpm release:check` is the network-free release readiness gate. It runs:

- formatting, linting, package boundaries, typecheck, tests, build, and bundle-size checks;
- geometry fixture validation and pilot country smoke tests;
- registry install/offline-cache smoke with a temporary local file registry;
- query/render compatibility smoke using generated MVT fixtures;
- fixture benchmark baseline comparison;
- package tarball audit through temporary `pnpm pack` output;
- documentation local-link validation.

The command does not publish packages, create tags, open pull requests, create GitHub Releases, or
download real-world datasets.

CI runs `pnpm release:check` on the Node.js 22 matrix job. Node.js 24 still runs `pnpm verify` plus
the MapLibre visual smoke, keeping cross-version coverage without duplicating every release gate.
