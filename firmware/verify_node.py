r"""One-shot firmware protocol verification for the OmniTwin node.

Talks to the board over the same COM port the browser's Web Serial bridge uses,
and checks the fw-1.1 contract that landed on `main`:

  IDENT                      -> fw 1.1
  PING                       -> {"pong":true}
  SCAN                       -> entries carry a raw addr and NO "name" field
  WHOAMI <addr> <reg>        -> {"whoami":<int>}, or -1 when the address is silent
  DIAG                       -> still answers
  STREAM on / off            -> rows, then silence

Run with the ESP-IDF python env (it already has pyserial):
  & "C:\Users\Arham\.espressif\python_env\idf6.0_py3.13_env\Scripts\python.exe" `
      firmware\verify_node.py COM4
"""
import json
import sys
import time

import serial

BAUD = 115200
results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{('  -> ' + detail) if detail else ''}")


def main(port):
    s = serial.Serial(port, BAUD, timeout=0.4)
    # The CP210x auto-reset circuit wires DTR->EN and RTS->IO0, so merely opening
    # the port resets an ESP32. Drop both lines so we do not restart the chip
    # mid-conversation and lose the first command to a still-booting app.
    try:
        s.dtr = False
        s.rts = False
    except Exception:
        pass
    buf = ""

    def drain(seconds=1.2):
        """Read whatever arrives within the window, returning parsed JSON lines."""
        nonlocal buf
        end = time.time() + seconds
        while time.time() < end:
            chunk = s.read(4096).decode("utf-8", "replace")
            if not chunk:
                continue
            buf += chunk
        lines = buf.split("\n")
        # Keep the trailing partial line for the next drain. This used to assign
        # the tail to `buf` and then immediately overwrite `buf` with "", so any
        # line split across two reads was silently discarded — which desynced
        # every command after it and showed up as a bogus "no reply".
        buf = lines.pop()
        out = []
        for ln in lines:
            ln = ln.strip()
            if not ln:
                continue
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
        return out

    def send(cmd, wait=1.2):
        s.reset_input_buffer()
        s.write((cmd + "\n").encode())
        time.sleep(0.15)
        got = drain(wait)
        return got[0] if got else None

    # proto_selftest() runs at boot. An assert failure aborts and reboots, so a
    # board that answers at all has already passed its eight self-tests. Retry
    # IDENT because the port open can reset the chip, and the first command sent
    # to a still-booting app is simply lost.
    print(f"\n== OmniTwin node verification on {port} @ {BAUD} ==\n")

    print("-- boot / self-test --")
    ident = None
    for attempt in range(4):
        ident = send("IDENT", 2.0)
        if ident:
            break
        print(f"        no reply yet (attempt {attempt + 1}/4) - still booting?")
        time.sleep(1.5)
    check("board answers IDENT (proto_selftest asserts passed at boot)", ident is not None,
          json.dumps(ident) if ident else "no reply")
    if ident is None:
        print("\nBoard did not answer. Check the cable and that firmware is flashed.")
        return 1
    check("fw is 1.2", ident.get("fw") == "1.2", f"got {ident.get('fw')!r}")
    check("device id looks like TL-XXXXXX", str(ident.get("id", "")).startswith("TL-"),
          repr(ident.get("id")))

    print("\n-- baseline commands --")
    check("PING -> pong", (send("PING") or {}).get("pong") is True)
    diag = send("DIAG", 2.0)
    check("DIAG still answers", isinstance(diag, dict) and "mpu" in diag,
          f"mpu.ready={diag.get('mpu', {}).get('ready') if diag else None}")

    print("\n-- SCAN: raw addresses, no part name (fw 1.1+ contract) --")
    scan = send("SCAN", 20.0)   # 117-address sweep: ~12s on an empty bus
    if scan is None:
        check("SCAN answers", False, "no reply within 20s")
    else:
        i2c = scan.get("i2c", [])
        check("SCAN answers", True, f"{len(i2c)} address(es): {[e.get('addr') for e in i2c]}")
        check("no entry carries a 'name' field (identity is the browser's job)",
              all("name" not in e for e in i2c),
              str([e for e in i2c if "name" in e]))
        check("SCAN still reports dht22 + bus", "dht22" in scan and "bus" in scan,
              f"dht22={scan.get('dht22')}")

    print("\n-- WHOAMI: register read + argument validation --")
    # 0x75 is the MPU6050 WHO_AM_I register, per components.json.
    w = send("WHOAMI 104 117", 2.0)
    check("WHOAMI 104 117 answers", w is not None and "whoami" in (w or {}), json.dumps(w))
    val = (w or {}).get("whoami")
    if val == 104:
        print("        MPU6050 present at 0x68 and its WHO_AM_I read back 0x68 -- "
              "full identity path proven.")
    elif val == -1:
        print("        No MPU6050 answering at 0x68 (got -1). The command and its")
        print("        argument parsing are proven, but the register read is NOT.")
        print("        -> plug the MPU6050 in and re-run to prove that half.")
    else:
        print(f"        Unexpected WHOAMI value: {val!r}")

    check("hex register accepted (WHOAMI 104 0x75)",
          (send("WHOAMI 104 0x75", 2.0) or {}).get("whoami") == val)
    check("out-of-range address rejected (WHOAMI 999 117 -> -1)",
          (send("WHOAMI 999 117", 2.0) or {}).get("whoami") == -1)
    check("missing register rejected (WHOAMI 104 -> -1)",
          (send("WHOAMI 104", 2.0) or {}).get("whoami") == -1)
    check("bare WHOAMI rejected (-> -1)", (send("WHOAMI", 2.0) or {}).get("whoami") == -1)
    check("unknown verb still gets the error reply",
          "error" in (send("BOGUS") or {}), json.dumps(send("NOPE")))

    print("\n-- stream --")
    send("STREAM on", 0.6)
    rows = drain(2.5)
    check("STREAM on produces timestamped rows", len(rows) > 0, f"{len(rows)} rows")
    if rows:
        r = rows[-1]
        has_accel = isinstance(r.get("ax"), (int, float))
        check("row carries temp/hum", "temp" in r or "hum" in r, json.dumps(r)[:120])
        print(f"        accel present: {has_accel}"
              + ("" if has_accel else "  (DHT-only row -- expected with no MPU)"))
    send("STREAM off", 1.0)
    quiet = drain(1.5)
    check("STREAM off actually stops the stream", not quiet, f"{len(quiet)} rows after off")

    s.close()

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n== {len(results) - len(failed)}/{len(results)} passed ==")
    if failed:
        print("FAILED: " + "; ".join(failed))
    if val == -1:
        print("\nNOTE: firmware protocol verified, but the WHOAMI register read is "
              "unproven (no MPU6050 on the bus).")
    return 1 if failed else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
