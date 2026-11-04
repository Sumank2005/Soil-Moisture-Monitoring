import {randomUUID} from 'node:crypto';

function view(row,now=Date.now()) {
 if(!row)return {supported:false,online:false,mode:'auto',pump:false,sensor_fault:false,timeout_fault:false,last_seen:null,command:null};
 return {supported:row.control_version>=1,online:now-Number(row.last_seen)<45000,mode:row.mode,pump:row.pump,sensor_fault:row.sensor_fault,timeout_fault:row.timeout_fault,last_seen:Number(row.last_seen),
  command:row.command_id?{id:row.command_id,action:row.command_action,status:row.command_status==='pending'&&Number(row.command_expires_at)<=now?'expired':row.command_status,result:row.command_result,expires_at:Number(row.command_expires_at)}:null};
}

export async function getControl(pool,now=Date.now()) {
 const result=await pool.query('SELECT * FROM public.soilsense_device_control WHERE id=1');
 return view(result.rows[0],now);
}

export async function recordDeviceState(pool,p,now) {
 const result=await pool.query(`INSERT INTO public.soilsense_device_control
  (id,boot_id,seq,last_seen,control_version,mode,pump,sensor_fault,timeout_fault)
  VALUES(1,$1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(id) DO UPDATE SET boot_id=excluded.boot_id,seq=excluded.seq,last_seen=excluded.last_seen,
   control_version=excluded.control_version,mode=excluded.mode,pump=excluded.pump,
   sensor_fault=excluded.sensor_fault,timeout_fault=excluded.timeout_fault,
   command_status=CASE
    WHEN soilsense_device_control.command_status<>'pending' THEN soilsense_device_control.command_status
    WHEN soilsense_device_control.command_boot_id<>excluded.boot_id THEN 'expired'
    WHEN soilsense_device_control.command_id=$9::uuid THEN CASE WHEN $10='applied' THEN 'applied' ELSE 'rejected' END
    WHEN soilsense_device_control.command_expires_at<=$3 THEN 'expired'
    ELSE 'pending' END,
   command_result=CASE WHEN soilsense_device_control.command_id=$9::uuid THEN $10 ELSE soilsense_device_control.command_result END
  WHERE soilsense_device_control.boot_id<>excluded.boot_id OR soilsense_device_control.seq<=excluded.seq
  RETURNING *`,[p.boot_id,p.seq,now,p.control_version||0,p.control_mode||'auto',p.pump,p.sensor_fault,p.timeout_fault,p.command_ack?.id||null,p.command_ack?.result||null]);
 const state=view(result.rows?.[0],now);
 return state.supported&&state.command?.status==='pending'?{id:state.command.id,action:state.command.action,expires_in_ms:Math.max(0,state.command.expires_at-now)}:null;
}

export async function queueCommand(pool,action,now=Date.now()) {
 const id=randomUUID();
 const updated=await pool.query(`UPDATE public.soilsense_device_control SET
  command_id=$1,command_action=$2,command_boot_id=boot_id,command_created_at=$3,
  command_expires_at=$4,command_status='pending',command_result=NULL
  WHERE id=1 AND last_seen>$5 AND control_version>=1
   AND ($2 IN ('off','reset') OR (sensor_fault=false AND timeout_fault=false))
   AND (command_status<>'pending' OR command_expires_at<=$3 OR $2='off')
  RETURNING *`,[id,action,now,now+30000,now-45000]);
 if(updated.rows[0])return {ok:true,control:view(updated.rows[0],now)};
 const control=await getControl(pool,now);
 const error=!control.supported?'Upload the remote-control firmware once to enable these buttons.':!control.online?'Device is offline. Connect the ESP32 before sending a command.':control.command?.status==='pending'?'Wait for the pending command, or use Pump OFF to replace it.':control.sensor_fault?'Check the soil sensor before starting the pump.':control.timeout_fault?'Clear the timeout lock before starting the pump.':'Device state changed. Refresh and try again.';
 return {ok:false,error,control};
}
