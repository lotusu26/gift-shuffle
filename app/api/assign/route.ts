import { errorResponse } from "@/lib/http";
import { assignAll } from "@/lib/store";

export async function POST() {
  try {
    return Response.json(await assignAll());
  } catch (error) {
    return errorResponse(error);
  }
}
