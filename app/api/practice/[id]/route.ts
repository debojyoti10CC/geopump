import { api, getPractice } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params:Promise<{id:string}>}) {
  return api(async () => getPractice(request,(await context.params).id));
}

