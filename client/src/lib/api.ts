/**
 * Public API surface for the UI. `@backend` is resolved at build time:
 *   - default build      -> src/backend/http.ts (real Node.js hub server)
 *   - `--mode demo` build -> src/backend/demo.ts (hub engine running in the browser)
 */
export { api, createHubSocket, IS_DEMO } from '@backend';
export { ApiError, setToken, setUnauthorizedHandler } from './api-core';
export type { AdapterStatus, AuditEntry, HubApi, HubSocket } from './api-core';
