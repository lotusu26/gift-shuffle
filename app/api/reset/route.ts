import { errorResponse, readJson } from "@/lib/http";
import { StoreError, reshuffle, unlockRoster } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    if (body.mode === "reshuffle") return Response.json(await reshuffle());
    if (body.mode === "unlock") return Response.json(await unlockRoster());
    throw new StoreError("요청 형식이 올바르지 않아요.", 400);
  } catch (error) {
    return errorResponse(error);
  }
}
