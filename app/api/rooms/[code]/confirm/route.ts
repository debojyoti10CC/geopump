import { api, confirmRoom } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: {params:Promise<{code:string}>}) {
  return api(async () => confirmRoom(request,(await context.params).code));
}

