# CI policy

GitHub Actions are temporarily disabled for this repository.

## Current rule

Until the project owner configures the intended self-hosted GitHub runner, this repository must not contain active GitHub Actions workflows.

Validation remains mandatory, but it is executed through the repository's reproducible local tooling:

```bash
npm install --ignore-scripts --no-audit --no-fund
npm test
npm run validate
```

Publication tooling must expose the same validation commands so the future self-hosted workflow can call them without duplicating validation logic.

## Restoring CI

When the self-hosted runner is available, GitHub Actions may be reintroduced deliberately. The workflow should invoke the existing repository scripts rather than move validation rules into YAML.

Until then, the absence of GitHub Actions is intentional and must not be treated as permission to bypass validation before publishing catalog changes.
