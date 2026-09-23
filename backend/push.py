"""
TwinLab push alerts — Firebase Cloud Messaging, broadcast to all registered tokens.
Flat module; called from _persist_alert via a thread executor (sync, never awaited).
The caller passes the token list in — this module never opens a Mongo client.
"""

import logging

from config import settings

log = logging.getLogger("twinlab.push")

_fb_app = None          # firebase_admin App, initialised lazily
_init_failed = False


def _ensure_app():
    global _fb_app, _init_failed
    if _fb_app is not None or _init_failed:
        return _fb_app
    if not settings.fcm_credentials_file:
        _init_failed = True
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials
        _fb_app = firebase_admin.initialize_app(
            credentials.Certificate(settings.fcm_credentials_file)
        )
        log.info("[PUSH] Firebase initialised")
        return _fb_app
    except Exception as e:
        log.error(f"[PUSH] Firebase init failed: {e}")
        _init_failed = True
        return None


def send_alert(alert: dict, device: dict, tokens: list) -> dict:
    """
    Broadcast one alert to every token. Returns {"sent": int, "invalid": [token,...]}.
    Never raises. `invalid` holds tokens the caller should delete.
    """
    out = {"sent": 0, "invalid": []}
    if not tokens or _ensure_app() is None:
        log.info("[PUSH] not configured or no tokens — skipping")
        return out

    from firebase_admin import messaging

    device_name = device.get("name") or alert["device_id"]
    title = f"{device_name} — {alert['severity'].upper()}"
    body_en, body_ur = _format_body(alert, device_name, device)

    messages = [
        messaging.Message(
            token=t,
            notification=messaging.Notification(title=title, body=body_en),
            data={
                "device_id":  str(alert["device_id"]),
                "alert_type": str(alert["alert_type"]),
                "severity":   str(alert["severity"]),
                "message_ur": body_ur,
            },
            android=messaging.AndroidConfig(priority="high"),
        )
        for t in tokens
    ]

    try:
        resp = messaging.send_each(messages)
    except Exception as e:
        log.error(f"[PUSH] send failed: {e}")
        return out

    for token, r in zip(tokens, resp.responses):
        if r.success:
            out["sent"] += 1
        elif r.exception is not None and type(r.exception).__name__ in (
            "UnregisteredError", "SenderIdMismatchError"
        ):
            out["invalid"].append(token)

    log.info(f"[PUSH] {alert['device_id']}/{alert['alert_type']} — sent {out['sent']}/{len(tokens)}")
    return out


def _format_body(alert: dict, device_name: str, device: dict) -> tuple:
    """Ported from the deleted whatsapp.py. Returns (english, roman_urdu)."""
    if alert["alert_type"] == "fuel_theft":
        drop     = alert.get("drop_litres", 0.0)
        window_s = alert.get("window_s", 300)
        mins     = round(window_s / 60, 1)
        rupees   = round(drop * settings.diesel_price_pkr)
        en = (
            f"⚠️ {device_name} — fuel dropped {drop:.1f}L in {mins} min "
            f"while generator OFF. Suspected theft. Est. loss ~PKR {rupees:,}."
        )
        ur = (
            f"{device_name} — generator BAND honay ke bawajood {mins} min mein "
            f"{drop:.1f}L fuel kam hua. Chori ka shak. Taqreeban PKR {rupees:,} nuqsan."
        )
    elif alert["alert_type"] == "consumable_reorder":
        hours  = alert["value"]
        vendor = device.get("vendor_name") or "vendor"
        en = (
            f"🟠 {device_name} — {hours:.0f}h reached — consumable change due. "
            f"Vendor: {vendor}. Reorder now to avoid over-stock or SLOB accumulation."
        )
        ur = (
            f"{device_name} — {hours:.0f} ghante ho gaye — consumable tabdeeli chahiye. "
            f"Vendor: {vendor}. Abhi order kar dein — zayada stock ya SLOB nuqsaan se bachne ke liye."
        )
    else:
        sensor   = alert["sensor"].replace("_", " ")
        value    = alert["value"]
        unit     = alert["unit"]
        detail   = alert.get("detail", "")
        severity = alert["severity"].upper()
        icon     = "\U0001f534" if alert["severity"] == "critical" else "\U0001f7e1"
        en = f"{icon} {device_name} — {sensor} {value}{unit} ({detail}). Severity: {severity}."
        ur = f"{device_name} — {sensor} {value}{unit} ({detail}). Severity: {severity}."

    return en, ur
