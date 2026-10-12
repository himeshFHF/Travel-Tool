import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleApi } from "../../../server/api";
export const dynamic = "force-dynamic";
async function handle(request: Request) { return handleApi(request,env,await getChatGPTUser()); }
export { handle as GET, handle as PUT, handle as POST, handle as DELETE };
