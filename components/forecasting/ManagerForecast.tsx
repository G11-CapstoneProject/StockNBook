"use client";

import {
    BranchForecastWorkspace,
    type LiveForecastProps,
} from "./_shared";

export default function ManagerForecast(props: LiveForecastProps) {
    return <BranchForecastWorkspace {...props} canViewInventory />;
}
