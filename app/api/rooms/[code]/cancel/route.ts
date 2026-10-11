import { api, recoverRoom } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: {params:Promise<{code:string}>}) {
  return api(async () => recoverRoom(request,(await context.params).code,true));
}

