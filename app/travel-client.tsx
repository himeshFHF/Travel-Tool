"use client";
import dynamic from "next/dynamic";
const App = dynamic(() => import("../src/App"), { ssr: false, loading: () => <div className="loading"><span className="brand-symbol">w</span><p>Getting your journey ready…</p></div> });
export default function TravelClient({user}:{user:{name:string;email:string}}) {return <App user={user}/>;}
