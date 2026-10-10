/*
 * hubd_bridge.c - QNX Neutrino sensor coordinator + hub bridge (PROTOTYPE)
 *
 * STATUS: written against documented QNX Neutrino 7.x/8.x APIs but NOT compiled
 * or run on QNX by this project (no QNX SDP was available). Treat as a design
 * reference, not as verified code. See native/qnx/README.md.
 *
 * Purpose
 * -------
 * Shows how the time-critical part of the hub would move OFF the Node.js event
 * loop and onto QNX, while the Node.js server keeps the UI, storage and
 * non-critical automation:
 *
 *   +-----------------------------+        NDJSON/TCP        +------------------+
 *   | QNX Neutrino target         |  ---------------------> | Node.js hub       |
 *   |  sampler thread  (prio 40)  |  readings / heartbeats   |  BridgeAdapter    |
 *   |   - periodic timer pulse    |  <---------------------  |  (validates all   |
 *   |   - local safety interlock  |  commands + acks         |   frames)         |
 *   |  bridge thread   (prio 10)  |                          +------------------+
 *   +-----------------------------+
 *
 * Determinism notes
 * -----------------
 * - Sampling is driven by a kernel timer that delivers a PULSE to a channel. The
 *   pulse carries a priority, so the receiving thread runs at that priority.
 * - The safety interlock (smoke/CO -> local siren output) is evaluated in the
 *   sampler thread itself, so it never waits for the network or for Node.js.
 * - Only the low-priority bridge thread touches the network. If the hub is
 *   down, safety reaction is unaffected; readings are dropped (bounded ring).
 * - Real hardware access (GPIO / I2C / Zigbee radio) is stubbed in
 *   read_sensors() / drive_siren(). With SIMULATED_SENSORS=1 (default) the
 *   values are synthetic and every frame declares "simulated": true.
 *
 * Build (QNX SDP 7.1/8.0, host shell after sourcing qnxsdp-env):
 *   make            # see Makefile; uses qcc -Vgcc_ntox86_64 (or ntoaarch64le)
 * Run:
 *   ./hubd_bridge -h 192.168.1.10 -p 7400 -t <BRIDGE_TOKEN>
 */

#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <signal.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

#ifdef __QNXNTO__
#include <sys/neutrino.h>
#include <sys/siginfo.h>
#endif

#ifndef SIMULATED_SENSORS
#define SIMULATED_SENSORS 1
#endif

#define SAMPLE_PERIOD_NS   (100 * 1000 * 1000) /* 100 ms */
#define SAMPLER_PRIO       40                   /* above normal apps (default 10) */
#define BRIDGE_PRIO        10
#define PULSE_CODE_SAMPLE  (_PULSE_CODE_MINAVAIL + 1)
#define RING_SIZE          256
#define LINE_MAX_LEN       512

#define SMOKE_ALARM_PCT_M  10.0
#define CO_ALARM_PPM       70.0

#ifndef _PULSE_CODE_MINAVAIL
#define _PULSE_CODE_MINAVAIL 0
#endif

/* ------------------------------------------------------------------ devices */

typedef struct {
    const char *id;
    const char *name;
    const char *kind;   /* "smoke" | "co" | "light" */
    const char *room;
    const char *metric; /* NULL for actuators */
    double value;
    int    alarm;
} device_t;

static device_t devices[] = {
    { "qnx-smoke-1", "QNX Kitchen Smoke", "smoke", "Kitchen", "obscuration", 0.4, 0 },
    { "qnx-co-1",    "QNX Garage CO",     "co",    "Garage",  "co_ppm",      3.0, 0 },
    { "qnx-light-1", "QNX Garage Light",  "light", "Garage",  NULL,          0.0, 0 },
};
#define NDEV (sizeof(devices) / sizeof(devices[0]))

/* ------------------------------------------------------------------ ring buffer (sampler -> bridge) */

typedef struct { char line[LINE_MAX_LEN]; } frame_t;

static frame_t          ring[RING_SIZE];
static unsigned         ring_head, ring_tail;
static pthread_mutex_t  ring_mx = PTHREAD_MUTEX_INITIALIZER; /* QNX mutexes use priority inheritance */
static pthread_cond_t   ring_cv = PTHREAD_COND_INITIALIZER;
static atomic_uint      dropped_frames;

/* Non-blocking for the producer: when full, the frame is dropped and counted.
 * The high-priority sampler must never block on the network path. */
static void ring_push(const char *line) {
    pthread_mutex_lock(&ring_mx);
    unsigned next = (ring_head + 1) % RING_SIZE;
    if (next == ring_tail) {
        atomic_fetch_add(&dropped_frames, 1);
    } else {
        strncpy(ring[ring_head].line, line, LINE_MAX_LEN - 1);
        ring[ring_head].line[LINE_MAX_LEN - 1] = '\0';
        ring_head = next;
        pthread_cond_signal(&ring_cv);
    }
    pthread_mutex_unlock(&ring_mx);
}

static int ring_pop(char *out, int timeout_ms) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    ts.tv_nsec += (long)timeout_ms * 1000000L;
    ts.tv_sec += ts.tv_nsec / 1000000000L;
    ts.tv_nsec %= 1000000000L;

    pthread_mutex_lock(&ring_mx);
    while (ring_head == ring_tail) {
        if (pthread_cond_timedwait(&ring_cv, &ring_mx, &ts) == ETIMEDOUT) {
            pthread_mutex_unlock(&ring_mx);
            return 0;
        }
    }
    memcpy(out, ring[ring_tail].line, LINE_MAX_LEN);
    ring_tail = (ring_tail + 1) % RING_SIZE;
    pthread_mutex_unlock(&ring_mx);
    return 1;
}

/* ------------------------------------------------------------------ hardware stubs */

static double frand(void) { return (double)rand() / (double)RAND_MAX; }

/* Replace with real drivers (e.g. an I2C resource manager under /dev/i2c1). */
static void read_sensors(void) {
#if SIMULATED_SENSORS
    for (size_t i = 0; i < NDEV; i++) {
        device_t *d = &devices[i];
        if (!d->metric) continue;
        double base = strcmp(d->kind, "smoke") == 0 ? 0.4 : 3.0;
        d->value += (base - d->value) * 0.2 + (frand() - 0.5) * (d->kind[0] == 's' ? 0.1 : 0.8);
        if (d->value < 0) d->value = 0;
    }
#else
#error "Provide real sensor drivers or build with SIMULATED_SENSORS=1"
#endif
}

/* Replace with a GPIO write to a certified sounder interface. */
static void drive_siren(int on) {
    static int state = -1;
    if (state != on) {
        state = on;
        fprintf(stderr, "[safety] local siren output %s\n", on ? "ON" : "OFF");
    }
}

/* ------------------------------------------------------------------ sampler (high priority) */

static void sample_once(void) {
    char line[LINE_MAX_LEN];
    int any_alarm = 0;

    read_sensors();
    for (size_t i = 0; i < NDEV; i++) {
        device_t *d = &devices[i];
        if (!d->metric) continue;
        double limit = strcmp(d->kind, "smoke") == 0 ? SMOKE_ALARM_PCT_M : CO_ALARM_PPM;
        d->alarm = d->value >= limit;
        any_alarm |= d->alarm;
        snprintf(line, sizeof line,
                 "{\"type\":\"reading\",\"deviceId\":\"%s\",\"reading\":{\"metric\":\"%s\",\"value\":%.2f}}",
                 d->id, d->metric, d->value);
        ring_push(line);
    }
    /* Local interlock: bounded-latency reaction independent of the hub. */
    drive_siren(any_alarm);
}

static void heartbeat_all(void) {
    char line[LINE_MAX_LEN];
    for (size_t i = 0; i < NDEV; i++) {
        snprintf(line, sizeof line, "{\"type\":\"heartbeat\",\"deviceId\":\"%s\"}", devices[i].id);
        ring_push(line);
    }
}

static int set_self_priority(int prio) {
    struct sched_param sp = { .sched_priority = prio };
    return pthread_setschedparam(pthread_self(), SCHED_FIFO, &sp);
}

static void *sampler_thread(void *arg) {
    (void)arg;
    unsigned tick = 0;
    set_self_priority(SAMPLER_PRIO);

#ifdef __QNXNTO__
    /* Kernel timer -> pulse on a private channel. The pulse priority makes the
     * receiving thread run at SAMPLER_PRIO when it is delivered. */
    int chid = ChannelCreate(0);
    int coid = ConnectAttach(0, 0, chid, _NTO_SIDE_CHANNEL, 0);
    if (chid == -1 || coid == -1) { perror("channel"); return NULL; }

    struct sigevent ev;
    SIGEV_PULSE_INIT(&ev, coid, SAMPLER_PRIO, PULSE_CODE_SAMPLE, 0);
    timer_t tid;
    if (timer_create(CLOCK_MONOTONIC, &ev, &tid) == -1) { perror("timer_create"); return NULL; }
    struct itimerspec its = { { 0, SAMPLE_PERIOD_NS }, { 0, SAMPLE_PERIOD_NS } };
    timer_settime(tid, 0, &its, NULL);

    for (;;) {
        struct _pulse pulse;
        if (MsgReceivePulse(chid, &pulse, sizeof pulse, NULL) == -1) continue;
        if (pulse.code != PULSE_CODE_SAMPLE) continue;
        sample_once();
        if (++tick % 20 == 0) heartbeat_all(); /* every 2 s */
    }
#else
    /* POSIX fallback (Linux/macOS) for protocol testing only - NOT deterministic. */
    struct timespec next;
    clock_gettime(CLOCK_MONOTONIC, &next);
    for (;;) {
        next.tv_nsec += SAMPLE_PERIOD_NS;
        if (next.tv_nsec >= 1000000000L) { next.tv_sec++; next.tv_nsec -= 1000000000L; }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next, NULL);
        sample_once();
        if (++tick % 20 == 0) heartbeat_all();
    }
#endif
    return NULL;
}

/* ------------------------------------------------------------------ bridge (low priority) */

static const char *hub_host = "127.0.0.1";
static int         hub_port = 7400;
static const char *hub_token = NULL;

static int send_line(int fd, const char *line) {
    size_t len = strlen(line);
    if (send(fd, line, len, 0) != (ssize_t)len) return -1;
    return send(fd, "\n", 1, 0) == 1 ? 0 : -1;
}

/* Minimal command handling: ack every command; switch the simulated light. */
static void handle_inbound(int fd, char *buf) {
    char *line = buf, *nl;
    while ((nl = strchr(line, '\n')) != NULL) {
        *nl = '\0';
        if (strstr(line, "\"type\":\"command\"")) {
            char id[80] = {0};
            const char *p = strstr(line, "\"id\":\"");
            if (p) sscanf(p + 6, "%79[^\"]", id);
            char ack[160];
            snprintf(ack, sizeof ack, "{\"type\":\"ack\",\"id\":\"%s\",\"ok\":true}", id);
            send_line(fd, ack);
        } else if (strstr(line, "\"unauthorized\"")) {
            fprintf(stderr, "[bridge] hub rejected token\n");
        }
        line = nl + 1;
    }
    memmove(buf, line, strlen(line) + 1);
}

static int connect_hub(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return -1;
    struct sockaddr_in sa = { 0 };
    sa.sin_family = AF_INET;
    sa.sin_port = htons((uint16_t)hub_port);
    if (inet_pton(AF_INET, hub_host, &sa.sin_addr) != 1 ||
        connect(fd, (struct sockaddr *)&sa, sizeof sa) != 0) {
        close(fd);
        return -1;
    }
    char line[LINE_MAX_LEN];
    snprintf(line, sizeof line, "{\"type\":\"hello\",\"token\":\"%s\",\"node\":\"qnx-node-1\",\"simulated\":%s}",
             hub_token, SIMULATED_SENSORS ? "true" : "false");
    send_line(fd, line);
    for (size_t i = 0; i < NDEV; i++) {
        snprintf(line, sizeof line,
                 "{\"type\":\"announce\",\"device\":{\"id\":\"%s\",\"name\":\"%s\",\"kind\":\"%s\",\"room\":\"%s\"}}",
                 devices[i].id, devices[i].name, devices[i].kind, devices[i].room);
        send_line(fd, line);
    }
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK);
    return fd;
}

static void *bridge_thread(void *arg) {
    (void)arg;
    set_self_priority(BRIDGE_PRIO);
    char out[LINE_MAX_LEN];
    char in[4096] = {0};

    for (;;) {
        int fd = connect_hub();
        if (fd < 0) { sleep(2); continue; }
        fprintf(stderr, "[bridge] connected to %s:%d\n", hub_host, hub_port);
        for (;;) {
            if (ring_pop(out, 200) && send_line(fd, out) != 0) break;
            size_t used = strlen(in);
            ssize_t n = recv(fd, in + used, sizeof in - used - 1, 0);
            if (n == 0) break;
            if (n > 0) { in[used + (size_t)n] = '\0'; handle_inbound(fd, in); }
            else if (errno != EAGAIN && errno != EWOULDBLOCK) break;
            if (strlen(in) >= sizeof in - 1) in[0] = '\0'; /* oversized garbage: reset */
        }
        fprintf(stderr, "[bridge] link lost, retrying (dropped=%u)\n", atomic_load(&dropped_frames));
        close(fd);
        in[0] = '\0';
        sleep(1);
    }
    return NULL;
}

/* ------------------------------------------------------------------ main */

int main(int argc, char **argv) {
    int opt;
    while ((opt = getopt(argc, argv, "h:p:t:")) != -1) {
        switch (opt) {
        case 'h': hub_host = optarg; break;
        case 'p': hub_port = atoi(optarg); break;
        case 't': hub_token = optarg; break;
        default:
            fprintf(stderr, "usage: %s -h host -p port -t token\n", argv[0]);
            return 2;
        }
    }
    if (!hub_token) hub_token = getenv("BRIDGE_TOKEN");
    if (!hub_token || strlen(hub_token) < 16) {
        fprintf(stderr, "bridge token (>=16 chars) required via -t or BRIDGE_TOKEN\n");
        return 2;
    }
    signal(SIGPIPE, SIG_IGN);
    srand((unsigned)time(NULL));

    pthread_t sampler, bridge;
    pthread_create(&sampler, NULL, sampler_thread, NULL);
    pthread_create(&bridge, NULL, bridge_thread, NULL);
    pthread_join(sampler, NULL);
    pthread_join(bridge, NULL);
    return 0;
}
