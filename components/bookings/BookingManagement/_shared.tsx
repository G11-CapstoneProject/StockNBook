"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    CreditCard,
    MapPin,
    Package,
    Palette,
    PhilippinePeso,
    StickyNote,
    UserRound,
    CalendarDays,
    ShieldCheck,
    Download,
} from "lucide-react";
import BookingFinancialPanel from "./BookingFinancialPanel";

export type BookingAccess = "none" | "view" | "standard" | "full";

export type FilterType =
    | "All"
    | "Pending Review"
    | "Awaiting Down Payment"
    | "Confirmed"
    | "Preparing"
    | "Released"
    | "Return Inspection"
    | "Pending Settlement"
    | "Completed"
    | "Cancelled"
    | "Rejected";

export const TABS: FilterType[] = [
    "All",
    "Pending Review",
    "Awaiting Down Payment",
    "Confirmed",
    "Preparing",
    "Released",
    "Return Inspection",
    "Pending Settlement",
    "Completed",
    "Cancelled",
    "Rejected",
];

export type Booking = {
    id: number;

    branchId?: number | null;
    branch_id?: number | null;
    branchName?: string;
    branch_name?: string;

    bookingReference?: string;
    booking_reference?: string;

    bookingType?: string;
    booking_type?: string;
    rentalItemCount?: number | null;
    customConsumableItemCount?: number | null;
    consumableItemCount?: number | null;

    name: string;
    facebookName?: string;
    facebook_name?: string;
    phone?: string;
    email?: string;

    date: string;
    eventEndDate?: string | null;
    event_end_date?: string | null;
    eventTime?: string;
    event_time?: string;
    eventType?: string;
    event_type?: string;

    package?: string;
    packageName?: string;
    package_name?: string;

    customOrder?: string;
    custom_order?: string;

    theme?: string;
    venue?: string;
    notes?: string;
    additional_custom_request?: string;
    additionalCustomRequest?: string;
    theme_motif_request?: string;
    themeMotifRequest?: string;
    additional_notes?: string;
    additionalNotes?: string;
    refundable_deposit?: number | string | null;
    refundableDeposit?: number | string | null;
    // Booking-specific deposit snapshot from the financial ledger (not revenue).
    securityDepositRequired?: number | string | null;
    securityDepositCollected?: number | string | null;

    status: string;
    approvalStatus?: "pending" | "approved" | "rejected" | null;
    approvalReason?: string | null;

    agreed_price?: number | string | null;
    agreedPrice?: number | string | null;

    package_price?: number | string | null;
    packagePrice?: number | string | null;

    required_down_payment?: number | string | null;
    requiredDownPayment?: number | string | null;

    down_payment_amount?: number | string | null;
    downPaymentAmount?: number | string | null;

    amount_paid?: number | string | null;
    amountPaid?: number | string | null;

    balance?: number | string | null;

    payment_status?: string | null;
    paymentStatus?: string | null;

    createdAt?: string;
    created_at?: string;
};

type BookingRentalItem = {
    id: number;
    equipment_id: number;
    equipment_name: string;
    quantity: number | string;
    start_date: string;
    end_date: string;
    billable_days: number | string;
    allocation_status: string;
    available_for_event?: number | null;
    availability_note?: string | null;
    daily_rate?: number | string | null;
    rental_rate?: number | string | null;
    amount?: number | string | null;
};

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity?: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    inventory_status?: string;
    available_for_booking?: number | null;
    availability_note?: string | null;
    unit_price?: number | string | null;
    total_price?: number | string | null;
};

// Read-only settlement values from the existing financial statement API.
// Deposits are liabilities, not booking revenue; never treat a proposed charge as paid.
type BookingSettlementSummary = {
    depositHeld: number;
    depositApplied: number;
    depositRefunded: number;
    approvedCharges: number;
    outstandingCharges: number;
};

type CalendarDropdownProps = {
    month: Date;
    bookingDateCounts: Record<string, number>;
    selectedDate: string;
    onChangeMonth: (date: Date) => void;
    onSelectDate: (dateKey: string) => void;
};

const STATUS_STYLE: Record<string, string> = {
    "Pending Review": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Awaiting Down Payment": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    Approved: "border-[#D8CBE7] bg-[#F5EEFF] text-[#5930A4]",
    Confirmed: "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    Preparing: "border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]",
    Released: "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    "Return Inspection": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Pending Settlement": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    Completed: "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
    Cancelled: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
    Rejected: "border-[#E3D5D5] bg-[#F9F4F4] text-[#8C4141]",
};

const PAYMENT_STYLE: Record<string, string> = {
    Unpaid: "border-[#F2C4C4] bg-[#FFF0F0] text-[#C32F2F]",
    "Down Payment Required": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Down Payment Paid": "border-[#C9D9FB] bg-[#EEF4FF] text-[#1D4ED8]",
    Partial: "border-[#D8CBE7] bg-[#F7F1FF] text-[#4E2C66]",
    "Fully Paid": "border-[#B7E9C8] bg-[#EDFBF1] text-[#138342]",
    "Deposit Pending": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
    "Deposit Unverified": "border-[#F4D79A] bg-[#FFF8E8] text-[#A56607]",
};

function rawValue(raw: Record<string, unknown>, key: string) {
    return raw[key];
}

function rawString(raw: Record<string, unknown>, key: string, fallback = "") {
    const value = rawValue(raw, key);

    if (value === undefined || value === null) return fallback;

    return String(value);
}

function rawNumber(raw: Record<string, unknown>, key: string, fallback = 0) {
    const value = rawValue(raw, key);
    const num = Number(value ?? fallback);

    return Number.isFinite(num) ? num : fallback;
}

export function peso(n: number | string | null | undefined) {
    const value = Number(n || 0);

    return `₱${value.toLocaleString("en-PH", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}

export function dateKey(value?: string | null) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return String(value).slice(0, 10);
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

export function formatDate(value?: string | null) {
    const key = dateKey(value);

    if (!key) return "—";

    const date = new Date(`${key}T00:00:00`);

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

// Format Booking List event times for display only. Keep the saved 24-hour value intact.
export function formatBookingListTime(value?: string | null): string {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    // API time values may include seconds (HH:mm:ss) or fractional seconds.
    const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/);
    if (!match) return raw; // Existing 12-hour strings or unknown formats are unchanged.

    const hour = Number(match[1]);
    const hour12 = hour % 12 || 12;
    return `${hour12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`;
}

export function formatMonth(date: Date) {
    return date.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });
}

function toNumber(value: unknown) {
    const n = Number(value || 0);
    return Number.isFinite(n) ? n : 0;
}

export function normalizeBookingStatus(value?: string | null) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();

    if (!raw) return "Pending Review";
    if (raw === "pending" || raw === "pending review") return "Pending Review";

    if (
        raw === "approved" ||
        raw === "awaiting down payment" ||
        raw === "waiting down payment" ||
        raw === "awaiting payment" ||
        raw === "down payment required"
    ) {
        return "Awaiting Down Payment";
    }

    if (raw === "confirmed") return "Confirmed";
    if (raw === "preparing") return "Preparing";
    if (raw === "released") return "Released";
    if (raw === "return inspection") return "Return Inspection";
    if (raw === "pending settlement") return "Pending Settlement";
    if (raw === "completed") return "Completed";
    if (raw === "cancelled" || raw === "canceled") return "Cancelled";
    if (raw === "rejected") return "Rejected";

    return value || "Pending Review";
}

function normalizePaymentStatus(value?: string | null) {
    const raw = String(value || "")
        .trim()
        .toLowerCase();

    if (!raw) return "";

    if (raw === "unpaid") return "Unpaid";
    if (raw === "down payment required") return "Down Payment Required";
    if (raw === "down payment paid") return "Down Payment Paid";
    if (raw === "partial") return "Partial";
    if (raw === "fully paid" || raw === "paid") return "Fully Paid";

    return value || "";
}

export function isCustomBooking(booking: Booking) {
    const type = String(booking.bookingType || booking.booking_type || "")
        .toLowerCase()
        .trim();

    const packageLabel = String(
        booking.package || booking.packageName || booking.package_name || ""
    )
        .toLowerCase()
        .trim();

    const customText = String(booking.customOrder || booking.custom_order || "")
        .toLowerCase()
        .trim();

    // Explicit booking type is authoritative. Free-text requests must not
    // reclassify a Rental booking as Custom.
    if (type === "rental" || type === "package") return false;
    if (type === "custom") return true;

    return packageLabel.includes("custom") || Boolean(customText);
}

export function getBookingItemLabel(booking: Booking) {
    if (getManagerBookingTypeLabel(booking) === "Rental") {
        return "Rental Equipment Booking";
    }
    if (isCustomBooking(booking)) {
        return "Custom Inventory Booking";
    }

    return (
        booking.package ||
        booking.packageName ||
        booking.package_name ||
        "Package Booking"
    );
}

// Display-only classification for the Manager booking screen. Never replace
// the actual bookingType value: API requests and pricing need the original data.
export function getManagerBookingTypeLabel(booking: Booking): "Custom" | "Package" | "Rental" {
    const rawType = String(booking.bookingType || booking.booking_type || "").trim().toLowerCase();
    if (rawType.includes("package")) return "Package";
    if (rawType.includes("custom")) return "Custom";
    if (rawType.includes("rental")) return "Rental";
    return isCustomBooking(booking) ? "Custom" : "Package";
}

// Composition is a display-only label; package vs custom remains the primary type.
// Never infer rental inclusion from the deposit (a rental deposit may be zero).
export function getManagerBookingCompositionLabel(booking: Booking): string {
    const base = getManagerBookingTypeLabel(booking);
    const rentalCount = booking.rentalItemCount;
    if (rentalCount == null || !Number.isFinite(Number(rentalCount))) return base;
    if (Number(rentalCount) <= 0) return base;
    if (base === "Package") return "Package + Rental";
    if (base === "Rental") return "Rental";
    const consumables = booking.consumableItemCount ?? booking.customConsumableItemCount;
    return consumables != null && Number(consumables) === 0
        ? "Custom · Rentals Only"
        : "Custom + Rental";
}

// Manager UI only: show the primary booking type with a separate composition line.
// Never infer rental equipment from payment/deposit values or the booking name.
export function getManagerBookingItemMixLabel(booking: Booking): string {
    const rental = booking.rentalItemCount;
    const consumable = booking.consumableItemCount ?? booking.customConsumableItemCount;
    if (rental == null || !Number.isFinite(Number(rental))) return "Composition unavailable";
    if (Number(rental) <= 0) return "Consumables only";
    if (consumable == null || !Number.isFinite(Number(consumable))) return "Includes rentals";
    return Number(consumable) > 0 ? "Consumables + Rentals" : "Rentals only";
}

// The persisted status remains "Awaiting Down Payment" to keep the existing API
// and inventory reservation workflow compatible. Only the manager UI says Approved.
export function getManagerBookingStatusLabel(status?: string | null) {
    const normalized = normalizeBookingStatus(status);
    return normalized === "Awaiting Down Payment" ? "Approved" : normalized;
}

// Manager-facing payment label only: retain all backend payment states,
// amounts, thresholds, and booking-transition rules unchanged.
export function getManagerPaymentLabel(booking: Booking): "Unpaid" | "Down Payment Paid" | "Fully Paid" | "Deposit Pending" | "Deposit Unverified" {
    const current = getPaymentStatus(booking);
    if (current === "Fully Paid") {
        if (booking.rentalItemCount != null && Number(booking.rentalItemCount) === 0) return "Fully Paid";
        // "Fully Paid" in bookings means the booking price only. Never show
        // that as final settlement when a refundable rental deposit remains due.
        const required = booking.securityDepositRequired;
        const collected = booking.securityDepositCollected;
        if (required == null || collected == null ||
            !Number.isFinite(Number(required)) || !Number.isFinite(Number(collected)) ||
            Number(required) < 0 || Number(collected) < 0) return "Deposit Unverified";
        return Number(collected) + 0.005 < Number(required) ? "Deposit Pending" : "Fully Paid";
    }
    if (current === "Down Payment Paid") return "Down Payment Paid";
    // Includes the former "Down Payment Required" and "Partial" labels.
    // The amounts remain visible so any partial receipt is never hidden.
    return "Unpaid";
}

export function getBookingItemSubtext(booking: Booking) {
    const parts = [
        booking.eventType || booking.event_type,
        booking.theme,
        booking.venue,
    ].filter(Boolean);

    return parts.length > 0 ? parts.join(" · ") : "No extra details";
}

export function getBranchGroupName(booking: Booking) {
    return booking.branchName || booking.branch_name || "Unassigned Branch";
}

export function getTotalPrice(booking: Booking) {
    if (isCustomBooking(booking)) {
        return toNumber(booking.agreed_price ?? booking.agreedPrice);
    }

    const agreed=toNumber(booking.agreed_price ?? booking.agreedPrice);
    return agreed>0 ? agreed : toNumber(booking.package_price ?? booking.packagePrice);
}

export function getRequiredDownPayment(booking: Booking) {
    return toNumber(
        booking.required_down_payment ??
        booking.requiredDownPayment ??
        booking.down_payment_amount ??
        booking.downPaymentAmount
    );
}

export function getAmountPaid(booking: Booking) {
    return toNumber(booking.amount_paid ?? booking.amountPaid);
}

export function getBalance(booking: Booking) {
    const explicitBalance = booking.balance;

    if (explicitBalance !== undefined && explicitBalance !== null) {
        return toNumber(explicitBalance);
    }

    return Math.max(getTotalPrice(booking) - getAmountPaid(booking), 0);
}

export function getPaymentStatus(booking: Booking) {
    const savedStatus = normalizePaymentStatus(
        booking.payment_status || booking.paymentStatus
    );

    const total = getTotalPrice(booking);
    const requiredDp = getRequiredDownPayment(booking);
    const paid = getAmountPaid(booking);

    if (total <= 0) return savedStatus || "Unpaid";
    if (paid >= total || savedStatus === "Fully Paid") return "Fully Paid";
    if (requiredDp > 0 && paid >= requiredDp) return "Down Payment Paid";
    if (paid > 0) return "Partial";
    if (requiredDp > 0) return "Down Payment Required";

    return savedStatus || "Unpaid";
}

export function normalizeBooking(
    raw: Record<string, unknown>,
    fallbackBranchName = "Assigned Branch"
): Booking {
    const branchId = rawValue(raw, "branchId") ?? rawValue(raw, "branch_id") ?? null;
    const branchName =
        rawValue(raw, "branchName") ?? rawValue(raw, "branch_name") ?? fallbackBranchName;

    return {
        ...raw,
        id: rawNumber(raw, "id"),
        branchId: branchId === null ? null : Number(branchId),
        branchName: String(branchName || fallbackBranchName),
        bookingReference:
            rawString(raw, "bookingReference") || rawString(raw, "booking_reference"),
        bookingType: rawString(raw, "bookingType") || rawString(raw, "booking_type"),
        rentalItemCount: rawValue(raw, "rentalItemCount") == null ? null : rawNumber(raw, "rentalItemCount"),
        customConsumableItemCount: rawValue(raw, "customConsumableItemCount") == null ? null : rawNumber(raw, "customConsumableItemCount"),
        consumableItemCount: rawValue(raw, "consumableItemCount") == null ? null : rawNumber(raw, "consumableItemCount"),
        facebookName: rawString(raw, "facebookName") || rawString(raw, "facebook_name"),
        eventEndDate: rawString(raw, "eventEndDate") || rawString(raw, "event_end_date") || null,
        eventTime: rawString(raw, "eventTime") || rawString(raw, "event_time"),
        eventType: rawString(raw, "eventType") || rawString(raw, "event_type"),
        package:
            rawString(raw, "package") ||
            rawString(raw, "packageName") ||
            rawString(raw, "package_name"),
        customOrder:
            rawString(raw, "customOrder") || rawString(raw, "custom_order"),
        status: normalizeBookingStatus(rawString(raw, "status")),
        approvalStatus: (rawValue(raw, "approvalStatus") || null) as Booking["approvalStatus"],
        approvalReason: String(rawValue(raw,"approvalReason") || "") || null,
        agreed_price: rawValue(raw, "agreed_price") ?? rawValue(raw, "agreedPrice") ?? null,
        refundable_deposit: rawValue(raw, "refundable_deposit") ?? rawValue(raw, "refundableDeposit") ?? null,
        package_price: rawValue(raw, "package_price") ?? rawValue(raw, "packagePrice") ?? null,
        required_down_payment:
            rawValue(raw, "required_down_payment") ??
            rawValue(raw, "requiredDownPayment") ??
            rawValue(raw, "down_payment_amount") ??
            rawValue(raw, "downPaymentAmount") ??
            0,
        amount_paid: rawValue(raw, "amount_paid") ?? rawValue(raw, "amountPaid") ?? 0,
        balance: rawValue(raw, "balance") ?? null,
        payment_status: normalizePaymentStatus(
            String(rawValue(raw, "payment_status") ?? rawValue(raw, "paymentStatus") ?? "Unpaid")
        ),
        createdAt: rawString(raw, "createdAt") || rawString(raw, "created_at"),
    } as Booking;
}

export function getSavedBookingAccess(role: "staff" | "manager" = "staff"): BookingAccess {
    try {
        const permissions = JSON.parse(
            sessionStorage.getItem("permissions") ||
            localStorage.getItem("permissions") ||
            "{}"
        ) as Record<string, unknown>;

        // The manager's editor saves both a legacy `bookings` boolean and
        // `bookings_access`. Read the granular access value first so `true`
        // cannot incorrectly override `"full"` or `"standard"`.
        const access = permissions.bookings_access ??
            permissions.booking_access ??
            permissions.bookings;

        if (access === undefined || access === null) {
            return role === "manager" ? "full" : "none";
        }
        if (role === "staff") {
            // Staff "full" in the access editor means standard-confirm only;
            // Manager-only pricing and cancellation actions stay unavailable.
            if (access === "full" || access === "standard" || access === "confirm_standard") return "standard";
            // Preserve legacy boolean grants as read-only, not write access.
            if (access === true || access === "true" || access === "view" ||
                access === "view_only" || access === "viewOnly") return "view";
            return "none";
        }
        if (access === "full" || access === true) return "full";
        if (access === "view" || access === "view_only" || access === "viewOnly") return "view";
        return "none";
    } catch {
        return role === "manager" ? "full" : "none";
    }
}

export function MetricCard({
                               title,
                               value,
                               subLabel,
                               subValue,
                           }: {
    title: string;
    value: string;
    subLabel?: string;
    subValue?: string;
}) {
    return (
        <div className="min-h-[102px] rounded-[14px] border border-[#E6DDF0] bg-white px-4 py-3 shadow-sm">
            <p className="text-sm font-semibold text-[#2B174C]">{title}</p>

            <p className="mt-1 truncate text-[24px] font-bold leading-tight text-[#1A1220]">
                {value}
            </p>

            {subLabel && subValue && (
                <div className="mt-2 flex items-center justify-between gap-3 border-t border-[#EFE7F4] pt-2 text-xs">
                    <span className="text-[#7A6A84]">{subLabel}</span>
                    <span className="font-semibold text-[#1A1220]">
                        {subValue}
                    </span>
                </div>
            )}
        </div>
    );
}

export function BookingOverviewCard({
                                        title,
                                        value,
                                        subLabel,
                                        subValue,
                                        icon,
                                        iconClassName = "bg-[#F0E9FF] text-[#5A35A5]",
                                        valueClassName = "text-[#1A1220]",
                                        compactValue = false,
                                    }: {
    title: string;
    value: string;
    subLabel?: string;
    subValue?: string;
    icon: ReactNode;
    iconClassName?: string;
    valueClassName?: string;
    compactValue?: boolean;
}) {
    const helperText =
        subLabel && subValue
            ? `${subLabel}: ${subValue}`
            : "";

    return (
        <div className="flex h-[132px] flex-col rounded-[18px] border border-[#E6DDF0] bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <p className="pt-1 text-sm font-semibold text-[#1A1220]">
                    {title}
                </p>

                <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconClassName}`}
                >
                    {icon}
                </span>
            </div>

            <p
                className={[
                    "mt-3 break-words font-bold leading-tight tracking-[-0.025em]",
                    compactValue ? "line-clamp-2 text-[19px]" : "text-[23px]",
                    valueClassName,
                ].join(" ")}
                title={value}
            >
                {value}
            </p>

            {helperText && (
                <p className="mt-1 text-[11px] leading-4 text-[#8A7D90]">
                    {helperText}
                </p>
            )}
        </div>
    );
}

export function CalendarDropdown({
                                     month,
                                     bookingDateCounts,
                                     selectedDate,
                                     onChangeMonth,
                                     onSelectDate,
                                 }: CalendarDropdownProps) {
    const cells = useMemo(() => {
        const year = month.getFullYear();
        const monthIndex = month.getMonth();

        const firstDay = new Date(year, monthIndex, 1);
        const start = new Date(firstDay);
        start.setDate(firstDay.getDate() - firstDay.getDay());

        return Array.from({ length: 42 }).map((_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);

            return {
                date,
                inMonth: date.getMonth() === monthIndex,
            };
        });
    }, [month]);

    return (
        <div className="absolute right-0 top-[calc(100%+10px)] z-50 w-[320px] rounded-[18px] border border-[#E6DDF0] bg-white p-4 font-sans shadow-xl">
            <div className="mb-3 flex items-center justify-between">
                <button
                    onClick={() =>
                        onChangeMonth(
                            new Date(month.getFullYear(), month.getMonth() - 1, 1)
                        )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-[#2B174C] transition hover:bg-[#F7F1FF]"
                    type="button"
                >
                    <ChevronLeft size={16} />
                </button>

                <p className="text-sm font-bold text-[#1A1220]">
                    {formatMonth(month)}
                </p>

                <button
                    onClick={() =>
                        onChangeMonth(
                            new Date(month.getFullYear(), month.getMonth() + 1, 1)
                        )
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-[#2B174C] transition hover:bg-[#F7F1FF]"
                    type="button"
                >
                    <ChevronRight size={16} />
                </button>
            </div>

            <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[#806A8C]">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day) => (
                    <div key={day} className="py-1">
                        {day}
                    </div>
                ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
                {cells.map(({ date, inMonth }) => {
                    const key = dateKey(date.toISOString());
                    const hasBooking = bookingDateCounts[key] > 0;
                    const isSelected = selectedDate === key;

                    return (
                        <button
                            key={key}
                            onClick={() => onSelectDate(key)}
                            type="button"
                            className={`relative flex h-9 items-center justify-center rounded-full text-sm transition ${
                                isSelected
                                    ? "bg-[#2B174C] text-white shadow-sm"
                                    : inMonth
                                        ? "text-[#1A1220] hover:bg-[#F7F1FF]"
                                        : "text-[#B8AFC0] hover:bg-[#F7F1FF]"
                            }`}
                        >
                            {date.getDate()}

                            {hasBooking && (
                                <span
                                    className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${
                                        isSelected ? "bg-white" : "bg-[#2B174C]"
                                    }`}
                                />
                            )}
                        </button>
                    );
                })}
            </div>

            <div className="mt-4 flex items-center gap-2 border-t border-[#EFE7F4] pt-3 text-xs text-[#6A5D6F]">
                <span className="h-2 w-2 rounded-full bg-[#2B174C]" />
                Has booking
            </div>
        </div>
    );
}

export function PriceModal({
                               booking,
                               onConfirm,
                               onClose,
                           }: {
    booking: Booking;
    onConfirm: (
        agreedPrice: number,
        requiredDownPayment: number,
        refundableDeposit: number,
        waiverReason: string,
        customConsumablesAgreed?: number,
        pricingAdjustmentReason?: string
    ) => void | Promise<void>;
    onClose: () => void;
}) {
    const bookingType = getManagerBookingTypeLabel(booking);
    const fixedPackage = bookingType === "Package";
    const fixedRental = bookingType === "Rental";
    const [price, setPrice] = useState(String(getTotalPrice(booking) || ""));
    const [consumablesPrice, setConsumablesPrice] = useState("");
    const [showProducts, setShowProducts] = useState(false);
    const [discountType, setDiscountType] = useState<"percentage" | "fixed">("fixed");
    const [discountValue, setDiscountValue] = useState("0");
    const [applyDiscount, setApplyDiscount] = useState(false);
    const [discountReason, setDiscountReason] = useState("");
    const [useOverride, setUseOverride] = useState(false);
    const [overrideReason, setOverrideReason] = useState("");
    const [dpPercent, setDpPercent] = useState("30");
    const [fixedBreakdown, setFixedBreakdown] = useState<{
        packageBase: number; rental: number; services: number;
        includedRentalNames: string[]; extraRentalNames: string[];
    } | null>(null);
    const [customConsumableSplit, setCustomConsumableSplit] = useState<{
        rental: number;
        services: number;
        salesEstimate: number;
        selectedProducts: Array<{name: string; variantName: string; quantity: number; unitPrice: number; amount: number}>;
    } | null>(null);
    const [downPayment, setDownPayment] = useState(String(
        booking.required_down_payment ?? booking.requiredDownPayment ??
        booking.down_payment_amount ?? booking.downPaymentAmount ?? ""
    ));
    const [refundableDeposit, setRefundableDeposit] = useState(String(
        booking.refundable_deposit ?? booking.refundableDeposit ?? ""
    ));
    const [hasRental, setHasRental] = useState<boolean | null>(null);
    const [termsLoading, setTermsLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const money = (value: string, number: number) => value.trim() !== "" &&
        Number.isFinite(number) && number >= 0 &&
        Math.abs(number * 100 - Math.round(number * 100)) < 0.001;
    const asCents = (number: number) => Math.round(number * 100);
    const hasCustomConsumableQuote = customConsumableSplit !== null;
    const selectedTotal = customConsumableSplit?.salesEstimate ?? 0;
    const discountNumeric = Number(discountValue);
    const discountedCents = !applyDiscount ? 0 : Math.round(Math.max(0, Math.min(selectedTotal,
        discountType === "percentage" ? selectedTotal * (Number.isFinite(discountNumeric) ? discountNumeric : 0) / 100
            : (Number.isFinite(discountNumeric) ? discountNumeric : 0))) * 100);
    const discountedConsumables = (Math.round(selectedTotal * 100) - discountedCents) / 100;
    const chosenConsumables = hasCustomConsumableQuote && !useOverride ? discountedConsumables : Number(consumablesPrice || 0);
    const totalCents = hasCustomConsumableQuote
        ? asCents(chosenConsumables) +
        asCents(customConsumableSplit.rental) + asCents(customConsumableSplit.services)
        : asCents(Number(price || 0));
    const finalPrice = totalCents / 100;
    const dpRateValue = Number(dpPercent);
    const validDpRate = dpPercent.trim() !== "" && Number.isFinite(dpRateValue) && dpRateValue >= 0 && dpRateValue <= 100;
    const calculatedDp = Math.round(finalPrice * dpRateValue) / 100;
    const effectiveDp = (fixedPackage && hasRental === false) ? Number(downPayment) : calculatedDp;

    useEffect(() => {
        let cancelled = false;
        const token = sessionStorage.getItem("token");
        if (!token) {
            setError("Login required to review booking items.");
            setTermsLoading(false);
            return;
        }
        const branchId = booking.branchId ?? booking.branch_id;
        const body = (action: string) => JSON.stringify({
            action, booking_id: booking.id,
            ...(branchId ? { branch_id: Number(branchId) } : {}),
        });
        void (async () => {
            try {
                const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
                const [itemsResponse, statementResponse] = await Promise.all([
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_items") }),
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_financial_statement") }),
                ]);
                const [itemsData, financeData] = await Promise.all([
                    itemsResponse.json(), statementResponse.json(),
                ]);
                if (!itemsResponse.ok || itemsData.error || itemsData.success === false ||
                    !statementResponse.ok || financeData.error || financeData.success === false || !financeData.statement) {
                    throw new Error(itemsData.error || financeData.error ||
                        "Could not verify booking items and financial details.");
                }
                const statement = financeData.statement;
                if (!Array.isArray(itemsData.rentalItems) || !Array.isArray(itemsData.items) ||
                    !Array.isArray(statement.rentalItems)) {
                    throw new Error("Booking item details are incomplete. Pricing is unavailable.");
                }
                const rental = itemsData.rentalItems.length > 0 || statement.rentalItems.length > 0;
                if (fixedRental && !rental) {
                    throw new Error("No rental equipment was found for this Rental booking.");
                }
                if (statement.depositRequired == null ||
                    !Number.isFinite(Number(statement.depositRequired)) || Number(statement.depositRequired) < 0) {
                    throw new Error("The saved refundable security deposit could not be verified.");
                }
                if (fixedPackage || fixedRental) {
                    const amountFields = [statement.packageBase, statement.rentalSubtotal,
                        statement.deliveryFee, statement.setupFee];
                    if (amountFields.some(value => value == null || !Number.isFinite(Number(value)) || Number(value) < 0)) {
                        throw new Error("Fixed package or rental pricing breakdown is missing. Saving is blocked.");
                    }
                    const rentalLineCents = statement.rentalItems.reduce(
                        (sum: number, item: {amount?: number | string}) => sum + asCents(Number(item.amount)), 0
                    );
                    if (rentalLineCents !== asCents(Number(statement.rentalSubtotal))) {
                        throw new Error("Rental line prices and saved rental subtotal do not match.");
                    }
                    const base = Number(statement.packageBase);
                    const rentalAmount = Number(statement.rentalSubtotal);
                    const services = (asCents(Number(statement.deliveryFee)) + asCents(Number(statement.setupFee))) / 100;
                    const savedTotal = (asCents(base) + asCents(rentalAmount) + asCents(services)) / 100;
                    if (Math.abs(savedTotal - getTotalPrice(booking)) > 0.005) {
                        throw new Error("Fixed package/rental total differs from saved booking price. Refresh before approving.");
                    }
                    if (fixedRental && base > 0) {
                        throw new Error("Rental-only booking unexpectedly has package charges.");
                    }
                    if (fixedPackage && base <= 0) {
                        throw new Error("The package base price could not be verified.");
                    }
                    const rentalLines = statement.rentalItems as Array<{name?:string;amount?:number|string}>;
                    const included = rentalLines.filter(line => asCents(Number(line.amount)) === 0)
                        .map(line => String(line.name || "Rental equipment"));
                    const extras = rentalLines.filter(line => asCents(Number(line.amount)) > 0)
                        .map(line => String(line.name || "Additional rental equipment"));
                    if (!cancelled) setFixedBreakdown({packageBase:base,rental:rentalAmount,services,
                        includedRentalNames:included,extraRentalNames:extras});
                }
                const negotiatedItems = itemsData.items.filter((item: {source_type?: string}) =>
                    String(item.source_type || "").toLowerCase() === "custom"
                );
                // Discounts apply to verified custom consumables, whether or not rentals exist.
                // Preserve the legacy manual-quotation path if an older consumables-only
                // booking has no itemized statement; never invent a discountable subtotal.
                const customHasConsumables = bookingType === "Custom" && negotiatedItems.length > 0;
                const hasVerifiedSalesStatement = Array.isArray(statement.salesItems) &&
                    statement.salesSubtotal != null &&
                    Number.isFinite(Number(statement.salesSubtotal));
                const mixed = customHasConsumables && (rental || hasVerifiedSalesStatement);
                let split: {rental: number;services: number;salesEstimate: number;
                    selectedProducts: Array<{name:string;variantName:string;quantity:number;unitPrice:number;amount:number}>} | null = null;
                let startingConsumablesPrice = "";
                if (mixed) {
                    const required = [statement.rentalSubtotal, statement.deliveryFee,
                        statement.setupFee, statement.salesSubtotal];
                    if (required.some(value => value == null ||
                        !Number.isFinite(Number(value)) || Number(value) < 0)) {
                        throw new Error("Itemized rental or service charges are missing. Pricing is blocked.");
                    }
                    const rentalLinesCents = statement.rentalItems.reduce(
                        (sum: number, line: { amount?: number | string }) =>
                            sum + asCents(Number(line.amount)), 0
                    );
                    if (rentalLinesCents !== asCents(Number(statement.rentalSubtotal))) {
                        throw new Error("Rental quote and rental line prices do not match. Refresh the booking.");
                    }
                    const rentalAmount = Number(statement.rentalSubtotal);
                    const servicesAmount = (asCents(Number(statement.deliveryFee)) +
                        asCents(Number(statement.setupFee))) / 100;
                    if (!Array.isArray(statement.salesItems)) {
                        throw new Error("Selected consumables breakdown is missing. Pricing is blocked.");
                    }
                    const selectedProducts = (statement.salesItems as Array<{
                        name?: string; variantName?: string; quantity?: number | string;
                        unitPrice?: number | string; amount?: number | string;
                    }>).map(line => ({
                        name: String(line.name || "Selected product"),
                        variantName: String(line.variantName || ""),
                        quantity: Number(line.quantity),
                        unitPrice: Number(line.unitPrice),
                        amount: Number(line.amount),
                    }));
                    const productTotalCents = selectedProducts.reduce((sum, line) => {
                        if (!Number.isFinite(line.amount) || line.amount < 0 ||
                            !Number.isFinite(line.quantity) || line.quantity <= 0 ||
                            !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
                            throw new Error("Invalid selected consumable product pricing; refresh the booking.");
                        }
                        return sum + asCents(line.amount);
                    }, 0);
                    if (!selectedProducts.length || productTotalCents !== asCents(Number(statement.salesSubtotal))) {
                        throw new Error("Selected products do not match the saved consumables subtotal; refresh the booking.");
                    }
                    split = {
                        rental: rentalAmount,
                        services: servicesAmount,
                        salesEstimate: Number(statement.salesSubtotal),
                        selectedProducts,
                    };
                    // Start from itemized custom consumables for both Custom Only and
                    // Custom + Rental. Rental/service charges stay outside discounts.
                    startingConsumablesPrice = (productTotalCents / 100).toFixed(2);
                    const savedAgreed = statement.booking?.agreedPrice;
                    if (savedAgreed != null && Number(savedAgreed) > 0) {
                        const savedConsumablesCents = asCents(Number(savedAgreed)) -
                            asCents(rentalAmount) - asCents(servicesAmount);
                        if (savedConsumablesCents < 0) {
                            throw new Error("Saved booking price is lower than fixed rental and service charges.");
                        }
                        startingConsumablesPrice = (savedConsumablesCents / 100).toFixed(2);
                    }
                }
                if (!cancelled) {
                    setHasRental(rental);
                    setRefundableDeposit(String(Number(statement.depositRequired)));
                    setCustomConsumableSplit(split);
                    setConsumablesPrice(startingConsumablesPrice);
                    if (split) {
                        // Existing negotiated discounts are shown as a fixed adjustment.
                        // Existing surcharges need an explicit justified override.
                        const difference = Math.round((split.salesEstimate - Number(startingConsumablesPrice)) * 100) / 100;
                        setDiscountType("fixed");
                        setDiscountValue(difference > 0 ? difference.toFixed(2) : "0");
                        setApplyDiscount(difference > 0.005);
                        setDiscountReason("");
                        setUseOverride(difference < -0.005);
                    }
                    const savedTotal = Number(statement.booking?.agreedPrice || getTotalPrice(booking) || 0);
                    const existingDp = Number(booking.required_down_payment ?? booking.requiredDownPayment ?? booking.down_payment_amount ?? booking.downPaymentAmount ?? 0);
                    if (savedTotal > 0 && existingDp > 0) {
                        setDpPercent(String(Math.round(existingDp / savedTotal * 10000) / 100));
                    } else {
                        setDpPercent("30");
                        // Fixed consumables-only packages keep their predefined DP.
                        if (!(fixedPackage && !rental)) setDownPayment((Math.round(savedTotal * 0.3 * 100) / 100).toFixed(2));
                    }
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : "Could not load pricing.");
            } finally {
                if (!cancelled) setTermsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id, bookingType, fixedRental]);

    async function handleConfirm() {
        if (saving || termsLoading || hasRental === null || error) return;
        const dp = effectiveDp;
        const deposit = Number(refundableDeposit);
        if (hasCustomConsumableQuote && (!money(String(chosenConsumables), chosenConsumables) ||
            (!useOverride && applyDiscount && (discountNumeric < 0 || !Number.isFinite(discountNumeric) ||
                (discountType === "percentage" && discountNumeric > 100) ||
                (discountType === "fixed" && discountNumeric > selectedTotal))))) {
            setError("Provide a valid consumables discount (0–100% or no more than the product total).");return;
        }
        if (hasCustomConsumableQuote && !useOverride && applyDiscount && discountedCents > 0 && discountReason.trim().length < 5) {
            setError("Enter a reason for the discount (at least 5 characters).");return;
        }
        if (hasCustomConsumableQuote && useOverride && !overrideReason.trim()) {
            setError("Enter a reason for the negotiated price override.");return;
        }
        if (hasCustomConsumableQuote && !money(String(chosenConsumables), chosenConsumables)) {
            setError("Enter the agreed consumables price (₱0 is allowed if agreed).");return;
        }
        if (finalPrice <= 0 || (!hasCustomConsumableQuote && !money(price, Number(price)))) {
            setError("A valid positive booking total is required.");return;
        }
        if ((!validDpRate && !(fixedPackage && hasRental === false)) || !money(dp.toFixed(2), dp) || dp > finalPrice || (hasRental && dp <= 0)) {
            setError(hasRental
                ? "A positive down payment toward the combined booking total is required for rentals. It is not an extra fee."
                : "Down payment must be between ₱0.00 and the total booking price.");return;
        }
        if (!money(refundableDeposit, deposit)) {
            setError("Enter a valid refundable security deposit.");return;
        }
        if (!hasRental && deposit !== 0) {
            setError("A booking without rental equipment cannot have a rental deposit.");return;
        }
        if ((fixedRental || fixedPackage) && Math.abs(finalPrice - getTotalPrice(booking)) > 0.005) {
            setError("Fixed booking charges cannot be modified.");return;
        }
        setSaving(true);setError("");
        try {
            await onConfirm(finalPrice, dp, deposit, "",
                hasCustomConsumableQuote ? chosenConsumables : undefined,
                hasCustomConsumableQuote ? (useOverride ? `Manager override: ${overrideReason.trim()}` :
                    applyDiscount && discountedCents > 0 ? `Consumables discount: ${discountValue} ${discountType === "percentage" ? "%" : "PHP"}. Reason: ${discountReason.trim()}` :
                        "Catalog price accepted; no discount") : undefined);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not save payment terms.");
        } finally {setSaving(false);}
    }

    const inputStyle = "h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 pl-10 text-sm text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:bg-[#F5F2F8] disabled:text-[#806A8C]";
    const priceLabel = fixedRental ? "Fixed Rental Booking Total (₱)" : fixedPackage ? "Fixed Package + Rental Total (₱)" : "Agreed Price (₱)";
    const fields: Array<{label:string;value:string;set:(v:string)=>void;disabled:boolean}> = hasCustomConsumableQuote
        ? [] : [{label:priceLabel,value:price,set:setPrice,disabled:fixedPackage||fixedRental}];
    fields.push(
        {label:"Required Booking Down Payment (₱)",value:downPayment,set:setDownPayment,disabled:fixedPackage&&!hasRental},
        ...(hasRental ? [{label:"Refundable Security Deposit (₱)",value:refundableDeposit,set:setRefundableDeposit,disabled:false}] : []),
    );
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="Review Booking Payment Terms" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[18px] border border-[#E6DDF0] bg-white p-5 font-sans shadow-2xl">
                <h3 className="text-[20px] font-bold text-[#1A1220]">
                    {hasCustomConsumableQuote ? (hasRental ? "Review Custom & Rental Pricing" : "Review Custom Consumables Pricing") : fixedRental ? "Review Rental Booking Terms" : fixedPackage ? "Review Package & Rental Terms" : "Review Booking Payment Terms"}
                </h3>
                <p className="mt-1 text-sm leading-6 text-[#7A6A84]">
                    {hasCustomConsumableQuote ? (hasRental ? "Apply an optional discount to selected consumables. Rental charges remain fixed for " : "Review selected consumables and apply an optional discount for ") :
                        fixedRental ? "Rental equipment prices are fixed. Review payment terms for " :
                            fixedPackage ? "Review the fixed package price, any additional rental fees, combined down payment, and separate rental deposit for " :
                                "Set the agreed price and payment terms for "}
                    <strong>{booking.name}</strong>.
                </p>
                <div className="mt-4 space-y-3">
                    {hasCustomConsumableQuote && customConsumableSplit && (
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#FAF8FD] p-3 text-xs text-[#2B174C] space-y-2">
                            <div className="flex justify-between gap-3 font-semibold">
                                <span>Selected consumables total (catalog estimate)</span>
                                <span className="whitespace-nowrap">{peso(customConsumableSplit.salesEstimate)}</span>
                            </div>
                            <button type="button" onClick={() => setShowProducts(value => !value)}
                                    className="text-[#63419B] underline underline-offset-2">
                                {showProducts ? "Hide product breakdown" : "View product breakdown"} ({customConsumableSplit.selectedProducts.length} lines)
                            </button>
                            {showProducts && customConsumableSplit.selectedProducts.map((product, index) => (
                                <div key={`${product.name}-${product.variantName}-${index}`} className="flex justify-between gap-3 border-t border-[#E6DDF0] pt-2">
                                    <span>{product.name}{product.variantName ? ` — ${product.variantName}` : ""} × {product.quantity}</span>
                                    <span className="whitespace-nowrap">{peso(product.amount)}</span>
                                </div>
                            ))}
                            <p className="text-[#806A8C]">The selected products total is the default agreed price. Rental fees remain fixed.</p>
                            <label className="flex items-center gap-2 pt-2 font-medium">
                                <input type="checkbox" checked={applyDiscount} disabled={termsLoading || saving || useOverride}
                                       onChange={event => {setApplyDiscount(event.target.checked);setError("");}} />
                                Apply discount (optional)
                            </label>
                            {applyDiscount && !useOverride && <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-2 pt-2">
                                    <label className="block font-medium">Discount type
                                        <select className="mt-1 w-full rounded-lg border border-[#E6DDF0] bg-white p-2"
                                                value={discountType} disabled={termsLoading || saving || useOverride}
                                                onChange={event => { setDiscountType(event.target.value as "percentage" | "fixed"); setDiscountValue("0"); setError(""); }}>
                                            <option value="percentage">Percentage (%)</option>
                                            <option value="fixed">Fixed amount (₱)</option>
                                        </select>
                                    </label>
                                    <label className="block font-medium">{discountType === "percentage" ? "Discount (%)" : "Discount (₱)"}
                                        <input className="mt-1 w-full rounded-lg border border-[#E6DDF0] bg-white p-2" type="number" min="0"
                                               max={discountType === "percentage" ? 100 : selectedTotal} step="0.01"
                                               value={discountValue} disabled={termsLoading || saving || useOverride}
                                               onChange={event => {setDiscountValue(event.target.value);setError("");}} />
                                    </label>
                                </div>
                                <label className="block font-medium">Reason for discount
                                    <input className="mt-1 w-full rounded-lg border border-[#E6DDF0] bg-white p-2" value={discountReason}
                                           disabled={termsLoading || saving} maxLength={180} placeholder="e.g. Loyalty customer discount"
                                           onChange={event => {setDiscountReason(event.target.value);setError("");}} />
                                </label>
                            </div>}
                            <label className="flex items-start gap-2 pt-1 text-xs">
                                <input type="checkbox" checked={useOverride} disabled={termsLoading || saving}
                                       onChange={event => {setUseOverride(event.target.checked);setError("");}} />
                                Override agreed consumables price (negotiated quotation)
                            </label>
                            {useOverride && <div className="space-y-2">
                                <label className="block font-medium">Agreed consumables price (₱)
                                    <input className="mt-1 w-full rounded-lg border border-[#E6DDF0] bg-white p-2" type="number" min="0" step="0.01"
                                           value={consumablesPrice} disabled={termsLoading || saving}
                                           onChange={event=>{setConsumablesPrice(event.target.value);setError("");}} />
                                </label>
                                <label className="block font-medium">Reason for Manager price override
                                    <input className="mt-1 w-full rounded-lg border border-[#E6DDF0] bg-white p-2" value={overrideReason}
                                           disabled={termsLoading || saving} maxLength={300} placeholder="e.g. Negotiated event quotation"
                                           onChange={event=>{setOverrideReason(event.target.value);setError("");}} />
                                </label>
                            </div>}
                            <div className="flex justify-between border-t border-[#E6DDF0] pt-2 font-semibold">
                                <span>Agreed consumables price</span><span>{peso(chosenConsumables)}</span>
                            </div>
                        </div>
                    )}
                    {fixedBreakdown && (fixedPackage || fixedRental) && (
                        <div className="rounded-xl border border-[#D6C4F8] bg-[#FBF8FF] p-3 text-xs text-[#2B174C] space-y-2">
                            {fixedPackage && <div className="flex justify-between gap-3"><span>Fixed package price (includes bundled equipment, if any)</span><strong className="whitespace-nowrap">{peso(fixedBreakdown.packageBase)}</strong></div>}
                            {fixedBreakdown.includedRentalNames.length > 0 && (
                                <div className="text-[#806A8C]">Included equipment — already covered by the package price: {fixedBreakdown.includedRentalNames.join(", ")}. Do not charge twice.</div>
                            )}
                            <div className="flex justify-between gap-3"><span>{fixedPackage ? "Additional rental charges (catalog-priced)" : "Fixed equipment rental charges"}</span><strong className="whitespace-nowrap">{peso(fixedBreakdown.rental)}</strong></div>
                            {fixedBreakdown.extraRentalNames.length > 0 && <div className="text-[#806A8C]">Equipment: {fixedBreakdown.extraRentalNames.join(", ")}</div>}
                            {fixedBreakdown.services > 0 && <div className="flex justify-between gap-3"><span>Additional service charges</span><strong>{peso(fixedBreakdown.services)}</strong></div>}
                            <div className="flex justify-between border-t border-[#D6C4F8] pt-2 font-bold"><span>Total booking price (deposit excluded)</span><strong>{peso(finalPrice)}</strong></div>
                            <p className="text-[#806A8C]">Down payment is part of this total, not an extra fee. Security deposit is separate and refundable under the rental terms.</p>
                        </div>
                    )}
                    {fields.filter(field => !field.label.startsWith("Required Booking Down Payment") && !field.label.startsWith("Refundable Security Deposit")).map(field => <label key={field.label} className="block text-sm font-medium text-[#1A1220]">
                        {field.label}
                        <div className="relative mt-2">
                            <PhilippinePeso size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                            <input aria-label={field.label} type="number" min="0" step="0.01" required value={field.value}
                                   disabled={termsLoading||saving||field.disabled}
                                   onChange={e=>{field.set(e.target.value);setError("");}}
                                   placeholder="0.00" className={inputStyle}/>
                        </div>
                    </label>)}
                    {hasCustomConsumableQuote && customConsumableSplit && (
                        <div className="rounded-xl border border-[#D6C4F8] bg-[#FBF8FF] p-3 text-xs text-[#2B174C] space-y-2">
                            <div className="flex justify-between"><span>Manager-agreed consumables price</span><strong>{peso(chosenConsumables)}</strong></div>
                            <div className="flex justify-between"><span>Adjustment vs. selected products</span><strong>{peso(chosenConsumables - customConsumableSplit.salesEstimate)}</strong></div>
                            {hasRental && <div className="flex justify-between"><span>Fixed rental charges</span><strong>{peso(customConsumableSplit.rental)}</strong></div>}
                            {customConsumableSplit.services>0 && <div className="flex justify-between"><span>Fixed service charges</span><strong>{peso(customConsumableSplit.services)}</strong></div>}
                            <div className="flex justify-between border-t pt-2 font-bold"><span>Total booking price</span><strong>{peso(finalPrice)}</strong></div>
                            <div className="flex justify-between"><span>Booking DP (deducted from total)</span><strong>{downPayment.trim()?peso(effectiveDp):"Not set"}</strong></div>
                            {hasRental && <div className="flex justify-between"><span>Refundable security deposit (separate)</span><strong>{peso(Number(refundableDeposit))}</strong></div>}
                        </div>
                    )}
                    {!(fixedPackage && hasRental === false) && <label className="block text-sm font-medium text-[#1A1220]">
                        Required down payment (%) of total booking price
                        <input aria-label="Down payment percentage" type="number" min="0" max="100" step="0.01"
                               value={dpPercent} disabled={termsLoading || saving}
                               onChange={event=>{
                                   const value=event.target.value;setDpPercent(value);setError("");
                                   const rate=Number(value);
                                   if(value.trim() !== "" && Number.isFinite(rate) && rate >= 0 && rate <= 100)
                                       setDownPayment((Math.round(finalPrice * rate) / 100).toFixed(2));
                               }} className="mt-2 h-[42px] w-full rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-3 text-sm" />
                        <span className="mt-1 block text-xs text-[#806A8C]">The amount below is the DP against the combined total, not an additional charge.</span>
                    </label>}
                    {fields.filter(field => field.label.startsWith("Required Booking Down Payment") || field.label.startsWith("Refundable Security Deposit")).map(field => <label key={field.label} className="block text-sm font-medium text-[#1A1220]">
                        {field.label}
                        <div className="relative mt-2">
                            <PhilippinePeso size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                            <input aria-label={field.label} type="number" min="0" step="0.01" required value={field.label.startsWith("Required Booking Down Payment") && !(fixedPackage && hasRental === false) ? effectiveDp.toFixed(2) : field.value}
                                   disabled={termsLoading||saving||field.disabled|| (field.label.startsWith("Required Booking Down Payment") && !(fixedPackage && hasRental === false))}
                                   onChange={e=>{field.set(e.target.value);setError("");}}
                                   placeholder="0.00" className={inputStyle}/>
                        </div>
                    </label>)}
                    <p className="text-xs leading-5 text-[#806A8C]">
                        {termsLoading ? "Checking booking items and saved pricing..." : hasRental===null ?
                            "Booking details could not be verified; saving is disabled." : hasRental ?
                                "The refundable rental security deposit is separate from booking revenue. ₱0 is allowed when no deposit is required." :
                                "No rental equipment is included, so a rental deposit is not applicable."}
                    </p>
                    {(hasCustomConsumableQuote ? true : price.trim()) && (validDpRate || (fixedPackage && hasRental === false)) && refundableDeposit.trim() &&
                        Number.isFinite(finalPrice) && <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF8FF] p-3 text-xs text-[#2B174C]">
                            <div className="flex justify-between"><span>Remaining balance after DP</span><strong>{peso(Math.max(0,finalPrice-effectiveDp))}</strong></div>
                            {hasRental && <div className="mt-1 flex justify-between"><span>Before-release amount if deposit unpaid</span><strong>{peso(Math.max(0,finalPrice-effectiveDp)+Number(refundableDeposit))}</strong></div>}
                        </div>}
                    {error && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-medium text-[#C32F2F]">{error}</p>}
                </div>
                <div className="mt-5 flex gap-3">
                    <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={saving||termsLoading||hasRental===null||Boolean(error)||
                        (hasCustomConsumableQuote&&useOverride&&!consumablesPrice.trim())||((fixedPackage||fixedRental)&&!fixedBreakdown)} onClick={()=>void handleConfirm()}
                            className="flex-1 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                        {saving?"Saving...":"Save Terms"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function getNextStatusConfig(displayStatus: string, downPaymentPaid: boolean) {
    switch (displayStatus) {
        case "Pending Review":
            return {
                nextStatus: "Awaiting Down Payment",
                nextStatusLabel: "Approve & Request DP",
                statusActionDisabled: false,
                statusHelper: "Review availability before requesting payment. No stock is allocated yet."
            };
        case "Awaiting Down Payment":
            return {
                nextStatus: "Confirmed",
                nextStatusLabel: "Retry Reservation",
                statusActionDisabled: !downPaymentPaid,
                statusHelper: downPaymentPaid ? "Payment is recorded, but automatic reservation did not complete. Resolve the reported issue, then retry." : "Verification of the required DP will automatically confirm and reserve this approved booking."
            };
        case "Confirmed":
            return {
                nextStatus: "Preparing",
                nextStatusLabel: "Start Preparing", // ← second button
                statusActionDisabled: false,
                statusHelper: "Move this booking to preparation stage."
            };
        case "Preparing":
            return {
                nextStatus: "Released",
                nextStatusLabel: "Release Items",
                statusActionDisabled: false,
                statusHelper: "Staff can release prepared items only after full booking payment and the refundable security deposit have been collected."
            };
        case "Released":
            return {
                nextStatus: "Return Inspection",
                nextStatusLabel: "Awaiting Rental Return",
                statusActionDisabled: true,
                statusHelper: "Staff receives and checks rental equipment in Inventory. Booking status updates automatically."
            };
        case "Return Inspection":
            return {
                nextStatus: "Pending Settlement",
                nextStatusLabel: "Staff Checking Returns",
                statusActionDisabled: true,
                statusHelper: "Staff must finish equipment condition checks in Rental Inventory before financial settlement."
            };
        case "Pending Settlement":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Settle Claims & Deposit",
                statusActionDisabled: true,
                statusHelper: "Manager settles damage/missing charges and returns or applies any held deposit. Completion then happens automatically."
            };
        case "Completed":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Completed",
                statusActionDisabled: true,
                statusHelper: "This booking is already completed."
            };
        case "Rejected":
            return {nextStatus:"Rejected",nextStatusLabel:"Rejected",statusActionDisabled:true,
                statusHelper:"This request was rejected; no booking was accepted."};
        case "Cancelled":
            return {
                nextStatus: "Cancelled",
                nextStatusLabel: "Cancelled",
                statusActionDisabled: true,
                statusHelper: "This booking has been cancelled."
            };
        default:
            return {
                nextStatus: "Pending Review",
                nextStatusLabel: "Confirm Booking",
                statusActionDisabled: false,
                statusHelper: "Move this booking to the next step."
            };
    }
}

// Customer-only details; the public portal currently may append its free-text request
// after generated inventory lines inside customOrder. Never display those product lines as notes.
export function getCustomerCustomRequest(booking: Booking): string {
    const explicit = String(booking.additional_custom_request || booking.additionalCustomRequest || "").trim();
    if (explicit) return explicit;
    const saved = String(booking.customOrder || booking.custom_order || "").trim();
    if (!saved) return "";
    if (!/selected inventory items:|^additional request:/im.test(saved)) return saved;
    const marker = /(?:^|\n)\s*Additional request:\s*/ig;
    let found: RegExpExecArray | null, after = "";
    while ((found = marker.exec(saved)) !== null) after = saved.slice(marker.lastIndex).trim();
    if (!after) return "";
    // The legacy portal writes rental item lines first, followed by a blank line and
    // the customer's typed request. Do not confuse a rental line with customer text.
    const blocks = after.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    if (blocks.length > 1) return blocks[blocks.length - 1];
    if (/\b(?:\d+\s*[x×]\s*\d+|₱\s*[\d,.]+|rental equipment)\b/i.test(after)) return "";
    return after;
}

export type BookingDetailTab = "Overview" | "Billing" | "Items" | "Notes";

type BookingRowProps = {
    b: Booking;
    ownerView?: boolean;
    canManage?: boolean;
    onUpdateStatus?: (id: number, status: string, price?: number) => void;
    onSetPrice?: (b: Booking) => void;
    termsReviewed?: boolean;
    onRecordDownPayment?: (b: Booking) => void;
    onMarkFullyPaid?: (b: Booking) => void;
    onCancelBooking?: (b: Booking) => void;
    onSettleDeposit?: (b: Booking) => void;
    canConfirmStandard?: boolean;
    onConfirmStandard?: (b: Booking) => void;
    onRequestApproval?: (b: Booking) => void;
    canOperateBookings?: boolean;
    onOperateBooking?: (id: number, status: "Preparing" | "Released" | "Completed") => void;
    operationsBusy?: boolean;
    // Only used by the non-paginated selectable booking workspace.
    hideSummaryRow?: boolean;
    expandedByDefault?: boolean;
    detailTab?: BookingDetailTab;
    managerView?: boolean;
};

export function BookingRow({
                               b,
                               hideSummaryRow = false,
                               expandedByDefault = false,
                               detailTab = "Overview",
                               managerView = false,
                               ownerView = false,
                               canManage = true,
                               onUpdateStatus,
                               onSetPrice,
                               termsReviewed = false,
                               onRecordDownPayment,
                               onMarkFullyPaid,
                               onCancelBooking,
                               onSettleDeposit,
                               canConfirmStandard = false,
                               onConfirmStandard,
                               onRequestApproval,
                               canOperateBookings = false,
                               onOperateBooking,
                               operationsBusy = false,
                           }: BookingRowProps) {
    const [bookingItems, setBookingItems] = useState<BookingInventoryItem[]>([]);
    const [bookingRentalItems, setBookingRentalItems] = useState<BookingRentalItem[]>([]);
    const [itemsLoading, setItemsLoading] = useState(false);
    const [itemsLoaded, setItemsLoaded] = useState(false);
    const [itemsError, setItemsError] = useState("");
    const [estimatedBookingPrice, setEstimatedBookingPrice] = useState<number | null>(null);
    // Existing financial-statement API supplies the booking-specific, refundable deposit.
    const [securityDeposit, setSecurityDeposit] = useState<{ required: number; collected: number } | null>(null);
    const [settlementSummary, setSettlementSummary] = useState<BookingSettlementSummary | null>(null);
    const [estimateLoading, setEstimateLoading] = useState(false);
    const [estimateError, setEstimateError] = useState(false);
    const [open, setOpen] = useState(expandedByDefault);

    // Status transitions change rental allocations; reload the displayed
    // inventory lines when a booking moves to its next operational step.
    useEffect(() => { setItemsLoaded(false); }, [b.status]);
    // Availability changes when another employee receives stock, sells via POS,
    // or confirms a booking. Refresh the active Items tab without page reload.
    useEffect(() => {
        if (!open || (hideSummaryRow && detailTab !== "Items")) return;
        const refresh = () => { if (document.visibilityState === "visible") setItemsLoaded(false); };
        const interval = window.setInterval(refresh, 12000);
        window.addEventListener("focus", refresh);
        return () => { window.clearInterval(interval); window.removeEventListener("focus", refresh); };
    }, [open, hideSummaryRow, detailTab, b.id]);

    const isCustom = managerView ? getManagerBookingTypeLabel(b) === "Custom" : isCustomBooking(b);
    // Read the saved estimate without treating it as the manager's final agreed price.
    // This endpoint totals catalog-verified custom consumables and rental lines,
    // plus the branch's saved optional charges, when applicable.
    useEffect(() => {
        if (!hideSummaryRow || !managerView || detailTab !== "Overview" || !open) return;
        const token = sessionStorage.getItem("token");
        if (!token) { setEstimateError(true); return; }
        let cancelled = false;
        setEstimatedBookingPrice(null);
        setSecurityDeposit(null);
        setSettlementSummary(null);
        setEstimateError(false);
        setEstimateLoading(true);
        const branchId = b.branchId || b.branch_id;
        void (async () => {
            try {
                const res = await fetch("/api/bookings", {
                    method: "POST", cache: "no-store",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: "get_booking_financial_statement", booking_id: b.id,
                        ...(branchId ? { branch_id: Number(branchId) } : {}) }),
                });
                const result = await res.json();
                if (res.ok && !result.error && result.statement && !cancelled) {
                    const required = Number(result.statement.depositRequired);
                    const collected = Number(result.statement.depositCollected);
                    if (Number.isFinite(required) && Number.isFinite(collected)) {
                        setSecurityDeposit({ required: Math.max(0, required), collected: Math.max(0, collected) });
                    }
                    // Reuse the already-fetched statement for the replacement Overview card.
                    // An absent or incomplete ledger must display Unavailable, not invented zeros.
                    const statement = result.statement;
                    const settlementKeys = ["depositHeld", "depositApplied", "depositRefunded", "claimBalance"] as const;
                    const hasSettlementValues = settlementKeys.every(key =>
                        statement[key] !== null && statement[key] !== undefined &&
                        Number.isFinite(Number(statement[key])) && Number(statement[key]) >= 0
                    );
                    if (hasSettlementValues && Array.isArray(statement.claims)) {
                        const charges = statement.claims.filter((claim: { status?: string }) =>
                            !["waived", "cancelled", "canceled", "rejected"].includes(
                                String(claim.status || "").toLowerCase()
                            )
                        );
                        if (charges.every((claim: { amount?: unknown }) =>
                            claim.amount !== null && claim.amount !== undefined &&
                            Number.isFinite(Number(claim.amount)) && Number(claim.amount) >= 0
                        )) {
                            setSettlementSummary({
                                depositHeld: Number(statement.depositHeld),
                                depositApplied: Number(statement.depositApplied),
                                depositRefunded: Number(statement.depositRefunded),
                                approvedCharges: charges.reduce(
                                    (sum: number, claim: { amount: number | string }) => sum + Number(claim.amount), 0
                                ),
                                outstandingCharges: Number(statement.claimBalance),
                            });
                        }
                    }
                }
                const estimate = Number(result.statement?.agreedCharges);
                if (!res.ok || result.error || !Number.isFinite(estimate) || estimate < 0 ||
                    result.statement?.agreedCharges == null) throw new Error("Quote unavailable");
                if (!cancelled) setEstimatedBookingPrice(estimate);
            } catch {
                if (!cancelled) setEstimateError(true);
            } finally {
                if (!cancelled) setEstimateLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [b.id, b.status, b.branchId, b.branch_id, b.refundable_deposit, b.refundableDeposit, b.agreed_price, hideSummaryRow, managerView, detailTab, open]);
    const total = getTotalPrice(b);
    const requiredDp = getRequiredDownPayment(b);
    const paid = getAmountPaid(b);
    const balance = getBalance(b);
    const paymentStatus = getPaymentStatus(b);
    const displayStatus = normalizeBookingStatus(b.status);
    // Use the latest persisted booking-list snapshot as the primary source.
    // The statement fetch is a read-only fallback for older API responses.
    const storedRequired = b.securityDepositRequired;
    const storedCollected = b.securityDepositCollected;
    const storedDeposit = storedRequired != null && storedCollected != null &&
    Number.isFinite(Number(storedRequired)) && Number.isFinite(Number(storedCollected)) &&
    Number(storedRequired) >= 0 && Number(storedCollected) >= 0
        ? {required: Number(storedRequired), collected: Number(storedCollected)} : null;
    const currentDeposit = storedDeposit ?? securityDeposit;
    const depositDue = currentDeposit
        ? Math.max(0, Math.round(Number(currentDeposit.required) * 100) - Math.round(Number(currentDeposit.collected) * 100)) / 100
        : null;

    const customNeedsTerms = isCustom && total <= 0;
    // Custom quotations are locked immediately after manager approval.
    const canEditPaymentTerms = displayStatus === "Pending Review" && b.approvalStatus !== "approved";
    // For a no-DP booking, the whole booking price must be paid before confirmation.
    const downPaymentPaid = total > 0 && paid + 0.005 >= (requiredDp > 0 ? requiredDp : total);

    const statusClass =
        STATUS_STYLE[displayStatus] ||
        "bg-[#F7F1FF] text-[#2B174C] border-[#E6DDF0]";

    const paymentClass =
        PAYMENT_STYLE[paymentStatus] ||
        "bg-[#F7F1FF] text-[#2B174C] border-[#E6DDF0]";

    const {
        nextStatus: actionNextStatus,
        nextStatusLabel,
        statusActionDisabled,
        statusHelper,
    } = getNextStatusConfig(displayStatus, downPaymentPaid);
    // Keep the existing operational labels and action rules available to the
    // legacy detail view. This is a scope fix only; the API calls are unchanged.
    const actionLabel = nextStatusLabel;
    const managerCanAdvance = Boolean(canManage && !ownerView && onUpdateStatus) &&
        ["Pending Review", "Awaiting Down Payment", "Confirmed", "Preparing"].includes(displayStatus) &&
        !(displayStatus === "Pending Review" && isCustom && total <= 0);
    // Present the next available action without rendering a second status tracker.
    // Backend payment, approval, inventory and deposit checks remain authoritative.
    const reviewNeedsQuotation = displayStatus === "Pending Review" && isCustom && total <= 0;
    // Booking actions are sequential. Fixed consumable-only packages use
    // catalog terms; all other types require a successful Manager terms review.
    const needsTermsReview = isCustom || getManagerBookingTypeLabel(b) === "Rental" ||
        (getManagerBookingTypeLabel(b) === "Package" && Number(b.rentalItemCount || 0) > 0);
    const awaitingTermsReview = displayStatus === "Pending Review" && needsTermsReview && !termsReviewed;
    const needsBookingPayment = balance > 0.005;
    const needsInitialDp = requiredDp > 0 && paid + 0.005 < requiredDp;
    const needsRentalDeposit = depositDue !== null && depositDue > 0.005;
    const bookingIncludesRentals = Number(b.rentalItemCount ?? 0) > 0 ||
        getManagerBookingTypeLabel(b) === "Rental";
    const paymentActionLabel = bookingIncludesRentals
        ? "Record Payment & Rental Deposit"
        : needsInitialDp ? "Record Down Payment" : "Record Remaining Payment";
    const paymentActionHandler = needsInitialDp ? onRecordDownPayment : onMarkFullyPaid;
    const nextActionDescription = displayStatus === "Pending Review"
        ? awaitingTermsReview
            ? "Step 1: Review and save the booking price, down payment, and any rental security deposit. Approval becomes available afterward."
            : "Step 2: Payment terms are reviewed. Approve the booking to request payment; no booking payment should be collected before approval."
        : displayStatus === "Awaiting Down Payment"
            ? downPaymentPaid
                ? "Payment is recorded, but the reservation still needs attention. Check inventory availability before retrying."
                : "Record the customer's verified down payment. The system will attempt to reserve the items automatically."
            : displayStatus === "Confirmed"
                ? "Inventory is reserved. Staff can start preparing the order when ready."
                : displayStatus === "Preparing"
                    ? "Preparation is underway. Full booking payment and any required rental deposit are due before release."
                    : displayStatus === "Released"
                        ? "Items were released. Rental equipment, if included, must be returned and inspected."
                        : displayStatus === "Return Inspection"
                            ? "Staff is checking returned equipment before any final rental settlement."
                            : displayStatus === "Pending Settlement"
                                ? "Reconcile any outstanding rental charges and refundable security deposit."
                                : displayStatus === "Completed"
                                    ? "Booking completed. You can still review its records below."
                                    : displayStatus === "Cancelled"
                                        ? "Booking cancelled. The payment history remains available in Billing."
                                        : displayStatus === "Rejected"
                                            ? "Booking request rejected. The decision remains in the audit history."
                                            : "Review this booking's current status and details.";

    useEffect(() => {
        if (!open || itemsLoaded || (hideSummaryRow && detailTab !== "Items")) return;

        const token = sessionStorage.getItem("token");
        const branchId =
            b.branchId ||
            b.branch_id ||
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("manager_branch_id") ||
            sessionStorage.getItem("staff_branch_id");

        if (!token) return;

        let cancelled = false;

        async function loadBookingItems() {
            setItemsLoading(!itemsLoaded && bookingItems.length === 0 && bookingRentalItems.length === 0);
            setItemsError("");

            try {
                const body: Record<string, unknown> = {
                    action: "get_booking_items",
                    booking_id: b.id,
                };

                if (branchId) body.branch_id = Number(branchId);

                const res = await fetch("/api/bookings", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify(body),
                });

                const data = await res.json();

                if (!res.ok || data.success === false) {
                    throw new Error(data.message || data.error || "Failed to load booking items.");
                }

                if (!cancelled) {
                    setBookingItems(
                        Array.isArray(data.items)
                            ? (data.items as BookingInventoryItem[])
                            : []
                    );
                    setBookingRentalItems(Array.isArray(data.rentalItems)
                        ? (data.rentalItems as BookingRentalItem[]) : []);
                    setItemsLoaded(true);
                }
            } catch (err) {
                console.error("Failed to load booking items:", err);

                if (!cancelled) {
                    setItemsError(
                        err instanceof Error
                            ? err.message
                            : "Unable to load selected items."
                    );
                    setItemsLoaded(true);
                }
            } finally {
                if (!cancelled) {
                    setItemsLoading(false);
                }
            }
        }

        void loadBookingItems();

        return () => {
            cancelled = true;
        };
    }, [
        open,
        itemsLoaded,
        hideSummaryRow,
        detailTab,
        b.id,
        b.branchId,
        b.branch_id,
    ]);

    // Only the Manager uses the redesigned overview. Keep the existing
    // BookingRow actions, Billing, Items and Notes for the other views.
    if (hideSummaryRow && managerView && detailTab === "Overview") {
        const infoLabel = "text-xs font-medium text-[#887B99]";
        const infoValue = "text-right text-xs font-semibold text-[#261940] break-words";
        const card = "min-w-0 rounded-xl border border-[#E8E1F1] bg-white p-3.5 sm:p-4";
        const action = "inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";
        return (
            <tr><td colSpan={6} className="p-0">
                <div className="space-y-3 text-[#25153D]">
                    <section aria-label="Booking actions" className="rounded-xl border border-[#E8DFF2] bg-[#F8F4FF] px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-[#2B174C]">Booking Action</h3>
                                <p className="mt-1 text-xs leading-5 text-[#655478]">{nextActionDescription}</p>
                            </div>
                            {canManage && !ownerView && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {displayStatus === "Pending Review" && awaitingTermsReview && canEditPaymentTerms && onSetPrice && (
                                        <button type="button" onClick={() => onSetPrice(b)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            {isCustom ? "Step 1 · Review Custom Price & Terms" :
                                                getManagerBookingTypeLabel(b) === "Rental" ? "Step 1 · Review Rental Terms" :
                                                    "Step 1 · Review Rental Deposit"}
                                        </button>
                                    )}
                                    {displayStatus === "Pending Review" && !awaitingTermsReview && onUpdateStatus && (
                                        <button type="button" disabled={statusActionDisabled || total <= 0}
                                                onClick={() => onUpdateStatus(b.id, actionNextStatus)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            {needsTermsReview ? "Step 2 · Approve Booking" : "Approve Booking"}
                                        </button>
                                    )}
                                    {displayStatus === "Pending Review" && !awaitingTermsReview && needsTermsReview && canEditPaymentTerms && onSetPrice && (
                                        <button type="button" onClick={() => onSetPrice(b)}
                                                className={`${action} border border-[#D6C4F8] bg-white text-[#4D2A96] hover:bg-[#F3EEFF]`}>
                                            Edit Reviewed Terms
                                        </button>
                                    )}
                                    {displayStatus === "Awaiting Down Payment" && !downPaymentPaid && needsBookingPayment && paymentActionHandler && (
                                        <button type="button" onClick={() => paymentActionHandler(b)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            {paymentActionLabel}
                                        </button>
                                    )}
                                    {displayStatus === "Awaiting Down Payment" && downPaymentPaid && onUpdateStatus && (
                                        <button type="button" disabled={statusActionDisabled || total <= 0}
                                                onClick={() => onUpdateStatus(b.id, actionNextStatus)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            Retry Reservation
                                        </button>
                                    )}
                                    {["Confirmed", "Preparing", "Released", "Return Inspection"].includes(displayStatus) && needsBookingPayment && onMarkFullyPaid && (
                                        <button type="button" onClick={() => onMarkFullyPaid(b)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            {bookingIncludesRentals ? "Record Payment & Rental Deposit" : "Record Remaining Payment"}
                                        </button>
                                    )}
                                    {["Confirmed", "Preparing", "Released", "Return Inspection"].includes(displayStatus) &&
                                        !needsBookingPayment && needsRentalDeposit && onMarkFullyPaid && (
                                            <button type="button" onClick={() => onMarkFullyPaid(b)}
                                                    className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                                Record Security Deposit ({peso(depositDue)})
                                            </button>
                                        )}
                                    {displayStatus === "Pending Settlement" && onSettleDeposit && (
                                        <button type="button" onClick={() => onSettleDeposit(b)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            Settle Deposit / Charges
                                        </button>
                                    )}

                                </div>
                            )}
                            {!canManage && <p className="text-xs text-[#806A8C]">Booking actions are view-only for your access level.</p>}
                        </div>
                    </section>
                    <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><UserRound size={17} className="text-[#6536D4]"/>Contact Information</h3>
                            <div className="space-y-3">
                                <div className="break-all text-xs font-semibold text-[#261940]">{b.phone || "—"}</div>
                                <div className="break-all text-xs font-semibold text-[#261940]">{b.email || "—"}</div>
                            </div>
                        </section>
                        <section className={card}>
                            <h3 className="mb-4 flex items-center gap-2 text-sm font-bold"><CalendarDays size={17} className="text-[#6536D4]"/>Event Details</h3>
                            <div className="space-y-2.5">
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Date</span><span className={infoValue}>{formatDate(b.date)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Time</span><span className={infoValue}>{formatBookingListTime(b.eventTime || b.event_time) || "—"}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Booking Type</span><span className={infoValue}>{getManagerBookingTypeLabel(b)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Composition</span><span className={infoValue}>{getManagerBookingItemMixLabel(b)}</span></div>
                                <div className="flex justify-between gap-3"><span className={infoLabel}>Event Type</span><span className={infoValue}>{b.eventType || b.event_type || "—"}</span></div>
                            </div>
                        </section>
                        <section className={`${card} sm:col-span-2`}>
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                <h3 className="flex items-center gap-2 text-sm font-bold"><CreditCard size={17} className="text-[#6536D4]"/>Payment Summary</h3>
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#E2DAEA] px-2.5 py-1 text-[11px] font-medium text-[#25153D]">
                                    <span aria-hidden="true">{getManagerPaymentLabel(b) === "Fully Paid" ? "✓" : getManagerPaymentLabel(b) === "Down Payment Paid" ? "◐" : "○"}</span>
                                    {getManagerPaymentLabel(b) === "Down Payment Paid" ? "DP Paid" : getManagerPaymentLabel(b)}
                                </span>
                            </div>
                            <div className="grid grid-cols-3 gap-3 border-t border-[#EFE7F4] pt-3">
                                <div className="min-w-0"><p className={infoLabel}>Booking Total</p><p className="mt-1 text-sm font-bold tabular-nums">{total > 0 ? peso(total) : "Not set"}</p></div>
                                <div className="min-w-0 border-l border-[#E9E1F1] pl-3"><p className={infoLabel}>Amount Paid</p><p className="mt-1 text-sm font-bold tabular-nums">{peso(paid)}</p></div>
                                <div className="min-w-0 border-l border-[#E9E1F1] pl-3"><p className={infoLabel}>Balance Due</p><p className="mt-1 text-sm font-bold tabular-nums text-[#6335BC]">{isCustom && total <= 0 ? "Not set" : peso(balance)}</p></div>
                            </div>
                        </section>
                    </div>

                    {/* Customer Requests & Instructions */}
                    <section className={card}>
                        <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
                            <StickyNote size={17} className="text-[#6536D4]" />
                            Customer Requests & Instructions
                        </h3>

                        {(() => {
                            const requests = [
                                {
                                    label: "Theme / Motif",
                                    value:
                                        b.theme_motif_request ||
                                        b.themeMotifRequest ||
                                        b.theme ||
                                        "",
                                },
                                {
                                    label: "Special Request",
                                    value: getCustomerCustomRequest(b),
                                },
                                {
                                    label: "Additional Instructions",
                                    value:
                                        b.additional_notes ||
                                        b.additionalNotes ||
                                        b.notes ||
                                        "",
                                },
                            ].filter(({ value }) => String(value ?? "").trim());

                            return requests.length > 0 ? (
                                <div className="space-y-3">
                                    {requests.map(({ label, value }) => (
                                        <div key={label}>
                                            <p className="text-xs font-semibold text-[#806A8C]">
                                                {label}
                                            </p>
                                            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#261940]">
                                                {String(value)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-xs text-[#887B99]">
                                    No special requests or additional instructions
                                    were provided.
                                </p>
                            );
                        })()}
                    </section>
                    {customNeedsTerms && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Agree on custom pricing and the down payment before collecting payment.</p>}
                    {canManage && !ownerView && onCancelBooking &&
                        ["Pending Review","Awaiting Down Payment","Confirmed","Preparing"].includes(displayStatus) && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAE3F1] pt-3">
                                <div>
                                    <p className="text-xs font-semibold text-[#392B49]">
                                        {displayStatus==="Pending Review"?"Decline this request?":"Need to cancel this booking?"}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-[#887B99]">
                                        {displayStatus==="Pending Review"
                                            ? "A reason is required. No booking has been approved yet."
                                            : "Review payments, deposits and inventory before cancelling."}
                                    </p>
                                </div>
                                <button type="button" onClick={()=>onCancelBooking(b)}
                                        className="rounded-lg border border-[#EAC8C8] bg-white px-3 py-2 text-xs font-semibold text-[#9B3838] hover:bg-[#FFF7F7]">
                                    {displayStatus==="Pending Review"?"Reject Booking":"Cancel Booking"}
                                </button>
                            </div>
                        )}
                </div>
            </td></tr>
        );
    }

    return (
        <>
            {!hideSummaryRow && (<tr
                onClick={() => setOpen((v) => !v)}
                className={`cursor-pointer border-b border-[#EFE7F4] transition hover:bg-[#FFFCF7] ${
                    open ? "bg-[#F9F4FF]" : "bg-white"
                }`}
            >
                <td className="px-4 py-3">
                    <div className="flex items-start gap-2.5">
                        <ChevronDown
                            size={14}
                            className={`mt-1 shrink-0 text-[#2B174C] transition ${
                                open ? "rotate-180" : "-rotate-90"
                            }`}
                        />

                        <div className="min-w-0">
                            <p className="text-sm font-bold text-[#1A1220]">
                                {b.name}
                            </p>

                            {b.phone && (
                                <p className="mt-0.5 text-xs text-[#5F4E75]">
                                    {b.phone}
                                </p>
                            )}

                            {b.bookingReference && (
                                <p className="mt-0.5 text-xs font-semibold text-[#806A8C]">
                                    {b.bookingReference}
                                </p>
                            )}

                            {ownerView && (
                                <p className="mt-0.5 text-xs text-[#806A8C]">
                                    {getBranchGroupName(b)}
                                </p>
                            )}
                        </div>
                    </div>
                </td>

                <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-[#1A1220]">
                        {formatDate(b.date)}
                    </p>

                    {b.eventTime && (
                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                            {b.eventTime}
                        </p>
                    )}
                </td>

                <td className="px-4 py-3">
                    <div className="flex max-w-[210px] items-start gap-2">
                        <Package size={14} className="mt-0.5 shrink-0 text-[#6C3AD6]" />

                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#1A1220]">
                                {getBookingItemLabel(b)}
                            </p>

                            <p className="mt-0.5 text-xs text-[#7A6A84]">
                                {total > 0
                                    ? peso(total)
                                    : isCustom
                                        ? "No agreed price yet"
                                        : "No package price"}
                            </p>

                            {b.theme && (
                                <p className="mt-0.5 truncate text-xs text-[#806A8C]">
                                    {b.theme}
                                </p>
                            )}
                        </div>
                    </div>
                </td>

                <td className="px-4 py-3">
                    <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${paymentClass}`}
                    >
                        {paymentStatus}
                    </span>

                    <p className="mt-1 text-xs text-[#7A6A84]">
                        Paid {peso(paid)}
                    </p>
                </td>

                <td className="px-4 py-3">
                    <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass}`}
                    >
                        {displayStatus}
                    </span>
                </td>

                <td className="px-4 py-3 text-right">
                    {b.venue ? (
                        <div className="inline-flex max-w-[180px] items-center justify-end gap-1.5 text-xs font-medium text-[#5F4E75]">
                            <MapPin size={13} />
                            <span className="truncate">{b.venue}</span>
                        </div>
                    ) : b.theme ? (
                        <div className="inline-flex max-w-[180px] items-center justify-end gap-1.5 text-xs font-medium text-[#5F4E75]">
                            <Palette size={13} />
                            <span className="truncate">{b.theme}</span>
                        </div>
                    ) : (
                        <span className="text-xs text-[#9B8AAA]">Open row</span>
                    )}
                </td>
            </tr>)}

            {open && (
                <tr className="border-b border-[#EFE7F4] bg-[#F9F4FF]">
                    <td colSpan={6} className={hideSummaryRow ? "p-0" : "px-4 pb-4"}>
                        <div className={hideSummaryRow
                            ? "flex w-full min-w-0 flex-col gap-3 bg-white"
                            : "flex w-full flex-col gap-4 rounded-[14px] border border-[#E6DDF0] bg-white p-4 xl:flex-row"}>
                            {/* LEFT SIDE */}
                            <div className="min-w-0 flex-1 space-y-4">
                                {(!hideSummaryRow || detailTab === "Overview") && (
                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-4 flex items-center gap-2">
                                            <CreditCard
                                                size={15}
                                                className="text-[#6C3AD6]"
                                            />

                                            <p className="text-[16px] font-bold text-[#1A1220]">
                                                Payment Summary
                                            </p>
                                        </div>

                                        <div className="space-y-3 text-sm">
                                            <SummaryLine
                                                label={isCustom ? "Agreed Price" : "Package Price"}
                                                value={total > 0 ? peso(total) : "Not set"}
                                            />

                                            <SummaryLine
                                                label="Required Down Payment"
                                                value={requiredDp > 0 ? peso(requiredDp) : "No down payment required"}
                                            />

                                            <SummaryLine
                                                label="Amount Paid"
                                                value={peso(paid)}
                                            />

                                            <div className="border-t border-[#EFE7F4] pt-4">
                                                <SummaryLine
                                                    label="Balance"
                                                    value={peso(balance)}
                                                    strong
                                                />
                                            </div>
                                        </div>

                                        {!hideSummaryRow && <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage}/>}

                                        {customNeedsTerms && (
                                            <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                                                This custom booking needs an agreed price and required down payment before payment can be recorded.
                                            </p>
                                        )}

                                        {!isCustom && total <= 0 && (
                                            <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                                                Package price is missing. Check if the booking API includes package price.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {hideSummaryRow && detailTab === "Billing" && (
                                    <section aria-label="Full booking billing record" className="min-w-0 space-y-3">
                                        <div className="rounded-xl border border-[#E6DDF0] bg-[#F9F6FF] px-4 py-3">
                                            <h3 className="text-sm font-bold text-[#2B174C]">Billing &amp; Payment Records</h3>
                                            <p className="mt-1 text-xs leading-5 text-[#766782]">Review the agreed charges, payments, down payment, security deposit, refunds, and any approved damage or missing-item charges here.</p>
                                        </div>
                                        <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage}/>
                                    </section>
                                )}

                                {(!hideSummaryRow || detailTab === "Items") && (
                                    <div className="min-w-0 space-y-3">
                                        {hideSummaryRow && <div className="rounded-xl border border-[#E6DDF0] bg-[#F9F6FF] px-4 py-3">
                                            <h3 className="text-sm font-bold text-[#2B174C]">Booking Items &amp; Availability</h3>
                                            <p className="mt-1 text-xs leading-5 text-[#766782]">Review consumables and rental equipment separately. Quantities and shortages reflect the latest available records.</p>
                                        </div>}
                                        {itemsLoading ? (
                                            <div role="status" className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-5 text-center text-sm text-[#7A6A84]">
                                                Loading booking items...
                                            </div>
                                        ) : itemsError ? (
                                            <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-semibold text-[#C32F2F]">
                                                {itemsError}
                                            </p>
                                        ) : (
                                            <>
                                                <section aria-label="Inclusions" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2">
                                                            <Package size={14} className="shrink-0 text-[#6C3AD6]" />
                                                            <h3 className="text-[16px] font-bold text-[#1A1220]">Consumable Items</h3>
                                                        </div>
                                                        <span className="shrink-0 rounded-full bg-[#F0E9FF] px-2.5 py-1 text-[11px] font-bold text-[#5A35A5]">
                                                            {bookingItems.length} {bookingItems.length === 1 ? "item" : "items"}
                                                        </span>
                                                    </div>
                                                    {bookingItems.length === 0 ? (
                                                        <div className="rounded-lg border border-dashed border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs text-[#7A6A84]">
                                                            No consumable items for this booking.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {bookingItems.map(item => {
                                                                const itemLabel = item.variant_name
                                                                    ? `${item.product_name} — ${item.variant_name}` : item.product_name;
                                                                const required = Math.max(0, Number(item.booked_quantity || 0));
                                                                const available = item.available_for_booking == null ? null : Number(item.available_for_booking);
                                                                const verified = available !== null && Number.isFinite(available) && available >= 0;
                                                                const delivered = Math.max(0, Number(item.used_quantity || 0));
                                                                const stillNeeded = Math.max(0, required - delivered);
                                                                const shortage = verified ? Math.max(0, stillNeeded - available!) : null;
                                                                return <div key={item.id} className="rounded-xl border border-[#EFE7F4] bg-white px-3 py-3">
                                                                    <p className="break-words text-sm font-semibold text-[#1A1220]" title={itemLabel}>{itemLabel}</p>
                                                                    <p className="mt-0.5 text-[11px] text-[#806A8C]">
                                                                        {item.source_type === "package" ? "Package inclusion · Sales inventory" : "Sales inventory"}
                                                                        {delivered > 0 ? ` · ${delivered} already issued` : item.inventory_status ? ` · ${item.inventory_status}` : ""}
                                                                    </p>
                                                                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#FAF8FD] p-2 text-center text-xs">
                                                                        <div><p className="text-[10px] text-[#806A8C]">Required</p><strong>{required}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Available</p><strong>{verified ? available : "—"}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Shortage</p>
                                                                            <strong className={shortage !== null && shortage > 0 ? "text-[#C32F2F]" : "text-[#23834A]"}>
                                                                                {shortage === null ? "—" : shortage > 0 ? shortage : "0"}
                                                                            </strong></div>
                                                                    </div>
                                                                    {shortage !== null && shortage > 0 && <p className="mt-2 text-[11px] font-semibold text-[#C32F2F]">Additional items needed for this booking: {shortage}.</p>}
                                                                    {!verified && <p className="mt-2 text-[11px] text-[#975A04]">{item.availability_note || "Stock availability could not be verified."}</p>}
                                                                </div>;
                                                            })}
                                                        </div>
                                                    )}
                                                </section>
                                                <section aria-label="Additional Rental Equipment" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                                    <div className="mb-3 flex items-center justify-between gap-2">
                                                        <div className="flex min-w-0 items-center gap-2">
                                                            <Package size={14} className="shrink-0 text-[#6C3AD6]" />
                                                            <h3 className="text-[16px] font-bold text-[#1A1220]">Rental Items</h3>
                                                        </div>
                                                        <span className="shrink-0 rounded-full bg-[#F0E9FF] px-2.5 py-1 text-[11px] font-bold text-[#5A35A5]">
                                                            {bookingRentalItems.length} {bookingRentalItems.length === 1 ? "item" : "items"}
                                                        </span>
                                                    </div>
                                                    {bookingRentalItems.length === 0 ? (
                                                        <div className="rounded-lg border border-dashed border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs text-[#7A6A84]">
                                                            No rental items for this booking.
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-2">
                                                            {bookingRentalItems.map(item => {
                                                                const required = Math.max(0, Number(item.quantity || 0));
                                                                const available = item.available_for_event == null ? null : Number(item.available_for_event);
                                                                const verified = available !== null && Number.isFinite(available) && available >= 0;
                                                                const shortage = verified ? Math.max(0, required - available!) : null;
                                                                const period = item.start_date === item.end_date ? item.start_date : `${item.start_date} – ${item.end_date}`;
                                                                return <div key={`rental-${item.id}`} className="rounded-xl border border-[#EFE7F4] bg-white px-3 py-3">
                                                                    <p className="break-words text-sm font-semibold text-[#1A1220]" title={item.equipment_name}>{item.equipment_name}</p>
                                                                    <p className="mt-0.5 text-[11px] text-[#806A8C]">Rental equipment · For event dates: {period}</p>
                                                                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-[#FAF8FD] p-2 text-center text-xs">
                                                                        <div><p className="text-[10px] text-[#806A8C]">Required</p><strong>{required}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Available</p><strong>{verified ? available : "—"}</strong></div>
                                                                        <div><p className="text-[10px] text-[#806A8C]">Shortage</p>
                                                                            <strong className={shortage !== null && shortage > 0 ? "text-[#C32F2F]" : "text-[#23834A]"}>
                                                                                {shortage === null ? "—" : shortage > 0 ? shortage : "0"}
                                                                            </strong></div>
                                                                    </div>
                                                                    {shortage !== null && shortage > 0 && <p className="mt-2 text-[11px] font-semibold text-[#C32F2F]">Additional rental items needed for the scheduled event: {shortage}.</p>}
                                                                    {!verified && <p className="mt-2 text-[11px] text-[#975A04]">{item.availability_note || "Availability for the event dates could not be verified."}</p>}
                                                                </div>;
                                                            })}
                                                        </div>
                                                    )}
                                                </section>
                                            </>
                                        )}
                                    </div>
                                )}

                                {(!hideSummaryRow || detailTab === "Notes") && (
                                    <div className="min-h-[96px] rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <div className="mb-2 flex items-center gap-2">
                                            <StickyNote
                                                size={14}
                                                className="text-[#806A8C]"
                                            />

                                            <p className="text-[16px] font-bold text-[#1A1220]">
                                                Notes
                                            </p>
                                        </div>

                                        <p className="mb-3 text-xs text-[#806A8C]">Customer-provided requests and event instructions. Empty fields are shown as “None provided.”</p>
                                        <div className="space-y-3">
                                            {([
                                                ["Additional Custom Request", getCustomerCustomRequest(b)],
                                                ["Theme / Motif Request", b.theme_motif_request || b.themeMotifRequest || b.theme || ""],
                                                ["Additional Notes", b.additional_notes || b.additionalNotes || b.notes || ""],
                                            ] as Array<[string, string]>).map(([label, value]) => (
                                                <div key={label} className="border-t border-[#E6DDF0] pt-2">
                                                    <p className="mb-1 text-xs font-bold text-[#2B174C]">{label}</p>
                                                    <p className="whitespace-pre-wrap text-sm leading-6 text-[#7A6A84]">{String(value).trim() || "None provided."}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* RIGHT SIDE */}
                            {(!hideSummaryRow || detailTab === "Overview") && (
                                <div className="min-w-0 flex-1 space-y-4">
                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <p className="mb-3 text-[16px] font-bold text-[#1A1220]">
                                            Payment Action
                                        </p>

                                        {ownerView || !canManage ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                View-only booking record.
                                            </div>
                                        ) : managerView && displayStatus === "Pending Review" && !customNeedsTerms ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-3 py-3 text-center text-xs font-semibold text-[#6E5B83]">Approve booking before recording payment.</div>
                                        ) : managerView && displayStatus === "Cancelled" ? (
                                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-center text-xs font-semibold text-red-700">Cancelled booking — payments disabled.</div>
                                        ) : customNeedsTerms && canEditPaymentTerms ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Review Price, DP & Security Deposit
                                            </button>
                                        ) : total <= 0 ? (
                                            <div
                                                className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 text-center text-sm font-semibold text-[#A56607]"
                                            >
                                                Payment terms missing
                                            </div>
                                        ) : balance <= 0 && depositDue !== null && depositDue > 0.005 ? (
                                            <button type="button" onClick={(e) => {e.stopPropagation();onMarkFullyPaid?.(b)}}
                                                    disabled={!onMarkFullyPaid}
                                                    className="inline-flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 text-sm font-semibold text-[#975A04] hover:bg-[#FFF0C8] disabled:opacity-70">
                                                Record Security Deposit ({peso(depositDue)})
                                            </button>
                                        ) : balance <= 0 && depositDue === null ? (
                                            <div className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 text-center text-sm font-semibold text-[#975A04]">Security deposit unverified — refresh booking</div>
                                        ) : balance <= 0 ? (
                                            <div className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#B7E9C8] bg-[#EDFBF1] px-4 text-center text-sm font-semibold text-[#138342]">Booking and deposit settled</div>
                                        ) : requiredDp === 0 ? (
                                            <button type="button" onClick={(e) => {e.stopPropagation();onMarkFullyPaid?.(b)}}
                                                    className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                                                Mark as Fully Paid
                                            </button>
                                        ) : paid <= 0 || paid < requiredDp ? (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onRecordDownPayment?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                {bookingIncludesRentals ? "Record Payment & Rental Deposit" : "Verify & Record Down Payment"}
                                            </button>
                                        ) : (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onMarkFullyPaid?.(b);
                                                }}
                                                type="button"
                                                className="inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]"
                                            >
                                                Mark as Fully Paid
                                            </button>
                                        )}

                                        {getManagerBookingTypeLabel(b) === "Custom" && !customNeedsTerms && canManage && !ownerView && canEditPaymentTerms && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onSetPrice?.(b);
                                                }}
                                                type="button"
                                                className="mt-3 inline-flex h-[42px] w-full items-center justify-center rounded-xl border border-[#E6DDF0] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF]"
                                            >
                                                Review Custom Price &amp; Payment Terms
                                            </button>
                                        )}
                                        {getManagerBookingTypeLabel(b) === "Package" && canManage && !ownerView && canEditPaymentTerms && (
                                            <p className="mt-3 rounded-xl border border-[#E6DDF0] bg-[#F8F4FF] px-3 py-3 text-xs leading-5 text-[#674A8E]">
                                                Fixed package price and down payment are not editable here. Verify rental add-ons and any applicable refundable security deposit before approval.
                                            </p>
                                        )}
                                    </div>

                                    <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
                                        <p className="mb-4 text-[16px] font-bold text-[#1A1220]">
                                            Booking Status
                                        </p>

                                        <div className="space-y-3 text-sm">
                                            <SummaryLine
                                                label="Current Status"
                                                value={displayStatus}
                                                badgeClass={statusClass}
                                            />

                                            <SummaryLine
                                                label="Next Step"
                                                value={actionLabel}
                                            />
                                        </div>

                                        {ownerView || (!canManage && !(canOperateBookings && (displayStatus === "Confirmed" || displayStatus === "Preparing" || displayStatus === "Released"))) ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                {canConfirmStandard && ["Pending Review","Awaiting Down Payment"].includes(displayStatus)
                                                    ? "Manager approval and payment confirmation are required before Staff can prepare items."
                                                    : "View-only booking status."}
                                            </div>
                                        ) : !canManage ? (
                                            <button
                                                type="button"
                                                disabled={operationsBusy || !onOperateBooking}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (displayStatus === "Confirmed" || displayStatus === "Preparing" || displayStatus === "Released") {
                                                        onOperateBooking?.(b.id, displayStatus === "Confirmed" ? "Preparing" : displayStatus === "Preparing" ? "Released" : "Completed");
                                                    }
                                                }}
                                                className="inline-flex min-h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {operationsBusy ? "Processing..." : nextStatusLabel}
                                            </button>
                                        ) : (
                                            <>
                                                {/* Next Step Button */}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); if (managerCanAdvance && !statusActionDisabled && total > 0) onUpdateStatus?.(b.id, actionNextStatus); }}
                                                    disabled={!managerCanAdvance || statusActionDisabled || total <= 0}
                                                    className="mb-2 inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:bg-[#D8CBE7] disabled:text-[#806A8C]"
                                                >
                                                    {actionLabel}
                                                </button>

                                                {/* Cancel Button */}
                                                {!["Released", "Return Inspection", "Pending Settlement", "Completed", "Cancelled"].includes(displayStatus) && onUpdateStatus && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();

                                                            if (onCancelBooking) {
                                                                onCancelBooking(b);
                                                                return;
                                                            }

                                                            onUpdateStatus?.(b.id, "Cancelled");
                                                        }}
                                                        className="mt-3 inline-flex h-[42px] w-full items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117]"
                                                    >
                                                        Cancel Booking
                                                    </button>
                                                )}
                                            </>
                                        )}

                                        {b.approvalStatus === "pending" && (
                                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                                                <strong>Manager approval requested</strong>
                                                <p className="mt-1">{b.approvalReason || "Awaiting review of this booking exception."}</p>
                                            </div>
                                        )}
                                        {canConfirmStandard && ["Pending Review","Awaiting Down Payment"].includes(displayStatus) && (
                                            <div className="mt-3 flex flex-col gap-2">
                                                {b.approvalStatus !== "pending" && requiredDp > 0 ? (
                                                    <button type="button" onClick={(e)=>{e.stopPropagation(); onConfirmStandard?.(b)}}
                                                            className="min-h-[42px] rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white hover:bg-[#1B0D31]">
                                                        {displayStatus==="Pending Review"?"Approve Standard Booking":"Confirm Paid Standard Booking"}
                                                    </button>
                                                ) : null}
                                                {displayStatus==="Pending Review" && requiredDp===0 && <p className="rounded-lg bg-[#FFF8E8] px-3 py-2 text-xs text-[#A56607]">A no-DP reservation needs Manager authorization. Use Request Manager Approval below.</p>}
                                                <button type="button" onClick={(e)=>{e.stopPropagation(); onRequestApproval?.(b)}}
                                                        className="min-h-[42px] rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">
                                                    {b.approvalStatus === "pending" ? "Update Approval Request" : "Request Manager Approval"}
                                                </button>
                                            </div>
                                        )}
                                        {canManage && !ownerView && displayStatus === "Pending Review" && b.approvalStatus === "pending" && (
                                            <p className="mt-2 text-center text-xs font-semibold text-amber-900">
                                                Manager approval starts payment collection; allocation happens only after confirmation.
                                            </p>
                                        )}
                                        <p className="mt-3 text-center text-xs text-[#7A6A84]">
                                            {statusHelper}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}


// Select one booking from the scrollable list; reuse BookingRow for status and API actions.
export function BookingWorkspace({
                                     bookings, ownerView = false, managerView = false, listToolbar,
                                     onExportSelected, reviewedBookingIds = [], ...bookingActions
                                 }: Omit<BookingRowProps, "b" | "hideSummaryRow" | "expandedByDefault" | "detailTab" | "managerView"> & {
    bookings: Booking[];
    managerView?: boolean;
    listToolbar?: ReactNode;
    onExportSelected?: (booking: Booking, format: "pdf" | "excel", tab: BookingDetailTab) => void;
    reviewedBookingIds?: number[];
}) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [detailTab, setDetailTab] = useState<BookingDetailTab>("Overview");
    const [exportOpen, setExportOpen] = useState(false);
    const selectedBooking = bookings.find(booking => booking.id === selectedId) ?? bookings[0];
    const tabs: BookingDetailTab[] = managerView
        ? ["Overview", "Billing", "Items"]
        : ["Overview", "Billing", "Items", "Notes"];
    // The header export action always describes and exports the currently selected tab.
    const exportLabel = detailTab === "Billing" ? "Billing Receipt"
        : detailTab === "Items" ? "Booking Items"
            : detailTab === "Notes" ? "Booking Notes" : "Booking Overview";

    return (
        <div className={`grid min-w-0 gap-3 ${managerView ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "2xl:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]"}`}>
            <section aria-label="Booking list" className={`flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm ${managerView ? "h-[700px] xl:h-[760px] rounded-[18px]" : ""}`}>
                {managerView && <div className="px-4 pt-4">
                    {listToolbar}
                </div>}
                <div className={`${managerView ? "min-h-0 flex-1" : "max-h-[640px]"} overflow-auto overscroll-contain`}>
                    <table role="grid" aria-label="Bookings" className={`w-full border-collapse ${managerView ? "min-w-[630px]" : "min-w-[590px]"}`} >
                        <thead className={`sticky top-0 z-10 ${managerView ? "bg-[#F9F7FC]" : "bg-[#FFFDF8]"}`}>
                        <tr className="border-b border-[#E6DDF0] text-left text-[11px] font-semibold text-[#806A8C]">
                            <th className="px-3 py-3">{managerView ? "Customer" : "Customer / Booking Ref"}</th>
                            <th className="px-3 py-3">{managerView ? "Event Date & Time" : "Schedule"}</th>
                            <th className="px-3 py-3">Type</th>
                            <th className="px-3 py-3">Payment</th>
                            <th className="px-3 py-3">Status</th>
                        </tr>
                        </thead>
                        <tbody>
                        {bookings.map(booking => {
                            const selected = booking.id === selectedBooking?.id;
                            const payment = managerView ? getManagerPaymentLabel(booking) : getPaymentStatus(booking);
                            const bookingTypeLabel = managerView ? getManagerBookingTypeLabel(booking) : getBookingItemLabel(booking);
                            const status = normalizeBookingStatus(booking.status);
                            return (
                                <tr key={booking.id}
                                    onClick={() => { setSelectedId(booking.id); setDetailTab("Overview"); setExportOpen(false); }}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault(); setSelectedId(booking.id); setDetailTab("Overview"); setExportOpen(false);
                                        }
                                    }}
                                    tabIndex={0} aria-selected={selected}
                                    className={`cursor-pointer border-b border-[#EFE7F4] text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C3AD6] ${selected ? "bg-[#F3ECFF] shadow-[inset_4px_0_0_#6C3AD6]" : "bg-white hover:bg-[#FAF6FF]"}`}>
                                    <td className="max-w-[165px] px-3 py-3 align-top">
                                        <p className="truncate text-xs font-bold text-[#1A1220]" title={booking.name}>{booking.name}</p>
                                        {!managerView && <p className="mt-1 truncate text-[11px] text-[#806A8C]">{booking.bookingReference || `#${booking.id}`}</p>}
                                        {ownerView && <p className="mt-1 truncate text-[11px] text-[#806A8C]">{getBranchGroupName(booking)}</p>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-[#1A1220]">
                                        <p className="font-semibold">{formatDate(booking.date)}</p>
                                        {booking.eventTime && <p className="mt-1 text-[#806A8C]">{formatBookingListTime(booking.eventTime)}</p>}
                                    </td>
                                    <td className="max-w-[110px] px-3 py-3 align-top">
                                        <p className="text-[11px] font-semibold text-[#1A1220]" title={bookingTypeLabel}>{bookingTypeLabel}</p>
                                        {managerView && <p className="mt-1 text-[10px] leading-4 text-[#806A8C]" title={getManagerBookingItemMixLabel(booking)}>{getManagerBookingItemMixLabel(booking)}</p>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-3 align-top">
                                        {managerView ? (
                                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-[#261940]">
                                                <span aria-hidden="true" className="text-[14px] leading-none">{payment === "Fully Paid" ? "✓" : payment === "Down Payment Paid" ? "◐" : "○"}</span>
                                                {payment === "Down Payment Paid" ? "DP Paid" : payment}
                                            </span>
                                        ) : <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${PAYMENT_STYLE[payment] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{payment}</span>}
                                    </td>
                                    <td className="px-3 py-3 align-top"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[status] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{managerView ? getManagerBookingStatusLabel(status) : status}</span></td>
                                </tr>
                            );
                        })}
                        </tbody>
                    </table>
                    {bookings.length === 0 && <p className="p-8 text-center text-sm text-[#806A8C]">No bookings match the selected filters.</p>}
                </div>
                {managerView && <div className="border-t border-[#EFE7F4] px-4 py-2 text-xs text-[#806A8C]">Showing {bookings.length} booking{bookings.length === 1 ? "" : "s"}</div>}
            </section>
            <section aria-label="Selected booking details" className={`flex min-w-0 flex-col overflow-hidden rounded-[16px] border border-[#E6DDF0] bg-white shadow-sm ${managerView ? "h-[700px] xl:h-[760px]" : "max-h-[760px]"}`}>
                {selectedBooking ? <>
                    <div className="shrink-0 border-b border-[#EFE7F4] px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                                <h2 className="truncate text-[18px] font-bold text-[#1A1220]">{selectedBooking.name}</h2>
                                <p className="mt-0.5 text-xs font-semibold text-[#806A8C]">{selectedBooking.bookingReference || `Booking #${selectedBooking.id}`}</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[normalizeBookingStatus(selectedBooking.status)] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{managerView ? getManagerBookingStatusLabel(selectedBooking.status) : normalizeBookingStatus(selectedBooking.status)}</span>
                                {managerView && onExportSelected && <div className="relative">
                                    <button type="button" aria-label={`Download ${exportLabel}`} title={`Download ${exportLabel}`} aria-expanded={exportOpen} onClick={() => setExportOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF]"><Download size={16}/></button>
                                    {exportOpen && <div className="absolute right-0 top-10 z-30 w-48 rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-xl">
                                        <p className="px-3 py-1 text-[11px] font-semibold text-[#806A8C]">Export {exportLabel}</p>
                                        <button type="button" onClick={() => {onExportSelected(selectedBooking, "pdf", detailTab);setExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download {exportLabel} PDF</button>
                                        <button type="button" onClick={() => {onExportSelected(selectedBooking, "excel", detailTab);setExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Download {exportLabel} Excel (.xlsx)</button>
                                    </div>}
                                </div>}
                            </div>
                        </div>
                        {!managerView && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#5F4E75]">
                            <span>{formatDate(selectedBooking.date)}{selectedBooking.eventTime ? ` · ${selectedBooking.eventTime}` : ""}</span>
                            <span className="max-w-full truncate">{getBranchGroupName(selectedBooking)}</span>
                            <span className="max-w-full truncate" title={getBookingItemLabel(selectedBooking)}>{getBookingItemLabel(selectedBooking)}</span>
                        </div>}
                        <div
                            className={`mt-3 grid gap-1 ${managerView ? "grid-cols-3 border-b border-[#E6DDF0]" : "grid-cols-4 rounded-xl bg-[#F7F1FF] p-1"}`}
                            role="tablist"
                            aria-label="Booking detail sections"
                        >
                            {tabs.map(tab => <button key={tab} type="button" role="tab" aria-selected={tab === detailTab} onClick={() => {setDetailTab(tab);setExportOpen(false);}} className={`min-w-0 px-1.5 py-2.5 text-[11px] font-semibold transition ${managerView ? (tab === detailTab ? "border-b-[3px] border-[#6C3AD6] text-[#6C3AD6]" : "text-[#806A8C] hover:text-[#45217D]") : (tab === detailTab ? "rounded-lg bg-white text-[#2B174C] shadow-sm" : "rounded-lg text-[#806A8C] hover:bg-white/60")}`}>{tab}</button>)}
                        </div>
                    </div>
                    <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                        <table className="w-full table-fixed border-collapse"><tbody>
                        <BookingRow key={selectedBooking.id} b={selectedBooking} ownerView={ownerView} managerView={managerView} {...bookingActions} termsReviewed={reviewedBookingIds.includes(selectedBooking.id)} hideSummaryRow expandedByDefault detailTab={detailTab}/>
                        </tbody></table>
                    </div>
                </> : <div className="p-8 text-center text-sm text-[#806A8C]">No booking selected.</div>}
            </section>
        </div>
    );
}

function SummaryLine({
                         label,
                         value,
                         strong = false,
                         badgeClass,
                     }: {
    label: string;
    value: string;
    strong?: boolean;
    badgeClass?: string;
}) {
    return (
        <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-[#7A6A84]">{label}</span>

            {badgeClass ? (
                <span
                    className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                >
                    {value}
                </span>
            ) : (
                <span
                    className={`text-right ${
                        strong
                            ? "text-[18px] font-bold text-[#2B174C]"
                            : "text-sm font-semibold text-[#1A1220]"
                    }`}
                >
                    {value}
                </span>
            )}
        </div>
    );
}
