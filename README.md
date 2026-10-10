# Vertex Home Hub

A smart home coordination console with a **QNX-inspired architecture and
visual identity**: a priority-driven event engine coordinating lights,
thermostats, smoke/CO sensors and security devices, with real-time updates,
automation rules, alert handling and a documented integration boundary for
QNX Neutrino.

> **⚠ Simulation prototype — not a safety device.**
> All sample devices are **simulated in software**. This project does not
> replace certified smoke detectors, CO alarms or professional security
> systems. It is QNX-*inspired* and is **not** an official QNX or BlackBerry
> product; the branding and logo are original.

![stack](https://img.shields.io/badge/React-18-informational) ![stack](https://img.shields.io/badge/Node-24-informational) ![stack](https://img.shields.io/badge/SQLite-node%3Asqlite-informational)

---

## 1. Requirements

| Tool | Version | Check |
|---|---|---|
| Node.js | **22.13 or newer** (24 LTS recommended — uses the built-in `node:sqlite`) | `node -v` |
| npm | 10+ | `npm -v` |

No database server, no C compiler and no QNX SDK are needed to run the hub.

## 2. Install and run (development)

Run these from the project folder (`QNX/`), in PowerShell, Command Prompt,
Git Bash or any macOS/Linux terminal:

```bash
npm install
```

```bash
npm run setup
```

`npm run setup` creates `server/.env` with a random JWT secret, a bridge
token and random passwords for three users, and **prints the passwords once**.
They stay readable in `server/.env` (`ADMIN_PASSWORD`, `OPERATOR_PASSWORD`,
`VIEWER_PASSWORD`). Edit that file and restart to change them.

```bash
npm run dev
```

This starts the API on <http://127.0.0.1:4000> and the web console on
**<http://localhost:5173>**. Open the console and sign in as `admin` with the
printed password.

> npm 11+ may print *"install-scripts … blocked"* warnings for `esbuild` and
> `@tailwindcss/oxide`. They are harmless: both ship prebuilt binaries for
> Windows, macOS and Linux.

## 3. Production build (single port)

```bash
npm run build
```

```bash
npm start
```

The server then serves the built console and the API together on
<http://127.0.0.1:4000>. For production, set `NODE_ENV=production` in
`server/.env`: the server then refuses to start without a strong `JWT_SECRET`
and an explicit `ADMIN_PASSWORD`.

## 3b. Browser demo build (Vercel)

The full hub needs a long-running Node.js process (WebSockets, background
simulator, SQLite), which serverless platforms such as Vercel cannot host. For
a zero-backend deployment there is a **demo build** that runs the *same* hub
engine (`server/src/engine`, device models, simulator, Zod validation) inside
the browser against in-memory storage:

```bash
npm run build:demo -w client
```

```bash
npm run preview:demo -w client
```

Then open <http://localhost:4173> and enter as **admin**, **operator** or
**viewer** (password `demo`). Each visitor gets an independent hub that resets
on reload; nothing is shared or persisted.

`vercel.json` configures Vercel to build this demo (`client/dist`, SPA
rewrites). Import the GitHub repository at <https://vercel.com/new> - no
settings or environment variables are needed.

## 4. Tests

```bash
npm test
```

Runs the server suite (Vitest + Supertest + a Socket.IO and TCP bridge
client, 64 tests) and the client suite (Vitest + Testing Library, 10 tests).
Each suite can also be run alone with `npm test -w server` or
`npm test -w client`.

`npm run typecheck` type-checks both workspaces.

## 5. A two-minute tour

1. **Dashboard** — device/alert/status tiles, the *Emergency* section, live
   sensor telemetry, events-per-minute, the live event stream and quick
   controls.
2. **Settings → Scenario injection** — click **CO leak**. Within a few
   seconds the *CO warning* rule raises a warning, the *CO critical* rule
   **escalates the same alert** to critical, and it appears in the Emergency
   section. Every element is tagged **SIM**.
3. **Acknowledge** the alert (operator/admin), then **Resolve** it on
   *Alerts*.
4. **Security** — the panel starts *Armed · Home*. Click **Door opened**: the
   *Intrusion while armed* rule raises a critical alert and sounds the siren.
   Disarm or **Silence** from the panel card.
5. **Devices** — switch lights, drag brightness, step thermostat targets,
   open **Details** for a telemetry chart and per-device event history.
6. **Automation** — toggle rules, or build a new one (admin).
7. Toggle **light/dark** mode from the top bar (light is the default, matching the program guide palette).

## 6. What is real vs. simulated

| Capability | Status |
|---|---|
| Web console, REST API, JWT auth with roles, audit log | ✅ Implemented and tested |
| Real-time updates (Socket.IO) | ✅ Implemented and tested |
| Priority event engine, automation rules, alert lifecycle | ✅ Implemented and tested |
| SQLite persistence (devices, rules, events, alerts, readings, audit) | ✅ Implemented and tested |
| Sensor readings (smoke, CO, temperature, contact, motion) | 🧪 **Simulated** by `SimulatedAdapter`. Every reading, event and alert carries `simulated: true` and shows a **SIM** badge |
| TCP bridge for external device processes | ✅ Implemented, tested with a Node mock client |
| QNX Neutrino native process (`native/qnx/hubd_bridge.c`) | 📝 **Written, not compiled or run** (no QNX SDP available) |
| Deployment on QNX hardware | ❌ Not done |
| Physical devices, Zigbee / Thread / Matter | ❌ Not implemented — adapter interface documented |
| Certified life-safety function | ❌ Never — see the safety note above |

## 7. Project layout

```
QNX/
├── client/                    React + TypeScript + Tailwind console
│   └── src/
│       ├── theme/             ★ central design tokens (theme.css, tokens.ts, ThemeProvider)
│       ├── components/        ui primitives · layout · devices · charts · alerts · events
│       ├── pages/             Dashboard · Devices · Automation · Security · Alerts · Settings · Login
│       ├── state/             auth, live hub store (REST + Socket.IO), toasts
│       └── lib/               API client, formatting
├── server/                    Node.js + Express + TypeScript
│   └── src/
│       ├── domain/            shared types (also imported by the client) + Zod schemas
│       ├── api/               routes, validation & error middleware
│       ├── auth/              JWT, bcrypt, role checks
│       ├── engine/            Hub, EventEngine, AutomationEngine, AlertManager
│       ├── devices/           device models (DAL) + adapters (simulated, bridge)
│       ├── realtime/          Socket.IO fan-out
│       ├── db/                SQLite schema, repositories, seed data
│       └── config/            environment validation
├── native/qnx/                QNX Neutrino C prototype (unverified)
├── scripts/                   setup-env.mjs, mock-bridge.mjs
└── docs/                      ARCHITECTURE.md · API.md · QNX_INTEGRATION.md
```

## 8. Configuration

All settings live in `server/.env` (template: `server/.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `4000` / `127.0.0.1` | API listen address |
| `DATABASE_PATH` | `./data/hub.db` | SQLite file (`:memory:` for throw-away runs) |
| `JWT_SECRET` | generated | ≥ 32 chars; required in production |
| `ADMIN_*`, `OPERATOR_*`, `VIEWER_*` | generated | Users, re-synced at every start |
| `CORS_ORIGIN` | Vite dev origins | Allowed browser origins |
| `SIMULATION_ENABLED` / `SIMULATION_TICK_MS` | `true` / `2000` | Simulated adapter |
| `HEARTBEAT_TIMEOUT_MS` | `15000` | Offline detection window |
| `BRIDGE_ENABLED` / `BRIDGE_PORT` / `BRIDGE_TOKEN` | `false` / `7400` / generated | QNX/external bridge |

To start from a clean database, stop the server and delete `server/data/`.

## 8b. Visual theme

The palette is taken from the program guide PDF: white surfaces, black ink, a
single coral-red brand colour (`#ff443a`), warm greys and cream. Tokens live in
`client/src/theme/theme.css`; colour roles are kept separate so the brand
colour never means "alarm":

| Role | Light | Dark | Used for |
|---|---|---|---|
| `accent` (brand coral) | `#ff443a` (text `#d42a1e`, buttons `#d6301f`) | `#ff443a` | buttons, active nav, toggles, focus, brand mark |
| `ok` | `#1b7a43` | `#3ccb7f` | healthy / active device status |
| `warn` | `#a85d00` | `#f0a83a` | warnings |
| `crit` (crimson) | `#b0123a` | `#ff5c7a` | critical alarms, always with an icon + label |
| `chart` | `#1d1d1b` | `#e9e9e8` | telemetry lines (neutral ink) |

All text colours meet WCAG AA (≥ 4.5:1) on their surfaces. Typography is
Roboto with JetBrains Mono for readings. No logos or artwork from the PDF are
reproduced.

## 9. Security measures

* Strict Zod validation of every request body, query and path parameter; unknown fields rejected.
* Sensor readings validated for type **and physical plausibility**; implausible values mark the device *fault* and are audited.
* JWT (HS256, 8 h) + bcrypt; role-based access (viewer / operator / admin) on every route and on the socket handshake.
* Login rate limiting; timing-equalised login (a dummy bcrypt compare runs for unknown users).
* Secrets only in `server/.env` (git-ignored); production refuses weak/missing secrets.
* Helmet security headers with a restrictive CSP; 16 KB body limit.
* Audit log of logins, denied requests, failed commands, rule changes and rejected readings (Security page, admin).
* Graceful failure: offline devices → `409` + event; adapter acknowledgement required before state commits; UI error boundary, toasts and automatic socket reconnection; graceful server shutdown.

Known prototype limitations: the session token is kept in `sessionStorage`
(an httpOnly cookie would be stronger), and the bridge protocol is plain TCP
(use TLS/VPN outside a lab).

## 10. Further documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Mermaid diagram, layers, command/ingestion paths, **asynchronous vs deterministic (QNX) event handling**.
* [docs/API.md](docs/API.md) — REST, Socket.IO and error reference.
* [docs/QNX_INTEGRATION.md](docs/QNX_INTEGRATION.md) — QNX design, bridge protocol, native build steps, Zigbee/Thread path.
