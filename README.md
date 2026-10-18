# 37 Audits CLI

`37audits` runs audits, reads results and wraps deploys in maintenance
windows from the terminal or a CI/CD pipeline, against the
[37 Audits](https://www.37audits.com) API.

```sh
npm install -g 37audits-cli      # or: npx 37audits-cli ...
37audits login
37audits audit run --url https://www.example.com --wait
```

Requires Node.js 22 or newer.

## Authentication

Two kinds of credential work everywhere:

- **Your account** (interactive): `37audits login` opens the browser, you
  approve the CLI on the 37 Audits consent page, and the session is stored
  locally. It refreshes itself; `37audits logout` removes it.
- **An API key** (CI): create one under *Organization → API keys* on
  37audits.com, then either set `THIRTYSEVENAUDITS_API_KEY` in the
  pipeline (no login needed), pass `--api-key` on any command, or store it
  once with `37audits login --api-key tsa_live_...`.

Precedence: `--api-key`, then `THIRTYSEVENAUDITS_API_KEY`, then the stored
credential. Credentials live in `~/.config/37audits/credentials.json`
(`$XDG_CONFIG_HOME/37audits` or `%APPDATA%\37audits`) with mode `0600`.

Maintenance windows need an organization **admin**: an admin-role API key,
or an account with the owner or admin role.

`37audits whoami` shows which credential is in use and whom it belongs to.

## Commands

Every command accepts `--url-id <uuid>` or `--url <address>` to name a
monitored URL; `--url` is resolved to the matching monitored URL of your
organizations. The `mw` commands take `--project <uuid>` instead, or derive
the project from `--url-id` / `--url`.

| Command | What it does |
| --- | --- |
| `login [--api-key <key>]` | Browser sign-in, or store an API key |
| `logout` | Remove the stored credential |
| `whoami` | Show the current credential and its owner |
| `audit run [--note <text>] [--auditor <id>]... [--wait] [--fail-on fail\|warning]` | Start a run; `--wait` polls until every auditor finished |
| `audit latest [--fail-on fail\|warning]` | Each auditor's newest result |
| `mw start [--reason <text>] [--run-auditors] [--ends-in 30m\|--ends-at <iso>] [--wait]` | Start a maintenance window now, optionally auditing first |
| `mw end [<id>]` | End the given or the active window (runs the "after" audit) |
| `mw list [--status scheduled\|active\|ended] [--limit n]` | List a project's windows |

`--help` on any command documents its options, JSON output and error
codes.

### `--wait`, `--timeout`, `--interval`

`audit run --wait` and `mw start --run-auditors --wait` poll the run until
no result is pending, at most `--timeout` (default `120s`, e.g. `3m`),
every `--interval` (default `5s`). Running out of time is a warning, not an
error: the run keeps going on the server and the results still land.

### `--fail-on`

`audit run --fail-on fail` (implies `--wait`) and `audit latest --fail-on
fail` exit with code **2** when any auditor reports `fail` or `error`;
`--fail-on warning` also counts warnings. Pending results never trip the
gate. With `--fail-on`, a `--wait` timeout is an error (exit 1).

## Output

When stdout is a terminal the CLI prints tables and sentences. With
`--json`, or whenever stdout is not a TTY (CI, pipes), it prints JSON on
stdout and errors as `{"error":{"message":"...","code":"..."}}` on stderr.
`-q`/`--quiet` also silences spinners and status lines.

Exit codes: `0` success, `1` error, `2` a `--fail-on` gate tripped, `130`
cancelled with Ctrl-C.

## CI/CD: wrap a deploy in a maintenance window

While a maintenance window is active, 37 Audits pauses scheduled audits of
the project, so a restart mid-deploy does not raise false alerts. Starting
it with `--run-auditors` records a "before" run, ending it records an
"after" run, and both carry the `--reason` on the timeline.

GitHub Actions:

```yaml
      - name: Start maintenance window
        id: maintenance
        continue-on-error: true        # never block a deploy on monitoring
        env:
          THIRTYSEVENAUDITS_API_KEY: ${{ secrets.THIRTYSEVENAUDITS_API_KEY }}
        run: |
          npx -y 37audits-cli@1.0.1 mw start \
            --project "${{ secrets.THIRTYSEVENAUDITS_PROJECT_ID }}" \
            --run-auditors --wait --ends-in 30m \
            --reason "Deploy of my-app at ${GITHUB_REF_NAME}@${GITHUB_SHA::7}"

      # ... deploy ...

      - name: End maintenance window
        if: always() && steps.maintenance.outputs.window_id != ''
        continue-on-error: true
        env:
          THIRTYSEVENAUDITS_API_KEY: ${{ secrets.THIRTYSEVENAUDITS_API_KEY }}
        run: npx -y 37audits-cli@1.0.1 mw end "${{ steps.maintenance.outputs.window_id }}" --project "${{ secrets.THIRTYSEVENAUDITS_PROJECT_ID }}"
```

`mw start` writes `window_id` (and `audit run` writes `group_id`) to
`$GITHUB_OUTPUT` when it is set, so a later step can read
`steps.<id>.outputs.window_id`. Always give the window an end
(`--ends-in`) sized to your deploy: if the pipeline dies, 37 Audits ends
the window itself and runs the "after" audit.

Where there is no post-deploy hook (for example a Vercel build), run only
`mw start --ends-in 10m` before the build and let the cap end it.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `THIRTYSEVENAUDITS_API_KEY` | API key used when no `--api-key` is given |
| `THIRTYSEVENAUDITS_API_BASE_URL` | API base URL (default `https://api.37audits.com`) |
| `THIRTYSEVENAUDITS_AUTH_URL` | OAuth server for `login` (default: 37 Audits production) |
| `THIRTYSEVENAUDITS_OAUTH_CLIENT_ID` | Override the CLI's OAuth client id (local development) |
| `XDG_CONFIG_HOME` | Where the credentials file lives |
| `CI` / `GITHUB_ACTIONS` | Treated as non-interactive: no prompts, JSON output |

## Development

```sh
npm ci
npm run dev -- whoami            # run from source (tsx)
npm test                         # unit tests (mocked API)
npm run lint && npm run typecheck
npm run build && node dist/cli.cjs --help
THIRTYSEVENAUDITS_API_KEY=tsa_test_... npm run test:e2e   # read-only, real API
```

To use a local 37 Audits stack, point the CLI at it:

```sh
export THIRTYSEVENAUDITS_API_BASE_URL=http://127.0.0.1:8080
export THIRTYSEVENAUDITS_AUTH_URL=http://127.0.0.1:54321/auth/v1
export THIRTYSEVENAUDITS_OAUTH_CLIENT_ID=<a public client registered on local Supabase>
```

Browser login is an OAuth 2.1 authorization-code flow with PKCE against
Supabase Auth, the 37 Audits authorization server. The CLI is a public
client whose redirect URIs are `http://127.0.0.1:37371/callback`, `:37372`
and `:37373` (the first free one is used; Supabase matches redirect URIs
exactly, hence fixed ports).

### Releasing

Bump `version` in `package.json`, commit, then push a matching tag:

```sh
git tag v1.0.1 && git push --tags
```

`release.yml` runs the checks and publishes to npm with provenance through
npm trusted publishing (no token in the repository).

## License

[MIT](./LICENSE)
