"""Probe an unknown serial board and report what it is.

Two PHASES, and the distinction is the whole point:

  PASS 1 (passive)  -- listen only. Sends NOTHING. Identifies any board that
                       speaks unsolicited: our own firmware, MAVLink (heartbeat
                       every second), CRSF, NMEA.
  PASS 2 (greeting)-- only if pass 1 was silent, send the documented READ-ONLY
                       greeting for the protocols that are request/response.
                       Today that is MSP_IDENT on Betaflight/INAV/Cleanflight.

Why pass 2 exists: **MSP is request/response. A healthy flight controller says
absolutely nothing until it is asked.** An earlier version of this tool treated
a silent port as a fault and then ran `esptool` against an STM32F3 -- an ESP32
tool that could never have worked. Both errors came from assuming boards
volunteer their identity. They do not.

SAFETY. Pass 2 sends ONLY MSP_IDENT (command 1), which returns a version and
configures nothing. The spec's rule is "a client adapter may send documented read
commands; it must contain zero WRITE commands" -- because on a flight controller
a wrong write spins a motor, not just logs a bad reading. The ban is on
MSP_SET_*/MSP_DO_*/flash, not on all traffic. Use --no-greet to stay silent.

Usage:
    python probe_board.py COM3              # passive, then greet if silent
    python probe_board.py COM3 --no-greet   # passive only, writes nothing
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
    """Return (family, why) from passively observed bytes."""
    if not buf:
        return "silent", "nothing arrived unsolicited"

    if looks_like_omnitwin(buf):
        return "omnitwin", "ASCII JSON -- this is OmniTwin firmware"
    if looks_like_mavlink(buf):
        return "mavlink", "0xFE preamble repeated -- ArduPilot / PX4 / INAV"
    if looks_like_msp(buf):
        return "msp", "0xAA 'M'/< header repeated"
    if looks_like_crsf(buf):
        return "crsf", "crossfire sync frames -- an ELRS/CRSF radio, not a flight controller"
    if looks_like_nmea(buf):
        return "nmea", "ASCII $G/$P sentences -- a GPS module"
    return "unknown", "bytes arrived but match no known framing"


# ------------------------------------------------------- MSP (read-only) ---
MSP_IDENT = 1
MSP_API_VERSION = 1
MSP_FC_VARIANT = 2
MSP_BOARD_INFO = 4
MSP_BUILD_INFO = 115

# READ-ONLY ONLY. MSP_SET_*/MSP_DO_* and every flash path are deliberately absent
# from this file: on a flight controller a write can arm a motor, which is a
# different class of consequence from a bad log line.
MSP_READ_COMMANDS = {
    MSP_IDENT: "MSP_IDENT",
    MSP_API_VERSION: "MSP_API_VERSION",
    MSP_FC_VARIANT: "MSP_FC_VARIANT",
    MSP_BOARD_INFO: "MSP_BOARD_INFO",
    MSP_BUILD_INFO: "MSP_BUILD_INFO",
}


def msp_request(cmd: int, payload: bytes = b"") -> bytes:
    """Build an outbound MSPv1 frame.

    Fixed 12 bytes on the wire, inherited from MultiWii:

        $AA 'M' '<' size_lo size_hi cmd payload[5] checksum

    Two details matter and both were wrong in the first version, which made a
    healthy Betaflight board answer nothing at all:

    - The size field states the REAL length (cmd + payload). The payload slot is
      zero-padded to fixed width, but the padding is not part of the protocol.
    - The checksum is XOR over size_lo, size_hi, cmd and exactly `size` payload
      bytes -- NOT the padding. Betaflight's receive path sets
      `dataSize = hdr->size` and consumes/XORs only that many payload bytes
      (src/main/msp/msp_serial.c, MSP_HEADER_V1 -> MSP_PAYLOAD_V1).
    """
    if len(payload) > 5:
        raise ValueError("MSPv1 payload is at most 5 bytes; use MSPv2 for more")
    size = 1 + len(payload)
    frame = bytearray([0xAA, ord("M"), ord("<"), size & 0xFF, size >> 8, cmd])
    frame.extend(payload)
    # Fixed 12-byte on the wire, but the size field is the REAL length. The
    # padding exists to fill the slot and is NOT covered by the checksum:
    # betaflight's receive path sets dataSize = hdr->size and XORs exactly that
    # many payload bytes (msp_serial.c, MSP_HEADER_V1 -> MSP_PAYLOAD_V1).
    frame.extend(b"\x00" * (5 - len(payload)))
    ck = 0
    for b in frame[3:5 + size]:
        ck ^= b
    frame.append(ck)
    return bytes(frame)


def parse_msp(buf: bytes) -> list[tuple[int, bytes]]:
    """Pull (command, payload) out of inbound MSPv1 frames, verifying the XOR.

    The size field states how many bytes are real; the rest of the 5-byte slot
    is padding and is stripped so string replies come back clean. Scanning
    advances one byte at a time rather than skipping past a frame, because
    boot chatter and real frames share the stream.
    """
    out = []
    for i in range(len(buf) - 5):
        if buf[i] != 0xAA or buf[i + 1] != ord("M") or buf[i + 2] != ord(">"):
            continue
        size = buf[i + 3] | (buf[i + 4] << 8)
        if not 1 <= size <= 6:
            continue
        end = i + 5 + size
        if end >= len(buf):
            continue
        ck = 0
        for b in buf[i + 3:end]:
            ck ^= b
        if ck != buf[end]:
            continue
        out.append((buf[i + 5], buf[i + 6:end].rstrip(b"\x00")))
    return out


def msp_greet(s) -> bytes:
    """Ask the documented read-only questions. Writes only IDENT-family reads."""
    replies = b""
    for cmd, name in MSP_READ_COMMANDS.items():
        s.reset_input_buffer()
        s.write(msp_request(cmd))
        s.flush()
        end = time.time() + 0.6
        while time.time() < end:
            chunk = s.read(512)
            if chunk:
                replies += chunk
                if len(replies) > 2:
                    time.sleep(0.05)
                    replies += s.read(512)
                    break
        time.sleep(0.05)
    return replies


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


def describe_msp(replies: bytes) -> None:
    for cmd, payload in parse_msp(replies):
        name = MSP_READ_COMMANDS.get(cmd, f"cmd {cmd}")
        shown = payload[:64]
        text = shown.decode("utf-8", "replace").rstrip("\x00")
        printable = sum(c.isprintable() or c == "\x00" for c in text)
        if text and printable / max(len(text), 1) > 0.85:
            print(f"    {name:<16} -> {text!r}")
        else:
            print(f"    {name:<16} -> {shown.hex(' ')}")


def probe(port: str, greet: bool = True) -> int:
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
    # rather than one we just restarted.
    try:
        s.dtr = False
        s.rts = False
    except Exception:
        pass

    print(f"opened {port} @ {BAUD}")
    print(f"pass 1: listening {PROBE_SECONDS:.0f}s, sending NOTHING\n")

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

    print(f"received {len(buf)} bytes")
    if buf:
        print(hexdump(buf))

    family, why = classify(buf)

    # Pass 2. A silent port is ambiguous: it can be a healthy request/response
    # board (MSP says nothing until asked) or simply a board that is off. Greet
    # it with the documented read-only commands and let the answer disambiguate.
    greeted = b""
    if greet and family in ("silent", "unknown"):
        print("\npass 2: silent, so sending the read-only MSP greeting")
        print("        (MSP_IDENT/FC_VARIANT/BOARD_INFO/BUILD_INFO -- no writes)")
        try:
            greeted = msp_greet(s)
        except Exception as exc:
            print(f"        greeting failed: {exc}")
        if greeted:
            print(f"        received {len(greeted)} bytes")
            print(hexdump(greeted))
        else:
            print("        still nothing")

    s.close()

    if greeted:
        family, why = "msp", "answered a read-only MSP request"
    print(f"\n==> {family.upper()}: {why}")

    if greeted:
        print("\nread-only replies:")
        describe_msp(greeted)

    if family == "omnitwin":
        print("\n    run the dashboard and Connect -- this board is already ours.")
    elif family == "msp":
        print("\n    client transport: documented reads only. No MSP_SET_*, no")
        print("    flash, ever -- a wrong write here spins a motor.")
        print("    channels it does not volunteer read as 'not reporting'.")
    elif family in ("mavlink", "crsf", "nmea"):
        print("\n    client transport: read what it volunteers, never write.")
    elif family == "silent":
        print("\n    still silent after the greeting. Likely: the board is powered")
        print("    down, in its bootloader, or the cable carries no data.")
        print("    If Cleanflight Configurator works on this port, tell me -- that")
        print("    would mean it needs a different greeting or a baud change.")
    else:
        print("\n    bring the silkscreen text and the LED pattern.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port", nargs="?", help="e.g. COM3")
    ap.add_argument("--list", action="store_true", help="list serial ports and exit")
    ap.add_argument("--no-greet", action="store_true",
                    help="passive only: never send anything, not even MSP_IDENT")
    args = ap.parse_args()

    if args.list or not args.port:
        return list_ports()
    return probe(args.port, greet=not args.no_greet)


if __name__ == "__main__":
    sys.exit(main())
