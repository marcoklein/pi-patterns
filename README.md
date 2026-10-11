# pi-patterns

Small, self-contained [pi](https://github.com/earendil-works/pi) patterns: copy a folder, run it, mix and match.

## Get started

```bash
./install.sh --agents all            # one-time: subagent extension + reusable agents at user scope
cd patterns/nested-subagents && pi    # run a pattern from its own folder
```

Agent-only patterns run with `pi`; extension patterns run with `pi -e ./index.ts` (each README says which). The install is only needed by patterns that nest subagents — leaf patterns run with no install.

## Patterns

- **[nested-subagents](patterns/nested-subagents)** — minimal nested delegation with a structural depth cap: `orchestrator` → `delegator` → `worker`.
- **[neutral-research](patterns/neutral-research)** — goal → neutral questions → goal-blind research, facts cited `path:line`, no solutions.
- **[hitd-machine](patterns/hitd-machine)** — the irreducible human-in-the-loop machine: research in, `designer` → approval sentinel → gated `implementer` out.
- **[resumable-subagents](patterns/resumable-subagents)** — subagents that remember across sessions: `resume <run-id>`.
- **[subagent-question](patterns/subagent-question)** — subagents ask questions that ripple up to your session, where a human answers.

## License

MIT — see [LICENSE](LICENSE).
