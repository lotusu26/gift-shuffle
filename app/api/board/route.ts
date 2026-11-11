import { connection } from "next/server";
import { errorResponse } from "@/lib/http";
import { getBoard } from "@/lib/store";

export async function GET() {
  await connection();
  try {
    return Response.json(await getBoard());
  } catch (error) {
    return errorResponse(error);
  }
}
