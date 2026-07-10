import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://qyjajerkuc.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const normalizedBody = {
      ...body,
      action: body.action === "register" ? "signup" : body.action,
    };

    const response = await fetch(LAMBDA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: req.headers.get("authorization") || "",
      },
      body: JSON.stringify(normalizedBody),
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