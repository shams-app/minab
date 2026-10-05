# The CI runner

Most workflows run on our own machine, a self-hosted GitHub Actions runner with the label `minab`.
The machine is also Shamsine's preview server. Its setup script and notes are in the monorepo:
`deploy/server/minab-runner.sh` and `deploy/server/README.md` ("The minab runner").

## Which runner runs what

| Event | Runner |
| --- | --- |
| Push to `main`, tags, manual runs | ours (`minab`) |
| Pull request from a branch of this repository | ours (`minab`) |
| Pull request from a fork | GitHub's (`ubuntu-latest`) |
| `next.yml`, `release.yml` (publishing) | GitHub's (`ubuntu-latest`), always |

The repository is public. Code from a fork must not run on our machine, so every job that a pull
request can start chooses its runner like this:

```yaml
runs-on: ${{ github.event.pull_request.head.repo.fork && 'ubuntu-latest' || 'minab' }}
```

Use the same line in every new workflow. A job that never runs for pull requests can use
`runs-on: minab`.

This line alone is not enough: a fork pull request can change the workflow files. So the repository
setting **Require approval for all external contributors** is on. Before you approve a fork's run,
check that it does not change `.github/`.

`next.yml` and `release.yml` stay on GitHub's runners because npm trusted publishing and npm
provenance work only there.

## What is different on our runner

- **No sudo.** `playwright install --with-deps` needs sudo, so the jobs pass `--with-deps` only on
  GitHub's runners. The machine has the system libraries already.
- **No Chrome.** Lighthouse uses Playwright's Chromium through `CHROME_PATH` (`site-checks.yml`).
- **One job at a time.** There is one runner, so jobs wait for each other. The jobs use fixed ports
  (Postgres 5432, Vite preview 4173, NestJS 3000). Before you add a second runner, give the jobs
  free ports, or two jobs will meet on the same port.
- **Service containers** (Postgres) run in a rootless Docker that belongs to the runner user.
- **Slower and noisier than GitHub's machines** while previews are busy. The performance budgets
  (`perf.yml`, Q4) and the Lighthouse scores were measured on `ubuntu-latest`. If they fail only on
  our runner, move that one job back to `ubuntu-latest` rather than loosening the budget.
