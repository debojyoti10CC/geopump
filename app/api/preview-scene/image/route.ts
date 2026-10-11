import { api, previewImage } from "@/lib/game-server";
export const dynamic="force-dynamic";
export async function GET() { return api(previewImage); }
