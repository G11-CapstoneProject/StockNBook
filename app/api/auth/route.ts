import { NextRequest, NextResponse } from "next/server";

const LAMBDA_URL =
    "https://qyjajerkuc.execute-api.ap-southeast-1.amazonaws.com/default/stocknbook-auth";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const normalizedAction =
        body.action === "register" || body.action === "signup"
            ? "send_signup_otp"
            : body.action;

    const normalizedBody = {
      ...body,
      action: normalizedAction,
    };

    const response = await fetch(LAMBDA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
            req.headers.get("authorization") || "",
      },
      body: JSON.stringify(normalizedBody),
      cache: "no-store",
    });

    const text = await response.text();

    let data: unknown;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {
        error:
            text ||
            "Invalid response from authentication server",
      };
    }

    if (!response.ok) {
      console.error("Auth Lambda request failed:", {
        status: response.status,
        action: normalizedAction,
        data,
      });
    }

    return NextResponse.json(data, {
      status: response.status,
    });
  } catch (error) {
    console.error("Auth route error:", error);

    return NextResponse.json(
        {
          error: "Auth server error",
        },
        {
          status: 500,
        }
    );
  }
}