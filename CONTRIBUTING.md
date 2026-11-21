# Contributing

AgentLoop has a platform at the repository root and a complementary local workflow edition in `local/`. Read the applicable `AGENTS.md` before changing either.

For platform changes, preserve upstream engine, repository and handler boundaries. Keep identity, provider and deployment adaptations explicit. Add a regression test for a behavioral fix and document schema or runner-protocol compatibility changes.

The platform binary embeds the chatbot frontend from `web/native-chat`, so build it (Node 22+) before the Go checks; this also runs the chatbot tests.

```bash
bash scripts/build-chatbot.sh
go test -p=2 ./... -count=1 -timeout=180s
go vet ./...
python3 scripts/check-public.py
bash scripts/scan-secrets.sh
```

Community contributions do not require private source manifests or hash updates. Maintainers keep source synchronization records locally, separate from the public CI checks. See [the maintenance policy](docs/upstream-sync.md).

Run the [public browser acceptance suite](e2e/public/README.md) for authentication, preferences or execution changes. Paid model and external knowledge tests require explicit operator configuration; state passed, failed, skipped and not-run checks accurately.

Platform pull requests run the `core`, `browser`, and `first-run` jobs. The stable check `platform-required` fails unless all three succeed. A repository administrator has to mark `platform-required` as a required status check in GitHub branch protection. This repository does not change that GitHub setting.

Keep workflow templates generic. Preserve existing permission behavior and user-file protection. Commit messages should follow Conventional Commits.

Public pull requests must not contain credentials, private infrastructure, employee access defaults or production datasets. Preserve existing user files. Keep source attribution and third-party licenses. Describe the problem, resulting behavior and the validation actually performed in the PR.
