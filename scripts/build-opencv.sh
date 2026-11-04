#!/usr/bin/env bash
# Builds the custom OpenCV.js used by Puzzle Lens (docs/RESEARCH.md §18).
#
# Output: vendor/opencv/opencv.mjs + vendor/opencv/opencv.wasm (+ BUILD-INFO.txt)
#   - WebAssembly with SIMD, separate .wasm file, ES module (the unwrapped bin/opencv_js.js,
#     NOT bin/opencv.js, whose UMD wrapper breaks ES modules)
#   - dnn and photo modules switched off; exported functions in scripts/opencv/whitelist.py
#   - native WebAssembly exceptions, so an OpenCV error can be caught instead of killing the worker
#   - build_js.py applies --build_flags to C and C++ compile AND link, so all flags go there.
#     -DHAVE_UNISTD_H: OpenCV's bundled zlib needs it with newer clang (else read/write are undeclared).
#   - OpenCV's modules/js/CMakeLists.txt appends "-s TOTAL_MEMORY=128MB" AFTER our flags, which
#     silently wins. We patch that line so each worker starts at 32 MiB and grows only when needed
#     (otherwise the memory readouts can't show growth below 128 MiB). check-wasm.mjs verifies it.
#   - stackSave/stackRestore + decrementExceptionRefcount are exported: with native wasm exceptions a
#     C++ error caught in JavaScript does NOT rewind the WASM stack pointer or free the exception, so
#     src/cv/loadCv.ts (cvGuard) restores the stack and frees the error in every catch.
#
# Usage:
#   OPENCV_DIR=/path/to/opencv-4.14.0  EMSDK=/path/to/emsdk  [CMAKE_BIN_DIR=/dir/with/cmake]  scripts/build-opencv.sh
#
# Requirements: emsdk (activated version recorded in BUILD-INFO.txt), cmake, python3.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${OPENCV_DIR:?set OPENCV_DIR to an OpenCV 4.14.0 source checkout}"
: "${EMSDK:?set EMSDK to an emsdk checkout with an activated toolchain}"
BUILD_DIR="${BUILD_DIR:-$OPENCV_DIR/../build_puzzle_lens}"
OUT="$ROOT/vendor/opencv"

if [ -n "${CMAKE_BIN_DIR:-}" ]; then export PATH="$CMAKE_BIN_DIR:$PATH"; fi
# shellcheck disable=SC1091
source "$EMSDK/emsdk_env.sh" >/dev/null

# Patch OpenCV's hard-coded memory size (idempotent).
JS_CMAKE="$OPENCV_DIR/modules/js/CMakeLists.txt"
sed -i.bak 's/-s TOTAL_MEMORY=128MB -s WASM_MEM_MAX=1GB/-s INITIAL_MEMORY=32MB -s MAXIMUM_MEMORY=1GB/' "$JS_CMAKE" && rm -f "$JS_CMAKE.bak"
grep -q 'INITIAL_MEMORY=32MB' "$JS_CMAKE" || { echo "Could not patch $JS_CMAKE (memory flags)"; exit 1; }

EM_FLAGS="-s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node -s INITIAL_MEMORY=33554432 -s MAXIMUM_MEMORY=1073741824 -s ALLOW_MEMORY_GROWTH=1 -fwasm-exceptions -s EXPORTED_RUNTIME_METHODS=['getExceptionMessage','decrementExceptionRefcount','stackSave','stackRestore'] -s EXPORT_EXCEPTION_HANDLING_HELPERS=1 -DHAVE_UNISTD_H"

emcmake python3 "$OPENCV_DIR/platforms/js/build_js.py" "$BUILD_DIR" \
  --build_wasm --simd --disable_single_file \
  --config "$ROOT/scripts/opencv/whitelist.py" \
  --build_flags "$EM_FLAGS" \
  --cmake_option="-DCMAKE_CXX_STANDARD=17" \
  --cmake_option="-DBUILD_opencv_dnn=OFF" \
  --cmake_option="-DBUILD_opencv_photo=OFF"

mkdir -p "$OUT"
cp "$BUILD_DIR/bin/opencv_js.js" "$OUT/opencv.mjs"
cp "$BUILD_DIR/bin/opencv_js.wasm" "$OUT/opencv.wasm"
# The ES module asks for 'opencv_js.wasm' by default; Puzzle Lens passes locateFile, but keep both names working.
sed -i.bak 's/opencv_js\.wasm/opencv.wasm/g' "$OUT/opencv.mjs" && rm -f "$OUT/opencv.mjs.bak"

{
  echo "OpenCV: $(cd "$OPENCV_DIR" && git describe --tags 2>/dev/null || echo unknown)"
  echo "Emscripten: $(emcc --version | head -1)"
  echo "Built: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Flags: --build_wasm --simd --disable_single_file, dnn/photo OFF, $EM_FLAGS"
  echo "Sizes: $(wc -c < "$OUT/opencv.mjs") bytes JS, $(wc -c < "$OUT/opencv.wasm") bytes WASM"
  echo "Memory: $(node "$ROOT/scripts/opencv/check-wasm.mjs" "$OUT/opencv.wasm")"
} > "$OUT/BUILD-INFO.txt"
cat "$OUT/BUILD-INFO.txt"
node "$ROOT/scripts/opencv/check-wasm.mjs" "$OUT/opencv.wasm" --expect-initial-mib 32
