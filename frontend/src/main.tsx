import {apiFetch,clearSession,saveSession} from './api';
import {StrictMode,useEffect,useState,type FormEvent} from 'react';
import {createRoot} from 'react-dom/client';
import {Sprout} from 'lucide-react';
import Dashboard from './Dashboard';
import './styles.css';
function App(){
 const [auth,setAuth]=useState<boolean|null>(null),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{apiFetch('/api/session').then(r=>{if(!r.ok)throw Error('The backend rejected this frontend origin. Check FRONTEND_ORIGIN in backend/.env.');return r.json()}).then(s=>setAuth(s.authenticated)).catch(e=>{setAuth(false);setError(e instanceof Error?e.message:'Cannot reach the backend server.')});const expired=()=>{clearSession();setAuth(false)};window.addEventListener('session-expired',expired);return()=>window.removeEventListener('session-expired',expired)},[]);
 async function login(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await apiFetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});if(!r.ok)throw Error(r.status===429?'Too many attempts. Try again in 15 minutes.':r.status===401?'Incorrect dashboard password.':r.status===403?'This frontend origin is not allowed. Check FRONTEND_ORIGIN in backend/.env.':'The backend could not sign you in. Please try again.');const result=await r.json();if(typeof result.token!=='string')throw Error('Restart the backend to load the updated sign-in API.');saveSession(result.token);const session=await apiFetch('/api/session');if(!session.ok||!(await session.json()).authenticated){clearSession();throw Error('The backend could not verify your session. Please sign in again.')}setPassword('');setAuth(true)}catch(e){setError(e instanceof Error?e.message:'Cannot connect.')}finally{setBusy(false)}}
 if(auth===null)return <div className="login-page">Connecting to your station…</div>;
 if(auth)return <Dashboard/>;
 return <main className="login-page"><form className="setup-modal login-form" onSubmit={login}><span className="modal-sprout"><Sprout size={28}/></span><div className="eyebrow">WELCOME TO SOILSENSE</div><h1>A little closer to your soil.</h1><p>Sign in to your private soil station.</p><label htmlFor="password">Dashboard password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/>{error&&<p role="alert" className="error">{error}</p>}<button className="primary full" disabled={busy}>{busy?'Signing in…':'Open my dashboard'}</button><p className="footnote">Use DASHBOARD_PASSWORD from your server’s .env file.</p></form></main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);

