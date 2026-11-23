#!/usr/bin/env bash
set -u
fail=0
check_cmd() {
    if command -v "$1" >/dev/null 2>&1; then
        printf 'OK   command: %s (%s)\n' "$1" "$(command -v "$1")"
    else
        printf 'MISS command: %s\n' "$1"
        fail=1
    fi
}
if [[ "$(uname -s)" != "Linux" ]]; then
    echo "UNSUPPORTED: the observer must be built and run on Linux."
    exit 2
fi
echo "Kernel: $(uname -r)"
echo "Architecture: $(uname -m)"
check_cmd clang
check_cmd bpftool
check_cmd cc
check_cmd pkg-config
if [[ -r /sys/kernel/btf/vmlinux ]]; then
    echo "OK   kernel BTF: /sys/kernel/btf/vmlinux"
else
    echo "MISS kernel BTF: /sys/kernel/btf/vmlinux"
    fail=1
fi
if pkg-config --exists libbpf; then
    echo "OK   libbpf: $(pkg-config --modversion libbpf)"
else
    echo "MISS libbpf development files (pkg-config libbpf)"
    fail=1
fi
config_file="/boot/config-$(uname -r)"
if [[ -r "$config_file" ]]; then
    for option in CONFIG_BPF CONFIG_BPF_SYSCALL CONFIG_DEBUG_INFO_BTF; do
        if grep -q "^$option=y" "$config_file"; then
            echo "OK   $option"
        else
            echo "WARN $option not confirmed in $config_file"
        fi
    done
else
    echo "WARN kernel config file unavailable; inspect kernel config manually."
fi
if [[ "$EUID" -eq 0 ]]; then
    echo "INFO running as root; production deployment should use least privilege."
else
    echo "INFO not root; BPF load/attach may require CAP_BPF and CAP_PERFMON or elevated privileges."
fi
if [[ "$fail" -ne 0 ]]; then
    echo "Environment check failed. Resolve MISS items before building."
    exit 1
fi
echo "Environment prerequisites look present. This check does not prove tp_btf attach support."
