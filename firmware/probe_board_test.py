"""Self-test for probe_board's protocol classifier — no hardware required.

The classifier decides whether OmniTwin may talk to a board at all, and a false
positive means parsing noise as flight commands. So it is tested against
synthetic frames of every protocol we support, plus the cases most likely to
fool it.

Run:  python probe_board_test.py
"""

import sys

from probe_board import (
    classify, looks_like_msp, msp_request, parse_msp,
    MSP_IDENT, MSP_FC_VARIANT,
)


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


MSP_GLOBAL: list = []


def check(label: str, ok: bool) -> None:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
    if not ok:
        MSP_GLOBAL.append(1)


def reply(cmd: int, payload: bytes = b"", *, size: int | None = None) -> bytes:
    """Build a reply the way a flight controller does: fixed 12-byte MSPv1 frame.

    Written INDEPENDENTLY of msp_request so the two cannot agree on a shared
    mistake. The earlier bug was a self-consistent encoder/decoder pair that was
    wrong in the same way twice, so agreeing with itself proved nothing.

    `size` defaults to the REAL byte count (payload + cmd) because that is what
    Betaflight actually sends in replies -- a short FC_VARIANT reports size=5,
    not 6. Passing size=6 explicitly reproduces the fixed-width request form.
    """
    real = len(payload) + 1 if size is None else size
    # size(2) + cmd(1) + payload slot(5) = 8 bytes of body, then the checksum.
    body = bytearray([real & 0xFF, real >> 8, cmd]) + payload
    body += b"\x00" * (8 - len(body))
    # Checksum spans size_lo, size_hi, cmd and all (size-1) payload bytes --
    # never the padding. That is exactly the FC's receive path: dataSize =
    # hdr->size, and MSP_PAYLOAD_V1 XORs each of those bytes as it arrives.
    ck = 0
    for b in body[:2] + body[2:real]:
        ck ^= b
    return bytes([0xAA, ord("M"), ord(">")]) + bytes(body) + bytes([ck])


def msp_cases() -> None:
    """Check the frame layout against Betaflight's fixed 9-byte MSPv1 format."""
    req = msp_request(MSP_IDENT)

    # 3 header + 2 size + 1 cmd + 5 payload + 1 checksum = 12 bytes.
    check("request is exactly 12 bytes", len(req) == 12)
    check("header is $AA 'M' '<'", req[:3] == b"\xaa\x4d\x3c")
    # The size field states the REAL length (cmd + payload); the 5-byte slot is
    # zero-padded to fixed width. Betaflight sets dataSize = hdr->size and
    # consumes exactly that many payload bytes, so padding is not checksummable.
    check("size field is the real length, 1 for a bare command", req[3] == 1 and req[4] == 0)
    check("command byte is in place", req[5] == MSP_IDENT)
    check("payload slot is zero-padded to fixed width", req[6:11] == b"\x00" * 5)

    ck = 0
    for b in req[3:6]:                 # size_lo, size_hi, cmd, then 0 payload bytes
        ck ^= b
    check("checksum excludes the zero padding", req[11] == ck)

    # A request carrying payload must checksum the payload but not the padding.
    req2 = msp_request(MSP_FC_VARIANT, b"SP")
    check("2-byte payload request is still 12 bytes", len(req2) == 12)
    check("2-byte payload sets size=3", req2[3] == 3)
    ck2 = 0
    for b in req2[3:5 + 3]:
        ck2 ^= b
    check("2-byte payload checksum covers payload, skips padding", req2[11] == ck2)

    got = parse_msp(reply(MSP_FC_VARIANT, b"SPH7"))
    check(f"parse FC_VARIANT -> {got}", got == [(MSP_FC_VARIANT, b"SPH7")])

    got = parse_msp(reply(MSP_IDENT, b"\x03\x04"))
    check(f"parse IDENT -> {got}", got == [(MSP_IDENT, b"\x03\x04")])

    # A corrupt checksum must be REJECTED: accepting bad frames is how a parser
    # starts decoding noise as flight data.
    bad = bytearray(reply(MSP_FC_VARIANT, b"SPH7"))
    bad[-1] ^= 0xFF
    check("reject a frame with a bad checksum", parse_msp(bytes(bad)) == [])

    check("boot chatter is not a frame", parse_msp(bytes([0xAA, 0x00, 0x00, 0xAA, 0xFF])) == [])

    stream = reply(MSP_IDENT, b"\x03\x04") + reply(MSP_FC_VARIANT, b"SPRF3")
    got = parse_msp(stream)
    check(f"parse two concatenated replies -> {len(got)}", len(got) == 2)

    try:
        msp_request(1, b"x" * 6)
        check("a 6-byte payload is rejected (MSPv2 territory)", False)
    except ValueError:
        check("a 6-byte payload is rejected (MSPv2 territory)", True)


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

    msp_cases()
    failures += len(MSP_GLOBAL)
    print()
    if failures:
        print(f"{failures} FAILED")
        return 1
    print("classifier + MSP codec: all cases correct")
    return 0


if __name__ == "__main__":
    sys.exit(main())
