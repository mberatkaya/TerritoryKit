# Security Policy

## Supported Versions

Security fixes target the current stable major line.

| Version line | Support status                                           |
| ------------ | -------------------------------------------------------- |
| `2.x`        | Supported for security fixes while it is the stable line |
| `1.x`        | Maintenance fixes only when explicitly announced         |
| `<1.0`       | Unsupported                                              |

## Reporting

Report suspected vulnerabilities through a private security advisory or the security contact
listed in the project repository. Do not open public issues for exploitable reports.

## Scope

In scope:

- Package supply-chain issues.
- Unsafe parsing or validation behavior in dataset and CLI tools.
- Server-side risks in NestJS/PostGIS integrations.

Out of scope:

- Incorrect or unlicensed third-party geographic source data supplied by users.
- Map tile provider availability or account configuration.
