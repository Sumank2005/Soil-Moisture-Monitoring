// SoilSense - ESP32-WROOM-32 (30 pin), SSD1306 OLED, BC548 relay interface.
// Keep config.h and trust_roots.h in this sketch's folder.
// Network uploads run on a separate FreeRTOS task; local pump control never waits for HTTPS.
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <time.h>
#include <esp_system.h>
#include "config.h"
#include "trust_roots.h"

const int SOIL_PIN=34, PUMP_PIN=26;
const int DRY_RAW=3130, WET_RAW=1450;
const int ON_PERCENT=30, OFF_PERCENT=55;
const bool PUMP_ENABLED=true;
const unsigned long MAX_PUMP_MS=10000, SAMPLE_MS=500, START_MS=5000;
Adafruit_SSD1306 oled(128,64,&Wire,-1);
bool oledReady=false,pumpOn=false,sensorFault=false,timeoutFault=false;
int rawValue=0,moisture=0;
unsigned long startedAt=0,pumpStartedAt=0,lastSampleAt=0,lastOledAttempt=0;
char bootId[24];

struct Sample {int raw;int moisture;bool pump;bool sensorFault;bool timeoutFault;uint32_t uptime;bool valid;};
Sample sharedSample={0,0,false,false,false,0,false};
portMUX_TYPE stateMux=portMUX_INITIALIZER_UNLOCKED;
bool networkConnected=false;
int lastHttpCode=0;
uint32_t lastSuccessAt=0;
bool hasUploaded=false;

void setPump(bool on){
 if(on&&!pumpOn)pumpStartedAt=millis();
 pumpOn=on;
 digitalWrite(PUMP_PIN,on?HIGH:LOW); // BC548 -> LOW-trigger relay
}
bool oledResponding(){Wire.beginTransmission(0x3C);return Wire.endTransmission()==0;}
void initOLED(){
 lastOledAttempt=millis();oledReady=false;
 if(!oledResponding())return;
 oledReady=oled.begin(SSD1306_SWITCHCAPVCC,0x3C,true,false);
 Wire.setClock(100000);
 if(oledReady){oled.clearDisplay();oled.setTextColor(SSD1306_WHITE);oled.setTextWrap(false);oled.display();}
}
int readSoil(){long total=0;for(int i=0;i<20;i++){total+=analogRead(SOIL_PIN);delayMicroseconds(200);}return total/20;}
const char* localStatus(){
 if(sensorFault)return "CHECK SENSOR";
 if(timeoutFault)return "TIMEOUT - RESET";
 if(!PUMP_ENABLED)return "MONITOR ONLY";
 if(millis()-startedAt<START_MS)return "STARTING";
 return pumpOn?"WATERING":moisture>=OFF_PERCENT?"WET":"MOIST / DRY";
}
void drawOLED(){
 if(!oledReady)return;
 if(!oledResponding()){oledReady=false;lastOledAttempt=millis();return;}
 bool wifiOK,uploaded;int code;uint32_t success;
 portENTER_CRITICAL(&stateMux);
 wifiOK=networkConnected;code=lastHttpCode;success=lastSuccessAt;uploaded=hasUploaded;
 portEXIT_CRITICAL(&stateMux);
 oled.clearDisplay();oled.setTextColor(SSD1306_WHITE);oled.setTextSize(1);oled.setCursor(0,0);oled.print("SOILSENSE");
 oled.setCursor(77,0);oled.print(wifiOK?"WiFi ON":"OFFLINE");
 oled.setTextSize(2);oled.setCursor(0,13);
 if(sensorFault)oled.print("--");else{oled.print(moisture);oled.print("%");}
 oled.setTextSize(1);oled.setCursor(0,33);oled.print("PUMP:");oled.print(pumpOn?"ON ":"OFF");oled.print(" RAW:");oled.print(rawValue);
 oled.setCursor(0,44);oled.print(localStatus());
 oled.setCursor(0,55);
 if(uploaded&&millis()-success<45000)oled.print("CLOUD: SYNCED");
 else if(!wifiOK)oled.print("CLOUD: WAIT WIFI");
 else if(code!=0){oled.print("HTTP: ");oled.print(code);}
 else oled.print("CLOUD: CONNECTING");
 oled.display();
}

void networkTask(void*){
 Serial.println("SoilSense Express firmware v2");
 Serial.print("Backend: ");Serial.println(UPLOAD_URL);
 if(strlen(WIFI_SSID)==0||strcmp(WIFI_SSID,"YOUR_WIFI_NAME")==0||strlen(DEVICE_TOKEN)<32){
  Serial.println("CONFIG ERROR: fill Wi-Fi and use the matching backend-generated config.h. Local watering remains active.");
  vTaskDelete(nullptr);return;
 }
 if(String(UPLOAD_URL).indexOf("localhost")>=0||String(UPLOAD_URL).indexOf("127.0.0.1")>=0){
  Serial.println("CONFIG ERROR: ESP32 needs the computer LAN IP or a hosted backend URL, not localhost.");
  vTaskDelete(nullptr);return;
 }
 WiFi.mode(WIFI_STA);
 WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
 WiFi.setAutoReconnect(true);
 unsigned long lastReconnect=millis(),lastAttempt=millis()-10000;
 bool timeStarted=false;
 bool wasConnected=false;
 unsigned long lastClockMessage=0;
 const bool useTls=String(UPLOAD_URL).startsWith("https://");
 uint32_t seq=0;
 for(;;){
  bool connected=WiFi.status()==WL_CONNECTED;
  portENTER_CRITICAL(&stateMux);networkConnected=connected;portEXIT_CRITICAL(&stateMux);
  if(!connected){
   wasConnected=false;
   if(millis()-lastReconnect>=20000){
    lastReconnect=millis();
    Serial.printf("WiFi not connected (status %d). ",(int)WiFi.status());
    if(WiFi.status()==WL_NO_SSID_AVAIL)Serial.println("Network not found: check the 2.4 GHz Wi-Fi name.");
    else if(WiFi.status()==WL_CONNECT_FAILED)Serial.println("Connection failed: check Wi-Fi password and signal.");
    else Serial.println("Retrying. Check Wi-Fi credentials and signal.");
    WiFi.reconnect();
   }
   vTaskDelay(pdMS_TO_TICKS(1000));continue;
  }
  if(!wasConnected){
   wasConnected=true;
   Serial.print("WiFi connected. ESP32 IP: ");Serial.println(WiFi.localIP());
   Serial.print("Gateway: ");Serial.println(WiFi.gatewayIP());
   Serial.printf("Signal: %d dBm\n",(int)WiFi.RSSI());
  }
  if(useTls&&!timeStarted){configTime(0,0,"pool.ntp.org","time.google.com");timeStarted=true;Serial.println("WiFi connected. Syncing clock for verified HTTPS.");}
  // TLS certificate validation needs the real clock. Do not use setInsecure().
  if(useTls&&time(nullptr)<1700000000){
   if(millis()-lastClockMessage>=15000){lastClockMessage=millis();Serial.println("HTTPS waiting for internet time sync. Local HTTP does not need NTP.");}
   vTaskDelay(pdMS_TO_TICKS(1000));continue;
  }
  if(millis()-lastAttempt<10000){vTaskDelay(pdMS_TO_TICKS(250));continue;}
  lastAttempt=millis();
  Sample s;
  portENTER_CRITICAL(&stateMux);s=sharedSample;portEXIT_CRITICAL(&stateMux);
  if(!s.valid){vTaskDelay(pdMS_TO_TICKS(500));continue;}
  char payload[640];
  snprintf(payload,sizeof(payload),
   "{\"boot_id\":\"%s\",\"seq\":%lu,\"raw\":%d,\"moisture\":%d,\"pump\":%s,\"sensor_fault\":%s,\"timeout_fault\":%s,\"rssi\":%d,\"uptime_s\":%lu,\"dry_raw\":%d,\"wet_raw\":%d,\"threshold_on\":%d,\"threshold_off\":%d}",
   bootId,(unsigned long)seq++,s.raw,s.moisture,s.pump?"true":"false",s.sensorFault?"true":"false",s.timeoutFault?"true":"false",(int)WiFi.RSSI(),(unsigned long)s.uptime,DRY_RAW,WET_RAW,ON_PERCENT,OFF_PERCENT);
  WiFiClient plainClient;
  WiFiClientSecure client;
  client.setCACert(TRUST_ROOTS);
  client.setHandshakeTimeout(10);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(5000);
  int code=-1000;
  bool begun = String(UPLOAD_URL).startsWith("https://") ? http.begin(client,UPLOAD_URL) : http.begin(plainClient,UPLOAD_URL);
  if(begun){
   http.addHeader("Content-Type","application/json");
   http.addHeader("Authorization",String("Bearer ")+DEVICE_TOKEN);
   code=http.POST(String(payload));
   // Never print credentials or Wi-Fi password.
   Serial.printf("Cloud upload HTTP %d\n",code);
   if(code<0){Serial.print("Network error: ");Serial.println(HTTPClient::errorToString(code));Serial.println("Check backend is running, LAN IP/port 3001, same Wi-Fi, and inbound firewall access.");}
   else if(code==200)Serial.println("Backend accepted reading.");
   else if(code==401||code==403)Serial.println("Authentication failed: regenerate config.h from this backend; the old ChatGPT SITE_TOKEN cannot be used.");
   else if(code==400)Serial.println("Backend rejected telemetry. Use the matching SoilSense sketch.");
   else if(code>=500)Serial.println("Backend/database error. Check the Express server log.");
   http.end();
  }
  else Serial.println("Cannot initialize upload. UPLOAD_URL must be an http:// or https:// backend URL.");
  portENTER_CRITICAL(&stateMux);
  lastHttpCode=code;
  if(code==200){lastSuccessAt=millis();hasUploaded=true;}
  portEXIT_CRITICAL(&stateMux);
  if(code==401||code==403)Serial.println("Check device config credential from your private dashboard.");
  vTaskDelay(pdMS_TO_TICKS(250));
 }
}

void setup(){
 digitalWrite(PUMP_PIN,LOW);pinMode(PUMP_PIN,OUTPUT);
 Serial.begin(115200);
 pinMode(SOIL_PIN,INPUT);analogReadResolution(12);analogSetPinAttenuation(SOIL_PIN,ADC_11db);
 Wire.begin(21,22);Wire.setClock(100000);
 delay(200);initOLED();
 snprintf(bootId,sizeof(bootId),"%08lx-%08lx",(unsigned long)esp_random(),(unsigned long)esp_random());
 startedAt=millis();
 // ESP32-WROOM has two cores. Network runs on core 0; Arduino control loop on core 1.
 BaseType_t taskResult=xTaskCreatePinnedToCore(networkTask,"soil-network",16384,nullptr,1,nullptr,0);
 if(taskResult!=pdPASS)Serial.println("Network task could not start. Local watering still works.");
 Serial.println("SoilSense started. Local pump control + backend upload every 10 seconds.");
 Serial.println("Air/water calibration only. Calibrate in actual soil before irrigation.");
}
void loop(){
 unsigned long now=millis();
 if(pumpOn&&now-pumpStartedAt>=MAX_PUMP_MS){setPump(false);timeoutFault=true;Serial.println("PUMP TIMEOUT: check water/pipe/sensor before local reset.");}
 if(now-lastSampleAt>=SAMPLE_MS){
  lastSampleAt=now;rawValue=readSoil();
  sensorFault=rawValue<50||rawValue>4045||DRY_RAW<=WET_RAW+200;
  if(!sensorFault)moisture=constrain((int)map(rawValue,DRY_RAW,WET_RAW,0,100),0,100);
  if(!PUMP_ENABLED||sensorFault||timeoutFault||now-startedAt<START_MS)setPump(false);
  else if(!pumpOn&&moisture<=ON_PERCENT)setPump(true);
  else if(pumpOn&&moisture>=OFF_PERCENT)setPump(false);
  portENTER_CRITICAL(&stateMux);
  sharedSample={rawValue,moisture,pumpOn,sensorFault,timeoutFault,(uint32_t)(now/1000),true};
  portEXIT_CRITICAL(&stateMux);
  if(!oledReady&&!pumpOn&&millis()-lastOledAttempt>=3000)initOLED();
  drawOLED();
  Serial.printf("RAW:%d | Moisture:%d%% | Pump:%s | %s\n",rawValue,moisture,pumpOn?"ON":"OFF",localStatus());
 }
 delay(5);
}

