import { api, getConfig } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => getConfig());
}

