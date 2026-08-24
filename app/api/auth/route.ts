import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-auth/index.js";

export const runtime = "nodejs";

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

    const event = {
      headers: {
        "Content-Type": "application/json",
        Authorization:
            req.headers.get("authorization") || "",
      },
      body: JSON.stringify(normalizedBody),
      requestContext: {
        http: {
          method: "POST",
        },
      },
    };

    const response = await handler(event);

    let data: unknown = {};

    try {
      data = response.body
          ? JSON.parse(response.body)
          : {};
    } catch {
      data = {
        error: response.body || "Invalid server response",
      };
    }

    const jsonResponse = NextResponse.json(data, {
      status: response.statusCode || 200,
    });

    // For platform admin logins only: also set an httpOnly cookie carrying
    // the same token. This is what lets proxy.ts verify the session
    // server-side before an admin page is even rendered. It does not
    // replace the token returned in the JSON body above — the app still
    // stores that in sessionStorage and sends it as a Bearer header for
    // every other admin API call, unchanged.
    if (
        normalizedAction === "platform_admin_login" &&
        response.statusCode === 200 &&
        (data as { token?: string })?.token
    ) {
      jsonResponse.cookies.set("admin_token", (data as { token: string }).token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 8 * 60 * 60, // 8 hours — matches the JWT's expiresIn
      });
    }

    return jsonResponse;

  } catch (error: any) {
    console.error("Local Auth API Error:", error);

    return NextResponse.json(
        {
          error:
              error?.message ||
              "Authentication server error",
        },
        {
          status: 500,
        }
    );
  }
}