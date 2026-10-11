#!/usr/bin/env bash
set -euo pipefail
task_source=$(pwd)
task_work=/tmp/geo-duels-9ak-20261011
mkdir -p "$task_work/agave"
if [[ ! -x "$task_work/agave/solana-release/bin/solana-test-validator" ]]; then
  tar -xjf "$task_source/chain/tooling/agave-linux.tar.bz2" -C "$task_work/agave"
fi
exec "$task_work/agave/solana-release/bin/solana-test-validator" --ledger "$task_work/ledger" --rpc-port 18899 --faucet-port 18901 --bind-address 0.0.0.0 --bpf-program "${1:-9akMspt9zUEXS5Yp8NBZGNKhRgtdLMi7oMhxpC7G1BAk}" "$task_source/chain/deploy/geo_duels.so" --quiet
