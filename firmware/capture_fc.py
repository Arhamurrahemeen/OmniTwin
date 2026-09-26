"""Capture a flight controller's raw replies so we stop guessing at the framing.

WHY THIS EXISTS. probe_board.py's MSP greeting got no answer from a perfectly
healthy SP Racing F3, and the self-test could not settle the frame layout
because the fixture and the parser disagreed in the same way. Guessing at
byte offsets is what caused that; this tool records what the board actually
sends, to a file, so the parser can be written against real traffic.

Read-only. Sends documented MSP read commands only -- no MSP_SET_*, no MSP_DO_*,
no flash. Run it with the props OFF: nothing here should spin a motor, but a
board that is armed will still react to its own sensors.

    python capture_fc.py COM3            # sweep, log to fc_capture.log
    python capture_fc.py COM3 --baud 115200 --lines idle
"""

import argparse
import sys
import time

import serial

# Documented READ-ONLY commands. Everything writable is deliberately absent.
READS = [
    (1, "MSP_IDENT"),
    (2, "MSP_FC_VARIANT"),
    (4, "MSP_BOARD_INFO"),
    (101, "MSP_STATUS"),
    (102, "MSP_SENSOR"),
    (103, "MSP_RC"),
    (115, "MSP_BUILD_INFO"),
    (116, "MSP_BOXNAMES"),
]

MSP_V2_FRAME_ID = 255


def frame_v1(cmd: int, payload: bytes = b"") -> bytes:
    """Fixed 12-byte MSPv1: $AA M < size_lo size_hi cmd payload[5] checksum."""
    size = 1 + len(payload)
    f = bytearray([0xAA, ord("M"), ord("<"), size & 0xFF, size >> 8, cmd])
    f += payload
    f += b"\x00" * (5 - len(payload))
    ck = 0
    for b in f[3:5 + size]:
        ck ^= b
    f.append(ck)
    return bytes(f)


def frame_v2(cmd: int) -> bytes:
    """MSPv2 native: $AA X < flag checksum cmd_lo cmd_hi payload[5] checksum."""
    payload = bytes([cmd & 0xFF, (cmd >> 8) & 0xFF])
    f = bytearray([0xAA, ord("X"), ord("<"), 0])
    f += payload
    f += b"\x00" * (5 - len(payload))
    ck = 0
    for b in f[3:]:
        ck ^= b
    f.append(ck)
    return bytes(f)


def hexs(b: bytes) -> str:
    return " ".join(f"{x:02x}" for x in b)


def sweep(s, baud: int, dtr: bool, rts: bool, log) -> int:
    total = 0
    for cmd, name in READS:
        for label, fr in (("v1", frame_v1(cmd)), ("v2", frame_v2(cmd))):
            try:
                s.reset_input_buffer()
                s.write(fr)
                s.flush()
            except Exception as exc:
                log(f"    {name:<16} {label}  WRITE FAILED: {exc}")
                continue
            deadline = time.time() + 0.45
            got = b""
            while time.time() < deadline:
                try:
                    chunk = s.read(256)
                except Exception:
                    break
                if chunk:
                    got += chunk
                    time.sleep(0.04)
                    try:
                        got += s.read(256)
                    except Exception:
                        pass
                    if got:
                        break
            if got:
                total += len(got)
                log(f"    {name:<16} {label}  <- {len(got):3d}B  {hexs(got[:40])}")
            else:
                log(f"    {name:<16} {label}  -> (no reply)")
    return total


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("port")
    ap.add_argument("--baud", type=int, default=115200)
    ap.add_argument("--out", default="fc_capture.log")
    args = ap.parse_args()

    lines = []
    def log(msg=""):
        print(msg)
        lines.append(msg)

    log(f"# OmniTwin FC capture  port={args.port}  {time.strftime('%Y-%m-%d %H:%M:%S')}")
    log(f"# READ-ONLY sweep: MSP v1 + v2 identifier commands only. No writes, no flash.")
    log()

    bauds = [args.baud, 420000, 115200, 57600]
    line_states = [(False, False), (True, False), (False, True), (True, True)]
    grand = 0

    for baud in dict.fromkeys(bauds):
        for dtr, rts in line_states:
            try:
                s = serial.Serial(args.port, baud, timeout=0.15)
            except Exception as exc:
                log(f"!! cannot open {args.port}: {exc}")
                log("!! If Configurator has it open, close it -- ports are exclusive.")
                return 2
            try:
                s.dtr, s.rts = dtr, rts
                time.sleep(0.25)
                s.reset_input_buffer()

                # Passive window first: MAVLink/NMEA-style boards talk unbidden.
                time.sleep(0.6)
                idle = s.read(1024)

                log(f"== baud={baud} DTR={int(dtr)} RTS={int(rts)} ==")
                if idle:
                    log(f"    idle            <- {len(idle):3d}B  {hexs(idle[:40])}")
                else:
                    log("    idle            -> (silent)")
                n = sweep(s, baud, dtr, rts, log)
                grand += n + len(idle)
            finally:
                s.close()
            log()

    log(f"# total bytes captured: {grand}")
    if grand == 0:
        log("#")
        log("# NOTHING AT ALL. On a healthy Betaflight board that means one of:")
        log("#   - the board is in its BOOTLOADER (DFU), not running firmware")
        log("#   - it is powered from the USB port's 5V but its 3V3 rail is dead")
        log("#   - the CP210x is enumerating while the STM32 is held in reset")
        log("#     (some boards need BOOT held while RESET is tapped)")
        log("#   - the cable carries power but not data")
        log("# Confirm Configurator still connects on THIS port right now. If it does,")
        log("# the difference is in the line states or the baud, and the sweep above")
        log("# should have found it -- so re-run with Configurator fully closed.")

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
    print(f"\nwrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
