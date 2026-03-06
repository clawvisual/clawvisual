import { NextResponse } from "next/server";
import { createOpenApiDocument } from "@/lib/openapi/schema";

export async function GET() {
  return NextResponse.json(createOpenApiDocument());
}
