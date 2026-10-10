# Build the QNX Neutrino bridge prototype.
#
# Requires the QNX Software Development Platform (SDP) 7.1 or 8.0 with its
# environment sourced (qnxsdp-env.sh / qnxsdp-env.bat) so that `qcc` is on PATH.
# NOT verified by this project - no QNX SDP was available during development.
#
#   make                       # x86_64 target (e.g. QNX VM image)
#   make TARGET=aarch64le      # ARM64 target (e.g. Raspberry Pi 4 BSP)
#   make posix                 # host build with gcc/clang for protocol testing only

TARGET   ?= x86_64
SIM      ?= 1
OUT      := build
CFLAGS   := -O2 -Wall -Wextra -std=gnu11 -DSIMULATED_SENSORS=$(SIM)

ifeq ($(TARGET),aarch64le)
  QCC_V := -Vgcc_ntoaarch64le
else
  QCC_V := -Vgcc_ntox86_64
endif

# QNX 7.x keeps BSD sockets in libsocket; QNX 8.0 also provides it (io-sock).
QNX_LIBS := -lsocket

all: $(OUT)/hubd_bridge

$(OUT)/hubd_bridge: hubd_bridge.c | $(OUT)
	qcc $(QCC_V) $(CFLAGS) -o $@ $< $(QNX_LIBS)

posix: $(OUT)/hubd_bridge_posix

$(OUT)/hubd_bridge_posix: hubd_bridge.c | $(OUT)
	$(CC) $(CFLAGS) -o $@ $< -lpthread

$(OUT):
	mkdir -p $(OUT)

clean:
	rm -rf $(OUT)

.PHONY: all posix clean
