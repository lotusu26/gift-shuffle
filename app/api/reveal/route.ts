import { errorResponse, readId, readJson } from "@/lib/http";
import { revealGift } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    return Response.json(await revealGift(readId(body.id)));
  } catch (error) {
    return errorResponse(error);
  }
}
