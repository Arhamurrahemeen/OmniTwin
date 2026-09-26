"""Self-test for probe_board's protocol classifier — no hardware required.

The classifier decides whether OmniTwin may talk to a board at all, and a false
positive means parsing noise as flight commands. So it is tested against
synthetic frames of every protocol we support, plus the cases most likely to
fool it.

Run:  python probe_board_test.py
"""

import sys

from probe_board import classify, looks_like_msp


def msp_frame(cmd: bytes, payload: bytes = b"\x01\x02\x03") -> bytes:
    """MSP inbound frame: $AA '>' <len_lo> <len_hi> payload... <xor checksum>."""
    body = cmd + payload
    ck = 0
    for b in body:
        ck ^= b
    return bytes([0xAA, ord(">"), len(body), 0]) + body + bytes([ck])


def mav_frame(seq: int) -> bytes:
    """MAVLink v1: STX len_lo len_hi seq(4) sysid compid msgid payload crc(2)."""
    payload = b"\x09" + seq.to_bytes(4, "little")
    return b"\xfe" + bytes([len(payload), 0]) + payload + b"\x50\x37"


CASES = [
    # our own firmware: ASCII JSON lines
    ("omnitwin", b'{"ts":1,"temp":25.1,"ax":0.01}\n'),
    ("omnitwin", b'{"device":"ESP32","fw":"1.2","board":"twinlab-node","id":"TL-A1B2C3"}\n'),
    # MSP needs a REPEATING 3-byte header, or boot chatter false-positives
    ("msp", msp_frame(b"M") + msp_frame(b"X") + msp_frame(b"I")),
    # MAVLink
    ("mavlink", mav_frame(1) + mav_frame(2) + mav_frame(3)),
    # CRSF: sync/type, TOTAL length, payload..., crc8, 0xEE.
    # length counts the whole frame, so a 5-byte frame declares 5.
    ("crsf", bytes([0xC8, 0x05, 0x01, 0xAB, 0xEE]) * 3),
    # NMEA sentences
    ("nmea", b"$GPRMC,123519,A,4807.038,N*32\r\n"),
    # a lone 0xAA must NOT be MSP -- this is the boot-chatter trap
    ("unknown", bytes([0xAA, 0x00, 0x00, 0xAA, 0xFF])),
    # ESP32 ROM bootloader output
    ("unknown", b"\xe0\x00\x02\x00\x00\x00\x00\x00\x0a\x00\xd0\x00"),
    ("silent", b""),
]


def main() -> int:
    failures = 0

    for want, data in CASES:
        got, why = classify(data)
        ok = got == want
        failures += 0 if ok else 1
        label = repr(data[:34])
        print(f"  {'ok  ' if ok else 'FAIL'}  {want:<9} -> {got:<9} {label}")

    # The single most important assertion: one 0xAA is not an MSP frame.
    if looks_like_msp(bytes([0xAA, 0x00, 0x00, 0xAA, 0xFF])):
        print("  FAIL  a lone 0xAA must not classify as MSP")
        failures += 1
    else:
        print("  ok    a lone 0xAA does not classify as MSP")

    # An idle board that says nothing is 'silent', never 'unknown'.
    got, _ = classify(b"")
    if got != "silent":
        print(f"  FAIL  empty read should be 'silent', got {got!r}")
        failures += 1
    else:
        print("  ok    empty read is 'silent'")

    print()
    if failures:
        print(f"{failures} FAILED")
        return 1
    print("classifier: all cases correct")
    return 0


if __name__ == "__main__":
    sys.exit(main())
