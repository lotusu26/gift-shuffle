import { StoreError } from "./store";

export async function readJson(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new StoreError("요청 형식이 올바르지 않아요.", 400);
  }
  return body as Record<string, unknown>;
}

export function readId(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new StoreError("참가자를 찾을 수 없어요.", 400);
  }
  return value.trim();
}

export function errorResponse(error: unknown) {
  if (error instanceof StoreError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error("gift store request failed");
  return Response.json(
    { error: "잠시 후 다시 시도해 주세요." },
    { status: 500 },
  );
}
