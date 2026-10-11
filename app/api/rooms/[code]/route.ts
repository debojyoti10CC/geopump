import { api, getRoom } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params:Promise<{code:string}>}) {
  return api(async () => getRoom(request,(await context.params).code));
}

