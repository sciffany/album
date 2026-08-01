import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { searchTagSuggestions } from "@/lib/tags";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const tags = await searchTagSuggestions(q);
  return NextResponse.json(tags);
}
