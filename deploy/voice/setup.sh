#!/usr/bin/env bash
set -euo pipefail
trap 'echo "VOICE_SETUP_ERROR: setup or service failed (line $LINENO)" >&2' ERR
export DEBIAN_FRONTEND=noninteractive
# What to install. The portal sets these from the engines chosen in Settings.
# Without them this is the original combination: Breeze speech and Whisper base.
tts="${VOICE_TTS:-breeze}"
asr="${VOICE_ASR:-whisper}"
asr_model="${VOICE_ASR_MODEL:-base}"
case "$tts" in
  breeze|chatterbox) ;;
  *) echo "VOICE_SETUP_ERROR: unknown speech engine '$tts'" >&2; exit 2 ;;
esac
case "$asr:$asr_model" in
  whisper:base|whisper:small|qwen3-asr:0.6b|qwen3-asr:1.7b) ;;
  *) echo "VOICE_SETUP_ERROR: unknown speech recognition model '$asr:$asr_model'" >&2; exit 2 ;;
esac
cd /voice
if [ -n "${VOICE_PLAN:-}" ]; then echo "VOICE_STAGE: $VOICE_PLAN"; fi
if [ ! -f /usr/local/share/pithagoras-voice-deps ]; then
  echo 'VOICE_STAGE: Installing build tools'
  dpkg --configure -a
  apt-get update
  apt-get install -y --no-install-recommends git cmake ninja-build build-essential curl ca-certificates python3 libssl-dev aria2
  touch /usr/local/share/pithagoras-voice-deps
fi
checkout() {
  local directory="$1" repository="$2" revision="$3"
  if [ ! -d "$directory/.git" ]; then git clone "$repository" "$directory"; fi
  git -C "$directory" checkout "$revision"
  git -C "$directory" submodule update --init --recursive
}
# The audio.cpp model families this choice needs. Speech comes from audio.cpp for
# both engines; recognition does only for Qwen3-ASR, Whisper is a process of its own.
families=()
if [ "$tts" = breeze ]; then families+=(breeze_tts); fi
if [ "$tts" = chatterbox ]; then families+=(chatterbox); fi
if [ "$asr" = qwen3-asr ]; then families+=(qwen3_asr); fi
echo 'VOICE_STAGE: Preparing pinned audio runtime'
checkout audio https://github.com/0xShug0/audio.cpp.git efb04233dab73aeee4b2912042a90e7b36329061
# A volume from before engines could be chosen was built for Breeze alone. A build
# keeps every family it was given, so switching engines back and forth compiles once.
built=audio/build/portal/pithagoras-families
if [ -f "$built" ]; then have=$(cat "$built"); elif [ -x audio/build/portal/bin/audiocpp_server ]; then have=breeze_tts; else have=; fi
models=$(printf '%s,' "$have" "${families[@]}" | tr ',' '\n' | sed '/^$/d' | sort -u | paste -sd, -)
if [ "$models" != "$have" ] || [ ! -x audio/build/portal/bin/audiocpp_gguf ] || [ ! -x audio/build/portal/bin/audiocpp_server ] || ! grep -q 'AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER:BOOL=ON' audio/build/portal/CMakeCache.txt; then
  echo "VOICE_STAGE: Building CUDA speech runtime and quantizer ($models)"
  architecture=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1 | tr -d '. ')
  (cd audio && bash scripts/build_linux.sh --native-model-manager --system-openssl --cuda on --cuda-arch "$architecture" --build-dir /voice/audio/build/portal --build-type Release --model-set custom --models "$models" --target audiocpp_server --target audiocpp_gguf --jobs 4) 2>&1 | tr '\r' '\n'
  echo "$models" > "$built"
fi
if [ "$asr" = whisper ]; then
  echo 'VOICE_STAGE: Preparing CPU speech recognition'
  checkout whisper https://github.com/ggml-org/whisper.cpp.git a2b36eb677918d4f9ab1db7b8a7ff968563ed163
  if [ ! -x whisper/build/bin/whisper-server ]; then
    cmake -S whisper -B whisper/build -DCMAKE_BUILD_TYPE=Release -DGGML_CUDA=OFF -DWHISPER_BUILD_SERVER=ON
    cmake --build whisper/build --target whisper-server -j 4
  fi
fi
mkdir -p models
download() {
  local url="$1" destination="$2" checksum="$3"
  if [ ! -s "$destination" ]; then
    aria2c --continue=true --max-connection-per-server=4 --split=4 --min-split-size=16M --file-allocation=none --auto-file-renaming=false --max-tries=5 --retry-wait=5 --summary-interval=10 --console-log-level=warn --checksum=sha-256="$checksum" --dir="$(dirname "$destination")" --out="$(basename "$destination").part" "$url" 2>&1 | tr '\r' '\n'
    mv "$destination.part" "$destination"
  fi
}
if [ "$asr" = whisper ]; then
  echo "VOICE_STAGE: Downloading multilingual Whisper $asr_model"
  bash whisper/models/download-ggml-model.sh "$asr_model" /voice/models 2>&1 | tr '\r' '\n'
fi
# Chatterbox and Qwen3-ASR come from one pinned revision of the audio.cpp GGUF repository, checked against their SHA-256.
gguf=https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/6d5436fc85f7a20c2e9f4e472b7f3a532f686444
if [ "$asr" = qwen3-asr ]; then
  case "$asr_model" in
    0.6b) folder=Qwen3-ASR-0.6B-GGUF; checksum=6c44ec2fb4cee513892d7863c1fcc3ea6b699ffa4d899b0ef4ab19956d9544f7 ;;
    1.7b) folder=Qwen3-ASR-1.7B-GGUF; checksum=da4fc2ac7f24dee784d1684eb1f35836cdbf559519452ae11777670734c0a4f8 ;;
  esac
  echo "VOICE_STAGE: Downloading Qwen3-ASR $asr_model"
  download "$gguf/$folder/qwen3-asr-$asr_model-q8_0.gguf" "models/qwen3-asr-$asr_model-q8_0.gguf" "$checksum"
fi
if [ "$tts" = chatterbox ]; then
  echo 'VOICE_STAGE: Downloading Chatterbox Multilingual'
  download "$gguf/Chatterbox-GGUF/chatterbox-q8_0.gguf" models/chatterbox-q8_0.gguf d586dd1aa59613cab8046176fb7ca5ba191c02a9b10ffa5b0d892ed22b470656
fi
if [ "$tts" = breeze ] && [ ! -s models/breeze-q8_0.gguf ]; then
  echo 'VOICE_STAGE: Downloading full-precision Breeze-TTS-2'
  download "https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/056144d2744697c9439bd32647279674dba0c964/Breeze-TTS-2-GGUF/breeze-tts-2-bf16.gguf" models/breeze-bf16.gguf a00c9f678b4c5ae03d1dcd228f636b329352cda200823faef4e01d3bd97c0a89
  echo 'VOICE_STAGE: Quantizing Breeze to Q8_0 on CPU'
  audio/build/portal/bin/audiocpp_gguf --input models/breeze-bf16.gguf --output models/breeze-q8_0.partial.gguf --type q8_0 --overwrite
  audio/build/portal/bin/audiocpp_gguf --inspect models/breeze-q8_0.partial.gguf
  mv models/breeze-q8_0.partial.gguf models/breeze-q8_0.gguf
  rm models/breeze-bf16.gguf
fi
# The portal sends the config for the choice. Without it, only the original combination is known here.
if [ -n "${VOICE_SERVER_CONFIG:-}" ]; then
  printf '%s\n' "$VOICE_SERVER_CONFIG" > server.json
elif [ "$tts" = breeze ] && [ "$asr" = whisper ]; then
  cat > server.json <<'JSON'
{"host":"127.0.0.1","port":7862,"backend":"cuda","device":0,"threads":4,"lazy_load":true,"idle_unload_ms":90000,"ui_management":true,"max_loaded_models":1,"models":[{"id":"breeze","family":"breeze_tts","path":"/voice/models/breeze-q8_0.gguf","task":"tts","mode":"streaming","session_options":{"breeze_tts.reference_cache_slots":"1"}}]}
JSON
else
  echo 'VOICE_SETUP_ERROR: VOICE_SERVER_CONFIG is missing' >&2
  exit 2
fi
echo 'VOICE_STAGE: Starting speech services'
pids=()
if [ "$asr" = whisper ]; then
  whisper/build/bin/whisper-server --host 127.0.0.1 --port 8188 --model "/voice/models/ggml-$asr_model.bin" --language auto --threads 4 &
  pids+=($!)
fi
audio/build/portal/bin/audiocpp_server --config /voice/server.json &
pids+=($!)
trap 'kill "${pids[@]}" 2>/dev/null || true; wait; exit 0' TERM INT
set +e
wait -n "${pids[@]}"
code=$?
kill "${pids[@]}" 2>/dev/null
wait
exit "$code"
