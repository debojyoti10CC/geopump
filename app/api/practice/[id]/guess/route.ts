import { api, guessPractice } from "@/lib/game-server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: {params:Promise<{id:string}>}) {
  return api(async () => guessPractice(request,(await context.params).id));
}

