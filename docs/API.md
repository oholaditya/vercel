# API reference

Base URL: `http://127.0.0.1:4000/api` (the Vite dev server proxies `/api` and
`/socket.io`, so the browser uses relative URLs).

* All bodies are JSON (`Content-Type: application/json`, max 16 KB).
* Unknown fields are rejected (`400`) — schemas are strict.
* Authenticate with `Authorization: Bearer <token>` from `/auth/login`.
* Roles: **viewer** (read) < **operator** (control, acknowledge, simulate) < **admin** (rules, simulator state, audit).

## Errors

```json
{ "error": "Validation failed", "details": [{ "path": "level", "message": "Number must be less than or equal to 100" }] }
```

| Status | Meaning |
|---|---|
| 400 | Malformed JSON or schema validation failed |
| 401 | Missing/invalid/expired token, or bad credentials |
| 403 | Authenticated but role too low (logged to the audit log) |
| 404 | Unknown device / rule / alert / route |
| 409 | Device offline or unreachable; alert already acknowledged/resolved |
| 413 | Body too large |
| 422 | Command not supported by this device type; rule references an unknown device |
| 429 | Login rate limit (20 attempts / 15 min / IP) |

## Auth

| Method | Path | Role | Body / Notes |
|---|---|---|---|
| POST | `/auth/login` | public | `{ "username", "password" }` → `{ token, user }` |
| GET | `/auth/me` | viewer | → `{ user }` |
| GET | `/health` | public | → `{ status: "ok" }` |

## Devices

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/devices` | viewer | → `{ devices: DeviceSnapshot[] }` |
| GET | `/devices/:id` | viewer | → `{ device }` |
| GET | `/devices/:id/history?metric=&limit=120` | viewer | Numeric telemetry → `{ metric, points: [{ts, value}] }` |
| POST | `/devices/:id/commands` | operator | Body: one command (below) → `{ device }` |

`DeviceSnapshot`:

```json
{
  "id": "thermo-main", "name": "Main Thermostat", "kind": "thermostat", "room": "Living Room",
  "origin": "simulated", "adapterId": "sim", "online": true, "health": "ok",
  "battery": null, "lastSeen": "2026-10-10T10:00:00.000Z",
  "state": { "currentC": 20.4, "targetC": 21.5, "mode": "auto", "heating": true, "cooling": false }
}
```

Commands:

| Command | Valid for | Constraints |
|---|---|---|
| `{ "action": "setPower", "on": true }` | light, thermostat | — |
| `{ "action": "setBrightness", "level": 75 }` | light | integer 0–100 (0 = off) |
| `{ "action": "setTarget", "celsius": 21.5 }` | thermostat | 10–30, multiple of 0.5 |
| `{ "action": "setMode", "mode": "heat" }` | thermostat | `off` `heat` `cool` `auto` |
| `{ "action": "setSecurityMode", "mode": "armed_away" }` | security_panel | `disarmed` `armed_home` `armed_away` (disarm silences siren) |
| `{ "action": "silenceSiren" }` | security_panel | — |

Sensors (smoke, CO, contact, motion) accept **no** commands — their state
only changes through validated readings from an adapter.

```bash
curl -X POST http://127.0.0.1:4000/api/devices/light-kitchen/commands \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"setBrightness","level":60}'
```

## Automation rules

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/rules` | viewer | → `{ rules }` |
| POST | `/rules` | admin | → `201 { rule }` |
| PATCH | `/rules/:id` | admin | Partial update, e.g. `{ "enabled": false }` |
| DELETE | `/rules/:id` | admin | → `204` |

```json
{
  "name": "Garage CO → alert",
  "description": "optional",
  "enabled": true,
  "cooldownMs": 30000,
  "trigger": { "type": "threshold", "metric": "co_ppm", "op": ">", "value": 50, "deviceId": "co-utility" },
  "actions": [
    { "type": "raise_alert", "severity": "critical", "category": "co", "title": "Garage CO" },
    { "type": "lights", "on": true, "room": "*", "brightness": 100 }
  ]
}
```

Triggers: `motion {deviceId?}` · `intrusion {deviceId?, requireArmed}` ·
`threshold {metric: temperature|obscuration|co_ppm, op: > | <, value, deviceId?}` ·
`device_offline {deviceId?}`.

Actions (1–8): `device_command {deviceId, command}` · `lights {on, room?, brightness?}`
(`room` omitted = triggering device's room, `"*"` = all) ·
`raise_alert {severity: warning|critical, category, title, message?}` · `activate_siren`.

## Alerts

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/alerts?status=open\|active\|acknowledged\|resolved&limit=200` | viewer | → `{ alerts }` |
| POST | `/alerts/:id/acknowledge` | operator | `active → acknowledged`; `409` otherwise |
| POST | `/alerts/:id/resolve` | operator | `active\|acknowledged → resolved` |

## Events

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/events?limit=100&priority=&deviceId=&type=&before=<ISO>` | viewer | Newest first; page with `before` = last `ts`. |

Every event carries `simulated: boolean` so simulated activity is never
mistaken for real sensor data.

## System & simulation

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/system/overview` | viewer | Status, counts, engine stats, adapter status |
| GET | `/system/activity?minutes=30` | viewer | Events per minute (excludes raw readings) |
| GET | `/system/audit?limit=100` | admin | Audit log |
| POST | `/simulation/scenario` | operator | `{ "scenario": "smoke\|co\|intrusion\|motion\|disconnect\|reconnect\|clear", "deviceId"? }` → `{ simulated: true, description }` |
| POST | `/simulation/state` | admin | `{ "running": false }` pauses the simulator (devices go offline after the heartbeat timeout) |

## Real-time (Socket.IO)

Connect with `io({ auth: { token } })`. Invalid tokens are refused with
`connect_error: unauthorized`. Server → client only:

| Event | Payload |
|---|---|
| `device:update` | `DeviceSnapshot` |
| `event:new` | `HubEvent` (raw readings excluded) |
| `alert:upsert` | `Alert` |
| `rule:upsert` / `rule:delete` | `AutomationRule` / `id` |
| `system:overview` | `SystemOverview` (every 2 s and on connect) |
| `telemetry:point` | `{ deviceId, metric, point }` (volatile) |

## Bridge protocol (TCP, NDJSON)

See [`QNX_INTEGRATION.md`](QNX_INTEGRATION.md#bridge-protocol).
