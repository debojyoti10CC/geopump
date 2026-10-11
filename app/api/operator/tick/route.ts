import { api, operatorTick } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return api(async () => operatorTick(request));
}

