# Operations

Repository and CI settings, written down because they are invisible from the
code and easy to lose. Everything here is checkable with `gh`, so nothing below
has to be taken on trust.

## Branch protection on `main`

Configured 2026-07-31, after a red CI run on `main` sat unnoticed for two phases.
The Phase 0 plan called for this and it was never actually applied — a plan is
not a setting.

| Setting | Value | Why |
|---|---|---|
| Required status checks | all 9 | Nothing merges on a red build |
| Strict (branch up to date) | off | Solo repo; forcing a rebase per merge is friction without benefit |
| `enforce_admins` | **on** | The repo owner is also the person most likely to merge in a hurry |
| Required reviews | none | One maintainer, who cannot approve their own PR |
| Force pushes / deletions | off | History on `main` is not rewritable |
| Linear history | on | Squash merges only, so `main` reads as one commit per change |

The nine required checks:

```
Typecheck & lint · expo-doctor · Component tests · Engine coverage gate
Migrations, policies & integration
Engine (TZ UTC) · (TZ America/New_York) · (TZ Pacific/Kiritimati) · (TZ Pacific/Niue)
```

`Supabase Preview` is deliberately **not** required — it is a third-party
integration that skips on most runs, and a required check that never reports
blocks every merge.

Verify, or re-apply after a settings change:

```bash
gh api repos/Delimiters/chorus/branches/main/protection | jq '{
  admins: .enforce_admins.enabled,
  checks: (.required_status_checks.contexts | length),
  force_push: .allow_force_pushes.enabled
}'
```

## Outside contributors

The repository is public so that the work can be read. Two things keep that from
being a liability, and neither needed a branch-protection rule:

- **Merging requires write access.** A stranger forks, opens a pull request, and
  cannot merge it — GitHub has no setting to turn off, because there is nothing
  to turn off. Only collaborators merge.
- **Their CI does not run until approved.** The fork-PR policy is
  `all_external_contributors`, tightened from GitHub's default of
  `first_time_contributors`. A drive-by PR cannot make the runners execute its
  code until a maintainer says so.

```bash
gh api repos/Delimiters/chorus/actions/permissions/fork-pr-contributor-approval
gh api repos/Delimiters/chorus/actions/permissions/workflow
```

The second returns `default_workflow_permissions: read` and
`can_approve_pull_request_reviews: false`. CI uses **no secrets** — the database
jobs run against a throwaway local Supabase — so there is nothing in the
workflow environment worth exfiltrating even if the approval gate were bypassed.
Keep it that way: if a job ever needs a secret, it must not run on
`pull_request` from a fork.

## Watching CI

`ci.yml` triggers on `push` to `main`, on `pull_request`, and on
`workflow_dispatch`. Both of the first two matter, and the first is the one that
gets forgotten:

```bash
gh run list --branch main --limit 5      # after every merge
gh pr checks <n>                          # before every merge
gh run view <id> --log-failed             # any non-success
```

See AGENTS.md, "A red CI job is a finding, never noise", for what went wrong when
this was not done and why re-running a failed job is the wrong instinct.
