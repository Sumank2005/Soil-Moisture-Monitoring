import {useState} from 'react';
import {Power,Square,RotateCcw,Leaf,Clock3,Check,AlertCircle} from 'lucide-react';
import {apiFetch} from './api';

export type Control={supported:boolean;online:boolean;mode:string;pump:boolean;sensor_fault:boolean;timeout_fault:boolean;last_seen:number|null;command:{id:string;action:string;status:string;result:string|null;expires_at:number}|null};
export default function PumpControls({control,onChange}:{control:Control|null;onChange:(control:Control)=>void}) {
 const [sending,setSending]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const online=!!control?.online&&!!control.last_seen&&Date.now()-control.last_seen<45000;
 const ready=!!control?.supported&&online;
 const pending=control?.command?.status==='pending'&&control.command.expires_at>Date.now();
 const locked=!!control?.timeout_fault||!!control?.sensor_fault;
 async function send(action:string){
  setSending(true);setMessage('');setFailed(false);
  try {
   const response=await apiFetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})});
   const result=await response.json();if(result.control)onChange(result.control);
   if(!response.ok)throw Error(result.error||'Could not send the command.');
   setMessage(action==='reset'?'Reset requested. The pump will stay OFF.':'Command queued. Waiting for your ESP32.');
  }catch(error){setFailed(true);setMessage(error instanceof Error?error.message:'Could not send command.')}finally{setSending(false)}
 }
 const command=control?.command;
 const status=command?.status==='pending'&&!pending?'expired':command?.status;
 const label=status==='applied'?'ESP32 confirmed the command.':status==='rejected'?`ESP32 rejected the command: ${command?.result?.replaceAll('_',' ')}.`:status==='expired'?'Command expired. It will not run later.':pending?'Waiting for ESP32 acknowledgement…':'';
 return <section className="card pump-controls" aria-labelledby="pump-controls-title">
  <div className="section-top"><div><h2 id="pump-controls-title">Pump controls</h2><p>{!control?.supported?'Upload the updated firmware once to enable online controls.':!online?'Connect your ESP32 to use online controls.':'Commands arrive with the next upload, usually within 10 seconds.'}</p></div><span className="pill">{control?.mode==='manual_off'?'Manual · OFF':control?.mode==='manual_on'?'Manual · ON':'Automatic mode'}</span></div>
  <div className="control-buttons">
   <button className="primary" disabled={!ready||sending||pending||locked} onClick={()=>void send('on')}><Power size={16}/>Pump ON <small>up to 10s</small></button>
   <button className="control-off" disabled={!ready||sending} onClick={()=>void send('off')}><Square size={15}/>Pump OFF</button>
   <button className="control-secondary" disabled={!ready||sending||pending||locked} onClick={()=>void send('auto')}><Leaf size={16}/>Auto mode</button>
   <button className="control-secondary" disabled={!ready||sending||pending||!control?.timeout_fault} onClick={()=>void send('reset')}><RotateCcw size={16}/>Reset timeout</button>
  </div>
  {failed&&message?<p className="command-feedback command-error" role="alert"><AlertCircle size={15}/>{message}</p>:label?<p className={`command-feedback ${status==='rejected'||status==='expired'?'command-error':''}`} role="status">{status==='applied'?<Check size={15}/>:<Clock3 size={15}/>} {label}</p>:message&&<p className="command-feedback" role="status"><Clock3 size={15}/>{message}</p>}
  <p className="control-note">The 10-second limit and sensor protection apply in every mode. Reset clears the timeout lock and keeps the pump OFF; choose ON or Auto to resume.</p>
 </section>;
}
