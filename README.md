# IBKR TUI

Terminal UI for Interactive Brokers (IBKR), built with TypeScript, Ink, and Zustand.

## Run

```bash
npm install
npm run dev
```

## Keybindings

- `q` or `Ctrl+C`: quit
- `[` / `]`: cycle display currency
- `1`: focus status panel
- `2`: focus portfolio panel
- `3`: focus cash panel
- `ArrowUp` / `ArrowDown`: browse status history when status panel is focused (`[1]`)

## Status Bar

The app uses two status rows:

- Global status row:
  - `transport`: socket/session state (`disconnected`, `connecting`, `connected`, `error`)
  - `health`: broker/network quality (`healthy`, `degraded`, `down`)
  - `data`: freshness of portfolio updates (`fresh ...` / `stale ...`)
  - `retry`: reconnect attempt countdown (or `-` when idle)
- Status-history row:
  - Focus marker for status panel (`>[1] Status<` when active)
  - Selected significant broker event, age, repeat count, and position in history (`i/N`)

Portfolio and cash focus markers are shown in their section headers (`>[2] Portfolio<`, `>[3] Cash<`).
