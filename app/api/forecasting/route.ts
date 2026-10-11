import { NextRequest, NextResponse } from "next/server";
import { handler } from "../../../lambda-forecasting/index.js";
import { requireEffectivePlanFeature } from "../_helpers/require-effective-plan-feature";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";


export async function POST(request: NextRequest) {

    try {

        const authHeader =
            request.headers.get("Authorization") || "";

        if (!authHeader) {
            return NextResponse.json(
                {
                    error:
                        "Missing Authorization header."
                },
                {
                    status:401
                }
            );
        }


        const body = await request.json();


        const allowedActions = [
            "get_inventory_forecast",
            "get_booking_forecast",
            "get_seasonal_analysis",
            "get_forecast_report"
        ];


        if (!allowedActions.includes(body.action)) {

            return NextResponse.json(
                {
                    error:
                        "Invalid forecasting action."
                },
                {
                    status:400
                }
            );
        }


        const subscriptionGate = await requireEffectivePlanFeature(authHeader, "has_forecasting");
        if (subscriptionGate) return subscriptionGate;

        const event = {

            headers:{
                Authorization:authHeader,
                authorization:authHeader,
                "Content-Type":
                    "application/json"
            },

            body:JSON.stringify({
                ...body,

                action:
                    body.action === "get_seasonal_analysis"
                        ?
                        "get_seasonal_forecast"
                        :
                        body.action
            }),

            httpMethod:"POST",

            requestContext:{
                http:{
                    method:"POST"
                }
            }

        };


        const result =
            await handler(event);


        const responseBody =
            result.body
                ?
                JSON.parse(result.body)
                :
                {};


        return NextResponse.json(
            responseBody,
            {
                status:
                    result.statusCode || 200
            }
        );


    } catch(error){

        console.error(
            "LOCAL FORECASTING ERROR:",
            error
        );


        return NextResponse.json(
            {
                error:
                    "Local forecasting failed.",
                details:
                    error instanceof Error
                        ?
                        error.message
                        :
                        "Unknown error"
            },
            {
                status:500
            }
        );

    }

}



export async function OPTIONS(){

    return new NextResponse(null,{
        status:204
    });

}