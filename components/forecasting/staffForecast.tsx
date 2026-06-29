"use client";

import {
    BranchForecastWorkspace,
    type LiveForecastProps,
} from "./_shared";

export default function StaffForecast(props: LiveForecastProps) {
    return (
        <BranchForecastWorkspace
            {...props}
            title="Staff Demand Forecast Overview"
            description="Review product demand signals, upcoming booking demand, and inventory actions for your assigned branch."
            canViewInventory={false}
        />
    );
}
