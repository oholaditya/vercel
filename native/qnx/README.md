# native/qnx — QNX Neutrino bridge prototype

**Not compiled or executed** — no QNX SDP was available during development.
The code targets documented QNX Neutrino 7.1/8.0 APIs (`ChannelCreate`,
`ConnectAttach`, `SIGEV_PULSE_INIT`, `timer_create`, `MsgReceivePulse`,
`SCHED_FIFO`) and will likely need small fixes on a real SDP.

| File | Purpose |
|---|---|
| `hubd_bridge.c` | Pulse-driven sampler (prio 40) with a local safety interlock + low-priority TCP bridge to the hub |
| `Makefile` | `make` (qcc x86_64), `make TARGET=aarch64le`, `make posix` (host build, protocol testing only) |

Sensor reads and the siren output are **stubs**; by default the program emits
synthetic values and declares them `"simulated": true` to the hub.

Full design notes, protocol and build/run steps:
[`docs/QNX_INTEGRATION.md`](../../docs/QNX_INTEGRATION.md).
