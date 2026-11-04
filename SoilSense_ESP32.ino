
/*
  SoilSense - ESP32-WROOM-32 (30 pin)

  Hardware:
    Soil Sensor  : GPIO 34
    Pump Relay   : GPIO 26 (BC548 driver)
    OLED SDA     : GPIO 21
    OLED SCL     : GPIO 22

  Features:
    - Automatic irrigation
    - Moisture hysteresis
    - 10 second pump timeout
    - Sensor fault protection
    - SSD1306 OLED display
    - WiFi auto reconnect
    - Express / Render backend
    - Bearer token authentication
    - Verified HTTPS
    - FreeRTOS network task

  Required files:
    config.h
    trust_roots.h
*/

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>
#include <esp_system.h>
#include <cstring>

#include "config.h"
#include "trust_roots.h"
#include "remote_control.h"

// ========================================
// HARDWARE CONFIGURATION
// ========================================

const int SOIL_PIN = 34;
const int PUMP_PIN = 26;

const int OLED_SDA = 21;
const int OLED_SCL = 22;

// BC548 transistor interface:
// HIGH = Pump ON
// LOW  = Pump OFF
//
// Verify your relay circuit follows this
// polarity before connecting the pump.

const int PUMP_ACTIVE_LEVEL = HIGH;
const int PUMP_INACTIVE_LEVEL = LOW;

// ========================================
// SOIL SENSOR CALIBRATION
// ========================================

const int DRY_RAW = 3130;
const int WET_RAW = 1450;

const int ON_PERCENT = 30;
const int OFF_PERCENT = 55;

// ========================================
// SYSTEM SETTINGS
// ========================================

const bool PUMP_ENABLED = true;

const unsigned long MAX_PUMP_MS = 10000;
const unsigned long SAMPLE_MS = 500;
const unsigned long START_MS = 5000;
const unsigned long UPLOAD_MS = 10000;

const unsigned long WIFI_RETRY_MS = 20000;
const unsigned long OLED_RETRY_MS = 3000;
const unsigned long CLOUD_FRESH_MS = 45000;

// Require three consecutive valid dry
// readings before starting irrigation.
const int DRY_CONFIRM_SAMPLES = 3;

// ========================================
// OLED
// ========================================

Adafruit_SSD1306 oled(
  128,
  64,
  &Wire,
  -1
);

bool oledReady = false;

// ========================================
// LOCAL STATE
// ========================================

bool pumpOn = false;
bool sensorFault = false;
bool timeoutFault = false;

int rawValue = 0;
int moisture = 0;
int dryCount = 0;

unsigned long startedAt = 0;
unsigned long pumpStartedAt = 0;
unsigned long lastSampleAt = 0;
unsigned long lastOledAttempt = 0;

char bootId[24];
RemoteControl remoteControl;
RemoteCommand pendingCommand;
char acknowledgedCommand[37] = {};
char acknowledgedResult[24] = {};

// ========================================
// SHARED NETWORK DATA
// ========================================

struct Sample {
  int raw;
  int moisture;
  bool pump;
  bool sensorFault;
  bool timeoutFault;
  uint32_t uptime;
  bool valid;
  int controlMode;
};

Sample sharedSample = {
  0, 0, false, false, false, 0, false, 0
};

portMUX_TYPE stateMux =
  portMUX_INITIALIZER_UNLOCKED;

bool networkConnected = false;
int lastHttpCode = 0;

uint32_t lastSuccessAt = 0;
bool hasUploaded = false;

// ========================================
// PUMP CONTROL
// ========================================

void setPump(bool on) {

  // Never allow a faulted pump to start.
  if (on && (sensorFault || timeoutFault)) {
    on = false;
  }

  if (on && !pumpOn) {
    pumpStartedAt = millis();
  }

  pumpOn = on;

  digitalWrite(
    PUMP_PIN,
    on ? PUMP_ACTIVE_LEVEL
       : PUMP_INACTIVE_LEVEL
  );
}

// ========================================
// OLED INITIALIZATION
// ========================================

bool oledResponding() {

  Wire.beginTransmission(0x3C);

  return Wire.endTransmission() == 0;
}

void initOLED() {

  lastOledAttempt = millis();
  oledReady = false;

  if (!oledResponding()) {
    return;
  }

  oledReady = oled.begin(
    SSD1306_SWITCHCAPVCC,
    0x3C,
    true,
    false
  );

  Wire.setClock(100000);

  if (oledReady) {

    oled.clearDisplay();

    oled.setTextColor(
      SSD1306_WHITE
    );

    oled.setTextWrap(false);
    oled.display();
  }
}

// ========================================
// SOIL SENSOR
// ========================================

int readSoil() {

  long total = 0;

  for (int i = 0; i < 20; i++) {

    total += analogRead(SOIL_PIN);

    delayMicroseconds(200);
  }

  return total / 20;
}

// ========================================
// LOCAL STATUS
// ========================================

const char* localStatus() {

  if (sensorFault)
    return "CHECK SENSOR";

  if (timeoutFault)
    return "TIMEOUT - RESET";

  if (!PUMP_ENABLED)
    return "MONITOR ONLY";

  if (millis() - startedAt < START_MS)
    return "STARTING";

  if (pumpOn)
    return "WATERING";

  if (remoteControl.mode == RemoteControl::ManualOff)
    return "MANUAL OFF";

  if (moisture >= OFF_PERCENT)
    return "WET";

  return "MOIST / DRY";
}

// ========================================
// OLED DISPLAY
// ========================================

void drawOLED() {

  if (!oledReady) return;

  if (!oledResponding()) {

    oledReady = false;
    lastOledAttempt = millis();
    return;
  }

  bool wifiOK;
  bool uploaded;

  int code;
  uint32_t success;

  portENTER_CRITICAL(&stateMux);

  wifiOK = networkConnected;
  code = lastHttpCode;
  success = lastSuccessAt;
  uploaded = hasUploaded;

  portEXIT_CRITICAL(&stateMux);

  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);

  oled.setTextSize(1);

  oled.setCursor(0, 0);
  oled.print("SOILSENSE");

  oled.setCursor(77, 0);
  oled.print(
    wifiOK ? "WiFi ON" : "OFFLINE"
  );

  oled.setTextSize(2);
  oled.setCursor(0, 13);

  if (sensorFault) {

    oled.print("--");

  } else {

    oled.print(moisture);
    oled.print("%");
  }

  oled.setTextSize(1);

  oled.setCursor(0, 33);

  oled.print("PUMP:");
  oled.print(pumpOn ? "ON " : "OFF");

  oled.print(" RAW:");
  oled.print(rawValue);

  oled.setCursor(0, 44);
  oled.print(localStatus());

  oled.setCursor(0, 55);

  // Always prioritize the newest
  // network status.

  if (!wifiOK) {

    oled.print("CLOUD: WAIT WIFI");

  }
  else if (code != 0 &&
           (code < 200 || code >= 300)) {

    oled.print("HTTP: ");
    oled.print(code);

  }
  else if (
    uploaded &&
    millis() - success < CLOUD_FRESH_MS
  ) {

    oled.print("CLOUD: SYNCED");

  }
  else {

    oled.print("CLOUD: CONNECTING");
  }

  oled.display();
}

// ========================================
// BACKEND CONFIGURATION VALIDATION
// ========================================

bool validConfiguration() {

  if (
    strlen(WIFI_SSID) == 0 ||
    strcmp(
      WIFI_SSID,
      "YOUR_WIFI_NAME"
    ) == 0
  ) {

    Serial.println(
      "CONFIG ERROR: Invalid WiFi SSID."
    );

    return false;
  }

  if (
    strlen(DEVICE_TOKEN) == 0 ||
    strcmp(
      DEVICE_TOKEN,
      "YOUR_BACKEND_DEVICE_TOKEN"
    ) == 0
  ) {

    Serial.println(
      "CONFIG ERROR: Missing DEVICE_TOKEN."
    );

    return false;
  }

  String url = String(UPLOAD_URL);

  if (
    !url.startsWith("http://") &&
    !url.startsWith("https://")
  ) {

    Serial.println(
      "CONFIG ERROR: Invalid UPLOAD_URL."
    );

    return false;
  }

  if (
    url.indexOf("localhost") >= 0 ||
    url.indexOf("127.0.0.1") >= 0
  ) {

    Serial.println(
      "CONFIG ERROR: localhost is not "
      "accessible as the backend "
      "from ESP32."
    );

    return false;
  }

  return true;
}

// ========================================
// NETWORK TASK - CORE 0
// ========================================

void networkTask(void*) {

  Serial.println(
    "SoilSense Express Firmware"
  );

  Serial.print("Backend: ");
  Serial.println(UPLOAD_URL);

  if (!validConfiguration()) {

    Serial.println(
      "Network task stopped."
    );

    Serial.println(
      "Local irrigation remains active."
    );

    vTaskDelete(nullptr);
    return;
  }

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  WiFi.begin(
    WIFI_SSID,
    WIFI_PASSWORD
  );

  unsigned long lastReconnect =
    millis();

  unsigned long lastAttempt =
    millis() - UPLOAD_MS;

  unsigned long lastClockMessage = 0;

  bool timeStarted = false;
  bool wasConnected = false;

  const bool useTls =
    String(UPLOAD_URL).startsWith(
      "https://"
    );

  uint32_t seq = 0;

  // ======================================
  // NETWORK LOOP
  // ======================================

  for (;;) {

    bool connected =
      WiFi.status() == WL_CONNECTED;

    portENTER_CRITICAL(&stateMux);

    networkConnected = connected;

    portEXIT_CRITICAL(&stateMux);

    // ---------- WIFI RECONNECT ----------

    if (!connected) {

      wasConnected = false;

      if (
        millis() - lastReconnect >=
        WIFI_RETRY_MS
      ) {

        lastReconnect = millis();

        Serial.printf(
          "WiFi status: %d\n",
          (int)WiFi.status()
        );

        Serial.println(
          "Reconnecting WiFi..."
        );

        WiFi.reconnect();
      }

      vTaskDelay(
        pdMS_TO_TICKS(1000)
      );

      continue;
    }

    // ---------- WIFI CONNECTED ----------

    if (!wasConnected) {

      wasConnected = true;

      Serial.println(
        "WiFi connected."
      );

      Serial.print("ESP32 IP: ");
      Serial.println(
        WiFi.localIP()
      );

      Serial.print("Gateway: ");
      Serial.println(
        WiFi.gatewayIP()
      );

      Serial.printf(
        "WiFi RSSI: %d dBm\n",
        (int)WiFi.RSSI()
      );
    }

    // ---------- NTP TIME SYNC ----------

    if (useTls && !timeStarted) {

      configTime(
        0,
        0,
        "pool.ntp.org",
        "time.google.com"
      );

      timeStarted = true;

      Serial.println(
        "Starting HTTPS clock sync."
      );
    }

    // Valid time is needed for
    // TLS certificate verification.

    if (
      useTls &&
      time(nullptr) < 1700000000
    ) {

      if (
        millis() - lastClockMessage >=
        15000
      ) {

        lastClockMessage = millis();

        Serial.println(
          "Waiting for NTP time sync..."
        );
      }

      vTaskDelay(
        pdMS_TO_TICKS(1000)
      );

      continue;
    }

    // ---------- UPLOAD INTERVAL ----------

    if (
      millis() - lastAttempt <
      UPLOAD_MS
    ) {

      vTaskDelay(
        pdMS_TO_TICKS(250)
      );

      continue;
    }

    lastAttempt = millis();

    // ---------- GET SENSOR DATA ----------

    Sample s;
    char ackId[37], ackResult[24];

    portENTER_CRITICAL(&stateMux);

    s = sharedSample;
    memcpy(ackId, acknowledgedCommand, sizeof(ackId));
    memcpy(ackResult, acknowledgedResult, sizeof(ackResult));

    portEXIT_CRITICAL(&stateMux);

    if (!s.valid) {

      vTaskDelay(
        pdMS_TO_TICKS(500)
      );

      continue;
    }

    char ackJson[128] = {};
    if (ackId[0]) snprintf(ackJson, sizeof(ackJson), ",\"command_ack\":{\"id\":\"%s\",\"result\":\"%s\"}", ackId, ackResult);

    // ---------- JSON PAYLOAD ----------

    char payload[640];

    snprintf(
      payload,
      sizeof(payload),

      "{"
      "\"boot_id\":\"%s\","
      "\"seq\":%lu,"
      "\"raw\":%d,"
      "\"moisture\":%d,"
      "\"pump\":%s,"
      "\"sensor_fault\":%s,"
      "\"timeout_fault\":%s,"
      "\"rssi\":%d,"
      "\"uptime_s\":%lu,"
      "\"dry_raw\":%d,"
      "\"wet_raw\":%d,"
      "\"threshold_on\":%d,"
      "\"threshold_off\":%d,"
      "\"control_version\":1,\"control_mode\":\"%s\"%s"
      "}",

      bootId,
      (unsigned long)seq++,
      s.raw,
      s.moisture,
      s.pump ? "true" : "false",
      s.sensorFault ? "true" : "false",
      s.timeoutFault ? "true" : "false",
      (int)WiFi.RSSI(),
      (unsigned long)s.uptime,
      DRY_RAW,
      WET_RAW,
      ON_PERCENT,
      OFF_PERCENT,
      s.controlMode == RemoteControl::ManualOn ? "manual_on" : s.controlMode == RemoteControl::ManualOff ? "manual_off" : "auto",
      ackJson
    );

    // ---------- HTTP CLIENTS ----------

    WiFiClient plainClient;
    WiFiClientSecure secureClient;

    HTTPClient http;

    secureClient.setCACert(
      TRUST_ROOTS
    );

    secureClient.setHandshakeTimeout(
      10
    );

    http.setConnectTimeout(5000);
    http.setTimeout(5000);

    // Do not blindly follow redirects
    // that could expose the Bearer token.

    http.setFollowRedirects(
      HTTPC_DISABLE_FOLLOW_REDIRECTS
    );

    const char* commandHeaders[] = {"X-SoilSense-Command-Id", "X-SoilSense-Action", "X-SoilSense-Expires-Ms"};
    http.collectHeaders(commandHeaders, 3);
    int code = -1000;

    // ---------- INITIALIZE CONNECTION ----------

    bool begun;

    if (useTls) {

      begun = http.begin(
        secureClient,
        UPLOAD_URL
      );

    } else {

      begun = http.begin(
        plainClient,
        UPLOAD_URL
      );
    }

    // ---------- SEND DATA ----------

    if (begun) {

      http.addHeader(
        "Content-Type",
        "application/json"
      );

      // Express backend authentication.
      http.addHeader(
        "Authorization",
        String("Bearer ") +
        DEVICE_TOKEN
      );

      Serial.println(
        "---------------------------"
      );

      Serial.println(
        "Uploading to SoilSense API..."
      );

      // Credentials are never printed.

      const uint32_t requestStartedAt = millis();
      code = http.POST(
        (uint8_t*)payload,
        strlen(payload)
      );

      Serial.printf(
        "Cloud upload HTTP: %d\n",
        code
      );

      // ---------- RESPONSE HANDLING ----------

      if (code >= 200 && code < 300) {

        Serial.println(
          "Backend accepted reading."
        );
        String commandId = http.header("X-SoilSense-Command-Id");
        String action = http.header("X-SoilSense-Action");
        long remaining = http.header("X-SoilSense-Expires-Ms").toInt() - (long)(millis() - requestStartedAt);
        if (commandId.length() == 36 && remaining > 0 && remaining <= 30000 &&
            (action == "on" || action == "off" || action == "auto" || action == "reset")) {
          RemoteCommand incoming;
          commandId.toCharArray(incoming.id, sizeof(incoming.id));
          action.toCharArray(incoming.action, sizeof(incoming.action));
          incoming.deadline = millis() + (uint32_t)remaining;
          incoming.valid = true;
          portENTER_CRITICAL(&stateMux);
          pendingCommand = incoming;
          portEXIT_CRITICAL(&stateMux);
        }

      }
      else if (
        code == 401 ||
        code == 403
      ) {

        Serial.println(
          "Authentication failed."
        );

        Serial.println(
          "Check DEVICE_TOKEN."
        );

      }
      else if (code == 400) {

        Serial.println(
          "Invalid telemetry payload."
        );

      }
      else if (code >= 500) {

        Serial.println(
          "Backend/server error."
        );

      }
      else if (code < 0) {

        Serial.print(
          "Network error: "
        );

        Serial.println(
          HTTPClient::errorToString(code)
        );

      }
      else {

        Serial.printf(
          "Unexpected HTTP: %d\n",
          code
        );
      }

      http.end();

    } else {

      Serial.println(
        "Cannot initialize HTTP client."
      );
    }

    // ---------- SHARE CLOUD STATUS ----------

    portENTER_CRITICAL(&stateMux);

    lastHttpCode = code;

    if (
      code >= 200 &&
      code < 300
    ) {

      lastSuccessAt = millis();
      hasUploaded = true;
    }

    portEXIT_CRITICAL(&stateMux);

    vTaskDelay(
      pdMS_TO_TICKS(250)
    );
  }
}

// ========================================
// SETUP
// ========================================

void setup() {

  // Pump must remain OFF on startup.

  digitalWrite(
    PUMP_PIN,
    PUMP_INACTIVE_LEVEL
  );

  pinMode(
    PUMP_PIN,
    OUTPUT
  );

  Serial.begin(115200);

  delay(300);

  Serial.println();
  Serial.println("========================");
  Serial.println("SOILSENSE ESP32");
  Serial.println("========================");

  // ---------- ADC ----------

  pinMode(
    SOIL_PIN,
    INPUT
  );

  analogReadResolution(12);

  analogSetPinAttenuation(
    SOIL_PIN,
    ADC_11db
  );

  // ---------- OLED ----------

  Wire.begin(
    OLED_SDA,
    OLED_SCL
  );

  Wire.setClock(100000);

  delay(200);

  initOLED();

  // ---------- UNIQUE BOOT ID ----------

  snprintf(
    bootId,
    sizeof(bootId),
    "%08lx-%08lx",
    (unsigned long)esp_random(),
    (unsigned long)esp_random()
  );

  startedAt = millis();

  // ---------- NETWORK TASK ----------

  BaseType_t result =
    xTaskCreatePinnedToCore(

      networkTask,
      "soil-network",
      16384,
      nullptr,
      1,
      nullptr,
      0
    );

  if (result != pdPASS) {

    Serial.println(
      "ERROR: Network task failed."
    );

    Serial.println(
      "Local pump control still works."
    );
  }

  Serial.println(
    "SoilSense initialized."
  );

  Serial.println(
    "Pump mode: AUTOMATIC"
  );

  Serial.println(
    "Max pump runtime: 10 seconds"
  );

  Serial.println(
    "Cloud upload: every 10 seconds"
  );
}

// ========================================
// MAIN LOOP - CORE 1
// ========================================

void loop() {

  unsigned long now = millis();
  RemoteCommand command;
  portENTER_CRITICAL(&stateMux);
  command = pendingCommand;
  pendingCommand.valid = false;
  portEXIT_CRITICAL(&stateMux);
  if (command.valid) {
    bool requestedPump = pumpOn;
    const char* result = remoteControl.apply(command, now, sensorFault, timeoutFault, PUMP_ENABLED, requestedPump);
    setPump(requestedPump);
    dryCount = 0;
    portENTER_CRITICAL(&stateMux);
    strncpy(acknowledgedCommand, remoteControl.lastId, sizeof(acknowledgedCommand));
    strncpy(acknowledgedResult, result, sizeof(acknowledgedResult));
    portEXIT_CRITICAL(&stateMux);
    Serial.printf("Remote command %s: %s\n", command.action, result);
    lastSampleAt = now - SAMPLE_MS;
  }

  // ======================================
  // PUMP TIMEOUT PROTECTION
  // ======================================

  if (
    pumpOn &&
    now - pumpStartedAt >= MAX_PUMP_MS
  ) {

    setPump(false);

    timeoutFault = true;
    remoteControl.mode = RemoteControl::ManualOff;
    dryCount = 0;

    Serial.println(
      "PUMP TIMEOUT!"
    );

    Serial.println(
      "Pump locked OFF for safety."
    );

    Serial.println(
      "Inspect sensor, water and relay."
    );
  }

  // ======================================
  // SENSOR SAMPLING
  // ======================================

  if (
    now - lastSampleAt >= SAMPLE_MS
  ) {

    lastSampleAt = now;

    rawValue = readSoil();

    // ---------- SENSOR VALIDATION ----------

    sensorFault =
      rawValue < 50 ||
      rawValue > 4045 ||
      DRY_RAW <= WET_RAW + 200;

    if (!sensorFault) {

      moisture = constrain(
        (int)map(
          rawValue,
          DRY_RAW,
          WET_RAW,
          0,
          100
        ),
        0,
        100
      );

    } else {

      dryCount = 0;

      // Stop immediately on fault.
      if (remoteControl.mode == RemoteControl::ManualOn) remoteControl.mode = RemoteControl::ManualOff;
      setPump(false);
    }

    // ======================================
    // AUTOMATIC PUMP CONTROL
    // ======================================

    if (
      !PUMP_ENABLED ||
      sensorFault ||
      timeoutFault ||
      now - startedAt < START_MS
    ) {

      dryCount = 0;
      setPump(false);

    }
    else if (remoteControl.mode == RemoteControl::ManualOff) {
      dryCount = 0;
      setPump(false);
    }
    else if (remoteControl.mode == RemoteControl::ManualOn) {
      dryCount = 0;
      setPump(true);
    }
    else if (!pumpOn) {

      // Confirm dry condition before
      // activating the pump.

      if (moisture <= ON_PERCENT) {

        if (
          dryCount < DRY_CONFIRM_SAMPLES
        ) {
          dryCount++;
        }

        if (
          dryCount >= DRY_CONFIRM_SAMPLES
        ) {

          setPump(true);

          dryCount = 0;
        }

      } else {

        dryCount = 0;
      }

    }
    else if (
      pumpOn &&
      moisture >= OFF_PERCENT
    ) {

      // Soil has reached OFF threshold.
      setPump(false);
      dryCount = 0;
    }

    // ======================================
    // SHARE DATA WITH NETWORK TASK
    // ======================================

    portENTER_CRITICAL(&stateMux);

    sharedSample = {
      rawValue,
      moisture,
      pumpOn,
      sensorFault,
      timeoutFault,
      (uint32_t)(now / 1000),
      true,
      (int)remoteControl.mode
    };

    portEXIT_CRITICAL(&stateMux);

    // ======================================
    // OLED RECOVERY
    // ======================================

    if (
      !oledReady &&
      !pumpOn &&
      millis() - lastOledAttempt >=
      OLED_RETRY_MS
    ) {

      initOLED();
    }

    drawOLED();

    // ======================================
    // SERIAL MONITOR
    // ======================================

    Serial.printf(
      "RAW:%d | Moisture:%d%% | "
      "Pump:%s | %s\n",

      rawValue,
      moisture,
      pumpOn ? "ON" : "OFF",
      localStatus()
    );
  }

  delay(5);
}
