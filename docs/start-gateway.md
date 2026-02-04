# Start Gateway

The `start-gateway.ts` script launches the IB Gateway in a Docker container, allowing the TUI application to connect to Interactive Brokers.

## Step-by-Step Guide

1. **Start the gateway**
   ```bash
   npm run gateway:start
   ```

2. **Enter your IBKR credentials** when prompted

3. **Open a VNC viewer** to connect to `localhost:5900`
   - **macOS**: Finder > Go > Connect to Server > `vnc://localhost:5900`
   - **Or** use any VNC client (RealVNC, TigerVNC, etc.)

4. **Enter the VNC password**: `password` (default)

5. **Complete 2FA** if prompted:
   - Open the IBKR mobile app on your phone
   - Find the security code or approve the login request
   - Enter the code in the gateway window

6. **Verify connection**: The gateway should show "Connected" in its status bar

7. **Start using the TUI**: The API is now available on port `4002`

## What It Does

1. Prompts for your IBKR username and password
2. Starts the IB Gateway Docker container via `docker compose up -d`
3. Passes credentials as environment variables to the container

## Endpoints

Once running, the gateway exposes:

| Service | URL/Port | Description |
|---------|----------|-------------|
| API | `localhost:4002` | TWS API socket connection |
| VNC | `localhost:5900` | VNC connection for GUI access |

## VNC Access

### Why VNC?

IB Gateway runs as a GUI application, even when containerized. VNC (Virtual Network Computing) provides remote access to this GUI, which is necessary for:

- **Two-Factor Authentication (2FA)**: IBKR may prompt for a security code on login
- **Manual confirmations**: Some actions require clicking through dialogs
- **Monitoring**: Verify connection status, see error messages, and debug issues
- **Session management**: Handle disconnections or re-authentication prompts

### Connecting via VNC

**macOS (built-in)**:
1. Open Finder
2. Go to menu: Go > Connect to Server (or press Cmd+K)
3. Enter `vnc://localhost:5900`
4. Enter password: `password`

**VNC client apps** (RealVNC, TigerVNC, etc.):
1. Connect to `localhost:5900`
2. Enter password: `password`

### Common VNC Tasks

- **Complete 2FA**: Enter the code from your IBKR mobile app when prompted
- **Check connection status**: Look for "Connected" in the gateway status bar
- **View logs**: The gateway displays connection events and errors in its interface

## Configuration

The Docker container is configured with:

- **Trading Mode**: Live (change to `paper` in docker-compose.yml for testing)
- **Read-Only API**: Enabled (prevents accidental trades)
- **Incoming Connections**: Automatically accepted

These settings are defined in `docker-compose.yml`.

## Stopping the Gateway

```bash
npm run gateway:stop
```

This runs `docker compose down` to stop and remove the container.

## Prerequisites

- Docker and Docker Compose installed
- An Interactive Brokers account (paper or live)
- Node.js 18+

## Troubleshooting

### Container won't start
Check Docker is running: `docker info`

### Can't connect to API
1. Open VNC viewer at `vnc://localhost:5900`
2. Verify the gateway is logged in and running
3. Check that API connections are enabled in gateway settings

### Authentication fails
Verify your IBKR credentials are correct. Note that paper and live accounts may have different credentials.
