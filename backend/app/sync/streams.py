import json
import zlib

STREAM_COLUMNS = ("t", "fc", "altitude", "speed", "distance", "cadence")


def encode_stream(samples: dict[str, list[float | None]]) -> bytes:
    lengths = {len(v) for v in samples.values()}
    if len(lengths) > 1:
        raise ValueError("colonnes d'échantillons de longueurs différentes")
    return zlib.compress(json.dumps(samples, separators=(",", ":")).encode())


def decode_stream(blob: bytes) -> dict[str, list[float | None]]:
    data: dict[str, list[float | None]] = json.loads(zlib.decompress(blob))
    return data
