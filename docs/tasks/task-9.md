# Task 9 — Firmware bring-up: build validation (DONE — flash/verify deferred)

## Intent
Prove the copied `twinlab_node_v1` ESP32 firmware still compiles. Physical bring-up deferred to you — no kit is plugged in (no COM ports), services aren't installed, and Wi-Fi credentials are yours.

## Done
- `secrets.h` created from `secrets.h.example` (placeholder creds — fine for compile; gitignored, confirmed).
- ESP-IDF v6.0.2 build succeeded: app `build/twinlab_node_v1.bin` = 819,200 B (22% partition free), bootloader 26,096 B. One transient first-run FAILED on `lmots.c.obj`; clean on rerun (IDF cold-build flake, not a source issue).
- Zero firmware source changes → clean tree, no commit.

## Expect
- The copied firmware is build-valid. Nothing runs until you do the real bring-up.

## What you do later (pilot bring-up, needs kit + services + creds)
1. Edit `firmware/twinlab_node_v1/main/secrets.h` (untracked): real `WIFI_SSID`, `WIFI_PASSWORD`, `MQTT_HOST` = **laptop LAN IP** from `ipconfig` (never localhost).
2. Flash: `cd D:\OmniTwin\firmware\twinlab_node_v1; idf.py -p COM<x> flash monitor` (activate ESP-IDF first: `. C:\Espressif\tools\Microsoft.v6.0.2.PowerShell_profile.ps1`).
3. Read the printed `TL-XXXXXXXX` device id; register: `POST /devices` with `{device_id, source:"hardware", sensors:[temperature,humidity,accel_x,accel_y,accel_z,vibration]}`.
4. Verify: dashboard shows live readings; `GET /devices/<id>/last-known` non-empty; touch the temp sensor or shake for vibration → alert + `hint_en` fires per default thresholds.

## Commands
```powershell
. "C:\Espressif\tools\Microsoft.v6.0.2.PowerShell_profile.ps1"
cd "D:\OmniTwin\firmware\twinlab_node_v1"; idf.py build        # validates anytime
```