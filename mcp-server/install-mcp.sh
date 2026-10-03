#!/usr/bin/env bash
# =============================================================================
#  install-mcp.sh — Aashray MCP server one-command installer
# =============================================================================
#
#  Patches config files for every major AI coding agent so the whole team
#  only needs to run one command.
#
#  Supported agents:
#    · Claude Code          (claude mcp add)
#    · Claude Desktop       (macOS / Linux / Windows)
#    · GitHub Copilot       (VS Code settings.json — requires VS Code ≥ 1.99)
#    · Cursor               (~/.cursor/mcp.json)
#    · Windsurf             (~/.codeium/windsurf/mcp_config.json)
#    · Gemini CLI           (~/.gemini/settings.json)
#    · Codex CLI            (~/.codex/config.toml — native HTTP)
#    · Antigravity          (~/.gemini/antigravity/mcp_config.json)
#
#  OS support:
#    macOS   — fully supported
#    Linux   — fully supported
#    Windows — requires Git Bash (https://git-scm.com) or WSL2.
#              Does NOT work in PowerShell or CMD.
#
#  Usage:
#    ./install-mcp.sh <bearer-token>
#    ./install-mcp.sh <bearer-token> --url https://your-domain.com/mcp
#    ./install-mcp.sh <bearer-token> --dry-run
#    ./install-mcp.sh <bearer-token> --only cursor,zed,codex
#
#  Environment variables:
#    AASHRAY_MCP_URL   Override server URL without passing --url
# =============================================================================

# Bail out immediately if somehow sourced into a non-bash shell.
if [ -z "${BASH_VERSION:-}" ]; then
  echo "Error: this script requires bash." >&2
  echo "On Windows use Git Bash or WSL2, not PowerShell or CMD." >&2
  exit 1
fi

set -euo pipefail

SERVER_NAME="aashray"

# ── Argument parsing ──────────────────────────────────────────────────────────
TOKEN=""
SERVER_URL="${AASHRAY_MCP_URL:-https://aashray.vitraagvigyaan.org/mcp}"
DRY_RUN=false
ONLY_AGENTS=""   # comma-separated allowlist; empty = all

usage() {
  sed -n '/^#  Usage:/,/^#  Environment/p' "$0" \
    | sed -e 's/^#  //' -e 's/^#$//' \
    | sed '$d'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --url)      SERVER_URL="$2";   shift 2 ;;
    --dry-run)  DRY_RUN=true;      shift   ;;
    --only)     ONLY_AGENTS="$2";  shift 2 ;;
    -h|--help)  usage ;;
    -*)         echo "Unknown option: $1"; usage ;;
    *)
      if [[ -z "$TOKEN" ]]; then TOKEN="$1"; shift
      else echo "Unexpected argument: $1"; usage; fi ;;
  esac
done

[[ -z "$TOKEN" ]] && { echo "Error: bearer token is required."; echo; usage; }

# ── OS detection ──────────────────────────────────────────────────────────────
OS="linux"
case "$(uname -s 2>/dev/null)" in
  Darwin)                 OS="mac"     ;;
  MINGW*|CYGWIN*|MSYS*)  OS="windows" ;;
esac

# On Windows (Git Bash), APPDATA is set by the environment.
# On WSL it is NOT set — WSL is detected as Linux, which is correct.
if [[ "$OS" == "windows" && -z "${APPDATA:-}" ]]; then
  echo "Error: \$APPDATA is not set. Run this script from Git Bash, not WSL." >&2
  exit 1
fi

# ── Colours ───────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  GRN='\033[0;32m' YLW='\033[1;33m' RED='\033[0;31m'
  BLD='\033[1m'    DIM='\033[2m'    NC='\033[0m'
else
  GRN='' YLW='' RED='' BLD='' DIM='' NC=''
fi

# ── Output helpers ─────────────────────────────────────────────────────────────
PATCHED=0; SKIPPED=0; FAILED=0
ok()   { echo -e " ${GRN}✓${NC}  $1"; ((PATCHED++)) || true; }
skip() { echo -e " ${YLW}−${NC}  ${DIM}$1${NC}"; ((SKIPPED++)) || true; }
fail() { echo -e " ${RED}✗${NC}  $1"; ((FAILED++)) || true; }
info() { echo -e "   ${DIM}$1${NC}"; }
hdr()  { echo -e "\n${BLD}$1${NC}"; }

agent_enabled() {
  [[ -z "$ONLY_AGENTS" ]] && return 0
  echo ",$ONLY_AGENTS," | grep -q ",${1}," && return 0 || return 1
}

# =============================================================================
#  Core helpers
# =============================================================================

# Create a directory only if:
#   1. It doesn't already exist, AND
#   2. Its parent already exists (prevents creating deep trees for missing apps)
ensure_dir() {
  local dir="$1"
  [[ -d "$dir" ]] && return 0
  if [[ ! -d "$(dirname "$dir")" ]]; then
    return 1   # grandparent missing — agent not properly installed
  fi
  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] would create: $dir"
  else
    mkdir -p "$dir"
  fi
}

# Back up a file to <file>.bak before the first write this session.
# Skips if the .bak already exists (idempotent across multiple patch calls).
backup_file() {
  local file="$1"
  [[ -f "$file" && ! -f "${file}.bak" ]] && cp "$file" "${file}.bak" || true
}

# Patch a JSON file at a dot-separated key path with a JSON value.
# The parent directory MUST already exist — call ensure_dir first.
patch_json() {
  local file="$1" keypath="$2" value="$3"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] would write to: $file"
    info "          .$keypath = $value"
    return 0
  fi

  backup_file "$file"
  python3 - "$file" "$keypath" "$value" <<'PY'
import sys, json, os

def load_jsonc(text):
    """Parse JSON or JSONC (JSON with // and /* */ comments)."""
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n:   # escape sequence inside string
                i += 1; out.append(text[i])
            elif c == '"':
                in_str = False
        elif c == '"':
            in_str = True; out.append(c)
        elif c == '/' and i + 1 < n:
            if text[i+1] == '/':           # line comment
                while i < n and text[i] != '\n': i += 1
                continue
            elif text[i+1] == '*':         # block comment
                i += 2
                while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'): i += 1
                i += 2; continue
            else:
                out.append(c)
        else:
            out.append(c)
        i += 1
    return json.loads(''.join(out))

file  = sys.argv[1]
keys  = sys.argv[2].split(".")
value = json.loads(sys.argv[3])

parent = os.path.dirname(os.path.abspath(file))
if not os.path.isdir(parent):
    print(f"error: directory does not exist: {parent}", file=sys.stderr)
    sys.exit(1)

data = {}
if os.path.exists(file) and os.path.getsize(file) > 0:
    raw = open(file).read()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        try:
            data = load_jsonc(raw)
            print(f"note: {file} contains comments — they will be removed on write", file=sys.stderr)
        except (json.JSONDecodeError, ValueError):
            print(f"error: cannot parse {file} as JSON or JSONC", file=sys.stderr)
            sys.exit(1)

obj = data
for k in keys[:-1]:
    if k not in obj or not isinstance(obj[k], dict):
        obj[k] = {}
    obj = obj[k]
obj[keys[-1]] = value

with open(file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

# Ensure a string value is in a JSON array at keypath (no duplicates).
ensure_in_json_array() {
  local file="$1" keypath="$2" value="$3"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] would ensure '$value' in $file .$keypath[]"
    return 0
  fi

  backup_file "$file"
  python3 - "$file" "$keypath" "$value" <<'PY'
import sys, json, os

def load_jsonc(text):
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n: i += 1; out.append(text[i])
            elif c == '"': in_str = False
        elif c == '"': in_str = True; out.append(c)
        elif c == '/' and i + 1 < n:
            if text[i+1] == '/':
                while i < n and text[i] != '\n': i += 1
                continue
            elif text[i+1] == '*':
                i += 2
                while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'): i += 1
                i += 2; continue
            else: out.append(c)
        else: out.append(c)
        i += 1
    return json.loads(''.join(out))

file  = sys.argv[1]
keys  = sys.argv[2].split(".")
value = sys.argv[3]

parent = os.path.dirname(os.path.abspath(file))
if not os.path.isdir(parent):
    print(f"error: directory does not exist: {parent}", file=sys.stderr)
    sys.exit(1)

data = {}
if os.path.exists(file) and os.path.getsize(file) > 0:
    raw = open(file).read()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        try:
            data = load_jsonc(raw)
        except (json.JSONDecodeError, ValueError):
            print(f"error: cannot parse {file} as JSON or JSONC", file=sys.stderr)
            sys.exit(1)

obj = data
for k in keys[:-1]:
    if k not in obj or not isinstance(obj[k], dict):
        obj[k] = {}
    obj = obj[k]
arr = obj.get(keys[-1], [])
if not isinstance(arr, list): arr = []
if value not in arr: arr.append(value)
obj[keys[-1]] = arr

with open(file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

# Patch VS Code's settings.json for GitHub Copilot MCP.
patch_vscode_settings() {
  local file="$1" name="$2" url="$3" token="$4"

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] would write to $file"
    info "          .mcp.servers.$name"
    return 0
  fi

  backup_file "$file"
  python3 - "$file" "$name" "$url" "$token" <<'PY'
import sys, json, os

def load_jsonc(text):
    out, i, n = [], 0, len(text)
    in_str = False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == '\\' and i + 1 < n: i += 1; out.append(text[i])
            elif c == '"': in_str = False
        elif c == '"': in_str = True; out.append(c)
        elif c == '/' and i + 1 < n:
            if text[i+1] == '/':
                while i < n and text[i] != '\n': i += 1
                continue
            elif text[i+1] == '*':
                i += 2
                while i + 1 < n and not (text[i] == '*' and text[i+1] == '/'): i += 1
                i += 2; continue
            else: out.append(c)
        else: out.append(c)
        i += 1
    return json.loads(''.join(out))

file, name, url, token = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

parent = os.path.dirname(os.path.abspath(file))
if not os.path.isdir(parent):
    print(f"error: directory does not exist: {parent}", file=sys.stderr)
    sys.exit(1)

data = {}
if os.path.exists(file) and os.path.getsize(file) > 0:
    raw = open(file).read()
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        try:
            data = load_jsonc(raw)
        except (json.JSONDecodeError, ValueError):
            print(f"error: cannot parse {file} as JSON or JSONC", file=sys.stderr)
            sys.exit(1)

data.setdefault("mcp", {}).setdefault("servers", {})[name] = {
    "type": "http", "url": url,
    "headers": {"Authorization": f"Bearer {token}"},
}
if "github.copilot.chat.mcp.enabled" in data:
    data["github.copilot.chat.mcp.enabled"] = True

with open(file, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

# =============================================================================
#  JSON entry blobs
# =============================================================================
# HTTP-native agents (Cursor, Windsurf, Cline, Roo Code)
std_entry()    { printf '{"url":"%s","headers":{"Authorization":"Bearer %s"}}' "$SERVER_URL" "$TOKEN"; }
# Gemini CLI uses httpUrl instead of url
gemini_entry() { printf '{"httpUrl":"%s","headers":{"Authorization":"Bearer %s"}}' "$SERVER_URL" "$TOKEN"; }
# Claude Code HTTP transport
cc_entry()     { printf '{"type":"http","url":"%s","headers":{"Authorization":"Bearer %s"}}' "$SERVER_URL" "$TOKEN"; }
# Agents that only support stdio (Claude Desktop, Antigravity) — bridged via mcp-remote
mcp_remote_entry() {
  python3 -c "
import json
print(json.dumps({
  'command': 'npx',
  'args': ['mcp-remote','$SERVER_URL','--header','Authorization: Bearer $TOKEN']
}))
"
}

# =============================================================================
#  Per-agent installers
# =============================================================================

install_claude_code() {
  hdr "Claude Code"
  agent_enabled "claude-code" || { skip "skipped (not in --only list)"; return; }

  if command -v claude &>/dev/null; then
    if [[ "$DRY_RUN" == "true" ]]; then
      info "[dry-run] would run: claude mcp add --transport http $SERVER_NAME $SERVER_URL --header 'Authorization: Bearer ***'"
    else
      claude mcp add --transport http "$SERVER_NAME" "$SERVER_URL" \
        --header "Authorization: Bearer $TOKEN" 2>/dev/null || true
    fi
    ok "claude mcp add  →  $SERVER_NAME registered"
  else
    # Fallback: patch the JSON files directly.
    # $HOME always exists; ~/.claude/ is created by Claude Code on first run.
    local mcp_file="$HOME/.mcp.json"
    local settings_file="$HOME/.claude/settings.json"
    ensure_dir "$HOME/.claude" || true   # may not exist if Code not yet run
    patch_json "$mcp_file" "mcpServers.$SERVER_NAME" "$(cc_entry)"
    [[ -d "$HOME/.claude" ]] && ensure_in_json_array "$settings_file" "enabledMcpjsonServers" "$SERVER_NAME"
    ok "~/.mcp.json patched  (claude CLI not found)"
  fi
}

install_claude_desktop() {
  hdr "Claude Desktop"
  agent_enabled "claude-desktop" || { skip "skipped (not in --only list)"; return; }

  local cfg=""
  local app_found=false

  case "$OS" in
    mac)
      cfg="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
      [[ -d "/Applications/Claude.app" ]] && app_found=true
      ;;
    linux)
      cfg="$HOME/.config/Claude/claude_desktop_config.json"
      # On Linux, Claude Desktop creates its config dir on first launch.
      [[ -d "$HOME/.config/Claude" ]] && app_found=true
      ;;
    windows)
      cfg="$APPDATA/Claude/claude_desktop_config.json"
      [[ -d "$APPDATA/Claude" ]] && app_found=true
      ;;
  esac

  # If the config file already exists, that's definitive proof it's installed.
  [[ -f "$cfg" ]] && app_found=true

  if [[ "$app_found" == "false" ]]; then
    skip "Claude Desktop not found — install from claude.ai/download"
    return
  fi

  # Config dir may not exist on a fresh install — create it (one level only).
  ensure_dir "$(dirname "$cfg")" || { fail "Claude Desktop: could not create config dir"; return; }
  patch_json "$cfg" "mcpServers.$SERVER_NAME" "$(mcp_remote_entry)"
  ok "$cfg"
  info "Restart Claude Desktop for the change to take effect."
}

install_github_copilot() {
  hdr "GitHub Copilot (VS Code ≥ 1.99)"
  agent_enabled "copilot" || { skip "skipped (not in --only list)"; return; }

  local cfg="" found=false

  case "$OS" in
    mac)
      cfg="$HOME/Library/Application Support/Code/User/settings.json"
      [[ -d "/Applications/Visual Studio Code.app" ]] && found=true
      [[ -d "$HOME/Library/Application Support/Code/User" ]] && found=true
      command -v code &>/dev/null && found=true
      ;;
    linux)
      cfg="$HOME/.config/Code/User/settings.json"
      [[ -d "$HOME/.config/Code/User" ]] && found=true
      command -v code &>/dev/null && found=true
      ;;
    windows)
      cfg="$APPDATA/Code/User/settings.json"
      [[ -d "$APPDATA/Code/User" ]] && found=true
      ;;
  esac

  if [[ "$found" == "false" ]]; then
    skip "VS Code not found — install from code.visualstudio.com (requires ≥ 1.99)"
    return
  fi

  # VS Code/User dir always exists if VS Code is installed — no need to create.
  patch_vscode_settings "$cfg" "$SERVER_NAME" "$SERVER_URL" "$TOKEN"
  ok "$cfg"
  info "If tools don't appear in Copilot Chat, add: \"github.copilot.chat.mcp.enabled\": true"

  # VS Code Insiders — only if the settings file already exists.
  local insiders_cfg=""
  case "$OS" in
    mac)   insiders_cfg="$HOME/Library/Application Support/Code - Insiders/User/settings.json" ;;
    linux) insiders_cfg="$HOME/.config/Code - Insiders/User/settings.json" ;;
  esac
  if [[ -n "$insiders_cfg" && -f "$insiders_cfg" ]]; then
    patch_vscode_settings "$insiders_cfg" "$SERVER_NAME" "$SERVER_URL" "$TOKEN"
    info "VS Code Insiders also patched."
  fi
}

install_cursor() {
  hdr "Cursor"
  agent_enabled "cursor" || { skip "skipped (not in --only list)"; return; }

  # ~/.cursor is created by Cursor during installation — it's reliable.
  local cursor_dir="$HOME/.cursor"
  local found=false
  [[ -d "$cursor_dir" ]]               && found=true
  [[ -d "/Applications/Cursor.app" ]]  && found=true   # macOS
  command -v cursor &>/dev/null         && found=true

  if [[ "$found" == "false" ]]; then
    skip "Cursor not found — install from cursor.com"
    return
  fi

  # Cursor may be detected via app bundle before ~/.cursor exists (e.g., just installed).
  ensure_dir "$cursor_dir" || { fail "Cursor: could not create ~/.cursor"; return; }
  patch_json "$cursor_dir/mcp.json" "mcpServers.$SERVER_NAME" "$(std_entry)"
  ok "$cursor_dir/mcp.json"
  info "Also works per-project: commit .cursor/mcp.json in the repo root."
}

install_windsurf() {
  hdr "Windsurf"
  agent_enabled "windsurf" || { skip "skipped (not in --only list)"; return; }

  local cfg="$HOME/.codeium/windsurf/mcp_config.json"
  local found=false
  # ~/.codeium/windsurf is created by Windsurf at install time.
  [[ -d "$HOME/.codeium/windsurf" ]]  && found=true
  [[ -d "/Applications/Windsurf.app" ]] && found=true
  command -v windsurf &>/dev/null      && found=true

  if [[ "$found" == "false" ]]; then
    skip "Windsurf not found — install from windsurf.com"
    return
  fi

  ensure_dir "$(dirname "$cfg")" || { fail "Windsurf: could not create config dir"; return; }
  patch_json "$cfg" "mcpServers.$SERVER_NAME" "$(std_entry)"
  ok "$cfg"
}

install_gemini_cli() {
  hdr "Gemini CLI"
  agent_enabled "gemini" || { skip "skipped (not in --only list)"; return; }

  # Only check for the binary — don't treat ~/.gemini existing as proof Gemini is installed.
  local found=false
  command -v gemini &>/dev/null  && found=true
  # ~/.gemini dir is created by Gemini on first run; also accept it as proof.
  [[ -d "$HOME/.gemini" ]]       && found=true

  if [[ "$found" == "false" ]]; then
    skip "Gemini CLI not found — install from g.co/gemini-cli"
    return
  fi

  local cfg="$HOME/.gemini/settings.json"
  # ~/.gemini may not exist yet if the binary was just installed.
  ensure_dir "$HOME/.gemini" || { fail "Gemini CLI: could not create ~/.gemini"; return; }
  patch_json "$cfg" "mcpServers.$SERVER_NAME" "$(gemini_entry)"
  ok "$cfg"
}


install_codex() {
  hdr "Codex CLI"
  agent_enabled "codex" || { skip "skipped (not in --only list)"; return; }

  local found=false
  command -v codex &>/dev/null   && found=true
  [[ -d "$HOME/.codex" ]]        && found=true

  if [[ "$found" == "false" ]]; then
    skip "Codex CLI not found — install from github.com/openai/codex"
    return
  fi

  local cfg="$HOME/.codex/config.toml"
  ensure_dir "$HOME/.codex" || { fail "Codex: could not create ~/.codex"; return; }

  if [[ "$DRY_RUN" == "true" ]]; then
    info "[dry-run] would write to $cfg"
    info "          [mcp_servers.$SERVER_NAME] (native HTTP transport)"
    ok "$cfg"
    return
  fi

  # Codex natively supports streamable HTTP — no mcp-remote bridge needed.
  backup_file "$cfg"
  python3 - "$cfg" "$SERVER_NAME" "$SERVER_URL" "$TOKEN" <<'PY'
import sys, os, re

file, name, url, token = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

new_section = (
    f"\n[mcp_servers.{name}]\n"
    f'url = "{url}"\n'
    f'http_headers = {{ "Authorization" = "Bearer {token}" }}\n'
)

content = open(file).read() if os.path.exists(file) else ""
header  = f"[mcp_servers.{name}]"

if header in content:
    content = re.sub(
        rf'\[mcp_servers\.{re.escape(name)}\][^\[]*',
        new_section.lstrip(),
        content,
    )
else:
    content += new_section

with open(file, "w") as f:
    f.write(content)
PY
  ok "$cfg"
}

install_antigravity() {
  hdr "Antigravity (Google)"
  agent_enabled "antigravity" || { skip "skipped (not in --only list)"; return; }

  # Config lives in ~/.gemini/antigravity/ — separate from Gemini CLI's ~/.gemini/settings.json
  local cfg_dir="$HOME/.gemini/antigravity"
  local cfg="$cfg_dir/mcp_config.json"
  local found=false
  [[ -d "$cfg_dir" ]]                          && found=true
  [[ -d "/Applications/Antigravity.app" ]]     && found=true   # macOS

  if [[ "$found" == "false" ]]; then
    skip "Antigravity not found — install from antigravity.google"
    return
  fi

  if ! command -v npx &>/dev/null; then
    fail "Antigravity: npx is required for mcp-remote — install Node.js from nodejs.org"
    return
  fi

  ensure_dir "$cfg_dir" || { fail "Antigravity: could not create $cfg_dir"; return; }
  patch_json "$cfg" "mcpServers.$SERVER_NAME" "$(mcp_remote_entry)"
  ok "$cfg"
}

# =============================================================================
#  Main
# =============================================================================

echo -e "${BLD}Aashray MCP Installer${NC}"
echo -e "${DIM}OS     : $OS${NC}"
echo -e "${DIM}Server : $SERVER_URL${NC}"
echo -e "${DIM}Token  : ${TOKEN:0:8}…${NC}"
[[ "$DRY_RUN" == "true" ]] && echo -e "${YLW}Dry-run mode — no files will be modified.${NC}"

install_claude_code
install_claude_desktop
install_github_copilot
install_cursor
install_windsurf
install_gemini_cli
install_codex
install_antigravity

# ── Summary ───────────────────────────────────────────────────────────────────
echo
echo -e "${BLD}Summary${NC}"
echo -e " ${GRN}✓${NC}  $PATCHED agent(s) configured"
echo -e " ${YLW}−${NC}  $SKIPPED skipped"
[[ $FAILED -gt 0 ]] && echo -e " ${RED}✗${NC}  $FAILED failed"
echo -e "${DIM}Originals backed up as <file>.bak — restore with: cp <file>.bak <file>${NC}"
echo
health_url="${SERVER_URL%/mcp}/health"
echo -e "Verify any agent with:"
echo -e "  ${DIM}curl -s $health_url -H \"Authorization: Bearer <token>\"${NC}"
echo
