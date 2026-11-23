# Security policy

## Supported versions

InLectra is a pre-release research project. Security fixes target the latest commit on `main`. No production release is currently supported.

## Report a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository.

Include the affected component, required conditions, reproduction steps, potential impact, and any suggested mitigation. Do not include real student records, credentials, private keys, access tokens, or production data in the report. Use synthetic examples where evidence is necessary.

The maintainers will acknowledge the report, assess its scope, and coordinate a fix before public disclosure. Response times are not guaranteed while the project remains pre-release.

## Security boundaries

The browser does not authorize access. Cloud Functions and Realtime Database rules protect trusted operations and private data. Read the [architecture](docs/architecture.md) and [data governance notes](docs/data-governance.md) before reporting or changing these boundaries.
