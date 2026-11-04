#include "../../remote_control.h"
#include <assert.h>
#include <stdio.h>

RemoteCommand command(int id,const char* action,uint32_t deadline=30000) {
 RemoteCommand value;snprintf(value.id,sizeof(value.id),"00000000-0000-4000-8000-%012d",id);
 strncpy(value.action,action,sizeof(value.action)-1);value.deadline=deadline;value.valid=true;return value;
}
int main() {
 RemoteControl control;bool fault=true,pump=false;
 assert(strcmp(control.apply(command(1,"on"),1000,false,fault,true,pump),"timeout_locked")==0);assert(!pump);
 assert(strcmp(control.apply(command(2,"reset"),1000,false,fault,true,pump),"applied")==0);assert(!fault&&!pump);assert(control.mode==RemoteControl::ManualOff);
 // Replaying a reset after a later timeout cannot clear the new lock.
 fault=true;control.apply(command(2,"reset"),2000,false,fault,true,pump);assert(fault);
 control.apply(command(3,"reset"),2000,false,fault,true,pump);assert(!fault&&!pump);
 assert(strcmp(control.apply(command(4,"on"),2000,true,fault,true,pump),"sensor_fault")==0);assert(!pump);
 assert(strcmp(control.apply(command(5,"on"),2000,false,fault,false,pump),"disabled")==0);assert(!pump);
 control.apply(command(6,"on"),2000,false,fault,true,pump);assert(pump&&control.mode==RemoteControl::ManualOn);
 control.apply(command(7,"off"),3000,false,fault,true,pump);assert(!pump&&control.mode==RemoteControl::ManualOff);
 control.apply(command(8,"auto"),3000,false,fault,true,pump);assert(!pump&&control.mode==RemoteControl::Automatic);
 assert(strcmp(control.apply(command(9,"on",3000),3000,false,fault,true,pump),"expired")==0);assert(!pump);
 // Deadline arithmetic also works across the millis() rollover.
 control.apply(command(10,"on",50),UINT32_MAX-50,false,fault,true,pump);assert(pump);
 assert(strcmp(control.apply(command(11,"on",50),51,false,fault,true,pump),"expired")==0);
 puts("Remote control tests passed: reset, manual modes, faults, duplicate delivery, expiry and clock rollover.");
}
