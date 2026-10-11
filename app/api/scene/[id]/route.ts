import { api, scene } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  return api(async () => scene(request,(await context.params).id));
}

