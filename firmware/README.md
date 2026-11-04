# ESP32 setup

Open **SoilSense_ESP32/SoilSense_ESP32.ino** from this directory. Keep its matching **config.h**, **trust_roots.h** and **remote_control.h** beside it. The existing Wi-Fi settings are already filled in locally.

The Express version uses `DEVICE_TOKEN` in config.h and sends `Authorization: Bearer ...`. The old ChatGPT-site config used `SITE_TOKEN` and cannot be mixed with this sketch. If Arduino reports `DEVICE_TOKEN was not declared`, it has opened an older config.h: replace the complete matching set of four files, or run `npm run firmware:configure` from the backend directory and use the generated sketch folder.

1. Start the API from the backend directory with `npm run dev`. The frontend is optional for uploads.
2. Arduino IDE: select **ESP32 Dev Module**, the ESP32 USB port (currently **COM13**), and install Adafruit SSD1306, Adafruit GFX and their dependencies if missing.
3. Verify, then Upload. Open Serial Monitor at **115200 baud**.
4. Look for `SoilSense Express firmware v2`, `WiFi connected. ESP32 IP: ...`, then `Cloud upload HTTP 200` and `Backend accepted reading.`

The current backend endpoint is **https://soilsense-gz6h.onrender.com/api/ingest**. ESP32 needs internet access over 2.4 GHz Wi-Fi. HTTPS verifies the server certificate using trust_roots.h and needs NTP time synchronization. A sleeping free Render service may need time to wake up; the sketch retries uploads every ten seconds.

Diagnostics distinguish Wi-Fi network/password failures, backend connection failures and rejected device tokens. For negative HTTP/network errors, confirm the API is running and reachable on TCP 3001 from the ESP32 network. HTTP 401 means config.h must use the DEVICE_TOKEN from this backend. HTTP 500/503 points to the API/database. Hosted HTTPS keeps certificate verification enabled.

Sensor/OLED/pump pins, calibration, hysteresis and the ten-second local pump timeout remain unchanged. Compilation checks do not flash the board.

## Online pump controls

After this firmware is uploaded once, the dashboard can send Pump ON, Pump OFF, Auto mode and Reset timeout. Commands arrive in authenticated HTTPS upload response headers, so the ESP does not open extra polling requests. A command expires after 30 seconds and is tied to the current boot. Its acknowledgement is included in a subsequent telemetry upload. Duplicate command delivery does not repeat a reset or restart the pump timer.

Reset timeout clears the timeout latch and selects manual OFF; it does not reboot the ESP or immediately restart watering. Pump OFF stays in manual OFF until ON or Auto is selected (a power cycle returns to the normal automatic startup). Manual ON retains the ten-second maximum runtime and sensor protection. After a timeout, ON and Auto remain blocked until Reset timeout. Offline commands are rejected by the backend.

The pure C++ remote-control policy tests are in `firmware/test/remote-control.test.cpp`; compile with a C++11 compiler and run the executable. The same `remote_control.h` policy is used by the ESP sketch.
