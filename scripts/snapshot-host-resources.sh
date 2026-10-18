#!/usr/bin/env bash
set -euo pipefail

{
  sysctl vm.swapusage
  vm_stat
  ps -axo pid,ppid,time,rss,comm
} > "${1:?Usage: scripts/snapshot-host-resources.sh <output-file>}"
