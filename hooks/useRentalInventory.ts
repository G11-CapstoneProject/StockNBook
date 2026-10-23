"use client";

import * as React from "react";

// Rental inventory is intentionally separate from the Sales products controller.
// CONTRACT: implement the actions below in POST /api/rental-inventory, scoped and
// authorized to the manager's branch on the SERVER. The UI never invents stock.

export type RentalEquipment = {
    id: number;
    equipmentNumber: string;
    name: string;
    category: string;
    totalUnits: number;
    rentedOutUnits: number;
    maintenanceUnits: number;
    missingUnits: number;
    alertLevel: number;
    active: boolean;
    // Rental equipment purchase cost and rental charges are different amounts.
    rentalRatePerDay: number | null;
    averageUnitCost: number | null;
    lastSupplier: string | null;
    // Cost-based pricing uses an explicit total paid-rental-day recovery target.
    pricingMethod: RentalPricingMethod;
    pricingRecoveryDays: number | null;
    pricingResidualValue: number | null;
    pricingOperatingCostPerDay: number | null;
    pricingMarginPercent: number | null;
    pricingUnitCostBasis: number | null;
};

export type RentalPricingMethod = "manual" | "cost_based";
export type RentalPricingSelection = {
    pricingMethod: RentalPricingMethod;
    pricingRecoveryDays?: number | null;
    pricingResidualValue?: number | null;
    pricingOperatingCostPerDay?: number | null;
    pricingMarginPercent?: number | null;
    // Opt-in recalculation after equipment has been received at a different cost.
    pricingRefreshBasis?: boolean;
};

/** Estimated minimum daily rate, rounded UP to whole pesos.
 * This is a pricing suggestion, NOT book depreciation or a market quotation.
 */
export function calculateCostBasedRentalRate(
    unitCost: number, residual: number, recoveryDays: number,
    operatingPerDay: number, marginPercent: number
): number | null {
    if (![unitCost, residual, recoveryDays, operatingPerDay, marginPercent]
            .every(Number.isFinite) || unitCost < 0 || residual < 0 || residual > unitCost ||
        !Number.isSafeInteger(recoveryDays) || recoveryDays < 1 || recoveryDays > 10980 ||
        operatingPerDay < 0 || marginPercent < 0 || marginPercent > 80) return null;
    const recoveryPerPaidDay = (unitCost - residual) / recoveryDays;
    const raw = (recoveryPerPaidDay + operatingPerDay) / (1 - marginPercent / 100);
    return Number.isFinite(raw) && raw <= 100000000 ? Math.ceil(raw - 1e-9) : null;
}


export type RentalActivityType =
    | "received" | "rented_out" | "returned" | "maintenance_started"
    | "maintenance_completed" | "missing_reported" | "missing_resolved"
    | "adjustment";

export type RentalActivity = {
    id: string;
    equipmentId: number;
    equipmentName: string;
    type: RentalActivityType;
    quantity: number;
    occurredAt: string;
    referenceNumber: string;
};

// One still-open maintenance record per repair/inspection transaction.
// Units reflect quantity_remaining, not quantity originally reported.
export type RentalMaintenanceRecord = {
    id: number;
    equipmentId: number;
    equipmentName: string;
    units: number;
    quantityStarted: number;
    reason: string;
    dateReported: string; // YYYY-MM-DD, reported in the branch's local date
    estimatedCompletion: string | null;
    status: "In Repair" | "For Inspection" | "Routine";
    repairApproved: boolean;
    pendingCompletionId: number | null;
    pendingCompletionUnits: number | null;
    pendingCompletionNotes?: string | null;
};

export type RentalMissingReport = {
    id:number; equipmentId:number; equipmentName:string; quantity:number;
    reason:string; reportedAt:string; reportedBy:string;
};

export type RentalPendingReceipt = {
    id:number; equipmentId:number; equipmentName:string; purchaseNumber:string;
    quantityExpected:number; quantityReceived:number;
};

export type StaffRentalPendingReceipt = RentalPendingReceipt & {equipmentNumber:string};
export type StaffRentalMaintenanceTask = {
    id:number; equipmentId:number; equipmentName:string; units:number; reason:string;
    repairApproved:boolean; pendingUnits:number;
    conditionStatus: "In Repair" | "For Inspection" | "Routine";
};

export type RentalSummary = {
    rentalProducts: number | null;
    totalUnits: number | null;
    availableUnits: number | null;
    rentedOutUnits: number | null;
    maintenanceUnits: number | null;
    missingUnits: number | null;
};

export type RentalAvailability = {
    equipmentId: number;
    availableUnits: number;
};

export type RentalIssue = {
    id: string;
    equipment: RentalEquipment;
    issue: "Stock Discrepancy" | "Missing Units" | "Under Maintenance" | "Low Availability";
    quantity: number;
    action: "Review" | "Manage Repair" | "Receive Equipment";
};

const emptySummary: RentalSummary = {
    rentalProducts: null, totalUnits: null, availableUnits: null,
    rentedOutUnits: null, maintenanceUnits: null, missingUnits: null,
};

function nonnegativeInteger(value: unknown): number {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function optionalMoney(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

export type RentalPurchaseDetails = {
    supplier: string;
    supplierInvoiceNumber?: string;
    purchaseDate: string;
    quantity: number;
    unitCost: number;
    paymentMethod: "cash" | "credit";
    amountPaid: number;
    paymentDueDate?: string | null;
};

export type RentalImportRow = {
    name: string;
    category: string;
    openingUnits: number;
    unitCost: number;
    rentalRatePerDay: number;
} & RentalPricingSelection;

// One supplier purchase for the ENTIRE XLSX file, as in Sales Inventory.
export type RentalBulkPurchase = {
    supplier: string;
    supplierInvoiceNumber?: string;
    purchaseDate: string;
    paymentMethod: "cash" | "credit";
    amountPaid: number;
    paymentDueDate: string | null;
};

// Derive this from physical stock, never from reservations or Sales product counts.
export function availableNow(item: RentalEquipment): number {
    return Math.max(0, item.totalUnits - item.rentedOutUnits - item.maintenanceUnits - item.missingUnits);
}

export function hasRentalStockDiscrepancy(item: RentalEquipment): boolean {
    return item.rentedOutUnits + item.maintenanceUnits + item.missingUnits > item.totalUnits;
}

export function calculateRentalSummary(items: readonly RentalEquipment[]): RentalSummary {
    const active = items.filter(item => item.active);
    return {
        rentalProducts: active.length,
        totalUnits: active.reduce((sum, item) => sum + item.totalUnits, 0),
        availableUnits: active.reduce((sum, item) => sum + availableNow(item), 0),
        rentedOutUnits: active.reduce((sum, item) => sum + item.rentedOutUnits, 0),
        maintenanceUnits: active.reduce((sum, item) => sum + item.maintenanceUnits, 0),
        missingUnits: active.reduce((sum, item) => sum + item.missingUnits, 0),
    };
}

export function getRentalIssues(items: readonly RentalEquipment[]): RentalIssue[] {
    const issues: RentalIssue[] = [];
    for (const item of items) {
        if (!item.active) continue;
        if (hasRentalStockDiscrepancy(item)) {
            issues.push({id: `${item.id}-discrepancy`, equipment: item,
                issue: "Stock Discrepancy", quantity: item.rentedOutUnits + item.maintenanceUnits + item.missingUnits - item.totalUnits,
                action: "Review"});
        }
        if (item.missingUnits > 0) {
            issues.push({id: `${item.id}-missing`, equipment: item,
                issue: "Missing Units", quantity: item.missingUnits, action: "Review"});
        }
        if (item.maintenanceUnits > 0) {
            issues.push({id: `${item.id}-maintenance`, equipment: item,
                issue: "Under Maintenance", quantity: item.maintenanceUnits, action: "Manage Repair"});
        }
        if (item.alertLevel > 0 && availableNow(item) <= item.alertLevel) {
            issues.push({id: `${item.id}-shortage`, equipment: item,
                issue: "Low Availability", quantity: availableNow(item), action: "Receive Equipment"});
        }
    }
    const priority: Record<RentalIssue["issue"], number> = {
        "Stock Discrepancy": 0, "Missing Units": 1, "Under Maintenance": 2, "Low Availability": 3,
    };
    return issues.sort((a, b) => priority[a.issue] - priority[b.issue] || a.equipment.name.localeCompare(b.equipment.name));
}

function normalizeEquipment(value: unknown): RentalEquipment | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const id = Number(raw.id);
    if (!Number.isSafeInteger(id) || id <= 0 || !String(raw.name ?? "").trim()) return null;
    // Reject records with missing physical counters rather than silently asserting zero.
    for (const key of ["totalUnits", "rentedOutUnits", "maintenanceUnits", "missingUnits"]) {
        if (raw[key] === undefined || raw[key] === null ||
            !Number.isSafeInteger(Number(raw[key])) || Number(raw[key]) < 0) return null;
    }
    return {
        id,
        equipmentNumber: String(raw.equipmentNumber ?? "").trim(),
        name: String(raw.name).trim(),
        category: String(raw.category ?? "Uncategorized").trim() || "Uncategorized",
        totalUnits: nonnegativeInteger(raw.totalUnits),
        rentedOutUnits: nonnegativeInteger(raw.rentedOutUnits),
        maintenanceUnits: nonnegativeInteger(raw.maintenanceUnits),
        missingUnits: nonnegativeInteger(raw.missingUnits),
        alertLevel: nonnegativeInteger(raw.alertLevel),
        active: raw.active !== false,
        rentalRatePerDay: optionalMoney(raw.rentalRatePerDay),
        averageUnitCost: optionalMoney(raw.averageUnitCost),
        lastSupplier: typeof raw.lastSupplier === "string" ? raw.lastSupplier.trim() || null : null,
        pricingMethod: raw.pricingMethod === "cost_based" ? "cost_based" : "manual",
        pricingRecoveryDays: optionalMoney(raw.pricingRecoveryDays),
        pricingResidualValue: optionalMoney(raw.pricingResidualValue),
        pricingOperatingCostPerDay: optionalMoney(raw.pricingOperatingCostPerDay),
        pricingMarginPercent: optionalMoney(raw.pricingMarginPercent),
        pricingUnitCostBasis: optionalMoney(raw.pricingUnitCostBasis),
    };
}

const ACTIVITY_TYPES: RentalActivityType[] = [
    "received", "rented_out", "returned", "maintenance_started", "maintenance_completed",
    "missing_reported", "missing_resolved", "adjustment",
];
function normalizeActivity(value: unknown): RentalActivity | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const type = String(raw.type ?? "") as RentalActivityType;
    if (!ACTIVITY_TYPES.includes(type) || !raw.id || !raw.occurredAt) return null;
    if (!Number.isFinite(Date.parse(String(raw.occurredAt)))) return null;
    return {
        id: String(raw.id), equipmentId: Number(raw.equipmentId) || 0,
        equipmentName: String(raw.equipmentName ?? "Equipment"),
        type, quantity: nonnegativeInteger(raw.quantity),
        occurredAt: String(raw.occurredAt),
        referenceNumber: String(raw.referenceNumber ?? "").trim(),
    };
}

function normalizeMaintenanceRecord(value: unknown): RentalMaintenanceRecord | null {
    if (!value || typeof value !== "object") return null;
    const raw = value as Record<string, unknown>;
    const id = Number(raw.id), equipmentId = Number(raw.equipmentId);
    const units = Number(raw.units), quantityStarted = Number(raw.quantityStarted);
    const dateReported = String(raw.dateReported ?? "");
    const estimatedCompletion = raw.estimatedCompletion == null ? null : String(raw.estimatedCompletion);
    const status = raw.status === "For Inspection" ? "For Inspection" :
        raw.status === "In Repair" ? "In Repair" :
            raw.status === "Routine" ? "Routine" : null;
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(equipmentId) || equipmentId <= 0 ||
        !Number.isSafeInteger(units) || units <= 0 || !Number.isSafeInteger(quantityStarted) ||
        quantityStarted < units || !status || !/^\d{4}-\d{2}-\d{2}$/.test(dateReported) ||
        (estimatedCompletion !== null && !/^\d{4}-\d{2}-\d{2}$/.test(estimatedCompletion))) return null;
    return { id, equipmentId, equipmentName: String(raw.equipmentName ?? "Equipment"),
        units, quantityStarted, reason: String(raw.reason ?? ""),
        dateReported, estimatedCompletion, status,
        repairApproved:raw.repairApproved===true || raw.repairApproved===1,
        pendingCompletionId:raw.pendingCompletionId==null?null:Number(raw.pendingCompletionId),
        pendingCompletionUnits:raw.pendingCompletionUnits==null?null:Number(raw.pendingCompletionUnits),
        pendingCompletionNotes:typeof raw.pendingCompletionNotes==="string"?raw.pendingCompletionNotes:null };
}

export type RentalMutation =
    | { action: "create_equipment"; name: string; category: string; alertLevel: number;
    rentalRatePerDay: number; initialPurchase?: RentalPurchaseDetails } & RentalPricingSelection
    | { action: "update_equipment"; equipmentId: number; name: string; category: string; alertLevel: number;
    rentalRatePerDay?: number } & RentalPricingSelection
    | ({ action: "receive_equipment"; equipmentId: number } & RentalPurchaseDetails)
    | { action: "start_maintenance"; equipmentId: number; quantity: number; reason: string;
    conditionStatus?: "In Repair" | "For Inspection"; estimatedCompletionDate?: string | null }
    | { action: "complete_maintenance"; equipmentId: number; quantity: number; reason: string }
    | { action: "import_equipment"; importMode: "single_purchase"; rows: RentalImportRow[]; purchase: RentalBulkPurchase }
    | { action: "create_rental_category"; name: string }
    | { action: "rename_rental_category"; previousName: string; name: string }
    | { action: "archive_rental_category"; name: string }
    | { action: "archive_equipment"; equipmentId:number; confirmName:string; reason:string }
    | { action: "approve_maintenance_repair"; maintenanceId:number }
    | { action: "approve_repair_completion"; requestId:number }
    | { action: "resolve_missing_equipment"; reportId:number; resolution:"found"|"writeoff"; notes:string };

type ApiResponse = { success?: boolean; error?: string; equipment?: unknown; activity?: unknown;
    availability?: unknown; referenceNumber?: string; categories?: unknown; bookingSyncConnected?: boolean;
    maintenanceRecords?: unknown; pendingReceipts?: unknown; missingReports?: unknown };

async function requestRental(action: Record<string, unknown>, signal?: AbortSignal): Promise<ApiResponse> {
    const token = typeof window !== "undefined" ? sessionStorage.getItem("token") : null;
    if (!token) throw new Error("Your session has expired. Please sign in again.");
    const response = await fetch("/api/rental-inventory", {
        method: "POST", cache: "no-store", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(action),
    });
    const result = await response.json().catch(() => ({})) as ApiResponse;
    if (!response.ok || result.success !== true) {
        throw new Error(result.error || (response.status === 404
            ? "Rental inventory backend is not connected yet (/api/rental-inventory)."
            : `Rental inventory request failed (HTTP ${response.status}).`));
    }
    return result;
}

export function useRentalInventory(branchId?: number) {
    const validBranchId = Number.isSafeInteger(branchId) && Number(branchId) > 0 ? Number(branchId) : null;
    // A manager may omit branchId because the backend resolves their assigned branch.
    // If a caller explicitly supplies an invalid branch, fail instead of silently
    // dropping it and accidentally falling back to another branch.
    const invalidExplicitBranch = branchId !== undefined && validBranchId === null;
    const [equipment, setEquipment] = React.useState<RentalEquipment[]>([]);
    const [recentActivity, setRecentActivity] = React.useState<RentalActivity[]>([]);
    const [maintenanceRecords, setMaintenanceRecords] = React.useState<RentalMaintenanceRecord[]>([]);
    const [pendingReceipts,setPendingReceipts] = React.useState<RentalPendingReceipt[]>([]);
    const [missingReports,setMissingReports] = React.useState<RentalMissingReport[]>([]);
    const [maintenanceDataReady, setMaintenanceDataReady] = React.useState(false);
    const [savedCategories, setSavedCategories] = React.useState<string[]>([]);
    const [bookingSyncConnected, setBookingSyncConnected] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [connected, setConnected] = React.useState(false);
    const inFlight = React.useRef<AbortController | null>(null);
    const loaded = React.useRef(false);

    const refresh = React.useCallback(async (force = false) => {
        // Manager branch is resolved securely from the JWT on the backend.
        // Passing the branch ID is optional for managers (owners must select one).
        if (invalidExplicitBranch) {
            inFlight.current?.abort();
            inFlight.current = null;
            loaded.current = false;
            setError("The selected rental branch is invalid. Choose a valid branch.");
            setLoading(false); setRefreshing(false);
            setConnected(false); setBookingSyncConnected(false);
            setEquipment([]); setRecentActivity([]); setMaintenanceRecords([]);setPendingReceipts([]);setMissingReports([]);
            setMaintenanceDataReady(false); setSavedCategories([]);
            return;
        }
        if (inFlight.current) {
            if (!force) return;
            inFlight.current.abort();
            inFlight.current = null;
        }
        const controller = new AbortController();
        inFlight.current = controller;
        if (!loaded.current) setLoading(true);
        else setRefreshing(true);
        try {
            const result = await requestRental({action: "get_manager_inventory", ...(validBranchId ? {branch_id: validBranchId} : {})}, controller.signal);
            if (!Array.isArray(result.equipment) || !Array.isArray(result.activity)) {
                throw new Error("Rental inventory API returned an unexpected response.");
            }
            const normalized = result.equipment.map(normalizeEquipment);
            if (normalized.some(item => item === null)) throw new Error("Rental equipment quantities are incomplete or invalid.");
            const maintenanceAvailable = Array.isArray(result.maintenanceRecords);
            const normalizedMaintenance = maintenanceAvailable
                ? (result.maintenanceRecords as unknown[]).map(normalizeMaintenanceRecord) : [];
            if (normalizedMaintenance.some(item => item === null)) {
                throw new Error("The rental API returned an invalid maintenance record.");
            }
            if (!controller.signal.aborted) {
                setEquipment(normalized as RentalEquipment[]);
                setMaintenanceDataReady(maintenanceAvailable);
                setMaintenanceRecords(normalizedMaintenance as RentalMaintenanceRecord[]);
                setPendingReceipts(Array.isArray(result.pendingReceipts)
                    ? (result.pendingReceipts as RentalPendingReceipt[]).filter(x => Number.isSafeInteger(x.id) && x.id>0) : []);
                setMissingReports(Array.isArray(result.missingReports)?result.missingReports as RentalMissingReport[]:[]);
                setBookingSyncConnected(result.bookingSyncConnected === true);
                setSavedCategories(Array.isArray(result.categories)
                    ? result.categories.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
                        .map(x => x.trim())
                    : []);
                setRecentActivity(result.activity.map(normalizeActivity).filter((a): a is RentalActivity => Boolean(a))
                    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)));
                setConnected(true); setError(null); loaded.current = true;
            }
        } catch (cause) {
            if (!controller.signal.aborted) {
                setError(cause instanceof Error ? cause.message : "Could not load rental inventory.");
                // If a refresh fails, retain previously loaded data, but never show it as live.
                if (!loaded.current) { setConnected(false); setBookingSyncConnected(false); setEquipment([]); setRecentActivity([]);
                    setMaintenanceRecords([]);setPendingReceipts([]);setMissingReports([]);setMaintenanceDataReady(false); }
            }
        } finally {
            if (inFlight.current === controller) inFlight.current = null;
            if (!controller.signal.aborted) { setLoading(false); setRefreshing(false); }
        }
    }, [validBranchId, invalidExplicitBranch]);

    React.useEffect(() => {
        loaded.current = false;
        setConnected(false); setBookingSyncConnected(false); setEquipment([]); setRecentActivity([]);
        setMaintenanceRecords([]);setPendingReceipts([]);setMissingReports([]); setMaintenanceDataReady(false); setSavedCategories([]); setLoading(true);
        void refresh();
        const onFocus = () => { if (document.visibilityState === "visible") void refresh(); };
        window.addEventListener("focus", onFocus);
        window.addEventListener("stocknbook:rental-inventory-refresh", onFocus);
        const interval = window.setInterval(onFocus, 60_000);
        return () => {
            inFlight.current?.abort(); inFlight.current = null;
            window.removeEventListener("focus", onFocus);
            window.removeEventListener("stocknbook:rental-inventory-refresh", onFocus);
            window.clearInterval(interval);
        };
    }, [refresh]);

    const mutate = React.useCallback(async (mutation: RentalMutation) => {
        if (invalidExplicitBranch) throw new Error("The selected rental branch is invalid.");
        setSaving(true);
        try {
            const result = await requestRental({...mutation, ...(validBranchId ? {branch_id: validBranchId} : {}), requestKey: crypto.randomUUID()});
            // All stock writes must be atomic and audited by the backend.
            await refresh(true);
            return result.referenceNumber || "";
        } finally { setSaving(false); }
    }, [validBranchId, invalidExplicitBranch, refresh]);

    const checkAvailability = React.useCallback(async (startDate: string, endDate: string): Promise<RentalAvailability[]> => {
        if (invalidExplicitBranch) throw new Error("The selected rental branch is invalid.");
        if (!startDate || !endDate || endDate < startDate) throw new Error("Select a valid rental date range.");
        // Backend handles overlapping confirmed bookings AND checked-out units exactly once.
        // Date-range availability must not be derived from today's available units.
        const result = await requestRental({action: "check_availability", ...(validBranchId ? {branch_id: validBranchId} : {}),
            start_date: startDate, end_date: endDate});
        if (!Array.isArray(result.availability)) throw new Error("Availability data was not returned.");
        return result.availability
            .filter((v: unknown): v is {equipmentId: number; availableUnits: number} => Boolean(v && typeof v === "object"))
            .map((v) => ({equipmentId: Number(v.equipmentId), availableUnits: nonnegativeInteger(v.availableUnits)}))
            .filter(v => Number.isSafeInteger(v.equipmentId) && v.equipmentId > 0);
    }, [validBranchId, invalidExplicitBranch]);

    const summary = React.useMemo(() => connected ? calculateRentalSummary(equipment) : emptySummary, [connected, equipment]);
    const actions = React.useMemo(() => getRentalIssues(equipment), [equipment]);
    const categories = React.useMemo(() => [...new Set([
        ...savedCategories, ...equipment.map(item => item.category),
    ])].sort((a,b) => a.localeCompare(b)), [savedCategories, equipment]);
    return { equipment, recentActivity, maintenanceRecords, pendingReceipts, missingReports, maintenanceDataReady,
        categories, summary, actions, loading, refreshing, saving,
        connected, bookingSyncConnected, error, refresh, mutate, checkAvailability };
}

// ---------------------------------------------------------------------------
// STAFF RENTAL OPERATIONS: shared in existing hook, no new hook file needed.
// The staff API projection is restricted server-side; never expose manager costs.
// ---------------------------------------------------------------------------
export type StaffRentalEquipment = {
    id: number; equipmentNumber: string; name: string; category: string;
    totalUnits: number; rentedOutUnits: number; maintenanceUnits: number;
    missingUnits: number; alertLevel: number;
};
export type StaffRentalAllocation = {
    allocationId: number; bookingReference: string; equipmentId: number;
    equipmentName: string; equipmentNumber: string; quantity: number;
    startDate: string; endDate: string;
    bookingTotal: number; amountPaid: number; bookingBalance: number;
    status: "reserved" | "checked_out" | "returned" | "cancelled";
    preparedAt: string | null; returnedAt: string | null;
    returnedReceivedUnits: number; // Returned physically (not missing)
    cleaningUnits: number; damagedUnits: number;
    inspectionStatus: "pending" | "cleared" | "cleaning" | "damaged" | null;
    inspectionNotes: string | null;
};
export type StaffRentalEquipmentSchedule = {
    equipmentId:number; date:string; totalUnits:number; rentedOutUnits:number;
    maintenanceUnits:number; missingUnits:number; physicallyAvailableNow:number;
    bookedUnits:number; allocationCount:number; availableOnDate:number;
    bookings: Array<{allocationId:number;bookingReference:string;quantity:number;
        startDate:string;endDate:string;status:"reserved"|"checked_out"}>;
};
export type StaffRentalMovement = {
    id: number; equipmentId: number; equipmentName: string;
    type: string; quantity: number; occurredAt: string; referenceNumber: string;
};
export type StaffRentalStockAction =
    | { action:"staff_receive_rental_purchase"; taskId:number; quantity:number }
    | { action:"staff_report_equipment_issue"; equipmentId:number; quantity:number; reason:string; issueType:"routine"|"damage"|"missing" }
    | { action:"staff_submit_repair_completion"; maintenanceId:number; quantity:number; notes:string }
    | { action:"staff_complete_routine_maintenance"; maintenanceId:number; quantity:number; notes:string };
export type StaffRentalBookingAction =
    | {action:"release_rental_booking"; bookingReference:string}
    | {action:"return_rental_booking"; bookingReference:string;
    returns:Array<{allocationId:number;missingUnits:number}>;notes:string};
export type StaffRentalAction =
    "prepare_rental_allocation" | "release_rental_allocation" |
    "return_rental_allocation" | "inspect_rental_allocation" | "clean_rental_allocation";

type ApiResult = {
    success?: boolean; error?: string; equipment?: StaffRentalEquipment[];
    allocations?: StaffRentalAllocation[]; activity?: StaffRentalMovement[];
    pendingReceipts?: StaffRentalPendingReceipt[]; maintenanceTasks?: StaffRentalMaintenanceTask[];
    schedule?: StaffRentalEquipmentSchedule;
};

async function rentalRequest(body: Record<string, unknown>, signal?: AbortSignal): Promise<ApiResult> {
    const token = sessionStorage.getItem("token");
    if (!token) throw new Error("Your session has expired. Sign in again.");
    const result = await fetch("/api/rental-inventory", {
        method: "POST", cache: "no-store", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await result.json().catch(() => ({})) as ApiResult;
    if (!result.ok || data.success !== true) {
        throw new Error(data.error || `Rental request failed (HTTP ${result.status}).`);
    }
    return data;
}

export function useStaffRentalInventory() {
    const [equipment, setEquipment] = React.useState<StaffRentalEquipment[]>([]);
    const [allocations, setAllocations] = React.useState<StaffRentalAllocation[]>([]);
    const [activity, setActivity] = React.useState<StaffRentalMovement[]>([]);
    const [pendingReceipts,setPendingReceipts] = React.useState<StaffRentalPendingReceipt[]>([]);
    const [maintenanceTasks,setMaintenanceTasks] = React.useState<StaffRentalMaintenanceTask[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [refreshing, setRefreshing] = React.useState(false);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [connected, setConnected] = React.useState(false);
    const controller = React.useRef<AbortController | null>(null);
    const loaded = React.useRef(false);

    const refresh = React.useCallback(async (force = false) => {
        // React Strict Mode may abort the initial request during effect cleanup.
        // An aborted controller must not block the next attempt to load the page.
        if (controller.current?.signal.aborted) controller.current = null;
        if (controller.current) {
            if (!force) return;
            controller.current.abort();
        }
        const abort = new AbortController();
        controller.current = abort;
        if (loaded.current) setRefreshing(true);
        else setLoading(true);
        let timedOut = false;
        const timeoutId = window.setTimeout(() => {
            timedOut = true;
            abort.abort();
        }, 20000);
        try {
            const response = await rentalRequest({ action: "get_staff_rental_workspace" }, abort.signal);
            if (!Array.isArray(response.equipment) || !Array.isArray(response.allocations) || !Array.isArray(response.activity)) {
                throw new Error("Rental inventory returned an invalid response.");
            }
            if (!abort.signal.aborted) {
                setEquipment(response.equipment);
                setAllocations(response.allocations);
                setActivity(response.activity);
                setPendingReceipts(Array.isArray(response.pendingReceipts)?response.pendingReceipts:[]);
                setMaintenanceTasks(Array.isArray(response.maintenanceTasks)?response.maintenanceTasks:[]);
                setConnected(true); setError(null); loaded.current = true;
            }
        } catch (reason) {
            if (!abort.signal.aborted || timedOut) {
                setConnected(false);
                setError(timedOut
                    ? "Rental inventory request timed out. Please retry."
                    : reason instanceof Error ? reason.message : "Unable to load rental inventory.");
                if (!loaded.current) { setEquipment([]); setAllocations([]); setActivity([]);setPendingReceipts([]);setMaintenanceTasks([]); }
            }
        } finally {
            window.clearTimeout(timeoutId);
            // Only the latest active request is allowed to change loading state.
            // This avoids a cancelled request overriding a newer request's UI.
            if (controller.current === abort) {
                controller.current = null;
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, []);

    React.useEffect(() => {
        void refresh();
        const onRefresh = () => { if (document.visibilityState === "visible") void refresh(); };
        window.addEventListener("focus", onRefresh);
        const timer = window.setInterval(onRefresh, 60_000);
        return () => {
            controller.current?.abort();
            controller.current = null; // Allow the next effect setup to start a fresh request.
            window.removeEventListener("focus", onRefresh);
            window.clearInterval(timer);
        };
    }, [refresh]);

    const act = React.useCallback(async (action: StaffRentalAction, allocationId: number,
                                         options: { condition?: "good" | "cleaning" | "damaged"; notes?: string;
                                             missingUnits?: number; goodUnits?: number; cleaningUnits?: number; damagedUnits?: number } = {}) => {
        if (saving) throw new Error("Please wait for the current operation to finish.");
        setSaving(true);
        try {
            const response = await rentalRequest({ action, allocationId, ...options, requestKey: crypto.randomUUID() });
            await refresh(true);
            return response;
        } finally { setSaving(false); }
    }, [refresh, saving]);
    // Atomic, idempotent booking-wide handover/return (not per-equipment API loops).
    const actBooking=React.useCallback(async(mutation:StaffRentalBookingAction)=>{
        if(saving)throw new Error("Please wait for the current operation to finish.");
        setSaving(true);
        try {
            const result=await rentalRequest({...mutation,requestKey:crypto.randomUUID()});
            await refresh(true);
            return result;
        } finally {setSaving(false);}
    },[saving,refresh]);
    const actStock=React.useCallback(async (mutation:StaffRentalStockAction)=>{
        if(saving)throw new Error("Please wait for the current operation to finish.");
        setSaving(true);
        try {
            const result=await rentalRequest({...mutation,requestKey:crypto.randomUUID()});
            await refresh(true);
            return result;
        } finally {setSaving(false);}
    },[saving,refresh]);
    const getEquipmentSchedule=React.useCallback(async(equipmentId:number,date:string,signal?:AbortSignal)=>{
        const response=await rentalRequest({action:"get_staff_equipment_schedule",equipmentId,date},signal);
        if(!response.schedule || response.schedule.equipmentId!==equipmentId || response.schedule.date!==date ||
            !Array.isArray(response.schedule.bookings))throw new Error("Invalid rental schedule response.");
        return response.schedule;
    },[]);
    return { equipment, allocations, activity, pendingReceipts, maintenanceTasks,
        loading, refreshing, saving, error, connected, refresh, act, actBooking, actStock, getEquipmentSchedule };
}