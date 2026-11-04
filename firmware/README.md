# ESP32 setup

Open **SoilSense_ESP32/SoilSense_ESP32.ino** from this directory. Keep its matching **config.h** and **trust_roots.h** beside it. The existing Wi-Fi settings are already filled in locally.

The Express version uses `DEVICE_TOKEN` in config.h and sends `Authorization: Bearer ...`. The old ChatGPT-site config used `SITE_TOKEN` and cannot be mixed with this sketch. If Arduino reports `DEVICE_TOKEN was not declared`, it has opened an older config.h: replace the complete matching set of three files, or run `npm run firmware:configure` from the backend directory and use the generated sketch folder.

1. Start the API from the backend directory with `npm run dev`. The frontend is optional for uploads.
2. Arduino IDE: select **ESP32 Dev Module**, the ESP32 USB port (currently **COM13**), and install Adafruit SSD1306, Adafruit GFX and their dependencies if missing.
3. Verify, then Upload. Open Serial Monitor at **115200 baud**.
4. Look for `SoilSense Express firmware v2`, `WiFi connected. ESP32 IP: ...`, then `Cloud upload HTTP 200` and `Backend accepted reading.`

The current backend endpoint is **https://soilsense-gz6h.onrender.com/api/ingest**. ESP32 needs internet access over 2.4 GHz Wi-Fi. HTTPS verifies the server certificate using trust_roots.h and needs NTP time synchronization. A sleeping free Render service may need time to wake up; the sketch retries uploads every ten seconds.

Diagnostics distinguish Wi-Fi network/password failures, backend connection failures and rejected device tokens. For negative HTTP/network errors, confirm the API is running and reachable on TCP 3001 from the ESP32 network. HTTP 401 means config.h must use the DEVICE_TOKEN from this backend. HTTP 500/503 points to the API/database. Hosted HTTPS keeps certificate verification enabled.

Sensor/OLED/pump pins, calibration, hysteresis and the ten-second local pump timeout remain unchanged. Compilation checks do not flash the board.
