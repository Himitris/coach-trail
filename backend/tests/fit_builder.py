"""Encodeur FIT minimal (tests) : en-tête, définitions, messages `record` et `session`, CRC."""

import struct
from datetime import UTC, datetime
from typing import Any

FIT_EPOCH = datetime(1989, 12, 31, tzinfo=UTC)
CRC_TABLE = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
             0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400]  # fmt: skip
ENUM, UINT8, UINT16, UINT32, SINT32 = 0x00, 0x02, 0x84, 0x86, 0x85
SIZES = {ENUM: 1, UINT8: 1, UINT16: 2, UINT32: 4, SINT32: 4}
FORMATS = {ENUM: "<B", UINT8: "<B", UINT16: "<H", UINT32: "<I", SINT32: "<i"}


def crc16(data: bytes, crc: int = 0) -> int:
    for byte in data:
        tmp = CRC_TABLE[crc & 0xF]
        crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ CRC_TABLE[byte & 0xF]
        tmp = CRC_TABLE[crc & 0xF]
        crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xF]
    return crc


def fit_time(dt: datetime) -> int:
    return int((dt - FIT_EPOCH).total_seconds())


# (numéro de champ, type de base)
RECORD_FIELDS = [
    (253, UINT32),
    (0, SINT32),
    (1, SINT32),
    (5, UINT32),
    (2, UINT16),
    (3, UINT8),
    (4, UINT8),
    (6, UINT16),
]  # fmt: skip  timestamp, lat, long, distance, altitude, hr, cadence, speed
SESSION_FIELDS = [(253, UINT32), (2, UINT32), (7, UINT32), (8, UINT32), (9, UINT32), (22, UINT16),
                  (23, UINT16), (5, ENUM), (6, ENUM), (16, UINT8), (17, UINT8), (11, UINT16)]  # fmt: skip


def _definition(local: int, global_num: int, fields: list[tuple[int, int]]) -> bytes:
    body = struct.pack("<BBBHB", 0x40 | local, 0, 0, global_num, len(fields))
    for num, base in fields:
        body += struct.pack("<BBB", num, SIZES[base], base)
    return body


def _data(local: int, fields: list[tuple[int, int]], values: list[int]) -> bytes:
    out = struct.pack("<B", local)
    for (_, base), value in zip(fields, values, strict=True):
        out += struct.pack(FORMATS[base], value)
    return out


def build_fit(
    start: datetime,
    seconds: int = 1200,
    *,
    sport: int = 1,
    sub_sport: int = 3,
    session: bool = True,
    records: bool = True,
    hr: tuple[int, int] = (130, 170),
    speed_ms: float = 2.5,
    climb_m: float = 100.0,
    **session_over: Any,
) -> bytes:
    """Séance synthétique : vitesse constante, montée linéaire de `climb_m`, FC en deux paliers."""
    body = b""
    if records:
        body += _definition(0, 20, RECORD_FIELDS)
        for i in range(seconds):
            alt = 100 + climb_m * i / seconds
            body += _data(
                0, RECORD_FIELDS,
                [
                    fit_time(start) + i, int(45.0 / (180 / 2**31)), int(6.0 / (180 / 2**31)),
                    int(speed_ms * i * 100), int((alt + 500) * 5), hr[0] if i < seconds // 2 else hr[1],
                    80, int(speed_ms * 1000),
                ],
            )  # fmt: skip
    if session:
        body += _definition(1, 18, SESSION_FIELDS)
        values = {
            "start": fit_time(start), "elapsed": seconds * 1000 + 5000, "timer": seconds * 1000,
            "distance": int(speed_ms * seconds * 100), "ascent": int(climb_m), "descent": 0,
            "sport": sport, "sub_sport": sub_sport, "avg_hr": 150, "max_hr": hr[1], "calories": 300,
        }  # fmt: skip
        values.update(session_over)
        body += _data(
            1, SESSION_FIELDS,
            [fit_time(start), values["start"], values["elapsed"], values["timer"], values["distance"],
             values["ascent"], values["descent"], values["sport"], values["sub_sport"],
             values["avg_hr"], values["max_hr"], values["calories"]],
        )  # fmt: skip
    header = struct.pack("<BBHI4s", 14, 0x20, 2132, len(body), b".FIT")
    header += struct.pack("<H", crc16(header))
    payload = header + body
    return payload + struct.pack("<H", crc16(payload))
