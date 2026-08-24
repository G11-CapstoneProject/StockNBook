import { NextRequest, NextResponse } from "next/server";
// Import your existing Lambda backend file
// The path goes up 3 levels: api -> app -> root, then into lambda-subscription-admin
const lambda = require("../../../lambda-subscription-admin/index.js");

export async function POST(req: NextRequest) {
    try {
        // Read the request body as text to pass to the Lambda event
        const bodyText = await req.text();

        // 1. Create a fake AWS Lambda "event" object
        const event = {
            httpMethod: "POST",
            body: bodyText,
            headers: {
                Authorization: req.headers.get("authorization") || "",
                "Content-Type": req.headers.get("content-type") || "application/json",
            },
            requestContext: {
                http: { method: "POST" }
            }
        };

        // 2. Execute your existing Lambda handler
        const result = await lambda.handler(event);

        // 3. Return the Lambda's response back to the Next.js frontend
        return NextResponse.json(
            JSON.parse(result.body || "{}"),
            { status: result.statusCode || 200 }
        );

    } catch (error) {
        console.error("API Route Wrapper Error:", error);
        return NextResponse.json(
            { error: "Internal Server Error in API Route" },
            { status: 500 }
        );
    }
}