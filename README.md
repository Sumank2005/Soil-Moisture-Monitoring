# SoilSense
Private live ESP32 soil-monitoring dashboard and device firmware.

## Device setup
Use the Connect device button on the deployed dashboard. Download SoilSense_ESP32.ino, trust_roots.h and the authenticated config.h download into one Arduino sketch folder named SoilSense_ESP32. Only edit Wi-Fi name/password in config.h; never commit it. Board: ESP32 Dev Module (classic dual-core WROOM). Libraries: Adafruit SSD1306 and Adafruit GFX plus dependencies. Baud: 115200.

Power-on connects to 2.4 GHz Wi-Fi and reconnects automatically. Verified HTTPS uploads every 10s run on a separate FreeRTOS task so pump timing remains independent of network delays. Clock sync uses NTP. Payloads contain no Wi-Fi credentials. Failed uploads are not queued; the latest current sample is sent after reconnect. HTTP 200 means saved. No remote control.

Existing wiring: sensor AO GPIO34, OLED SDA21/SCL22 (3.3V, SSD1306 128x64 at 0x3C); GPIO26 through 1k to BC548 base; emitter ground, collector relay IN, 10k base-emitter. Relay VCC 5V. Common ground. Keep tested decoupling capacitors and motor diode. Do not supply ESP32 VIN from a converter while laptop USB also supplies it.

Calibration 3130/1450 is air/water-relative, not volumetric soil water content. Pump on <=30%, off >=55%, max continuous 10s then latched OFF until local reset. Display pump value is the commanded state; no flow feedback is measured. Basic rail sensor checks cannot detect every fault.

## Server
Owner-private Sites gate authorizes device upload via existing service bearer header. Ingest does not grant access to browser-only history/config APIs. Config provisioned by owner-only, no-store download using a Sites runtime secret; it is never stored in source. History in D1 retains 7 days and is cleaned on uploads. GET /api/readings returns bounded chart buckets, summary and last 20 readings; export is the latest 20 samples in selected window. Device offline after 45s; old values explicitly labelled stale.

DB migration files are generated with npm run db:generate. Runtime secret: ESP_SERVICE_TOKEN. Do not log this value. If access audience changes, revisit ingest authorization.
