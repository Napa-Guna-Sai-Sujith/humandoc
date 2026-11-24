import { NextRequest, NextResponse } from "next/server";
import { one, pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  const downloadName = searchParams.get("download_name") || "download";

  if (!key) {
    return NextResponse.json({ detail: "Missing key parameter" }, { status: 400 });
  }

  // 1. Direct query from Neon PostgreSQL stored_files table (only within 24-hour lifetime)
  try {
    // Opportunistically prune files older than 24 hours
    pool.query("DELETE FROM stored_files WHERE created_at < NOW() - INTERVAL '24 hours'").catch(() => {});

    const row = await one<{ content: Buffer; content_type: string; size: number }>(
      "SELECT content, content_type, size FROM stored_files WHERE key = $1 AND created_at > NOW() - INTERVAL '24 hours'",
      [key]
    );

    if (row && row.content) {
      const headers = new Headers();
      headers.set("Content-Type", row.content_type || "application/octet-stream");
      headers.set("Content-Disposition", `attachment; filename="${downloadName}"`);
      headers.set("Content-Length", String(row.content.length));
      headers.set("Cache-Control", "private, max-age=3600");

      return new NextResponse(new Uint8Array(row.content), {
        status: 200,
        headers,
      });
    }
  } catch (err) {
    console.error("Error fetching stored file from database:", err);
  }

  // 2. Fallback to Render backend API
  const backendUrl = process.env.API_INTERNAL_URL || "https://humandoc.onrender.com";
  try {
    const resp = await fetch(`${backendUrl}/uploads/download?${searchParams.toString()}`, {
      cache: "no-store",
    });
    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const headers = new Headers(resp.headers);
      return new NextResponse(buf, {
        status: resp.status,
        headers,
      });
    }
  } catch (err) {
    console.error("Backend download fallback error:", err);
  }

  return NextResponse.json({ detail: "File not found" }, { status: 404 });
}
