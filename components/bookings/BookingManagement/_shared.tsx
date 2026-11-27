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
    // Pickup/delivery and return schedule (replaces "event time").
    handoverMethod?: "pickup" | "delivery";
    handoverDate?: string;
    handoverTime?: string;
    returnDate?: string;
    returnTime?: string;
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

// When the customer gets the items (Pickup or Delivery) and, for rentals, when they come back.
// Older bookings without these fields fall back to the event date and event time.
// Plain payment wording for lists and badges: Unpaid, DP Paid or Fully Paid (booking price only).
// The security deposit is shown separately in the Payment Summary and Billing.
export function getSimplePaymentLabel(b: Booking): "Unpaid" | "DP Paid" | "Fully Paid" {
    const label = getManagerPaymentLabel(b);
    return label === "Unpaid" ? "Unpaid" : label === "Down Payment Paid" ? "DP Paid" : "Fully Paid";
}

// "Based on selected package" is a placeholder saved for packages, not an event type.
export function realEventType(b: Booking): string {
    const value = String(b.eventType || b.event_type || "").trim();
    return /^based on selected package$/i.test(value) ? "" : value;
}

export function getBookingSchedule(b: Booking) {
    const label: "Pickup" | "Delivery" = b.handoverMethod === "delivery" ? "Delivery" : "Pickup";
    const handoverDate = dateKey(b.handoverDate || b.date);
    const handoverTime = formatBookingListTime(b.handoverTime || b.eventTime || b.event_time);
    const returnDate = dateKey(b.returnDate);
    const returnTime = formatBookingListTime(b.returnTime);
    const join = (d: string, t: string) => [d ? formatDate(d) : "", t].filter(Boolean).join(" · ");
    const sameDayAsEvent = handoverDate === dateKey(b.date);
    return {
        label, handoverDate, handoverTime, returnDate, returnTime,
        handoverText: join(handoverDate, handoverTime),
        returnText: returnDate ? join(returnDate, returnTime) : "",
        // Short line under the event date in lists: the date is left out when it is the event day.
        handoverShort: [label, sameDayAsEvent ? handoverTime : join(handoverDate, handoverTime)].filter(Boolean).join(" "),
    };
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
    // Two booking types on every screen: a Package (shown by its name) or a Custom booking.
    if (getBookingTypeDisplay(booking) === "Custom") {
        return "Custom Booking";
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

// The booking type SHOWN to people: only two, everywhere.
//   Package = a ready-made set from the Packages page (fixed price), with or without rentals inside.
//   Custom  = the customer picked their own items (consumables, rentals, or both); the Manager sets the price.
// Older "rental" bookings are custom bookings with only rentals, so they show as Custom.
// Display only: pricing and payment rules still use the saved booking type (getManagerBookingTypeLabel).
export function getBookingTypeDisplay(booking: Booking): "Package" | "Custom" {
    return getManagerBookingTypeLabel(booking) === "Package" ? "Package" : "Custom";
}

// One-line label for search and exports, e.g. "Package · Consumables + Rentals" or "Custom · Rentals only".
// Never infer rental inclusion from the deposit (a rental deposit may be zero).
export function getManagerBookingCompositionLabel(booking: Booking): string {
    const type = getBookingTypeDisplay(booking);
    const contents = getManagerBookingItemMixLabel(booking);
    return contents === "Composition unavailable" ? type : `${type} · ${contents}`;
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
        // A cancelled or rejected booking has no deposit left to collect.
        if (["Cancelled", "Rejected"].includes(String(normalizeBookingStatus(booking.status) ?? ""))) return "Fully Paid";
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
        handoverMethod: (rawString(raw, "handoverMethod") || rawString(raw, "handover_method")) === "delivery" ? "delivery" : "pickup",
        handoverDate: rawString(raw, "handoverDate") || rawString(raw, "handover_date"),
        handoverTime: rawString(raw, "handoverTime") || rawString(raw, "handover_time"),
        returnDate: rawString(raw, "returnDate") || rawString(raw, "return_date"),
        returnTime: rawString(raw, "returnTime") || rawString(raw, "return_time"),
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
    // Pricing rules (unchanged in the Bookings Lambda):
    //   Package → fixed package price. Older Rental bookings → fixed by daily rates.
    //   Custom  → ONE agreed price for everything (consumables and rental equipment). It can be discounted.
    // Discount and down payment share one unit switch: % or ₱.
    const bookingType = getManagerBookingTypeLabel(booking);
    const fixedPackage = bookingType === "Package";
    const fixedRental = bookingType === "Rental";
    const fixedPrice = fixedPackage || fixedRental;
    type Line = { name: string; detail: string; amount: number };
    type Unit = "percent" | "amount";
    const [lines, setLines] = useState<Line[]>([]);
    const [consumablesTotal, setConsumablesTotal] = useState(0);
    const [rentalTotal, setRentalTotal] = useState(0);
    const [packageBase, setPackageBase] = useState(0);
    const [includedRentals, setIncludedRentals] = useState<string[]>([]);
    const [showItems, setShowItems] = useState(false);
    const [unit, setUnit] = useState<Unit>("percent");
    const [discountText, setDiscountText] = useState("");
    const [dpText, setDpText] = useState("30");
    // Custom quote: type the total yourself (e.g. extra requests above the item prices).
    const [manualPrice, setManualPrice] = useState(false);
    const [price, setPrice] = useState(String(getTotalPrice(booking) || ""));
    const [fixedDp, setFixedDp] = useState(Number(booking.required_down_payment ?? booking.requiredDownPayment ??
        booking.down_payment_amount ?? booking.downPaymentAmount ?? 0));
    const [deposit, setDeposit] = useState("0");
    const [hasRental, setHasRental] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const cents = (n: number) => Math.round(n * 100);
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const fmt = (n: number) => String(r2(n));
    const isMoney = (raw: string) => /^\d+(\.\d{1,2})?$/.test(raw.trim());
    const toNumber = (raw: string) => (raw.trim() === "" ? Number.NaN : Number(raw));

    useEffect(() => {
        let cancelled = false;
        const token = sessionStorage.getItem("token");
        if (!token) { setError("Please sign in again."); setLoading(false); return; }
        const branchId = booking.branchId ?? booking.branch_id;
        const body = (action: string) => JSON.stringify({ action, booking_id: booking.id, ...(branchId ? { branch_id: Number(branchId) } : {}) });
        void (async () => {
            try {
                const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
                const [itemsRes, statementRes] = await Promise.all([
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_items") }),
                    fetch("/api/bookings", { method: "POST", headers, body: body("get_booking_financial_statement") }),
                ]);
                const [itemsData, financeData] = await Promise.all([itemsRes.json(), statementRes.json()]);
                if (!itemsRes.ok || itemsData.error || !statementRes.ok || financeData.error || !financeData.statement)
                    throw new Error(itemsData.error || financeData.error || "Couldn't load this booking's items.");
                const st = financeData.statement;
                const rentalLines = (Array.isArray(st.rentalItems) ? st.rentalItems : []) as Array<{ name?: string; quantity?: number; days?: number; amount?: number }>;
                const salesLines = (Array.isArray(st.salesItems) ? st.salesItems : []) as Array<{ name?: string; variantName?: string; quantity?: number; amount?: number }>;
                const rental = rentalLines.length > 0 || (Array.isArray(itemsData.rentalItems) && itemsData.rentalItems.length > 0);
                const savedPrice = Number(st.booking?.agreedPrice || 0);
                if (cancelled) return;
                setHasRental(rental);
                setDeposit(String(Number(st.depositRequired || 0)));
                setConsumablesTotal(Number(st.salesSubtotal || 0));
                setRentalTotal(Number(st.rentalSubtotal || 0));
                setPackageBase(Number(st.packageBase || 0));
                setIncludedRentals(rentalLines.filter(l => cents(Number(l.amount || 0)) === 0).map(l => String(l.name || "Equipment")));
                setLines([
                    ...salesLines.map(l => ({ name: `${l.name || "Product"}${l.variantName ? ` — ${l.variantName}` : ""}`, detail: `× ${Number(l.quantity || 0)}`, amount: Number(l.amount || 0) })),
                    ...rentalLines.filter(l => cents(Number(l.amount || 0)) > 0)
                        .map(l => ({ name: String(l.name || "Equipment"), detail: `× ${Number(l.quantity || 0)} · ${Number(l.days || 1)} ${Number(l.days || 1) === 1 ? "day" : "days"}`, amount: Number(l.amount || 0) })),
                ]);
                const normal = Number(st.salesSubtotal || 0) + Number(st.rentalSubtotal || 0);
                const startPrice = savedPrice > 0 ? savedPrice : normal > 0 ? normal : getTotalPrice(booking);
                setPrice(startPrice > 0 ? startPrice.toFixed(2) : "");
                // A saved price above the item total was typed by hand; a lower one shows as its % off.
                if (normal > 0 && startPrice > normal + 0.005) setManualPrice(true);
                const savedDiscount = normal > 0 && startPrice > 0 ? normal - startPrice : 0;
                setDiscountText(savedDiscount > 0.005 ? String(Math.round(savedDiscount / normal * 10000) / 100) : "");
                const existingDp = Number(booking.required_down_payment ?? booking.requiredDownPayment ?? 0);
                setFixedDp(existingDp);
                if (startPrice > 0 && existingDp > 0) setDpText(String(Math.round(existingDp / startPrice * 10000) / 100));
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't load this booking's items.");
            } finally { if (!cancelled) setLoading(false); }
        })();
        return () => { cancelled = true; };
    }, [booking.id, booking.branchId, booking.branch_id]);

    // ── Price ──
    const normalTotal = r2(consumablesTotal + rentalTotal);
    const priceEntry = !fixedPrice && (manualPrice || normalTotal <= 0);
    const useDiscount = !fixedPrice && !priceEntry;
    const discountValue = toNumber(discountText);
    const discountError = !useDiscount || discountText.trim() === "" ? ""
        : !Number.isFinite(discountValue) || discountValue < 0 ? "Enter a discount of 0 or more."
            : unit === "percent" && discountValue > 100 ? "A discount can't be more than 100%."
                : unit === "amount" && discountValue > normalTotal + 0.005 ? `A discount can't be more than the normal total (${peso(normalTotal)}).`
                    : "";
    const discountAmount = useDiscount && discountText.trim() !== "" && !discountError
        ? r2(unit === "percent" ? normalTotal * discountValue / 100 : discountValue) : 0;
    const finalPrice = fixedPrice ? getTotalPrice(booking)
        : priceEntry ? (isMoney(price) ? Number(price) : 0)
            : r2(normalTotal - discountAmount);
    const discount = !fixedPrice && normalTotal > 0 ? r2(normalTotal - finalPrice) : 0;
    const discountPercent = normalTotal > 0 ? Math.round(discount / normalTotal * 1000) / 10 : 0;
    // ── Down payment ── (a consumables-only package keeps the down payment set in the package)
    const dpFromPackage = fixedPackage && hasRental === false;
    const dpValue = toNumber(dpText);
    const dpError = dpFromPackage ? ""
        : !Number.isFinite(dpValue) || dpValue < 0 ? "Enter a down payment of 0 or more."
            : unit === "percent" && dpValue > 100 ? "A down payment can't be more than 100%."
                : unit === "amount" && dpValue > finalPrice + 0.005 ? "The down payment can't be more than the total price."
                    : "";
    const dp = dpFromPackage ? fixedDp : dpError ? 0 : r2(unit === "percent" ? finalPrice * dpValue / 100 : dpValue);
    const dpPercentOfPrice = finalPrice > 0 ? Math.round(dp / finalPrice * 1000) / 10 : 0;
    const depositValue = hasRental && isMoney(deposit) ? Number(deposit) : 0;
    const showUnitSwitch = useDiscount || !dpFromPackage;

    // Switching % ↔ ₱ keeps the same amounts, shown in the new unit.
    const switchUnit = (next: Unit) => {
        if (next === unit) return;
        setUnit(next); setError("");
        if (useDiscount && discountText.trim() !== "" && !discountError)
            setDiscountText(discountAmount > 0 ? fmt(next === "percent" ? discountAmount / normalTotal * 100 : discountAmount) : "");
        if (!dpFromPackage && !dpError && finalPrice > 0)
            setDpText(fmt(next === "percent" ? dp / finalPrice * 100 : dp));
    };
    const startManualPrice = () => { setManualPrice(true); setPrice((finalPrice > 0 ? finalPrice : normalTotal).toFixed(2)); setError(""); };
    const stopManualPrice = () => {
        setManualPrice(false); setError("");
        const off = normalTotal - finalPrice;
        setDiscountText(off > 0.005 && off <= normalTotal ? fmt(unit === "percent" ? off / normalTotal * 100 : off) : "");
    };

    async function handleConfirm() {
        if (saving || loading || hasRental === null) return;
        if (discountError) { setError(discountError); return; }
        if (!fixedPrice && finalPrice <= 0) { setError(priceEntry ? "Enter a total price greater than ₱0." : "The total price must be more than ₱0."); return; }
        if (dpError) { setError(dpError); return; }
        if (hasRental && dp <= 0) { setError("Bookings with rental equipment need a down payment above ₱0."); return; }
        if (dp > finalPrice + 0.005) { setError("The down payment can't be more than the total price."); return; }
        if (hasRental && !isMoney(deposit)) { setError("Enter a valid security deposit (₱0 if none)."); return; }
        setSaving(true); setError("");
        try {
            // No reason needed; the discount itself is saved in the activity log.
            await onConfirm(finalPrice, dp, depositValue, "", undefined,
                discount > 0.005 ? `Discount ${peso(discount)} (${discountPercent}% off)` : undefined);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Couldn't save the terms.");
        } finally { setSaving(false); }
    }

    const field = "h-11 w-full rounded-xl border border-[#E6DDF0] bg-white px-3 text-sm text-[#1A1220] outline-none focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:bg-[#F5F2F8] disabled:text-[#806A8C]";
    const row = "flex items-center justify-between gap-3";
    const unitSign = unit === "percent" ? "%" : "₱";
    // Input with the unit shown inside the box (inline styles so it never depends on new Tailwind classes).
    const unitInput = (props: { id: string; label: string; value: string; invalid: boolean; onChange: (value: string) => void; placeholder: string }) => (
        <div style={{ position: "relative" }}>
            {unit === "amount" && <span aria-hidden="true" className="text-sm text-[#806A8C]" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}>₱</span>}
            <input id={props.id} aria-label={props.label} inputMode="decimal" value={props.value} disabled={saving} placeholder={props.placeholder}
                   aria-invalid={props.invalid} onChange={e => { props.onChange(e.target.value); setError(""); }}
                   className={`${field} tabular-nums`} style={{ paddingLeft: unit === "amount" ? 28 : 12, paddingRight: 32 }}/>
            {unit === "percent" && <span aria-hidden="true" className="text-sm text-[#806A8C]" style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)" }}>%</span>}
        </div>
    );

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-label="Set price and payment terms" className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[18px] border border-[#E6DDF0] bg-white font-sans shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <h3 className="text-lg font-bold text-[#1A1220]">{fixedPrice ? "Review Payment Terms" : "Set Price & Payment Terms"}</h3>
                    <p className="mt-0.5 text-sm text-[#7A6A84]">{booking.name}</p>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-[#2B174C]">
                    {loading && <p role="status" className="text-[#806A8C]">Loading booking items…</p>}

                    {/* Price */}
                    {!loading && <section aria-label="Price" className="space-y-2">
                        <h4 className="text-xs font-bold uppercase tracking-wide text-[#806A8C]">Price</h4>
                        {fixedPrice ? <div className="space-y-1.5 rounded-xl bg-[#FAF8FD] p-3">
                            <div className={row}><span>{fixedPackage ? "Package price" : "Rental price"}</span><strong className="tabular-nums">{peso(fixedPackage ? packageBase : finalPrice)}</strong></div>
                            {fixedPackage && rentalTotal > 0 && <div className={row}><span>Extra rental equipment</span><strong className="tabular-nums">{peso(rentalTotal)}</strong></div>}
                            {fixedPackage && includedRentals.length > 0 && <p className="text-xs text-[#806A8C]">Includes: {includedRentals.join(", ")}</p>}
                            <div className={`${row} border-t border-[#E6DDF0] pt-1.5 font-bold`}><span>Total</span><span className="tabular-nums">{peso(finalPrice)}</span></div>
                            <p className="text-xs text-[#806A8C]">{fixedPackage ? "Fixed by the package." : "Fixed by the equipment's daily rates."}</p>
                        </div> : normalTotal > 0 && <div className="space-y-1.5 rounded-xl bg-[#FAF8FD] p-3">
                            {consumablesTotal > 0 && <div className={row}><span>Consumables</span><span className="tabular-nums">{peso(consumablesTotal)}</span></div>}
                            {rentalTotal > 0 && <div className={row}><span>Rental equipment</span><span className="tabular-nums">{peso(rentalTotal)}</span></div>}
                            <div className={`${row} border-t border-[#E6DDF0] pt-1.5 font-semibold`}><span>Normal total</span><span className="tabular-nums">{peso(normalTotal)}</span></div>
                            {lines.length > 0 && <button type="button" onClick={() => setShowItems(v => !v)} className="text-xs font-semibold text-[#6335BC] hover:underline">
                                {showItems ? "Hide items" : `View items (${lines.length})`}</button>}
                            {showItems && <ul className="space-y-1 border-t border-[#E6DDF0] pt-1.5 text-xs text-[#5F4E75]">{lines.map((l, i) =>
                                <li key={i} className={row}><span>{l.name} <span className="text-[#75657E]">{l.detail}</span></span><span className="tabular-nums">{peso(l.amount)}</span></li>)}</ul>}
                        </div>}
                        {priceEntry && <label className="block font-semibold">Total price (₱)
                            <input aria-label="Total price" inputMode="decimal" value={price} disabled={saving} placeholder="0.00"
                                   onChange={e => { setPrice(e.target.value); setError(""); }} className={`${field} mt-1 tabular-nums`}/>
                        </label>}
                        {!fixedPrice && normalTotal > 0 && <button type="button" disabled={saving} onClick={priceEntry ? stopManualPrice : startManualPrice}
                                                                   className="text-xs font-semibold text-[#6335BC] hover:underline">
                            {priceEntry ? "Use a discount instead" : "Type the total price yourself"}</button>}
                    </section>}

                    {/* Discount and down payment: one % / ₱ switch for both */}
                    {!loading && hasRental !== null && <section aria-label="Discount and payment" className="space-y-3">
                        <div className={row}>
                            <h4 className="text-xs font-bold uppercase tracking-wide text-[#806A8C]">{useDiscount ? "Discount & Down payment" : "Payment"}</h4>
                            {showUnitSwitch && <div role="radiogroup" aria-label="Enter amounts as" className="flex rounded-lg border border-[#D8CBE7]" style={{ padding: 2 }}>
                                {(["percent", "amount"] as Unit[]).map(option => <button key={option} type="button" role="radio" aria-checked={unit === option}
                                                                                         disabled={saving} onClick={() => switchUnit(option)}
                                                                                         className="rounded-md text-xs font-semibold"
                                                                                         style={{ padding: "4px 12px", background: unit === option ? "#2B174C" : "transparent", color: unit === option ? "#FFFFFF" : "#4E2C66" }}>
                                    {option === "percent" ? "%" : "₱"}</button>)}
                            </div>}
                        </div>
                        {useDiscount && <div>
                            <label htmlFor="booking-discount" className="block font-semibold">Discount <span className="font-normal text-[#806A8C]">(optional)</span></label>
                            <div className="mt-1">{unitInput({ id: "booking-discount", label: "Discount", value: discountText, invalid: Boolean(discountError),
                                onChange: setDiscountText, placeholder: unit === "percent" ? "0" : "0.00" })}</div>
                            {discountError
                                ? <span role="alert" className="mt-1 block text-xs font-semibold text-[#C32F2F]">{discountError}</span>
                                : discountAmount > 0 && <span className="mt-1 block text-xs font-semibold text-[#138342]">
                                    = {unit === "percent" ? `${peso(discountAmount)} off` : `${discountPercent}% off`}</span>}
                        </div>}
                        {dpFromPackage
                            ? <div className={`${row} rounded-xl bg-[#FAF8FD] p-3`}><span>Down payment <span className="text-xs text-[#806A8C]">(set in the package)</span></span><strong className="tabular-nums">{peso(dp)}</strong></div>
                            : <div>
                                <label htmlFor="booking-down-payment" className="block font-semibold">Down payment</label>
                                <div className="mt-1">{unitInput({ id: "booking-down-payment", label: "Down payment", value: dpText, invalid: Boolean(dpError),
                                    onChange: setDpText, placeholder: unit === "percent" ? "30" : "0.00" })}</div>
                                {dpError
                                    ? <span role="alert" className="mt-1 block text-xs font-semibold text-[#C32F2F]">{dpError}</span>
                                    : <span className="mt-1 block text-xs text-[#806A8C]">= {unit === "percent" ? peso(dp) : `${dpPercentOfPrice}% of the total`}, part of the price</span>}
                            </div>}
                        {hasRental && <label className="block font-semibold">Security deposit (₱)
                            <input aria-label="Security deposit" inputMode="decimal" value={deposit} disabled={saving}
                                   onChange={e => { setDeposit(e.target.value); setError(""); }} className={`${field} mt-1 tabular-nums`}/>
                            <span className="mt-1 block text-xs font-normal text-[#806A8C]">Refundable. Collected before release and returned after the equipment comes back. ₱0 if none.</span>
                        </label>}
                    </section>}

                    {/* Summary */}
                    {!loading && hasRental !== null && finalPrice > 0 && <div className="space-y-1.5 rounded-xl border border-[#E6DDF0] p-3">
                        {!fixedPrice && normalTotal > 0 && discount > 0.005 && <>
                            <div className={row}><span>Normal total</span><span className="tabular-nums">{peso(normalTotal)}</span></div>
                            <div className={`${row} text-[#138342]`}><span>Discount ({discountPercent}% off)</span><span className="tabular-nums">−{peso(discount)}</span></div>
                        </>}
                        {!fixedPrice && normalTotal > 0 && discount < -0.005 && <div className={`${row} text-[#806A8C]`}><span>Above the normal total</span><span className="tabular-nums">+{peso(-discount)}</span></div>}
                        <div className={`${row} font-bold`}><span>Total price</span><span className="tabular-nums">{peso(finalPrice)}</span></div>
                        <div className={row}><span>Down payment</span><span className="tabular-nums">{peso(dp)}</span></div>
                        <div className={row}><span>Balance after down payment</span><span className="tabular-nums">{peso(Math.max(0, finalPrice - dp))}</span></div>
                        {hasRental && depositValue > 0 && <div className={`${row} text-[#806A8C]`}><span>Security deposit (separate)</span><span className="tabular-nums">{peso(depositValue)}</span></div>}
                    </div>}
                    {error && <p role="alert" className="rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-3 py-2 text-xs font-medium text-[#C32F2F]">{error}</p>}
                </div>
                <div className="flex gap-3 border-t border-[#EFE7F4] px-5 py-4">
                    <button type="button" disabled={saving} onClick={onClose} className="flex-1 rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-sm font-semibold text-[#2B174C] disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={saving || loading || hasRental === null} onClick={() => void handleConfirm()}
                            className="flex-1 rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save Terms"}</button>
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
                nextStatusLabel: "Approve Booking",
                statusActionDisabled: false,
                statusHelper: "Check availability, then approve to request the down payment."
            };
        case "Awaiting Down Payment":
            return {
                nextStatus: "Confirmed",
                nextStatusLabel: "Retry Reservation",
                statusActionDisabled: !downPaymentPaid,
                statusHelper: downPaymentPaid ? "Payment recorded, but the items couldn't be reserved. Fix the issue shown, then retry." : "Recording the down payment confirms the booking and reserves the items."
            };
        case "Confirmed":
            return {
                nextStatus: "Preparing",
                nextStatusLabel: "Start Preparing", // ← second button
                statusActionDisabled: false,
                statusHelper: "Move this booking to preparation."
            };
        case "Preparing":
            return {
                nextStatus: "Released",
                nextStatusLabel: "Release Items",
                statusActionDisabled: false,
                statusHelper: "Staff can hand over the items once the full payment (and any security deposit) is recorded."
            };
        case "Released":
            return {
                nextStatus: "Return Inspection",
                nextStatusLabel: "Awaiting Rental Return",
                statusActionDisabled: true,
                statusHelper: "Waiting for Staff to receive the rental equipment."
            };
        case "Return Inspection":
            return {
                nextStatus: "Pending Settlement",
                nextStatusLabel: "Staff Checking Returns",
                statusActionDisabled: true,
                statusHelper: "Waiting for Staff to finish checking the returned equipment."
            };
        case "Pending Settlement":
            return {
                nextStatus: "Completed",
                nextStatusLabel: "Settle Claims & Deposit",
                statusActionDisabled: true,
                statusHelper: "Settle any damage charges and the security deposit to complete the booking."
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
                statusHelper:"This request was rejected."};
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
    // Staff see bookings read-only: hide Manager-only action boxes instead of showing "View-only" placeholders.
    const staffReadOnly = !managerView && !ownerView && !canManage;
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
        ? "Record Payment"
        : needsInitialDp ? "Record Down Payment" : "Record Payment";
    const paymentActionHandler = needsInitialDp ? onRecordDownPayment : onMarkFullyPaid;
    const nextActionDescription = displayStatus === "Pending Review"
        ? awaitingTermsReview
            ? "Set the price and payment terms first. Then you can approve the booking."
            : "Terms are set. Approve the booking to request the down payment."
        : displayStatus === "Awaiting Down Payment"
            ? downPaymentPaid
                ? "Payment recorded, but the items couldn't be reserved. Check availability, then retry."
                : "Record the down payment when the customer pays. The items are then reserved automatically."
            : displayStatus === "Confirmed"
                ? "Items are reserved. Staff can start preparing."
                : displayStatus === "Preparing"
                    ? "Staff is preparing. Full payment (and any security deposit) is due before hand over."
                    : displayStatus === "Released"
                        ? "Items handed over. Any rental equipment comes back after the event."
                        : displayStatus === "Return Inspection"
                            ? "Staff is checking the returned equipment."
                            : displayStatus === "Pending Settlement"
                                ? "Settle any damage charges and the security deposit."
                                : displayStatus === "Completed"
                                    ? "Booking completed."
                                    : displayStatus === "Cancelled"
                                        ? "Booking cancelled. See Billing for payments and refunds."
                                        : displayStatus === "Rejected"
                                            ? "Booking request rejected."
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
                                <h3 className="text-sm font-bold text-[#2B174C]">Next Step</h3>
                                <p className="mt-1 text-xs leading-5 text-[#655478]">{nextActionDescription}</p>
                            </div>
                            {canManage && !ownerView && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {displayStatus === "Pending Review" && awaitingTermsReview && canEditPaymentTerms && onSetPrice && (
                                        <button type="button" onClick={() => onSetPrice(b)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            {isCustom ? "Set Price & Terms" :
                                                getManagerBookingTypeLabel(b) === "Rental" ? "Review Terms" :
                                                    "Set Security Deposit"}
                                        </button>
                                    )}
                                    {displayStatus === "Pending Review" && !awaitingTermsReview && onUpdateStatus && (
                                        <button type="button" disabled={statusActionDisabled || total <= 0}
                                                onClick={() => onUpdateStatus(b.id, actionNextStatus)}
                                                className={`${action} bg-[#4D2A96] text-white hover:bg-[#371C72]`}>
                                            Approve Booking
                                        </button>
                                    )}
                                    {displayStatus === "Pending Review" && !awaitingTermsReview && needsTermsReview && canEditPaymentTerms && onSetPrice && (
                                        <button type="button" onClick={() => onSetPrice(b)}
                                                className={`${action} border border-[#D6C4F8] bg-white text-[#4D2A96] hover:bg-[#F3EEFF]`}>
                                            Edit Terms
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
                                            Record Payment
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
                            {!canManage && <p className="text-xs text-[#806A8C]">You have view-only access to bookings.</p>}
                        </div>
                    </section>
                    {/* Read-only form: label | value rows under plain section headings. */}
                    {(() => {
                        const schedule = getBookingSchedule(b);
                        const packageName = String(b.packageName || b.package_name || b.package || "").trim();
                        const theme = String(b.theme_motif_request || b.themeMotifRequest || b.theme || "").trim();
                        const specialRequest = String(getCustomerCustomRequest(b) || "").trim();
                        const instructions = String(b.additional_notes || b.additionalNotes || b.notes || "").trim();
                        type Field = { label: string; value: string; accent?: boolean };
                        const sections: Array<{ title: string; fields: Field[] }> = [
                            { title: "Payment", fields: [
                                    { label: "Booking total", value: total > 0 ? peso(total) : "Not set" },
                                    { label: "Amount paid", value: peso(paid) },
                                    { label: "Balance due", value: isCustom && total <= 0 ? "Not set" : peso(balance), accent: true },
                                    { label: "Payment status", value: getSimplePaymentLabel(b) },
                                ] },
                            { title: "Schedule", fields: [
                                    { label: "Event date", value: formatDate(b.date) },
                                    { label: schedule.label, value: schedule.handoverText || "—" },
                                    ...(schedule.returnText ? [{ label: "Return", value: schedule.returnText }] : []),
                                    ...(b.venue ? [{ label: b.handoverMethod === "delivery" ? "Delivery address" : "Venue", value: b.venue }] : []),
                                ] },
                            { title: "Booking", fields: [
                                    { label: "Type", value: `${getBookingTypeDisplay(b)} · ${getManagerBookingItemMixLabel(b)}` },
                                    ...(getBookingTypeDisplay(b) === "Package" && packageName ? [{ label: "Package", value: packageName }] : []),
                                    ...(realEventType(b) ? [{ label: "Event type", value: realEventType(b) }] : []),
                                    ...(theme ? [{ label: "Theme / Motif", value: theme }] : []),
                                ] },
                            { title: "Customer", fields: [
                                    { label: "Phone", value: b.phone || "—" },
                                    ...((b.facebookName || b.facebook_name) ? [{ label: "Messenger", value: String(b.facebookName || b.facebook_name) }] : []),
                                    ...(b.email ? [{ label: "Email", value: b.email }] : []),
                                ] },
                            { title: "Requests", fields: [
                                    ...(specialRequest ? [{ label: "Special request", value: specialRequest }] : []),
                                    ...(instructions ? [{ label: "Instructions", value: instructions }] : []),
                                ] },
                        ];
                        return (
                            <div className="space-y-5 px-1 pt-1" aria-label="Booking details">
                                {sections.filter(section => section.fields.length > 0).map(section => (
                                    <section key={section.title} aria-label={section.title}>
                                        <h3 className="mb-1 text-[13px] font-bold text-[#2B174C]">{section.title}</h3>
                                        <dl className="divide-y divide-[#F0EAF4] border-y border-[#F0EAF4]">
                                            {section.fields.map(field => (
                                                <div key={field.label} className="flex py-2" style={{ gap: 12 }}>
                                                    {/* Inline width so the label column is always the same, whatever Tailwind classes the build includes. */}
                                                    <dt className="text-xs text-[#75657E]" style={{ width: "40%", flexShrink: 0 }}>{field.label}</dt>
                                                    <dd className={`whitespace-pre-wrap break-words text-xs font-medium ${field.accent ? "text-[#6335BC]" : "text-[#261940]"}`} style={{ flex: 1, minWidth: 0 }}>{field.value}</dd>
                                                </div>
                                            ))}
                                        </dl>
                                    </section>
                                ))}
                            </div>
                        );
                    })()}

                    {customNeedsTerms && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Set the price and down payment before collecting payment.</p>}
                    {canManage && !ownerView && onCancelBooking &&
                        ["Pending Review","Awaiting Down Payment","Confirmed","Preparing"].includes(displayStatus) && (
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EAE3F1] pt-3">
                                <div>
                                    <p className="text-xs font-semibold text-[#392B49]">
                                        {displayStatus==="Pending Review"?"Decline this request?":"Need to cancel this booking?"}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-[#887B99]">
                                        {displayStatus==="Pending Review"
                                            ? "Not approved yet. A reason is required."
                                            : "You'll review payments and items before it's cancelled."}
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

                    {getBookingSchedule(b).handoverTime && (
                        <p className="mt-0.5 text-xs text-[#7A6A84]">
                            {getBookingSchedule(b).handoverShort}
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
                        <span className="text-xs text-[#75657E]">Open row</span>
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
                                                Set the price and down payment before recording a payment.
                                            </p>
                                        )}

                                        {!isCustom && total <= 0 && (
                                            <p className="mt-3 rounded-xl bg-orange-50 px-3 py-2 text-xs font-medium text-orange-700">
                                                Package price is missing. Refresh the page.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {hideSummaryRow && detailTab === "Billing" && (
                                    <section aria-label="Full booking billing record" className="min-w-0 space-y-3">
                                        <div className="rounded-xl border border-[#E6DDF0] bg-[#F9F6FF] px-4 py-3">
                                            <h3 className="text-sm font-bold text-[#2B174C]">Billing &amp; Payment Records</h3>
                                            <p className="mt-1 text-xs leading-5 text-[#766782]">Charges, payments, deposit and refunds for this booking.</p>
                                        </div>
                                        <BookingFinancialPanel bookingId={b.id} branchId={Number(b.branchId||b.branch_id||0)} ownerView={ownerView} editable={canManage}/>
                                    </section>
                                )}

                                {(!hideSummaryRow || detailTab === "Items") && (
                                    <div className="min-w-0 space-y-3">
                                        {hideSummaryRow && <div className="rounded-xl border border-[#E6DDF0] bg-[#F9F6FF] px-4 py-3">
                                            <h3 className="text-sm font-bold text-[#2B174C]">Booking Items &amp; Availability</h3>
                                            <p className="mt-1 text-xs leading-5 text-[#766782]">{bookingRentalItems.length > 0 && bookingItems.length > 0
                                                ? "Consumables and rental equipment in this booking."
                                                : bookingRentalItems.length > 0
                                                    ? "Rental equipment and its availability for the event dates."
                                                    : "Consumable items and current stock."}</p>
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
                                                {/* Show only the sections this booking actually has. */}
                                                {(bookingItems.length > 0 || bookingRentalItems.length === 0) && <section aria-label="Inclusions" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
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
                                                </section>}
                                                {bookingRentalItems.length > 0 && <section aria-label="Additional Rental Equipment" className="min-w-0 rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
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
                                                </section>}
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

                                        <p className="mb-3 text-xs text-[#806A8C]">Requests and instructions from the customer.</p>
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
                                    {!staffReadOnly && <div className="rounded-[14px] border border-[#E6DDF0] bg-[#FFFDF8] p-4">
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
                                            <div className="flex min-h-[42px] w-full items-center justify-center rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 text-center text-sm font-semibold text-[#975A04]">Deposit not loaded. Refresh the page.</div>
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
                                                {bookingIncludesRentals ? "Record Payment" : "Record Down Payment"}
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
                                                Edit Price &amp; Terms
                                            </button>
                                        )}
                                        {getManagerBookingTypeLabel(b) === "Package" && canManage && !ownerView && canEditPaymentTerms && (
                                            <p className="mt-3 rounded-xl border border-[#E6DDF0] bg-[#F8F4FF] px-3 py-3 text-xs leading-5 text-[#674A8E]">
                                                The package sets the price and down payment.
                                            </p>
                                        )}
                                    </div>}

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

                                        {staffReadOnly && !canConfirmStandard ? null : ownerView || (!canManage && !(canOperateBookings && (displayStatus === "Confirmed" || displayStatus === "Preparing" || displayStatus === "Released"))) ? (
                                            <div className="rounded-xl border border-[#E6DDF0] bg-white px-3 py-3 text-center text-xs font-semibold text-[#7A6A84]">
                                                {canConfirmStandard && ["Pending Review","Awaiting Down Payment"].includes(displayStatus)
                                                    ? "Staff can prepare the items after approval and the down payment."
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
                                                {displayStatus==="Pending Review" && requiredDp===0 && <p className="rounded-lg bg-[#FFF8E8] px-3 py-2 text-xs text-[#A56607]">A booking with no down payment needs Manager approval.</p>}
                                                <button type="button" onClick={(e)=>{e.stopPropagation(); onRequestApproval?.(b)}}
                                                        className="min-h-[42px] rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] hover:bg-[#F7F1FF]">
                                                    {b.approvalStatus === "pending" ? "Update Approval Request" : "Request Manager Approval"}
                                                </button>
                                            </div>
                                        )}
                                        {canManage && !ownerView && displayStatus === "Pending Review" && b.approvalStatus === "pending" && (
                                            <p className="mt-2 text-center text-xs font-semibold text-amber-900">
                                                Approving requests the down payment. Items are reserved once it's paid.
                                            </p>
                                        )}
                                        {!staffReadOnly && <p className="mt-3 text-center text-xs text-[#7A6A84]">
                                            {statusHelper}
                                        </p>}
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
    // Newest bookings first (by when they were made; the booking number breaks ties).
    const orderedBookings = useMemo(() => {
        const madeAt = (booking: Booking) => {
            const time = Date.parse(String(booking.createdAt || booking.created_at || "").replace(" ", "T"));
            return Number.isFinite(time) ? time : 0;
        };
        return [...bookings].sort((a, b) => madeAt(b) - madeAt(a) || Number(b.id) - Number(a.id));
    }, [bookings]);
    const openBooking = (booking: Booking) => {
        setSelectedId(booking.id); setDetailTab("Overview"); setExportOpen(false);
    };
    const selectedBooking = orderedBookings.find(booking => booking.id === selectedId) ?? orderedBookings[0];
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
                    <table role="grid" aria-label="Bookings" className="w-full min-w-[540px] border-collapse">
                        <thead className={`sticky top-0 z-10 ${managerView ? "bg-[#F9F7FC]" : "bg-[#FFFDF8]"}`}>
                        <tr className="border-b border-[#E6DDF0] text-left text-[11px] font-semibold text-[#75657E]">
                            <th scope="col" className="px-2.5 py-3">{managerView ? "Customer" : "Customer / Booking Ref"}</th>
                            <th scope="col" className="px-2.5 py-3">Schedule</th>
                            <th scope="col" className="px-2.5 py-3">Type</th>
                            <th scope="col" className="px-2.5 py-3">Payment</th>
                            <th scope="col" className="px-2.5 py-3">Status</th>
                        </tr>
                        </thead>
                        <tbody>
                        {orderedBookings.map(booking => {
                            const selected = booking.id === selectedBooking?.id;
                            const payment = getSimplePaymentLabel(booking);
                            const bookingTypeLabel = getBookingTypeDisplay(booking);
                            const contentsLabel = getManagerBookingItemMixLabel(booking);
                            const status = normalizeBookingStatus(booking.status);
                            return (
                                <tr key={booking.id}
                                    onClick={() => openBooking(booking)}
                                    onKeyDown={event => {
                                        if (event.key === "Enter" || event.key === " ") {
                                            event.preventDefault(); openBooking(booking);
                                        }
                                    }}
                                    tabIndex={0} aria-selected={selected}
                                    className={`cursor-pointer border-b border-[#EFE7F4] text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C3AD6] ${selected ? "bg-[#F3ECFF] shadow-[inset_4px_0_0_#6C3AD6]" : "bg-white hover:bg-[#FAF6FF]"}`}>
                                    <td className="max-w-[130px] px-2.5 py-3 align-top">
                                        <p className="truncate text-xs font-bold text-[#1A1220]" title={booking.name}>{booking.name}</p>
                                        {!managerView && <p className="mt-1 truncate text-[11px] text-[#75657E]">{booking.bookingReference || `#${booking.id}`}</p>}
                                        {ownerView && <p className="mt-1 truncate text-[11px] text-[#75657E]">{getBranchGroupName(booking)}</p>}
                                    </td>
                                    <td className="min-w-[104px] px-2.5 py-3 align-top text-xs text-[#1A1220]">
                                        <p className="whitespace-nowrap font-semibold">{formatDate(booking.date)}</p>
                                        {getBookingSchedule(booking).handoverTime && <p className={`mt-1 text-[11px] leading-4 text-[#75657E] ${getBookingSchedule(booking).handoverDate === dateKey(booking.date) ? "whitespace-nowrap" : ""}`}>{getBookingSchedule(booking).handoverShort}</p>}
                                    </td>
                                    <td className="px-2.5 py-3 align-top">
                                        <p className="text-xs font-semibold text-[#1A1220]" title={bookingTypeLabel}>{bookingTypeLabel}</p>
                                        {contentsLabel !== "Composition unavailable" && <p className="mt-1 whitespace-nowrap text-[11px] leading-4 text-[#75657E]" title={contentsLabel}>{contentsLabel}</p>}
                                    </td>
                                    <td className="px-2.5 py-3 align-top">
                                        <span className="whitespace-nowrap text-xs font-medium text-[#261940]">{payment}</span>
                                    </td>
                                    <td className="px-2.5 py-3 align-top"><span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-1 text-[11px] font-semibold ${STATUS_STYLE[status] || "border-[#E6DDF0] bg-[#F7F1FF] text-[#2B174C]"}`}>{getManagerBookingStatusLabel(status)}</span></td>
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
                            <span>{formatDate(selectedBooking.date)}{getBookingSchedule(selectedBooking).handoverTime ? ` · ${getBookingSchedule(selectedBooking).handoverShort}` : ""}</span>
                            <span className="max-w-full truncate">{getBranchGroupName(selectedBooking)}</span>
                            <span className="max-w-full truncate" title={getBookingItemLabel(selectedBooking)}>{getBookingItemLabel(selectedBooking)}</span>
                        </div>}
                        <div
                            className={`mt-3 grid gap-1 border-b border-[#E6DDF0] ${tabs.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}
                            role="tablist"
                            aria-label="Booking detail sections"
                        >
                            {tabs.map(tab => <button key={tab} type="button" role="tab" aria-selected={tab === detailTab} onClick={() => {setDetailTab(tab);setExportOpen(false);}} className={`min-w-0 px-1.5 py-2.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#6C3AD6] ${tab === detailTab ? "border-b-[3px] border-[#6C3AD6] text-[#6C3AD6]" : "text-[#75657E] hover:text-[#45217D]"}`}>{tab}</button>)}
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
