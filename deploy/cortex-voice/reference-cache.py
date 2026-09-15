"""Content-keyed reference cache for the installed Breeze runtime (CPU tensors only)."""
from functools import lru_cache
from io import BytesIO
from pathlib import Path
from .audio import encode_prompt_audio


@lru_cache(maxsize=8)
def _encode(audio_tokenizer, payload: bytes):
    return encode_prompt_audio(audio_tokenizer, BytesIO(payload))


def encode_cached_reference(audio_tokenizer, audio_path):
    # Upload paths change every request, but reference audio usually does not.
    # Clone the cached tensor so callers cannot mutate a later request's input.
    return _encode(audio_tokenizer, Path(audio_path).read_bytes()).clone()
