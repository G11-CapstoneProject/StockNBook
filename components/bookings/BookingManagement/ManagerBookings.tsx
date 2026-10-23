"use client";

import { getNextStatusConfig } from './_shared';
import { useEffect, useMemo, useState } from "react";
import {
    BadgeCheck,
    AlertCircle,
    CheckCircle2,
    ClipboardCheck,
    Download,
    PackageCheck,
    RefreshCw,
    Search,
    Wallet,
    X,
} from "lucide-react";
import { ModuleSkeleton } from "@/components/loading/ModuleSkeletons";
import {
    Booking,
    FilterType,
    TABS,
    BookingWorkspace,
    PriceModal,
    dateKey,
    formatDate,
    getAmountPaid,
    getBalance,
    getBranchGroupName,
    getManagerBookingTypeLabel,
    getManagerBookingStatusLabel,
    getManagerPaymentLabel,
    getRequiredDownPayment,
    getSavedBookingAccess,
    getTotalPrice,
    normalizeBooking,
    peso,
} from "./_shared";

type BookingInventoryItem = {
    id: number;
    booking_id?: number;
    source_type?: string;
    product_id?: number;
    variant_id?: number | null;
    product_name: string;
    variant_name?: string | null;
    booked_quantity: number | string;
    reserved_quantity: number | string;
    used_quantity?: number | string;
    restored_quantity?: number | string;
    unit_price?: number | string;
    inventory_status?: string;
};

type CancelUsedItem = {
    booking_item_id: number;
    used_quantity: number;
};

// UI-only feedback for booking actions. This does not change API requests
// or any inventory, approval, or payment business rules.
type BookingToast = {
    id: number;
    kind: "success" | "error";
    title: string;
    description: string;
};

function formatCurrentDateTime(value: Date) {
    const dateLabel = value.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });

    const timeLabel = value
        .toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        })
        .toLowerCase();

    return `${dateLabel} | ${timeLabel}`;
}


export default function ManagerBookings() {
    const canManage = getSavedBookingAccess("manager") === "full";
    const [bookings, setBookings] = useState<Booking[]>([]);
    const [branchName, setBranchName] = useState("Assigned Branch");
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterType>("All");
    const [search, setSearch] = useState("");
    const [approvalOnly, setApprovalOnly] = useState(false);
    const [toast, setToast] = useState<BookingToast | null>(null);

    function showBookingToast(kind: BookingToast["kind"], title: string, description: string) {
        setToast(previous => ({
            id: (previous?.id ?? 0) + 1,
            kind,
            title,
            description,
        }));
    }

    // Retain the existing call sites, but present handled API errors in a
    // dismissible bottom-right toast instead of a full-width page banner.
    function setBookingActionError(message: string) {
        if (!message) {
            setToast(null);
            return;
        }
        const shortage = /insufficient.*(sales\s+)?inventory|not enough (sales\s+)?stock/i.test(message);
        showBookingToast("error", shortage ? "Insufficient consumable items" : "Booking action unsuccessful",
            shortage
                ? "Not enough consumable items are available for this booking. Check the available stock and the booking inclusions before trying again."
                : message);
    }

    useEffect(() => {
        if (!toast) return;
        const timer = window.setTimeout(() => {
            setToast(current => current?.id === toast.id ? null : current);
        }, toast.kind === "error" ? 9000 : 5500);
        return () => window.clearTimeout(timer);
    }, [toast]);
    const [dateFrom, setDateFrom] = useState("");
    const [dateTo, setDateTo] = useState("");
    const [bookingType, setBookingType] = useState("All");
    const [listExportOpen, setListExportOpen] = useState(false);
    const [priceModal, setPriceModal] = useState<Booking | null>(null);
    const [approvalModal, setApprovalModal] = useState<Booking | null>(null);
    const [approvalSaving, setApprovalSaving] = useState(false);
    const [approvalError, setApprovalError] = useState("");
    const [paymentModal, setPaymentModal] = useState<Booking | null>(null);
    const [paymentSaving, setPaymentSaving] = useState(false);
    const [paymentError, setPaymentError] = useState("");
    const [currentDateTime, setCurrentDateTime] = useState<Date | null>(null);
    const [cancelModal, setCancelModal] = useState<Booking | null>(null);
    const [cancelItems, setCancelItems] = useState<BookingInventoryItem[]>([]);
    const [cancelUsedQty, setCancelUsedQty] = useState<Record<number, number>>({});
    const [cancelLoading, setCancelLoading] = useState(false);
    const [cancelSubmitting, setCancelSubmitting] = useState(false);
    const [cancelError, setCancelError] = useState("");

    function getToken() {
        return sessionStorage.getItem("token");
    }

    function getBranchId() {
        return (
            sessionStorage.getItem("branch_id") ||
            sessionStorage.getItem("stocknbook_branch_id") ||
            sessionStorage.getItem("manager_branch_id")
        );
    }

    function getStoreId() {
        return (
            sessionStorage.getItem("store_id") ||
            sessionStorage.getItem("stocknbook_store_id")
        );
    }

    function getSavedBranchName() {
        return (
            sessionStorage.getItem("branch_name") ||
            sessionStorage.getItem("stocknbook_branch_name") ||
            "Assigned Branch"
        );
    }

    function normalizeStatus(status?: string) {
        const value = String(status || "").trim().toLowerCase();

        if (!value || value === "pending" || value === "pending review") {
            return "Pending Review";
        }

        if (
            value === "approved" ||
            value === "awaiting down payment" ||
            value === "waiting down payment" ||
            value === "awaiting payment" ||
            value === "down payment required"
        ) {
            return "Awaiting Down Payment";
        }

        if (value === "confirmed") return "Confirmed";
        if (value === "preparing") return "Preparing";
        if (value === "completed") return "Completed";
        if (value === "cancelled" || value === "canceled") return "Cancelled";

        return status || "Pending Review";
    }

    function updateLocalBooking(id: number, updates: Partial<Booking>) {
        setBookings((prev) =>
            prev.map((booking) =>
                booking.id === id
                    ? normalizeBooking(
                        {
                            ...booking,
                            ...updates,
                        },
                        branchName
                    )
                    : booking
            )
        );
    }

    async function loadBookings(): Promise<Booking[]> {
        setLoading(true);

        const token = getToken();
        const storeId = getStoreId();
        const branchId = getBranchId();
        const savedBranchName = getSavedBranchName();

        setBranchName(savedBranchName);

        if (!token || !storeId || !branchId) {
            setBookings([]);
            setLoading(false);
            return [];
        }

        try {
            const res = await fetch("/api/bookings", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    action: "get_booking_page_bookings",
                    store_id: Number(storeId),
                    branch_id: Number(branchId),
                    role: "manager",
                }),
                cache: "no-store",
            });

            const data = await res.json();

            if (!res.ok || data.success === false) {
                console.error("Bookings load failed:", data);
                setBookings([]);
                return [];
            }

            const normalizedBookings = (data.bookings || []).map(
                (booking: Record<string, unknown>) =>
                    normalizeBooking(booking, savedBranchName)
            );

            setBookings(normalizedBookings);
            return normalizedBookings;

        } catch (err) {
            console.error("Bookings load failed:", err);
            setBookings([]);
            return [];
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void loadBookings();
    }, []);


    useEffect(() => {
        const updateDateTime = () => setCurrentDateTime(new Date());

        updateDateTime();
        const timer = window.setInterval(updateDateTime, 30_000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    async function updateStatus(
        id: number,
        newStatus: string,
        price?: number,
        usedItems?: CancelUsedItem[]
    ): Promise<boolean> {

        const token = getToken();
        const branchId = getBranchId();

        const booking = bookings.find((b) => b.id === id);
        if (!booking) return false;

        const cleanStatus = normalizeStatus(newStatus);

        // Allow cancel anytime except completed/cancelled
        if (cleanStatus === "Cancelled") {
            const currentStatus = normalizeStatus(booking.status);

            if (["Completed", "Cancelled"].includes(currentStatus)) {
                console.warn("Cannot cancel completed or already cancelled booking.");
                return false;
            }
        } else {
            const { nextStatus } = getNextStatusConfig(
                normalizeStatus(booking.status),
                getAmountPaid(booking) >= getRequiredDownPayment(booking)
            );

            if (cleanStatus !== nextStatus && !(cleanStatus === "Confirmed" && normalizeStatus(booking.status) === "Pending Review" && getRequiredDownPayment(booking) === 0)) {
                console.warn(`Cannot jump to ${cleanStatus}. Next valid status is ${nextStatus}`);
                return false;
            }
        }

        const isManagerApproval = normalizeStatus(booking.status) === "Pending Review"
            && cleanStatus === "Awaiting Down Payment" && getRequiredDownPayment(booking) > 0;

        try {
            const body: Record<string, unknown> = {
                action: "update_status",
                booking_id: id,
                status: cleanStatus,
            };

            if (branchId) body.branch_id = Number(branchId);
            if (cleanStatus === "Confirmed" && normalizeStatus(booking.status) === "Pending Review") {
                const reason = window.prompt("No down payment is required. Enter a Manager approval reason (at least 10 characters):");
                if (!reason || reason.trim().length < 10) return false;
                body.noDpReason = reason.trim();
            }
            if (price !== undefined) body.agreed_price = price;
            if (usedItems) body.used_items = usedItems;

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
                throw new Error(data.message || data.error || "Failed to update booking status.");
            }

            setBookingActionError("");
            updateLocalBooking(id, {
                status: cleanStatus,
                approvalStatus: ["Awaiting Down Payment","Confirmed"].includes(cleanStatus) && booking.approvalStatus === "pending" ? "approved" : booking.approvalStatus,
            });
            showBookingToast("success", isManagerApproval ? "Booking approved successfully" : "Booking status updated successfully",
                `${booking.bookingReference || `Booking #${id}`} is now ${getManagerBookingStatusLabel(cleanStatus)}.`);
            return true;
        } catch (err) {
            // Expected API/business-rule failures are already shown in the page alert.
            // Do not log them through console.error: Next.js dev overlay can obscure the UI.
            // Inventory validation and the booking's current status stay unchanged.
            setBookingActionError(err instanceof Error ? err.message : "Booking action failed.");
            return false;
        }
    }

    async function openCancelModal(booking: Booking) {
        const token = getToken();
        const branchId = getBranchId();

        setCancelModal(booking);
        setCancelItems([]);
        setCancelUsedQty({});
        setCancelError("");
        setCancelLoading(true);

        try {
            const body: Record<string, unknown> = {
                action: "get_booking_items",
                booking_id: booking.id,
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

            const items = Array.isArray(data.items) ? data.items : [];

            setCancelItems(items);

            const initialUsed: Record<number, number> = {};
            items.forEach((item: BookingInventoryItem) => {
                initialUsed[Number(item.id)] = 0;
            });

            setCancelUsedQty(initialUsed);
        } catch (err) {
            console.error("Failed to load booking items:", err);
            setCancelError("Failed to load booking items. Please try again.");
        } finally {
            setCancelLoading(false);
        }
    }

    async function confirmCancelBooking() {
        if (!cancelModal) return;

        setCancelSubmitting(true);
        setCancelError("");

        try {
            const usedItems: CancelUsedItem[] = cancelItems.map((item) => {
                const itemId = Number(item.id);
                const reservedQty = Number(item.reserved_quantity || 0);
                const usedQty = Math.max(
                    0,
                    Math.min(Number(cancelUsedQty[itemId] || 0), reservedQty)
                );

                return {
                    booking_item_id: itemId,
                    used_quantity: usedQty,
                };
            });

            await updateStatus(cancelModal.id, "Cancelled", undefined, usedItems);

            setCancelModal(null);
            setCancelItems([]);
            setCancelUsedQty({});
        } catch (err) {
            console.error("Failed to cancel booking:", err);
            setCancelError("Failed to cancel booking. Please check the used quantities and try again.");
        } finally {
            setCancelSubmitting(false);
        }
    }

    async function updateCustomPaymentTerms(
        booking: Booking,
        agreedPrice: number,
        requiredDownPayment: number
    ) {
        const latest = bookings.find(b => b.id === booking.id) ?? booking;
        if (normalizeStatus(latest.status) !== "Pending Review" || latest.approvalStatus === "approved") {
            throw new Error("Custom price and down payment are locked after booking approval.");
        }
        const token = getToken();
        const branchId = getBranchId();

        try {
            const body: Record<string, unknown> = {
                action: "update_price",
                booking_id: booking.id,
                agreed_price: agreedPrice,
                required_down_payment: requiredDownPayment,
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
                throw new Error(
                    data.message ||
                    data.error ||
                    "Failed to update custom payment terms."
                );
            }

            const currentPaid = getAmountPaid(booking);
            const newBalance = Math.max(agreedPrice - currentPaid, 0);

            const newPaymentStatus =
                currentPaid >= agreedPrice
                    ? "Fully Paid"
                    : currentPaid >= requiredDownPayment
                        ? "Down Payment Paid"
                        : currentPaid > 0
                            ? "Partial"
                            : "Down Payment Required";

            updateLocalBooking(booking.id, {
                agreed_price: agreedPrice,
                agreedPrice: agreedPrice,
                required_down_payment: requiredDownPayment,
                requiredDownPayment: requiredDownPayment,
                balance: newBalance,
                payment_status: newPaymentStatus,
                paymentStatus: newPaymentStatus,
            });
            showBookingToast("success", "Payment terms saved successfully",
                `${booking.bookingReference || `Booking #${booking.id}`} was updated.`);
        } catch (err) {
            console.error("Failed to update custom payment terms:", err);
            setBookingActionError(err instanceof Error ? err.message : "Could not save payment terms.");
            throw err;
        }
    }

    async function handlePriceConfirm(
        agreedPrice: number,
        requiredDownPayment: number
    ) {
        if (!priceModal) return;

        try {
            await updateCustomPaymentTerms(priceModal, agreedPrice, requiredDownPayment);
            setPriceModal(null);
        } catch {
            // Keep the editor open and display the error above the booking list.
        }
    }

    // Persist the ACTUAL amount received rather than silently assigning the
    // required deposit or full balance. update_payment expects the cumulative
    // amount_paid (the same existing API contract as before).
    async function saveRecordedPayment(receivedNow: number) {
        if (!paymentModal || paymentSaving) return;
        const booking = bookings.find(item => item.id === paymentModal.id) ?? paymentModal;
        const total = getTotalPrice(booking);
        const currentPaid = getAmountPaid(booking);
        const remainingCents = Math.round((total - currentPaid) * 100);
        const receivedCents = Math.round(receivedNow * 100);
        if (!Number.isFinite(receivedNow) || receivedCents <= 0 ||
            receivedCents > remainingCents || Math.abs(receivedNow * 100 - receivedCents) > 0.001) {
            setPaymentError("Enter a valid amount greater than ₱0.00 and no more than the remaining balance.");
            return;
        }
        const token = getToken();
        if (!token) { setPaymentError("Please sign in again before recording payment."); return; }
        const newAmountPaid = Math.round(currentPaid * 100 + receivedCents) / 100;
        const newBalance = Math.max(0, Math.round(total * 100 - Math.round(newAmountPaid * 100)) / 100);
        const requiredDp = getRequiredDownPayment(booking);
        const status = newBalance <= 0
            ? "Fully Paid"
            : requiredDp > 0 && newAmountPaid + 0.005 >= requiredDp
                ? "Down Payment Paid"
                : "Partial";
        setPaymentSaving(true);
        setPaymentError("");
        try {
            const body: Record<string, unknown> = {
                action: "update_payment",
                booking_id: booking.id,
                amount_paid: newAmountPaid,
                balance: newBalance,
                payment_status: status,
            };
            const branchId = getBranchId();
            if (branchId) body.branch_id = Number(branchId);
            const response = await fetch("/api/bookings", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify(body),
            });
            const result = await response.json();
            if (!response.ok || result.success === false || result.error) {
                throw new Error(result.error || result.message || "Failed to record payment.");
            }
            // Money received is not the same thing as Manager confirming inventory.
            updateLocalBooking(booking.id, {
                amount_paid: newAmountPaid, amountPaid: newAmountPaid,
                balance: newBalance, payment_status: status, paymentStatus: status,
            });
            setPaymentModal(null);
            setBookingActionError("");
            await loadBookings();
            showBookingToast("success", "Customer payment recorded successfully",
                `${peso(receivedNow)} received for ${booking.bookingReference || booking.name}. Booking confirmation remains separate.`);
        } catch (error) {
            setPaymentError(error instanceof Error ? error.message : "Unable to record payment.");
        } finally {
            setPaymentSaving(false);
        }
    }

    const filtered = useMemo(() => {
        return bookings
            .filter((booking) => !approvalOnly || (booking.approvalStatus === "pending" && booking.status === "Pending Review"))
            .filter((booking) => filter === "All" || booking.status === filter)
            .filter((booking) => bookingType === "All" || getManagerBookingTypeLabel(booking) === bookingType)
            .filter((booking) => !dateFrom || dateKey(booking.date) >= dateFrom)
            .filter((booking) => !dateTo || dateKey(booking.date) <= dateTo)
            .filter((booking) => {
                if (!search) return true;

                const query = search.toLowerCase();

                return (
                    booking.name.toLowerCase().includes(query) ||
                    booking.bookingReference?.toLowerCase().includes(query) ||
                    booking.phone?.includes(query) ||
                    booking.facebookName?.toLowerCase().includes(query) ||
                    getBranchGroupName(booking).toLowerCase().includes(query) ||
                    booking.customOrder?.toLowerCase().includes(query) ||
                    booking.custom_order?.toLowerCase().includes(query) ||
                    booking.package?.toLowerCase().includes(query) ||
                    booking.packageName?.toLowerCase().includes(query) ||
                    booking.package_name?.toLowerCase().includes(query) ||
                    booking.eventType?.toLowerCase().includes(query) ||
                    booking.event_type?.toLowerCase().includes(query) ||
                    booking.theme?.toLowerCase().includes(query) ||
                    booking.venue?.toLowerCase().includes(query)
                );
            });
    }, [bookings, filter, dateFrom, dateTo, bookingType, search, approvalOnly]);

    const counts = TABS.reduce((acc, tab) => {
        acc[tab] =
            tab === "All"
                ? bookings.length
                : bookings.filter((booking) => booking.status === tab).length;

        return acc;
    }, {} as Record<string, number>);

    const bookingTypes = ["Custom", "Package"] as const;
    const approvalsPending = bookings.filter(b => b.approvalStatus === "pending" && normalizeStatus(b.status) === "Pending Review").length;

    // Workbook-compatible UTF-8 CSV. Prefix formula-like values so customer data
    // can never run as a spreadsheet formula when opened in Excel.
    function csvField(value: unknown) {
        const raw = String(value ?? "");
        const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
        return `"${safe.replace(/"/g, '""')}"`;
    }
    function exportExcel(rows: Booking[], filename: string) {
        const columns = ["Booking Reference", "Customer", "Booking Type", "Schedule", "Time", "Status", "Payment Status", "Agreed Price", "Required Down Payment", "Amount Paid", "Balance", "Event Type", "Contact Number", "Email", "Notes", "Additional Custom Request"];
        const cells = rows.map(b => [b.bookingReference || String(b.id), b.name, getManagerBookingTypeLabel(b), dateKey(b.date), b.eventTime || "", getManagerBookingStatusLabel(b.status), getManagerPaymentLabel(b), getTotalPrice(b), getRequiredDownPayment(b), getAmountPaid(b), getBalance(b), b.eventType || "", b.phone || "", b.email || "", b.notes || "", b.customOrder || b.custom_order || ""]);
        const csv = "\uFEFF" + [columns, ...cells].map(row => row.map(csvField).join(",")).join("\r\n");
        const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8;"}));
        const a = document.createElement("a"); a.href = url; a.download = `${filename}.csv`; a.click();
        URL.revokeObjectURL(url);
    }
    function exportPDF(rows: Booking[], title: string) {
        const htmlEscape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, symbol => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[symbol] || symbol));
        const popup = window.open("", "_blank");
        if (!popup) { setBookingActionError("Allow pop-ups to open the printable PDF export."); return; }
        const tableRows = rows.map(b => `<tr><td>${htmlEscape(b.bookingReference || b.id)}</td><td>${htmlEscape(b.name)}</td><td>${htmlEscape(getManagerBookingTypeLabel(b))}</td><td>${htmlEscape(formatDate(b.date))}</td><td>${htmlEscape(getManagerBookingStatusLabel(b.status))}</td><td>${htmlEscape(peso(getAmountPaid(b)))}</td><td>${htmlEscape(peso(getBalance(b)))}</td></tr>`).join("");
        const selected = title === "Selected Booking" && rows.length === 1 ? rows[0] : null;
        const extra = selected ? `<div style="margin-bottom:18px;font-size:12px;line-height:1.6"><p><b>Contact:</b> ${htmlEscape(selected.phone || "—")} &nbsp;&nbsp; <b>Email:</b> ${htmlEscape(selected.email || "—")}</p><p><b>Agreed Price:</b> ${htmlEscape(peso(getTotalPrice(selected)))} &nbsp;&nbsp; <b>Required DP:</b> ${htmlEscape(peso(getRequiredDownPayment(selected)))}</p><p><b>Event:</b> ${htmlEscape(selected.eventType || selected.event_type || "—")}</p><p><b>Notes:</b> ${htmlEscape(selected.notes || "—")}</p><p><b>Additional Custom Request:</b> ${htmlEscape(selected.customOrder || selected.custom_order || "—")}</p></div>` : "";
        popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>body{font-family:Arial,sans-serif;color:#261940;padding:24px}h1{font-size:20px}p{font-size:12px;color:#6c6181}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f2ecfc}@page{size:landscape;margin:12mm}</style></head><body><h1>${htmlEscape(title)}</h1><p>StockNBook · ${htmlEscape(branchName)} · ${new Date().toLocaleDateString("en-PH")}</p>${extra}<table><thead><tr><th>Booking Ref</th><th>Customer</th><th>Type</th><th>Event Date</th><th>Status</th><th>Paid</th><th>Balance</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`);
        popup.document.close();
        popup.focus();
        popup.print();
    }
    function exportBookings(rows: Booking[], fileType: "pdf" | "excel", selected = false) {
        const filename = selected ? `StockNBook_Booking_${rows[0]?.bookingReference || rows[0]?.id || "selected"}` : "StockNBook_Manager_Bookings";
        if (fileType === "excel") exportExcel(rows, filename);
        else exportPDF(rows, selected ? "Selected Booking" : "Manager Booking List");
    }
    function clearFilters() {
        setSearch(""); setFilter("All"); setApprovalOnly(false);
        setBookingType("All"); setDateFrom(""); setDateTo("");
    }

    return (
        <>
            <header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur">
                <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-4 px-6 py-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <h1 className="text-[25px] font-bold text-[#1A1220]">
                            Bookings
                        </h1>

                        <span
                            title={branchName}
                            className="max-w-[220px] truncate rounded-lg bg-[#EFE8F8] px-3.5 py-1.5 text-sm font-medium text-[#4E2C66]"
                        >
                            {branchName}
                        </span>
                    </div>

                    <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">
                            {currentDateTime
                                ? formatCurrentDateTime(currentDateTime)
                                : "Loading date..."}
                        </span>

                        <button
                            onClick={() => void loadBookings()}
                            disabled={loading}
                            aria-label="Refresh bookings"
                            title="Refresh bookings"
                            className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-60"
                            type="button"
                        >
                            <RefreshCw
                                size={16}
                                className={loading ? "animate-spin" : ""}
                            />
                            Refresh
                        </button>
                    </div>
                </div>
            </header>

            <section className="px-4 py-4 sm:px-6">
                <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {([
                        {status: "Pending Review" as FilterType, title:"Pending Review", sub:"Requests to review", icon:<ClipboardCheck size={25}/>, bg:"bg-[#FFF9EE] border-[#F5E4BE]", ibg:"bg-[#FFF0D6] text-[#BA7608]"},
                        {status: "Awaiting Down Payment" as FilterType, title:"Approved", sub:"Approved, awaiting down payment", icon:<Wallet size={25}/>, bg:"bg-[#F9F6FF] border-[#E8DCFF]", ibg:"bg-[#ECE2FF] text-[#6135C6]"},
                        {status: "Confirmed" as FilterType, title:"Confirmed", sub:"Secured bookings", icon:<BadgeCheck size={25}/>, bg:"bg-[#EEFCF6] border-[#D2F1E0]", ibg:"bg-[#D8FAE8] text-[#15904E]"},
                        {status: "Preparing" as FilterType, title:"Preparing", sub:"Items being prepared", icon:<PackageCheck size={25}/>, bg:"bg-[#F0F6FF] border-[#D4E4FF]", ibg:"bg-[#DBE9FF] text-[#276BD3]"},
                    ]).map(m => <button type="button" key={m.status} onClick={() => {setFilter(m.status);setApprovalOnly(false);}}
                                        className={`flex min-h-[114px] items-center gap-3 rounded-2xl border p-4 text-left shadow-sm transition hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6536D4] ${m.bg} ${filter === m.status && !approvalOnly ? "ring-2 ring-[#6A3FE1] ring-offset-1" : ""}`}>
                        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${m.ibg}`}>{m.icon}</span>
                        <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[#2D1D52]">{m.title}</span><strong className="mt-1 block text-2xl text-[#241347]">{counts[m.status]}</strong><span className="mt-1 block text-[11px] text-[#82729C]">{m.sub}</span></span>
                        <span aria-hidden="true" className="text-xl text-[#6742A2]">›</span>
                    </button>)}
                </div>

                {loading && bookings.length === 0 ? <ModuleSkeleton variant="bookings" /> :
                    <BookingWorkspace
                        bookings={filtered} canManage={canManage} managerView
                        listToolbar={<div className="space-y-3 pb-3">
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h2 className="text-lg font-bold text-[#25143F]">Booking List <span className="ml-1 text-sm font-medium text-[#663BC6]">({filtered.length})</span></h2>
                                    <button type="button" onClick={() => {setApprovalOnly(v=>!v);setFilter("All");}} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${approvalOnly ? "bg-amber-100 text-amber-900 ring-1 ring-amber-300" : "bg-[#F6F1FF] text-[#5F3DB1] hover:bg-[#EDE3FF]"}`}>Manager Approval ({approvalsPending})</button>
                                </div>
                                <div className="relative shrink-0">
                                    <button type="button" aria-label="Export booking list" title="Export booking list" onClick={() => setListExportOpen(v => !v)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#D9C9EB] text-[#43217A] hover:bg-[#F3EEFF]"><Download size={17}/></button>
                                    {listExportOpen && <div className="absolute right-0 top-10 z-30 w-40 rounded-xl border border-[#E6DDF0] bg-white p-1.5 shadow-xl">
                                        <button type="button" onClick={() => {exportBookings(filtered,"pdf");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">PDF (Print)</button>
                                        <button type="button" onClick={() => {exportBookings(filtered,"excel");setListExportOpen(false);}} className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-[#F7F1FF]">Excel (CSV)</button>
                                    </div>}
                                </div>
                            </div>
                            <label className="relative block">
                                <span className="sr-only">Search bookings</span>
                                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#957CAB]"/>
                                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search booking ID, customer name, or contact..." className="h-10 w-full rounded-xl border border-[#E4D9EF] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#7648DC] focus:ring-2 focus:ring-[#7648DC]/10" />
                            </label>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-2 2xl:grid-cols-4">
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Booking Type
                                    <select value={bookingType} onChange={e=>setBookingType(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        <option value="All">All Types</option>{bookingTypes.map(t=><option key={t} value={t}>{t}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Status
                                    <select value={filter} onChange={e=>{setFilter(e.target.value as FilterType);setApprovalOnly(false);}} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]">
                                        {TABS.map(t=><option key={t} value={t}>{t === "All" ? "All Statuses" : getManagerBookingStatusLabel(t)}</option>)}
                                    </select>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date From
                                    <input aria-label="Booking date from" type="date" value={dateFrom} max={dateTo || undefined} onChange={e=>setDateFrom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                                <label className="block min-w-0 text-[10px] font-semibold text-[#655478]">Date To
                                    <input aria-label="Booking date to" type="date" value={dateTo} min={dateFrom || undefined} onChange={e=>setDateTo(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-[#DED1ED] bg-white px-2 text-xs text-[#25143F]"/>
                                </label>
                            </div>
                            {(search || filter !== "All" || approvalOnly || bookingType !== "All" || dateFrom || dateTo) && <div className="flex justify-end"><button type="button" onClick={clearFilters} className="text-xs font-semibold text-[#6335BC] hover:underline">Clear filters</button></div>}
                        </div>}
                        onExportSelected={(b,type)=>exportBookings([b],type,true)}
                        onUpdateStatus={canManage ? (id, status, price) => {
                            const booking = bookings.find(item => item.id === id);
                            if (status === "Awaiting Down Payment" && booking && normalizeStatus(booking.status) === "Pending Review" && getRequiredDownPayment(booking) > 0) {
                                setApprovalError("");
                                setApprovalModal(booking);
                                return;
                            }
                            void updateStatus(id, status, price);
                        } : undefined}
                        onSetPrice={canManage ? b => {
                            if (normalizeStatus(b.status) !== "Pending Review" || b.approvalStatus === "approved") {
                                setBookingActionError("Custom price and down payment are locked after approval.");
                                return;
                            }
                            setPriceModal(b);
                        } : undefined}
                        onRecordDownPayment={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onMarkFullyPaid={canManage ? b => {setPaymentError("");setPaymentModal(b);} : undefined}
                        onCancelBooking={canManage ? openCancelModal : undefined}
                    />}
            </section>

            {approvalModal && canManage && <ApproveBookingModal
                booking={bookings.find(b => b.id === approvalModal.id) ?? approvalModal}
                busy={approvalSaving}
                error={approvalError}
                onClose={() => { if (!approvalSaving) { setApprovalModal(null); setApprovalError(""); } }}
                onApprove={async () => {
                    setApprovalSaving(true);
                    setApprovalError("");
                    try {
                        const ok = await updateStatus(approvalModal.id, "Awaiting Down Payment");
                        if (ok) setApprovalModal(null);
                        else setApprovalError("Approval was not completed. Check the notification and try again.");
                    } finally { setApprovalSaving(false); }
                }}
            />}

            {paymentModal && canManage && <RecordPaymentModal
                booking={bookings.find(b=>b.id === paymentModal.id) ?? paymentModal}
                busy={paymentSaving} error={paymentError}
                onClose={() => {if(!paymentSaving){setPaymentModal(null);setPaymentError("");}}}
                onSave={saveRecordedPayment}
            />}

            {priceModal && canManage && normalizeStatus((bookings.find(b => b.id === priceModal.id) ?? priceModal).status) === "Pending Review" && (
                <PriceModal
                    booking={priceModal}
                    onConfirm={handlePriceConfirm}
                    onClose={() => setPriceModal(null)}
                />
            )}
            {cancelModal && canManage && (
                <CancelInventoryModal
                    booking={cancelModal}
                    items={cancelItems}
                    usedQty={cancelUsedQty}
                    loading={cancelLoading}
                    submitting={cancelSubmitting}
                    error={cancelError}
                    onChangeUsedQty={(itemId, value) =>
                        setCancelUsedQty((prev) => ({
                            ...prev,
                            [itemId]: value,
                        }))
                    }
                    onClose={() => {
                        if (cancelSubmitting) return;
                        setCancelModal(null);
                        setCancelItems([]);
                        setCancelUsedQty({});
                        setCancelError("");
                    }}
                    onConfirm={confirmCancelBooking}
                />
            )}

            {/* Matches the staff attendance success toast: bottom-right, dismissible,
                and automatically hidden. No changes to booking rules or API payloads. */}
            {toast && (
                <div
                    key={toast.id}
                    role={toast.kind === "error" ? "alert" : "status"}
                    aria-live={toast.kind === "error" ? "assertive" : "polite"}
                    className={`fixed bottom-5 right-5 z-[250] flex w-[400px] max-w-[calc(100vw-2.5rem)] items-start gap-3 rounded-2xl border bg-white p-4 shadow-[0_12px_32px_rgba(38,21,63,0.14)] ${
                        toast.kind === "success" ? "border-[#BAE8CC]" : "border-[#F6C9CE]"
                    }`}
                >
                    <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                        toast.kind === "success" ? "bg-[#EAF9EF] text-[#119047]" : "bg-[#FFF0F1] text-[#D43C53]"
                    }`}>
                        {toast.kind === "success" ? <CheckCircle2 size={22}/> : <AlertCircle size={22}/>}
                    </span>
                    <div className="min-w-0 flex-1">
                        <p className="text-[15px] font-bold leading-5 text-[#231834]">{toast.title}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-[#7B6A8A]">{toast.description}</p>
                    </div>
                    <button
                        type="button"
                        aria-label="Dismiss notification"
                        onClick={() => setToast(null)}
                        className="-mr-1 -mt-1 rounded-lg p-1.5 text-[#897899] hover:bg-[#F6F1FA] hover:text-[#352044] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#6C3AD6]"
                    >
                        <X size={17}/>
                    </button>
                </div>
            )}
        </>
    );
}
// Keep the existing manager approval confirmation, without any deadline requirement.
function ApproveBookingModal({booking, busy, error, onClose, onApprove}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onApprove: () => Promise<void>;
}) {
    const [agreed, setAgreed] = useState(false);
    const [validation, setValidation] = useState("");
    function submit() {
        if (!agreed) {
            setValidation("Confirm that the manager and customer agreed on the payment terms.");
            return;
        }
        if (getTotalPrice(booking) <= 0 || getRequiredDownPayment(booking) <= 0) {
            setValidation("Set an agreed price and required down payment before approving.");
            return;
        }
        setValidation("");
        void onApprove();
    }
    return <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 px-4 py-5">
        <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="w-full max-w-md rounded-2xl border border-[#E5D8F1] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 id="approval-title" className="text-lg font-bold text-[#24163E]">Approve Booking</h2>
                    <p className="mt-1 text-xs text-[#827394]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
                </div>
                <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="rounded-lg p-1.5 text-[#806D91] hover:bg-[#F4EFFB]"><X size={19}/></button>
            </div>
            <div className="mt-4 space-y-2 rounded-xl border border-[#EAE0F4] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Final Agreed Price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                <div className="flex justify-between gap-3"><span>Required Down Payment</span><strong>{peso(getRequiredDownPayment(booking))}</strong></div>
            </div>
            <label className="mt-4 flex items-start gap-2 text-xs leading-5 text-[#4F4162]">
                <input type="checkbox" checked={agreed} onChange={e=>{setAgreed(e.target.checked);setValidation("");}} disabled={busy} className="mt-1 accent-[#673DC8]"/>
                <span>I confirm that the manager and customer agreed to the final price and required down payment.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#816E93]">Approved bookings are not yet inventory reservations. Price and down payment are locked after approval.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{validation || error}</p>}
            <div className="mt-5 flex justify-end gap-2">
                <button type="button" disabled={busy} onClick={onClose} className="rounded-xl border border-[#E2D6EF] px-4 py-2.5 text-sm font-semibold text-[#47246E]">Back</button>
                <button type="button" disabled={busy || !agreed} onClick={submit} className="rounded-xl bg-[#432078] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Approving..." : "Approve Booking"}</button>
            </div>
        </div>
    </div>;
}

function RecordPaymentModal({booking, busy, error, onClose, onSave}: {
    booking: Booking;
    busy: boolean;
    error: string;
    onClose: () => void;
    onSave: (actualReceived: number) => void | Promise<void>;
}) {
    const balance = getBalance(booking);
    const paid = getAmountPaid(booking);
    const required = getRequiredDownPayment(booking);
    const [amount, setAmount] = useState("");
    const [verified, setVerified] = useState(false);
    const [validation, setValidation] = useState("");
    function save() {
        const value = Number(amount);
        if (amount.trim() === "" || !Number.isFinite(value) || value <= 0 || value > balance + 0.001 || Math.round(value*100)/100 !== value) {
            setValidation("Enter the actual received amount in pesos, up to the remaining balance, using at most two decimal places.");
            return;
        }
        if (!verified) {setValidation("Confirm that you checked the payment before saving.");return;}
        setValidation("");
        void onSave(value);
    }
    return <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-6">
        <div role="dialog" aria-modal="true" aria-labelledby="payment-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#E7D9F2] bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-2"><h2 id="payment-modal-title" className="text-lg font-bold text-[#26153F]">Record Customer Payment</h2><button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="rounded-lg p-1.5 hover:bg-[#F5F0FC]"><X size={19}/></button></div>
            <p className="mt-1 text-sm text-[#78698D]">{booking.name} · {booking.bookingReference || `#${booking.id}`}</p>
            <div className="mt-4 space-y-2 rounded-xl border border-[#E9E0EF] bg-[#FCFAFF] p-3 text-sm">
                <div className="flex justify-between gap-3"><span>Agreed Price</span><strong>{peso(getTotalPrice(booking))}</strong></div>
                <div className="flex justify-between gap-3"><span>Amount Already Paid</span><strong>{peso(paid)}</strong></div>
                <div className="flex justify-between gap-3"><span>Required Down Payment</span><strong>{peso(required)}</strong></div>
                <div className="flex justify-between gap-3 border-t pt-2"><span>Remaining Balance</span><strong className="text-[#492193]">{peso(balance)}</strong></div>
            </div>
            <label htmlFor="actual-customer-payment" className="mt-4 block text-sm font-semibold text-[#24143C]">Amount Actually Received (₱) <span className="text-red-500">*</span></label>
            <input id="actual-customer-payment" type="number" required min="0.01" max={balance} step="0.01" inputMode="decimal" placeholder="0.00" value={amount}
                   onChange={e=>{setAmount(e.target.value);setValidation("");}} disabled={busy} autoFocus
                   className="mt-1.5 h-11 w-full rounded-xl border border-[#D9C6E9] bg-white px-4 text-sm font-semibold outline-none focus:border-[#7140DC] focus:ring-2 focus:ring-[#7140DC]/15" />
            {amount && Number(amount)>0 && Number(amount)<=balance && <p className="mt-2 text-xs text-[#6A5888]">Balance after recording: {peso(Math.max(0, balance - Number(amount)))}</p>}
            <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#E8DDF2] bg-[#FCFAFF] p-3 text-xs leading-5 text-[#49376A]">
                <input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)} disabled={busy} className="mt-0.5 accent-[#6435BC]" />
                <span>I checked the actual payment in the bank, GCash, Maya, or cash records and confirm this amount was received.</span>
            </label>
            <p className="mt-3 text-xs leading-5 text-[#827393]">A partial amount stays partial until the required down payment is met. Saving payment does not confirm the booking; Manager confirmation remains a separate action.</p>
            {(validation || error) && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700">{validation || error}</p>}
            <div className="mt-5 flex gap-2"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-[#D9C6E9] bg-white px-3 text-sm font-semibold text-[#352353] hover:bg-[#F7F1FF] disabled:opacity-50">Cancel</button>
                <button type="button" disabled={busy || balance <= 0} onClick={save} className="min-h-11 flex-1 rounded-xl bg-[#432183] px-3 text-sm font-bold text-white hover:bg-[#30145F] disabled:opacity-50">{busy ? "Saving…" : "Save Payment"}</button></div>
        </div>
    </div>;
}

function CancelInventoryModal({
                                  booking,
                                  items,
                                  usedQty,
                                  loading,
                                  submitting,
                                  error,
                                  onChangeUsedQty,
                                  onClose,
                                  onConfirm,
                              }: {
    booking: Booking;
    items: BookingInventoryItem[];
    usedQty: Record<number, number>;
    loading: boolean;
    submitting: boolean;
    error: string;
    onChangeUsedQty: (itemId: number, value: number) => void;
    onClose: () => void;
    onConfirm: () => void;
}) {
    const reservedItems = items.filter(
        (item) => Number(item.reserved_quantity || 0) > 0
    );

    const hasReservedItems = reservedItems.length > 0;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 px-4 font-sans">
            <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-[22px] border border-[#E6DDF0] bg-white shadow-2xl">
                <div className="border-b border-[#EFE7F4] px-5 py-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#806A8C]">
                        Cancel Booking
                    </p>

                    <h2 className="mt-1 text-xl font-bold text-[#1A1220]">
                        Record used items before cancelling
                    </h2>

                    <p className="mt-1 text-sm text-[#7A6A84]">
                        Booking #{booking.id} · {booking.name}
                    </p>
                </div>

                <div className="max-h-[58vh] overflow-y-auto px-5 py-4">
                    {loading ? (
                        <div className="rounded-xl border border-[#E6DDF0] bg-[#FFFDF8] px-4 py-8 text-center text-sm text-[#806A8C]">
                            Loading booking items...
                        </div>
                    ) : !hasReservedItems ? (
                        <div className="rounded-xl border border-[#F4D79A] bg-[#FFF8E8] px-4 py-4 text-sm text-[#8A5A00]">
                            No reserved inventory was found for this booking. Cancelling will only update the booking status.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-sm text-[#4E2C66]">
                                Enter the quantity that was already used. Anything not used will be returned to inventory.
                            </div>

                            {reservedItems.map((item) => {
                                const itemId = Number(item.id);
                                const reserved = Number(item.reserved_quantity || 0);
                                const used = Math.max(
                                    0,
                                    Math.min(Number(usedQty[itemId] || 0), reserved)
                                );
                                const restored = Math.max(reserved - used, 0);
                                const label = item.variant_name
                                    ? `${item.product_name} — ${item.variant_name}`
                                    : item.product_name;

                                return (
                                    <div
                                        key={item.id}
                                        className="rounded-2xl border border-[#E6DDF0] bg-white p-4 shadow-sm"
                                    >
                                        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                            <div className="min-w-0">
                                                <p className="text-sm font-bold text-[#1A1220]">
                                                    {label}
                                                </p>

                                                <p className="mt-1 text-xs text-[#7A6A84]">
                                                    Reserved: {reserved}
                                                </p>

                                                <p className="mt-1 text-xs font-semibold text-[#138342]">
                                                    Will return to inventory: {restored}
                                                </p>
                                            </div>

                                            <div className="w-full md:w-[180px]">
                                                <label className="text-xs font-semibold text-[#5F4E75]">
                                                    Used quantity
                                                </label>

                                                <input
                                                    type="number"
                                                    min={0}
                                                    max={reserved}
                                                    value={used}
                                                    disabled={submitting}
                                                    onChange={(event) => {
                                                        const nextValue = Math.max(
                                                            0,
                                                            Math.min(Number(event.target.value || 0), reserved)
                                                        );

                                                        onChangeUsedQty(itemId, nextValue);
                                                    }}
                                                    className="mt-1 h-11 w-full rounded-xl border border-[#D8CBE7] bg-white px-3 text-sm font-semibold text-[#1A1220] outline-none transition focus:border-[#2B174C] focus:ring-4 focus:ring-[#2B174C]/10 disabled:opacity-60"
                                                />

                                                <p className="mt-1 text-[11px] text-[#806A8C]">
                                                    Max: {reserved}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {error && (
                        <div className="mt-4 rounded-xl border border-[#F2C4C4] bg-[#FFF0F0] px-4 py-3 text-sm font-semibold text-[#C32F2F]">
                            {error}
                        </div>
                    )}
                </div>

                <div className="flex flex-col-reverse gap-2 border-t border-[#EFE7F4] bg-[#FFFDF8] px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl border border-[#D8CBE7] bg-white px-4 text-sm font-semibold text-[#2B174C] transition hover:bg-[#F7F1FF] disabled:opacity-60"
                    >
                        Back
                    </button>

                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={loading || submitting}
                        className="inline-flex h-11 items-center justify-center rounded-xl bg-[#A33E20] px-4 text-sm font-semibold text-white transition hover:bg-[#883117] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        {submitting ? "Cancelling..." : "Confirm Cancellation"}
                    </button>
                </div>
            </div>
        </div>
    );
}
