# Demo Devices Template

This is the user documentation of the integration. Gladys re-hosts this file
and shows a permanent **Documentation** link to it in the Configuration screen
(in the user's language, with English as the fallback) — it is when
configuring that the user needs it most. Keep the short onboarding hints in
the `section` blocks of the manifest `config_schema`; put the long
step-by-step (screenshots, troubleshooting…) here.

## What you get

Six demo devices show up after installation: a weather station (real data
from Open-Meteo), a switch, a dimmable light, a smart plug with power
metering, a motion sensor and a camera.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Set the **latitude** and **longitude** the demo weather station should
   observe (they default to Paris), and pick your temperature unit.
3. Save: the devices appear in the **Discovery** tab, ready to be added.

The **Prefer the local connection** toggle drives the demo plug: it reports
the channel it actually uses as a badge (local or cloud), with an orange dot
when it runs degraded (local refused, cloud fallback).

## Actions

- **Test the weather provider** — performs a live request to Open-Meteo and
  shows the current temperature and humidity under the button.
- **Identify a device** — pick one of your devices in the list and it will
  signal itself (the demo light "blinks" in the logs).

## Troubleshooting

The integration logs everything it does: check the integration logs from the
Gladys UI (or `docker logs` on the host) with `LOG_LEVEL=debug` for the full
detail.
