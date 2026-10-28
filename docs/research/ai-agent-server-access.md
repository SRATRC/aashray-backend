# Safe server access for an AI agent

## Summary and recommendation

No vendor product gives a hard, tool-level read-only guarantee for an interactive shell. Teleport, HashiCorp Boundary, StrongDM, and AWS SSM Session Manager all control **who** can open a session to **which** host, and they all record the session — but once a session opens, the caller gets a normal shell under an OS login. None of them inspect or block commands typed inside that shell.

The only pattern that gives a real guarantee is a **narrow wrapper**: a fixed, allowlisted set of read-only operations, each with fixed logic, invoked without a shell. This matches the pattern this repo already uses for the database (`query_db` in `mcp-server/tools/database.js` — a SELECT-only DB user enforces the guarantee, not string parsing) and for logs (`mcp-server/tools/logs.js` — each tool reads a fixed file path, with no arbitrary path input).

**Recommendation:** extend the existing `mcp-server/` with one new tool file, `mcp-server/tools/system.js`, that exposes a fixed list of read-only server-health commands through `child_process.execFile` (never `exec`, never a shell string). Section 4 gives the exact design. Do not adopt Teleport, Boundary, StrongDM, or SSM for this — they solve a different problem (broker access across many hosts for many humans) and add infrastructure this single-host, single-caller setup does not need.

## Comparison table

| Mechanism | Blast radius if compromised | Auditability | How read-only is enforced | Integration effort here |
|---|---|---|---|---|
| Teleport (SSH access) | Full shell as the granted OS login; Teleport does not block commands | Full session recording (4 modes, sync/async), moderated sessions | Not enforced by Teleport — needs OS-level restriction underneath | New service, new agent on the host, licensing — high |
| HashiCorp Boundary | Full shell once connected; worker filters route traffic only, not commands | Session recording (BSR) to external storage | Not enforced — needs OS-level restriction underneath | New service (controller + worker) — high |
| StrongDM | Full shell once connected for SSH; command-level control exists only for Postgres/MSSQL queries | Full session replay + per-command log | Not enforced for SSH — needs OS-level restriction underneath | Paid vendor service — high |
| AWS SSM Session Manager (interactive shell) | Full shell as `ssm-user`, which has passwordless root via sudoers by default | Opt-in S3/CloudWatch capture of commands+output; not seen for port-forwarded/SSH sessions; CloudTrail misses in-session actions | Not enforced — AWS states it does not check commands before running them | Requires AWS-managed infra (SSM Agent, IAM); this repo's prod host is not AWS-managed — high |
| AWS SSM Run Command, document allowlisted | Bounded to the fixed command(s) in the allowlisted document — no shell prompt reached | Each call is a discrete, parameter-logged API call | Enforced — caller never gets a shell, only a parameterized script | Same AWS-infra requirement as above — not applicable here |
| `rbash` / restricted shell | Bypassable if the allowed program has a shell escape, `/`-based path, or can `exec` | Whatever the wrapping shell logs, no built-in recording | Convention only — GNU manual states this directly | Local, no new service, but weak guarantee alone |
| `sshd_config ForceCommand` / `authorized_keys command=` | Bounded to the forced program, but the forced program still receives the client's original command as a string (`SSH_ORIGINAL_COMMAND`) and must sanitize it itself; forwarding must be separately disabled | Whatever the forced program logs | Hard guarantee on **which binary runs** (sshd enforces this); no guarantee on what that binary then does with its input | Local, no new service — medium effort, and still needs a hand-written safe wrapper program |
| `sudoers` `Cmnd_Alias` / `NOPASSWD` | Bypassable via a negated rule, a copied binary, or a shell escape in the allowed command — manual states this explicitly | Whatever `sudo` logs | Convention only | Local, low effort, weak guarantee alone |
| MCP tool with `readOnlyHint` annotation | N/A — the annotation carries no enforcement | Whatever the MCP server logs | Not enforced — MCP spec states clients MUST treat this hint as untrusted | N/A — a label, not a control |
| Claude Code Bash allow/deny rules (`Bash(cmd:*)`) | Bounded to the string-matched prefix, but Anthropic's own docs call this "fragile" against flags, redirects, and shell operators | Whatever Claude Code logs | Partial — enforced by the harness, but string-prefix matching is not proof against injection | Applies to the *client* running commands, not to a server-side tool; not the right layer for this problem |
| **Custom MCP wrapper tool** (recommended) | Bounded to exactly the fixed operations coded into the tool — no shell, no argument passthrough | Whatever the tool logs via `req.log` / existing MCP logger | Enforced — the tool's own code is the only thing that can run, and it never accepts a command string | Extends a server already running on this host, using the same auth and tool-registration pattern as `database.js` and `logs.js` — low |

## Detailed findings

### Teleport
- Roles combine `allow`/`deny` rules; `deny` always wins and is evaluated first. `node_labels` picks which hosts a role can reach; `logins` picks the allowed OS usernames. ([Teleport Role Reference](https://goteleport.com/docs/reference/access-controls/roles/))
- `role_options` control session-wide behavior (TTL, forwarding, MFA) — none gate individual commands. ([Teleport Role Reference](https://goteleport.com/docs/reference/access-controls/roles/))
- No documented per-command allow/deny for SSH. PAM hooks run scripts at session start/stop, not per command. Moderated Sessions add a human observer, not a command filter. ([Configure SSH with PAM](https://goteleport.com/docs/enroll-resources/server-access/guides/ssh-pam/), [Moderated Sessions](https://goteleport.com/docs/admin-guides/access-controls/guides/moderated-sessions/))
- Teleport's own blog argues against restricted-shell command filtering as a security boundary, and recommends OS-level hardening instead: "the access controls are at the application level... any program you run launches with the permissions of the program without the application level restrictions." ([Restricted Shell for SSH](https://goteleport.com/blog/ssh-restricted-shells/))
- Session recording has 4 modes (`node`, `node-sync`, `proxy`, `proxy-sync`), stored separately from the audit log, played back via `tsh play`. ([Teleport Session Recording](https://goteleport.com/docs/reference/architecture/session-recording/))
- Database Access has real read/list verbs; SSH access has no equivalent. ([Database Access RBAC](https://goteleport.com/docs/machine-workload-identity/access-guides/databases/))

### HashiCorp Boundary
- A target lives in a project scope and reaches only the hosts in its own host set. `authorize-session` permission on the target is required to connect. ([Targets](https://developer.hashicorp.com/boundary/docs/concepts/domain-model/targets))
- Worker filters (`egress_worker_filter`, `ingress_worker_filter`) route traffic through specific worker infrastructure — this is network routing, not a command filter. ([Configure a worker filter](https://developer.hashicorp.com/boundary/docs/workers/filters))
- Session recording (BSR) captures all session data, writes to worker-local disk during the session, then moves to external object storage on close. Supports SSH and RDP. ([Session recording](https://developer.hashicorp.com/boundary/docs/session-recording))
- No command-level read-only feature exists in Boundary's docs, worker filters, or policies. The `policies` command controls only recording storage retention. ([Policies](https://developer.hashicorp.com/boundary/docs/commands/policies))

### StrongDM
- Roles hold access rules: static (pick specific resources) or dynamic (match resource type + tags). ([Roles](https://docs.strongdm.com/admin/access/roles.md))
- Policy-Based Action Control gives real command-level restriction (e.g., forbid `DELETE`, cap `SELECT` row count) — but only for Postgres and Microsoft SQL Server. No equivalent exists for SSH/server resources. ([Policy-Based Action Control](https://www.strongdm.com/blog/continuous-authorization-for-databases-through-fine-grained-policy-based-action-control))
- SSH sessions get full replay and per-command log entries, exportable to external sinks. ([Logs](https://docs.strongdm.com/admin/audit/logs))

### AWS SSM Session Manager and Run Command
- `ssm:StartSession` is scoped by exact instance ARN, exact document ARN, or resource tag in the IAM policy. `ssm:SessionDocumentAccessCheck` forces explicit per-document permission. ([Restrict access to commands in a session](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-restrict-command-access.html), [Enforce a session document permission check](https://docs.aws.amazon.com/systems-manager/latest/userguide/getting-started-sessiondocumentaccesscheck.html))
- A custom `Session`-type document with `sessionType: InteractiveCommands` pins a session to one fixed command with regex-limited parameters. This is not an interactive shell — the caller supplies parameter values only. ([Restrict access to commands in a session](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-restrict-command-access.html))
- For a normal interactive shell session, AWS states directly: "Systems Manager doesn't check the commands or scripts in your shell profile to see what changes they would make to an instance before they're run." The default `ssm-user` gets passwordless root via sudoers unless an admin edits it. ([Allow configurable shell profiles](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-preferences-shell-config.html), [Turn off ssm-user administrative permissions](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-ssm-user-permissions.html))
- Session logging to S3/CloudWatch is opt-in, command+output only (not keystrokes), and does not cover port-forwarded or SSH-tunneled sessions. CloudTrail logs only the API calls (StartSession, TerminateSession), not in-session actions. ([Logging session data using CloudWatch Logs](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-logging-cloudwatch-logs.html))
- Run Command restriction uses a Resource ARN on the document, not a condition key. `AWS-RunDocument` can execute remote or inline document content and can bypass an intended allowlist unless separately denied. ([Setting up Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command-setting-up.html), [Running documents from remote locations](https://docs.aws.amazon.com/systems-manager/latest/userguide/documents-running-remote-github-s3.html))
- This repo's prod host is a single self-hosted machine reached via a GitHub Actions self-hosted runner and PM2 (per this repo's `CLAUDE.md`), not an AWS-managed EC2 fleet — SSM does not apply without adding AWS-managed infrastructure.

### OS-level restricted shell mechanisms
- `rbash` disables `cd`, changing `PATH`/`SHELL`/`ENV`, slash-containing command names, output redirection, and `exec`. The GNU manual states the guarantee holds only if `PATH` allows just a few verified commands, the working directory is non-writable, and no shell scripts run — and running a script un-restricts the spawned shell. The manual recommends containers over `rbash` for real isolation. ([GNU Bash Reference — Restricted Shell](https://www.gnu.org/software/bash/manual/html_node/The-Restricted-Shell.html))
- `ForceCommand` in `sshd_config` and `command=` in `authorized_keys` both let `sshd` itself pick which binary runs, ignoring the client's requested command — a hard guarantee at the protocol level. The client's original command is still passed to that binary via `SSH_ORIGINAL_COMMAND`, so the binary must not blindly execute it. Port/agent/X11 forwarding is a separate setting that must be disabled explicitly (`DisableForwarding` or individual options). ([OpenBSD `sshd_config(5)`](https://man.openbsd.org/sshd_config), [OpenBSD `sshd(8)`](https://man.openbsd.org/sshd))
- `sudoers` `Cmnd_Alias`/`NOPASSWD` binds a name to specific commands. The manual warns that negating commands from `ALL` "rarely works as intended" and is bypassable by a copied binary or a shell escape in the allowed program. ([`sudoers(5)`](https://man.archlinux.org/man/sudoers.5))

### Anthropic's own first-party precedent
- Claude Code's Bash rules (`Bash(git diff:*)`) are enforced by the harness, evaluated deny-then-ask-then-allow, first match wins. Anthropic's own docs call argument-level allowlisting "fragile" — it can miss flags before a URL, redirects, or variable expansion — and recommend denying the raw tool (`curl`, `wget`) and using a purpose-built tool (`WebFetch`) instead. ([Configure permissions](https://code.claude.com/docs/en/permissions))
- The MCP spec's `ToolAnnotations` (`readOnlyHint`, `destructiveHint`) are self-declared by the server. The spec states: "clients MUST consider tool annotations to be untrusted unless they come from trusted servers." There is no protocol mechanism that verifies a tool is actually read-only. ([MCP spec, Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools))
- Anthropic's own engineering guidance recommends narrow, purpose-built tools over a generic wrapper around raw operations. ([Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))

## Recommendation for this repo

Build one new tool file: `mcp-server/tools/system.js`, registered in `mcp-server/server.js` next to `database.js` and `logs.js`, using the same tool-object shape (`name`, `description`, `inputSchema`, `handler`) already used by `logTools` in `logs.js`.

**Guardrails, matching how `query_db` and the log tools already enforce read-only:**
- Use `child_process.execFile` with a fixed argv array. Never `exec`, never string concatenation into a shell — this is what makes the guarantee hold regardless of model input, the same way the DB user's SELECT-only grant makes `query_db` safe regardless of the SQL string.
- Give the model no free-text command parameter. Each allowed operation is its own named tool input (or an enum), the same shape as `get_error_logs` taking `n` and `date`, never a raw string passed to a shell.
- Set a timeout (5–10s) and a max-output-size cap on every call, matching the `timeout: 5000` already set on `executeQuery` in `database.js` and the 500-row/entry caps in the log tools.
- Run the MCP server process itself (already a separate PM2 process, `MCPServer`, per this repo's `CLAUDE.md`) as a low-privilege OS user with no `sudo`, so even a bug in the wrapper cannot escalate.

**Allowlist to start with** (read-only, no side effects):
- `pm2 jlist` or `pm2 status` — process health
- `pm2 logs <name> --lines N --nostream` — recent process log tail (name from a fixed enum of this repo's PM2 apps: `BackendAPI`, `CronJob`, `MCPServer`)
- `df -h` — disk usage
- `free -m` — memory usage
- `uptime` — load average
- `ps aux` — process list

**Explicitly exclude:** anything that writes, restarts, or deletes (`pm2 restart`, `pm2 delete`, `kill`, `rm`, any redirection), and anything that takes a free-form path or command string as input.

This is the same shape as AWS's one genuinely bounded pattern found in this research — the `InteractiveCommands` SSM document, which works precisely because it is not an interactive shell, only a fixed command with regex-limited parameters. It also reuses this repo's existing MCP auth (`mcp-server/auth.js`, a single bearer token) and logging, so no new infrastructure, vendor contract, or OS account model is needed for a single-host, single-caller setup.

Do not add Teleport, Boundary, StrongDM, or SSM Session Manager. Each solves broker-and-record access for many hosts and many human operators; none of them enforces read-only inside the shell, so each would still need this same wrapper-tool guarantee built on top — at the cost of a new service, agent, or vendor contract this project does not need for one host and one caller.
