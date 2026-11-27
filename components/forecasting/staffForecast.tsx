"use client";

import {
    BranchForecastWorkspace,
    type LiveForecastProps,
} from "./_shared";

// Staff see demand and plans without stock quantities or order amounts.
export default function StaffForecast(props: LiveForecastProps) {
    return <BranchForecastWorkspace {...props} canViewInventory={false} />;
}
