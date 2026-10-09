#!/usr/bin/env bash
# One-time installer for the patterns in this repo.
#
# Why this exists: pi spawns subagents as `pi --mode json -p --no-session ...`.
# Children do NOT inherit `-e <extension>` and are NOT started with `-a`, so an
# extension loaded only for the top-level session is invisible to them, and a
# project-local `.pi/extensions/` is skipped (trust-gated). Any pattern that
# nests therefore needs the subagent extension at USER scope.
#
# Usage:
#   ./install.sh                       # install the subagent extension
#   ./install.sh --agents PATTERN      # also install PATTERN's agents (repeatable)
#   ./install.sh --agents all          # install every installable pattern's agents
#   ./install.sh --no-extension        # agents only (for patterns that ship their own extension)
#   ./install.sh --uninstall           # remove what this script installed
#   PI_CODING_AGENT_DIR=/tmp/x ./install.sh   # install into a scratch dir
#
# Agent scope note: project-local agents (`.pi/agents/`) are found when pi runs
# inside the pattern folder and you pass agentScope "both" (interactive runs ask
# "Run project-local agents?" once). Installing agents at user scope makes them
# available from ANY folder, which is what neutral-research and hitd-machine need.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
EXT_NAME="subagent"

# Patterns whose agents are meant to be usable from any folder.
INSTALLABLE_AGENTS=(neutral-research hitd-machine subagent-question)

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

# Locate pi's bundled subagent example (index.ts + agents.ts).
find_stock_extension() {
	if [[ -n "${PI_STOCK_SUBAGENT_DIR:-}" && -f "$PI_STOCK_SUBAGENT_DIR/index.ts" ]]; then
		printf '%s\n' "$PI_STOCK_SUBAGENT_DIR"; return 0
	fi
	local candidates=() bin root
	if bin="$(command -v pi 2>/dev/null)"; then
		root="$(readlink -f "$bin" 2>/dev/null || echo "$bin")"
		# .../@earendil-works/pi-coding-agent/dist/bundle/cli.js -> package root
		while [[ "$root" != "/" ]]; do
			candidates+=("$root/examples/extensions/subagent")
			root="$(dirname "$root")"
		done
	fi
	if command -v npm >/dev/null 2>&1; then
		candidates+=("$(npm root -g 2>/dev/null)/@earendil-works/pi-coding-agent/examples/extensions/subagent")
	fi
	local c
	for c in "${candidates[@]:-}"; do
		[[ -n "$c" && -f "$c/index.ts" && -f "$c/agents.ts" ]] && { printf '%s\n' "$c"; return 0; }
	done
	return 1
}

install_extension() {
	local stock; stock="$(find_stock_extension)" || {
		echo "error: could not locate pi's examples/extensions/subagent." >&2
		echo "       Set PI_STOCK_SUBAGENT_DIR=/path/to/subagent and re-run." >&2
		exit 1
	}
	mkdir -p "$AGENT_DIR/extensions/$EXT_NAME"
	ln -sfn "$stock/index.ts" "$AGENT_DIR/extensions/$EXT_NAME/index.ts"
	ln -sfn "$stock/agents.ts" "$AGENT_DIR/extensions/$EXT_NAME/agents.ts"
	echo "extension  $EXT_NAME -> $stock"
	echo "           installed in $AGENT_DIR/extensions/$EXT_NAME"
}

install_agents() {
	local pattern="$1" dir="$REPO/patterns/$1/.pi/agents"
	if [[ ! -d "$dir" ]]; then
		echo "error: no .pi/agents/ in patterns/$pattern" >&2; exit 1
	fi
	mkdir -p "$AGENT_DIR/agents"
	local f n
	for f in "$dir"/*.md; do
		n="$(basename "$f")"
		ln -sfn "$f" "$AGENT_DIR/agents/$n"
		echo "agent      $pattern/$n"
	done
}

uninstall() {
	local removed=0 p f n
	rm -rf "$AGENT_DIR/extensions/$EXT_NAME" && removed=1
	# subagent-question installs its own extension (stock + ask_user) as a symlinked dir
	if [[ -L "$AGENT_DIR/extensions/subagent-question" ]]; then
		rm -f "$AGENT_DIR/extensions/subagent-question"; removed=1
	fi
	for p in "${INSTALLABLE_AGENTS[@]}"; do
		for f in "$REPO/patterns/$p/.pi/agents"/*.md; do
			[[ -e "$f" ]] || continue
			n="$(basename "$f")"
			if [[ -L "$AGENT_DIR/agents/$n" ]]; then rm -f "$AGENT_DIR/agents/$n"; removed=1; fi
		done
	done
	[[ $removed -eq 1 ]] && echo "removed $EXT_NAME extension + this repo's agent symlinks from $AGENT_DIR"
}

want_uninstall=0; want_extension=1; agent_patterns=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--agents) shift; [[ $# -gt 0 ]] || { echo "error: --agents needs a value" >&2; exit 1; }
			if [[ "$1" == all ]]; then agent_patterns+=("${INSTALLABLE_AGENTS[@]}"); else agent_patterns+=("$1"); fi ;;
		--no-extension) want_extension=0 ;;
		--uninstall|-u) want_uninstall=1 ;;
		-h|--help) usage; exit 0 ;;
		*) echo "error: unknown argument '$1'" >&2; usage; exit 1 ;;
	esac
	shift
done

echo "pi agent dir: $AGENT_DIR"
if [[ $want_uninstall -eq 1 ]]; then uninstall; exit 0; fi
[[ $want_extension -eq 1 ]] && install_extension
for p in ${agent_patterns+"${agent_patterns[@]}"}; do install_agents "$p"; done
echo
echo "Next: run pi inside a pattern folder (project agents, agentScope \"both\"),"
echo "or from any target repo if you installed that pattern's agents."
