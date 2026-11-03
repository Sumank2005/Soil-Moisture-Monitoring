import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'SoilSense · Live Soil Monitor',description:'A little closer to your soil. Live ESP32 moisture, watering and device health.',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
