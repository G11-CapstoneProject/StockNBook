"use client";

import {
    BranchForecastWorkspace,
    type LiveForecastProps,
} from "./_shared";

export default function ManagerForecast(props: LiveForecastProps) {
    return (
        <BranchForecastWorkspace
            {...props}
            title="Manager Demand Forecast Overview"
            description="Review projected customer demand, recent product trends, seasonal signals, and upcoming booking demand for your assigned branch."
            canViewInventory
        />
    );
}
