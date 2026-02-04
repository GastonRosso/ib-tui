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
- **src/commands/** - User command handlers (extensibility point)

### Key Design Principles

1. **Broker Abstraction**: All broker interactions go through interfaces in `src/broker/`. This allows swapping IBKR for other brokers or mock implementations for testing.

2. **Command Pattern**: User actions are implemented as commands in `src/commands/`. Each command is self-contained and registered with the command system.

3. **Event-Driven**: IBKR API is asynchronous and event-based. The application uses an event bus to decouple API responses from UI updates.

4. **View/Model Separation**: TUI views subscribe to state changes and re-render automatically. Business logic stays out of view components.

### IBKR Connection

The app connects to TWS (Trader Workstation) or IB Gateway via their socket API (default port 7496 for TWS, 4001 for Gateway live, 4002 for Gateway demo). The app defaults to port 4002. Connection settings are configured via environment variables (`IBKR_HOST`, `IBKR_PORT`).

### Development Guidelines

1. **Research Before Implementing**: Before implementing non-trivial algorithms or patterns (e.g., hidden input, encryption, parsing), search for the current best practices and existing libraries. Prefer well-maintained libraries over custom implementations unless there's a specific reason not to.

2. **Prefer `type` over `interface`**: Use `type` instead of `interface` for type definitions throughout the codebase.
