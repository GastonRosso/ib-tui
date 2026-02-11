# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TUI (Terminal User Interface) application for interacting with Interactive Brokers (IBKR). Built in TypeScript with an extensible architecture to support any broker interaction.

## Build Commands

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm run dev          # Run in development mode with hot reload
npm run start        # Run the compiled application
npm run lint         # Run ESLint
npm run lint:fix     # Run ESLint with auto-fix
npm run test         # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test -- --grep "test name"  # Run a single test by name
```

## Architecture

### Core Layers

- **src/tui/** - Terminal UI components using Ink (React for CLI)
- **src/broker/** - Broker abstraction layer with IBKR implementation (uses `@stoqey/ib`)
- **src/state/** - Application state management with Zustand

### Key Design Principles

1. **Broker Abstraction**: All broker interactions go through interfaces in `src/broker/`. This allows swapping IBKR for other brokers or mock implementations for testing.

2. **Event-Driven**: IBKR API is asynchronous and event-based. The application uses an event bus to decouple API responses from UI updates.

4. **View/Model Separation**: TUI views subscribe to state changes and re-render automatically. Business logic stays out of view components.

### IBKR Connection

The app connects to TWS (Trader Workstation) or IB Gateway via their socket API (default port 7496 for TWS, 4001 for Gateway live, 4002 for Gateway demo). The app defaults to port 4002. Connection settings are configured via environment variables (`IBKR_HOST`, `IBKR_PORT`).

### Development Guidelines

1. **Research Before Implementing**: Before implementing non-trivial algorithms or patterns (e.g., hidden input, encryption, parsing), search for the current best practices and existing libraries. Prefer well-maintained libraries over custom implementations unless there's a specific reason not to.

2. **Prefer `type` over `interface`**: Use `type` instead of `interface` for type definitions throughout the codebase.

### Feature Development Workflow

1. **Create feature branch**: `git checkout -b feature/<feature-name>`
2. **Implement feature**: Follow existing patterns in the codebase
3. **Document feature**: Create `docs/features/<feature-name>.md` with:
   - Feature description
   - Usage instructions
   - Implementation notes
4. **Test**: Ensure all tests pass (`npm run test`)
5. **Commit**: Descriptive commit message
6. **Merge**: PR or merge to main when complete

### Plan Document Convention

When creating or updating files under `docs/plans/`, use the same completion format consistently:

1. During planning:
   - Keep `## Status` as `Planned on YYYY-MM-DD.`
2. When finished:
   - Update `## Status` to `Completed on YYYY-MM-DD.`
   - Add `Outcome:` immediately below status using bullet points.
   - Add a final `## Completion Notes` section with numbered items.
3. Do not use alternative completion headings (for example, avoid ad-hoc sections like `## Completion and Resolution`).
