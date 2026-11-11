import { connection } from "next/server";
import { errorResponse, readId, readJson } from "@/lib/http";
import {
  addParticipant,
  getRoster,
  removeParticipant,
  updateParticipant,
} from "@/lib/store";

export async function GET() {
  await connection();
  try {
    return Response.json(await getRoster());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const person = await addParticipant(body.name, body.giftCode);
    return Response.json(person, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    await updateParticipant(readId(body.id), body.name, body.giftCode);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await readJson(request);
    await removeParticipant(readId(body.id));
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
