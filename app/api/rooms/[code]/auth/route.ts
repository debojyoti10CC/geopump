import { api, authRoom } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: {params:Promise<{code:string}>}) {
  return api(async () => authRoom(request,(await context.params).code));
}

