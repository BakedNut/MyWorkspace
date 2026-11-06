#!/usr/bin/python3
"""Forced SSH command: exposes only CPU temperature and physical NIC counters."""
from pathlib import Path
import json

temperatures = []
for hwmon in Path("/sys/class/hwmon").glob("hwmon*"):
    try:
        if (hwmon / "name").read_text().strip() not in ("coretemp", "k10temp", "zenpower"):
            continue
        for sensor in hwmon.glob("temp*_input"):
            value = int(sensor.read_text()) / 1000
            if 0 < value < 150:
                temperatures.append(value)
    except (OSError, ValueError):
        continue

incoming = outgoing = 0
for device in Path("/sys/class/net").iterdir():
    if not (device / "device").exists():
        continue
    try:
        incoming += int((device / "statistics/rx_bytes").read_text())
        outgoing += int((device / "statistics/tx_bytes").read_text())
    except (OSError, ValueError):
        continue

print(json.dumps({"tempC": max(temperatures) if temperatures else None,
                  "netin": incoming, "netout": outgoing}))
