import { requireChatGPTUser } from "./chatgpt-auth";
import TravelClient from "./travel-client";
export const dynamic = "force-dynamic";
export default async function Home() { const u = await requireChatGPTUser("/"); return <TravelClient user={{name:u.displayName,email:u.email}} />; }
