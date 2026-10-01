import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    success: true,
    data: {
      service: "clottis-teams-web",
      status: "healthy",
      timestamp: new Date().toISOString(),
    },
  });
}
