CLANG ?= clang
BPFTOOL ?= bpftool
CC ?= cc
PKG_CONFIG ?= pkg-config
ARCH := $(shell uname -m)
TARGET_ARCH := $(if $(filter x86_64,$(ARCH)),x86,$(if $(filter aarch64,$(ARCH)),arm64,unknown))
BUILD := build
BPF_OBJ := $(BUILD)/kernelforge.bpf.o
SKEL := $(BUILD)/kernelforge.skel.h
OBSERVER := $(BUILD)/kernelforge-observer
ARCH_INCLUDE := /usr/include/$(ARCH)-linux-gnu

.PHONY: all clean check-deps test-python test-sim test
all: $(OBSERVER)

check-deps:
	@command -v $(CLANG) >/dev/null || (echo "missing clang" >&2; exit 1)
	@command -v $(BPFTOOL) >/dev/null || (echo "missing bpftool" >&2; exit 1)
	@$(PKG_CONFIG) --exists libbpf || (echo "missing libbpf development package" >&2; exit 1)
	@test -r /sys/kernel/btf/vmlinux || (echo "missing kernel BTF: /sys/kernel/btf/vmlinux" >&2; exit 1)
	@test "$(TARGET_ARCH)" != unknown || (echo "unsupported build architecture: $(ARCH)" >&2; exit 1)

$(BUILD):
	mkdir -p $(BUILD)

$(BUILD)/vmlinux.h: | $(BUILD)
	$(BPFTOOL) btf dump file /sys/kernel/btf/vmlinux format c > $@

$(BPF_OBJ): bpf/scheduler.bpf.c include/kf_event.h $(BUILD)/vmlinux.h
	$(CLANG) -g -O2 -target bpf -D__TARGET_ARCH_$(TARGET_ARCH) \
		-I$(BUILD) -Iinclude -I$(ARCH_INCLUDE) \
		-c bpf/scheduler.bpf.c -o $@

$(SKEL): $(BPF_OBJ)
	$(BPFTOOL) gen skeleton $< > $@

$(OBSERVER): src/linux_observer.c include/kf_event.h $(SKEL) | check-deps
	$(CC) -O2 -g -Wall -Wextra -Iinclude -I$(BUILD) \
		$< -o $@ $$( $(PKG_CONFIG) --cflags --libs libbpf )

test-python:
	python3 -m unittest discover -s tests -v

test-sim:
	node test.mjs
	node test-v2.mjs
	node test-v3.mjs
	node test-v4.mjs
	node test-v5.mjs

test: test-python test-sim

clean:
	rm -rf $(BUILD)
