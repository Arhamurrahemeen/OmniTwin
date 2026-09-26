"""Probe an unknown serial board and report what it is — read-only.

Exists because "what is this board?" is a question we could not answer, and the
answer determines which adapter OmniTwin needs. Written to be READ-ONLY and
INERT: it never writes a command, it only listens, because a wrong write on a
flight controller can spin a motor (see the spec's safety rule).

Identification is by what the board volunteers, in order:

  1. silent            - answers nothing; the port opens but no protocol
  2. omnitwin          - our own firmware: ASCII JSON lines starting with '{'
  3. mavlink           - 0xFE preamble, little-endian length, ASCII payload
  4. msp               - 0xAA 'M' '<' length, little-endian, little-endian
                          checksum XOR
  5. crsf              - binary frame 0xC8 (type + CRC8), sync 0xC8
  6. nmea              - ASCII lines starting with '$' and ending in CRLF

MSP is checked BEFORE the generic "talk and see" step: a lone 0xAA byte could
also be boot chatter, so we require the 3-byte header to repeat.

Usage:
    python probe_board.py <COMx>          # e.g. COM3
    python probe_board.py --list
"""

import argparse
import sys
import time

try:
    import serial
    import serial.tools.list_ports  # submodule: not auto-loaded by `import serial`
except ImportError:
    sys.exit("needs pyserial: pip install pyserial")

BAUD = 115200
PROBE_SECONDS = 3.0


# ---------------------------------------------------------------- framing ---
def looks_like_omnitwin(chunk: bytes) -> bool:
    return b"{" in chunk and b'"' in chunk


def looks_like_mavlink(chunk: bytes) -> bool:
    return chunk.count(b"\xfe") >= 2


def looks_like_msp(buf: bytes) -> bool:
    """MSP: $AA 'M' < direction, little-endian len, payload, xor checksum.

    The 3-byte header must repeat. A single 0xAA is far too weak a signal --
    boot banners and bootloaders emit arbitrary bytes, and a false positive
    here would mean we start parsing noise as flight commands.
    """
    hits = 0
    for i in range(len(buf) - 3):
        if buf[i] == 0xAA and buf[i + 1] in (ord("M"), ord(">")):
            payload_len = buf[i + 2] | (buf[i + 3] << 8)
            if 1 <= payload_len <= 256 and i + 5 + payload_len < len(buf):
                hits += 1
                i += 4 + payload_len
    return hits >= 2


def looks_like_crsf(buf: bytes) -> bool:
    """CRSF frames: <sync|type> <len> <payload...> <crc8> 0xEE.

    The terminator sits at length+1, NOT at a fixed offset -- indexing it
    positionally is what made a valid stream classify as unknown.
    """
    hits = 0
    for i in range(len(buf) - 4):
        if buf[i] & 0x0F != 0x08:
            continue
        # `total` counts type + payload + crc8 and EXCLUDES the sync byte, so the
        # 0xEE terminator is the last byte of the frame: i + total - 1. Verified
        # against a synthetic frame -- i + total and i + total + 1 both land on
        # the next frame's sync byte, which is why the check kept failing.
        total = buf[i + 1]
        term = i + total - 1
        if 3 <= total <= 64 and 0 <= term < len(buf) and buf[term] == 0xEE:
            hits += 1
    return hits >= 3


def looks_like_nmea(chunk: bytes) -> bool:
    return b"$G" in chunk or b"$P" in chunk


# ------------------------------------------------------------- reporting ---
def hexdump(chunk: bytes, limit: int = 48) -> str:
    head = chunk[:limit]
    hexpart = " ".join(f"{b:02x}" for b in head)
    asciipart = "".join(chr(b) if 32 <= b < 127 else "." for b in head)
    suffix = " ..." if len(chunk) > limit else ""
    return f"  hex: {hexpart}{suffix}\n  asc: {asciipart}{suffix}"


def classify(buf: bytes) -> tuple[str, str]:
    """Return (family, confidence) without ever writing to the board."""
    if not buf:
        return "silent", "port opened, nothing arrived"

    if looks_like_omnitwin(buf):
        return "omnitwin", "ASCII JSON -- this is OmniTwin firmware"
    if looks_like_mavlink(buf):
        return "mavlink", "0xFE preamble repeated -- ArduPilot / PX4 / INAV"
    if looks_like_msp(buf):
        return "msp", "0xAA 'M'/< header repeated -- Betaflight / INAV / Multistab"
    if looks_like_crsf(buf):
        return "crsf", "crossfire sync frames -- an ELRS/CRSF radio, not a flight controller"
    if looks_like_nmea(buf):
        return "nmea", "ASCII $G/$P sentences -- a GPS module"
    return "unknown", "bytes arrived but match no known framing"


def list_ports() -> int:
    ports = sorted(serial.tools.list_ports.comports(), key=lambda p: p.device)
    if not ports:
        print("pyserial sees no serial ports.")
        print("\nOn Windows that is often a STALE enumeration rather than a missing")
        print("board: Device Manager can list a port that has no live device behind")
        print("it, and HKLM\\HARDWARE\\DEVICEMAP\\SERIALCOMM comes back empty. The")
        print("giveaway is a device whose Status reads 'Unknown'. Unplug the board,")
        print("plug it back in, or run the probe as administrator.")
        return 1
    print(f"{'port':<8} {'vid:pid':<10} description")
    for p in ports:
        vid = f"{p.vid:04x}" if p.vid else "----"
        pid = f"{p.pid:04x}" if p.pid else "----"
        print(f"{p.device:<8} {vid}:{pid:<6} {p.description}")
    return 0


def open_port(port: str):
    """Open a port, falling back to a device number if the name does not resolve.

    Windows keeps a stale COM entry alive after an unplug, so `COM3` can fail
    with FileNotFoundError while the device-namespace spelling still opens.
    Try both rather than reporting a dead board.
    """
    attempts = [port, f"\\\\.\\{port}"]
    seen, last = set(), None
    for cand in attempts:
        if not cand or cand in seen:
            continue
        seen.add(cand)
        try:
            return serial.Serial(cand, BAUD, timeout=0.2)
        except Exception as exc:
            last = exc
    raise last if last else RuntimeError("no candidate port name")


def probe(port: str) -> int:
    try:
        s = open_port(port)
    except Exception as exc:
        print(f"cannot open {port}: {exc}")
        print("\nThree things to check, in order:")
        print("  1. is the board actually plugged in and powered?")
        print("  2. is the port held by a browser tab using Web Serial? Chrome")
        print("     keeps exclusive access -- close the dashboard tab and retry.")
        print("  3. stale Windows enumeration? Unplug/replug, or run as admin.")
        return 1

    # The CP210x auto-reset circuit ties DTR->EN and RTS->IO0, so merely opening
    # the port resets an ESP32. Drop both lines so we observe a running board
    # rather than a board we just restarted.
    try:
        s.dtr = False
        s.rts = False
    except Exception:
        pass

    print(f"opened {port} @ {BAUD} (read-only, nothing written)")
    print(f"listening {PROBE_SECONDS:.0f}s for anything the board volunteers...\n")

    buf = b""
    end = time.time() + PROBE_SECONDS
    while time.time() < end:
        try:
            chunk = s.read(4096)
        except Exception as exc:
            print(f"read failed: {exc}")
            break
        if chunk:
            buf += chunk
    s.close()

    print(f"received {len(buf)} bytes")
    if buf:
        print(hexdump(buf))

    family, why = classify(buf)
    print(f"\n==> {family.upper()}: {why}")

    if family == "omnitwin":
        print("    run the dashboard and Connect -- this board is already ours.")
    elif family in ("msp", "mavlink", "crsf", "nmea"):
        print("    client transport: read what it volunteers, never write, never flash.")
        print("    whatever sensors the board does not report will read as")
        print("    'not reporting' rather than as a phantom value.")
    elif family == "silent":
        print("    try a reset button, or a second listen -- some boards stay")
        print("    quiet until they receive something, which this probe will not do.")
    else:
        print("    bring the silkscreen text and the LED pattern; those usually")
        print("    identify the board faster than the bytes do.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", help="e.g. COM3")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    args = ap.parse_args()

    if args.list or not args.port:
        return list_ports()
    return probe(args.port)


if __name__ == "__main__":
    sys.exit(main())
