import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://7oxhafersb.execute-api.ap-southeast-1.amazonaws.com";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const path = body.action === "login" ? "/login" : "/register";

    const response = await fetch(`${LAMBDA_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text || "Invalid response from auth server" };
    }

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error) {
    return NextResponse.json(
        { error: "Auth server error" },
        { status: 500 }
    );
  }
}





