import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL = "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const path = body.action === "login" ? "/login" : "/register";

  const response = await fetch(`${LAMBDA_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data);
}