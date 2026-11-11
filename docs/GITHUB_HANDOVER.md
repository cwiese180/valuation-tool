# GitHub development branch

The development source, automated tests, CI workflow, deployment runbook and IT checklist are maintained in the repository on `development/integration-foundation`. The original local implementation was commit `513133b`; GitHub API publication creates its own commit with the same source tree plus this updated publication record.

The downloadable handover package is an optional recovery snapshot. It is not required to access or continue development. Use the GitHub branch and its pull request as the current source of truth.

In an authorized development environment:

```bash
git clone --branch development/integration-foundation https://github.com/cwiese180/valuation-tool.git
cd valuation-tool
npm ci
npm run demo
```

For validation:

```bash
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:e2e
```

The branch is a development release. Review `VALIDATION.md` for outstanding sandbox, data accuracy and security gates. No production access, paid AI processing or production deployment is authorized by branch publication.
