#!/usr/bin/env bash
set -euo pipefail
task_source=$(pwd)
task_work=/tmp/geo-duels-9ak-20261011
mkdir -p "$task_work/tools" "$task_work/program/src" "$task_work/cargo" "$task_work/target"
if [[ ! -x "$task_work/tools/rust/bin/rustc" ]]; then
  tar -xjf "$task_source/chain/tooling/platform-tools-linux.tar.bz2" -C "$task_work/tools"
fi
cp "$task_source/programs/geo-duels/Cargo.toml" "$task_source/programs/geo-duels/Cargo.lock" "$task_work/program/"
cp "$task_source/programs/geo-duels/src/lib.rs" "$task_work/program/src/"
export CARGO_HOME="$task_work/cargo" CARGO_TARGET_DIR="$task_work/target" RUSTC="$task_work/tools/rust/bin/rustc"
export PATH="$task_work/tools/rust/bin:$task_work/tools/llvm/bin:$PATH"
export CC="$task_work/tools/llvm/bin/clang" AR="$task_work/tools/llvm/bin/llvm-ar"
rustc --version
cargo build --manifest-path "$task_work/program/Cargo.toml" --release --target sbpfv3-solana-solana --locked
mkdir -p "$task_source/chain/deploy"
"$task_work/tools/llvm/bin/llvm-objcopy" --strip-all "$task_work/target/sbpfv3-solana-solana/release/geo_duels.so" "$task_source/chain/deploy/geo_duels.so"
wc -c "$task_source/chain/deploy/geo_duels.so"
