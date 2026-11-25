import { NextResponse } from "next/server";

import { getUserQuota } from "@/lib/quota";
import { getSession } from "@/lib/session";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });

  const quota = await getUserQuota(session.user.id, session.user.role);
  return NextResponse.json(quota);
}
