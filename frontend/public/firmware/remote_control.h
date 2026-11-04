#pragma once
#include <stdint.h>
#include <string.h>

struct RemoteCommand {
 char id[37] = {};
 char action[8] = {};
 uint32_t deadline = 0;
 bool valid = false;
};

struct RemoteControl {
 enum Mode {Automatic, ManualOn, ManualOff};
 Mode mode = Automatic;
 char lastId[37] = {};
 const char* lastResult = "applied";

 const char* modeName() const {
  return mode==ManualOn?"manual_on":mode==ManualOff?"manual_off":"auto";
 }

 const char* apply(const RemoteCommand& command,uint32_t now,bool sensorFault,
                   bool& timeoutFault,bool enabled,bool& requestedPump) {
  if(!command.valid||!command.id[0])return "expired";
  // Re-delivery never restarts the timer or re-clears a later timeout.
  if(strcmp(command.id,lastId)==0)return lastResult;
  strncpy(lastId,command.id,sizeof(lastId)-1);lastId[36]='\0';
  if((int32_t)(command.deadline-now)<=0)return lastResult="expired";
  if(strcmp(command.action,"off")==0){mode=ManualOff;requestedPump=false;return lastResult="applied";}
  if(strcmp(command.action,"reset")==0){mode=ManualOff;requestedPump=false;timeoutFault=false;return lastResult="applied";}
  if(strcmp(command.action,"on")!=0&&strcmp(command.action,"auto")!=0)return lastResult="disabled";
  if(!enabled)return lastResult="disabled";
  if(sensorFault)return lastResult="sensor_fault";
  if(timeoutFault)return lastResult="timeout_locked";
  mode=strcmp(command.action,"on")==0?ManualOn:Automatic;
  requestedPump=mode==ManualOn;
  return lastResult="applied";
 }
};
