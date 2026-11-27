"use client";

// Staff "Booking Operations Queue": ONE queue for every booking, replacing the separate Sales and
// Rental queues. Each row is one booking with its type (Package / Custom) and what it includes.
// "View Items" shows two checklists in one place:
//   • Consumables  → prepared and handed over through the Bookings Lambda (same actions as the old Sales queue)
//   • Rental equipment → prepared, released and received through the Rental Lambda hook (same actions as the old Rental queue)
// The rules are unchanged: full payment, the agreed security deposit for bookings with rentals, the event / rental
// start date, and Full Inventory access. The booking becomes Released only after both parts are handed over.
// Put this file next to StaffBookings.tsx.

import * as React from "react";
import { AlertTriangle, BadgeCheck, ClipboardList, Package2, RotateCcw, Truck, X } from "lucide-react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useStaffRentalInventory, type StaffRentalAllocation } from "@/hooks/useRentalInventory";
import { SuccessToast } from "@/components/inventory/_shared";

// ── Data from the Bookings Lambda (get_staff_sales_booking_queue) ──
type ConsumableLine = { itemId: number; productName: string; variantName: string; quantity: number; prepared: boolean; issued: boolean };
type ConsumableBooking = {
    bookingId: number; reference: string; bookingTotal: number; amountPaid: number; balance: number;
    eventDate: string; handoverDate?: string; handoverMethod?: string;
    rentalLines?: number; depositRequired?: number; depositCollected?: number; items: ConsumableLine[];
};
type BookingContents = {
    bookingId: number; reference: string; bookingType: string; bookingStatus: string; clientName: string; packageName: string;
    eventDate: string; eventTime: string; consumableLines: number; consumablesHandedOver: number; rentalLines: number;
    handoverMethod?: string; handoverDate?: string; handoverTime?: string; returnDate?: string; returnTime?: string;
    deliveryAddress?: string;
};
// ── Rental allocation fields the Rental Lambda workspace already returns ──
type RentalLine = StaffRentalAllocation & {
    clientName?: string | null; bookingType?: string | null; packageName?: string | null; eventDate?: string | null;
    eventTime?: string | null; depositRequired?: number | null; depositCollected?: number | null; bookingStatus?: string | null;
};
type RentalTask = "prepare" | "release" | "return" | "inspect";
type QueueFilter = "all" | "prepare" | "handover" | "return" | "inspect";
type QueueRow = {
    bookingId: number; reference: string; clientName: string; typeLabel: "Package" | "Custom"; contentsLabel: string; packageName: string;
    status: string; eventDate: string;
    // When the customer gets the items (Pickup / Delivery) and when rentals come back.
    handoverLabel: "Pickup" | "Delivery"; handoverDate: string; handoverTime: string; returnDate: string; returnTime: string;
    deliveryAddress: string;
    consumables: ConsumableBooking | null; consumablesDone: boolean; hasConsumables: boolean;
    rental: Array<{ item: RentalLine; task: RentalTask }>; hasRentals: boolean;
};

// ── Small helpers (same rules as the old queues) ──
const card = "min-w-0 overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const outline = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50";
const primary = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white hover:bg-[#1B0D31] disabled:cursor-not-allowed disabled:opacity-40";
const headClass = "truncate px-2 py-2 text-[11px] font-semibold text-[#75657E]";
// First column is left-aligned like its cells; the others are centered like theirs.
const headCell = (label: string, index: number) =>
    <th key={label} scope="col" className={`${headClass} ${index === 0 ? "pl-4 text-left" : "text-center"}`}>{label}</th>;
const tableClass = "w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]";

function manilaToday() {
    const bits = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(new Date());
    const get = (type: string) => bits.find(x => x.type === type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}
// Today first, then the most recent past dates, then upcoming dates (nearest first).
function compareQueueDates(first: string, second: string, today: string) {
    const bucket = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 3 : date === today ? 0 : date < today ? 1 : 2;
    const difference = bucket(first) - bucket(second);
    if (difference) return difference;
    return bucket(first) === 1 ? second.localeCompare(first) : first.localeCompare(second);
}
// "14:30" -> "2:30 PM"
function showTime(value?: string | null) {
    const m = String(value || "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return value || "";
    const hour = Number(m[1]);
    return `${hour % 12 || 12}:${m[2]} ${hour < 12 ? "AM" : "PM"}`;
}
function showDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
    return new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });
}
function statusLabel(value?: string | null) {
    const raw = String(value || "").trim();
    switch (raw.toLowerCase()) {
        case "confirmed": return "Confirmed";
        case "preparing": return "Preparing";
        case "released": return "Released";
        case "return inspection": return "Return Inspection";
        case "pending settlement": return "Pending Settlement";
        case "completed": return "Completed";
        default: return raw || "—";
    }
}
const statusColor: Record<string, string> = {
    Confirmed: "text-[#1D4ED8]", Preparing: "text-[#4E2C66]", Released: "text-[#1D4ED8]",
    "Return Inspection": "text-[#A56607]", "Pending Settlement": "text-[#A56607]", Completed: "text-[#138342]",
};
function typeLabel(raw: string): "Package" | "Custom" { return raw.toLowerCase().includes("package") ? "Package" : "Custom"; }
function contentsLabel(consumables: number, rentals: number) {
    if (consumables > 0 && rentals > 0) return "Consumables + Rentals";
    if (rentals > 0) return "Rentals only";
    return consumables > 0 ? "Consumables only" : "";
}
function rentalTask(a: StaffRentalAllocation): RentalTask | null {
    if (a.status === "reserved") return a.preparedAt ? "release" : "prepare";
    if (a.status === "checked_out") return "return";
    if (a.status === "returned" && a.inspectionStatus === "pending") return "inspect";
    return null; // cleaning / damage care stays in Staff Rental Inventory
}
function consumablesPaid(b: ConsumableBooking) {
    return Number.isFinite(b.bookingTotal) && b.bookingTotal > 0 && Number.isFinite(b.amountPaid) && Number.isFinite(b.balance) &&
        b.amountPaid + 0.005 >= b.bookingTotal && b.balance <= 0.005;
}
function consumableDepositSettled(b: ConsumableBooking) {
    if (!(Number(b.rentalLines) > 0)) return true;
    const required = Number(b.depositRequired ?? 0), collected = Number(b.depositCollected ?? 0);
    return Number.isFinite(required) && Number.isFinite(collected) && collected + 0.005 >= required;
}
const pesoText = (value: number) => `₱${Number(value || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Chip({ tone, children }: { tone: "todo" | "ready" | "done" | "out"; children: React.ReactNode }) {
    const colors = { todo: "bg-[#FFF3D8] text-[#926400]", ready: "bg-[#E5F7ED] text-[#218246]", done: "bg-[#F1EEF5] text-[#6A5D6F]", out: "bg-[#E9F2FF] text-[#1D4ED8]" };
    return <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${colors[tone]}`}>{children}</span>;
}
function SectionTitle({ icon, title, subtitle, badge }: { icon: React.ReactNode; title: string; subtitle: string; badge?: React.ReactNode }) {
    return <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3">
        <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F1EBFF] text-[#5A35A5]">{icon}</span>
            <div><h4 className="text-sm font-bold text-[#21132E]">{title}</h4><p className="mt-0.5 text-[11px] text-[#806A8C]">{subtitle}</p></div>
        </div>{badge}
    </div>;
}

export default function StaffBookingQueue({ search = "", date = "" }: { search?: string; date?: string }) {
    const today = manilaToday();
    const rental = useStaffRentalInventory();
    const { user } = useCurrentUser();
    const inventoryPermission = user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    // UI courtesy only; both Lambdas check permissions again.
    const canOperateRental = inventoryPermission === true || inventoryPermission === "true" || inventoryPermission === "full";

    // Consumables data (Bookings Lambda)
    const [consumableBookings, setConsumableBookings] = React.useState<ConsumableBooking[]>([]);
    const [contents, setContents] = React.useState<BookingContents[]>([]);
    const [canOperateConsumables, setCanOperateConsumables] = React.useState(false);
    const [loading, setLoading] = React.useState(false);
    const [loadError, setLoadError] = React.useState("");
    const [reloadKey, setReloadKey] = React.useState(0);
    // UI state
    const [filter, setFilter] = React.useState<QueueFilter>("all");
    // Laptop/desktop: the queue fills the rest of the screen, so the page stays still and only the
    // booking rows scroll (header, search, task cards and column titles stay visible). Phones scroll normally.
    const queueRef = React.useRef<HTMLElement>(null);
    const [fillHeight, setFillHeight] = React.useState<number | null>(null);
    React.useLayoutEffect(() => {
        const fit = () => {
            const el = queueRef.current;
            if (!el) return;
            if (!window.matchMedia("(min-width: 1024px) and (min-height: 600px)").matches) { setFillHeight(null); return; }
            const bottomGap = 28; // space under the queue card (page padding + margin)
            const next = Math.max(320, Math.floor(window.innerHeight - el.getBoundingClientRect().top - bottomGap));
            setFillHeight(current => (current === next ? current : next));
        };
        fit();
        window.addEventListener("resize", fit);
        return () => window.removeEventListener("resize", fit);
    });
    const [openRef, setOpenRef] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const closeNotice = React.useCallback(() => setNotice(""), []);
    const [confirm, setConfirm] = React.useState<null | "consumables" | "equipment">(null);
    const [finalizeItem, setFinalizeItem] = React.useState<RentalLine | null>(null);
    const [returnOpen, setReturnOpen] = React.useState(false);
    const [returnMissing, setReturnMissing] = React.useState<Record<number, string>>({});
    const [returnDamaged, setReturnDamaged] = React.useState<Record<number, string>>({});
    const [returnNotes, setReturnNotes] = React.useState("");
    const [returnChecked, setReturnChecked] = React.useState(false);
    const [issue, setIssue] = React.useState<null | { equipmentId: number; name: string; max: number; reference: string }>(null);
    const [issueQty, setIssueQty] = React.useState("1");
    const [issueType, setIssueType] = React.useState<"damage" | "missing" | "routine">("damage");
    const [issueNotes, setIssueNotes] = React.useState("");

    React.useEffect(() => {
        const abort = new AbortController();
        (async () => {
            setLoading(true); setLoadError("");
            try {
                const token = sessionStorage.getItem("token");
                if (!token) throw new Error("Your session has expired. Please sign in again.");
                const response = await fetch("/api/bookings", { method: "POST", cache: "no-store", signal: abort.signal,
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "get_staff_sales_booking_queue" }) });
                const data = await response.json().catch(() => ({}));
                if (!response.ok || data.success !== true || !Array.isArray(data.bookings)) throw new Error(String(data.error || "Unable to load booking tasks."));
                if (abort.signal.aborted) return;
                setConsumableBookings(data.bookings as ConsumableBooking[]);
                setContents(Array.isArray(data.bookingContents) ? data.bookingContents as BookingContents[] : []);
                setCanOperateConsumables(data.canOperateSalesQueue === true);
            } catch (cause) {
                if (abort.signal.aborted) return;
                setLoadError(cause instanceof Error ? cause.message : "Unable to load booking tasks.");
                setConsumableBookings([]); setContents([]); setCanOperateConsumables(false);
            } finally { if (!abort.signal.aborted) setLoading(false); }
        })();
        return () => abort.abort();
    }, [reloadKey]);

    // ── One row per booking: consumable tasks + rental tasks, merged by booking reference ──
    const rows = React.useMemo(() => {
        const byRef = new Map<string, QueueRow>();
        const contentByRef = new Map(contents.map(c => [c.reference, c]));
        const ensure = (reference: string, seed: Partial<QueueRow>) => {
            let row = byRef.get(reference);
            if (!row) {
                const c = contentByRef.get(reference);
                row = {
                    bookingId: c?.bookingId || seed.bookingId || 0, reference, clientName: c?.clientName || seed.clientName || "Customer",
                    typeLabel: typeLabel(c?.bookingType || seed.typeLabel || ""), packageName: c?.packageName || seed.packageName || "",
                    contentsLabel: c ? contentsLabel(c.consumableLines, c.rentalLines) : "", status: c?.bookingStatus || seed.status || "",
                    eventDate: c?.eventDate || seed.eventDate || "",
                    handoverLabel: (c?.handoverMethod || "") === "delivery" ? "Delivery" : "Pickup",
                    handoverDate: c?.handoverDate || seed.handoverDate || c?.eventDate || seed.eventDate || "",
                    handoverTime: c?.handoverTime || c?.eventTime || seed.handoverTime || "",
                    returnDate: c?.returnDate || seed.returnDate || "", returnTime: c?.returnTime || "",
                    deliveryAddress: c?.deliveryAddress || "",
                    consumables: null, consumablesDone: !!c && c.consumableLines > 0 && c.consumablesHandedOver >= c.consumableLines,
                    hasConsumables: !!c && c.consumableLines > 0, rental: [], hasRentals: !!c && c.rentalLines > 0,
                };
                byRef.set(reference, row);
            }
            return row;
        };
        for (const b of consumableBookings) {
            const row = ensure(b.reference, { bookingId: b.bookingId, eventDate: b.eventDate, handoverDate: b.handoverDate });
            row.consumables = b; row.hasConsumables = true;
            if (Number(b.rentalLines) > 0) row.hasRentals = true;
        }
        for (const a of rental.allocations as RentalLine[]) {
            const task = rentalTask(a);
            if (!task) continue;
            const row = ensure(a.bookingReference, { clientName: a.clientName || undefined, typeLabel: typeLabel(String(a.bookingType || "")),
                packageName: a.packageName || "", status: a.bookingStatus || "", eventDate: a.eventDate || a.startDate,
                // Rental period starts on the pickup/delivery date.
                handoverDate: a.startDate, handoverTime: a.eventTime || "" });
            row.rental.push({ item: a, task }); row.hasRentals = true;
            if (!row.returnDate) row.returnDate = a.endDate;
        }
        for (const row of byRef.values()) if (!row.contentsLabel) row.contentsLabel = contentsLabel(row.hasConsumables ? 1 : 0, row.hasRentals ? 1 : 0);
        // Newest bookings first (a higher booking number was made later), like the Manager and Owner lists.
        return [...byRef.values()].sort((x, y) => y.bookingId - x.bookingId ||
            compareQueueDates(x.handoverDate, y.handoverDate, today) || x.reference.localeCompare(y.reference));
    }, [consumableBookings, contents, rental.allocations, today]);

    const query = search.trim().toLowerCase();
    // Same task rules for the filter menu and the summary cards.
    const hasTask = (row: QueueRow, task: QueueFilter) => {
        const consumableItems = row.consumables?.items || [];
        if (task === "prepare") return consumableItems.some(i => !i.prepared && !i.issued) || row.rental.some(r => r.task === "prepare");
        if (task === "handover") return (consumableItems.length > 0 && consumableItems.every(i => i.prepared && !i.issued)) ||
            (row.rental.length > 0 && row.rental.every(r => r.task === "release"));
        if (task === "return") return row.rental.some(r => r.task === "return");
        if (task === "inspect") return row.rental.some(r => r.task === "inspect");
        return true;
    };
    const searchedRows = rows.filter(row => {
        // The page's "Filter by date" shows bookings picked up/delivered, held or returned on that day.
        if (date && row.handoverDate !== date && row.eventDate !== date && row.returnDate !== date) return false;
        const text = [row.reference, row.clientName, row.typeLabel, row.contentsLabel, row.packageName,
            ...(row.consumables?.items || []).flatMap(i => [i.productName, i.variantName]), ...row.rental.map(r => r.item.equipmentName)].join(" ").toLowerCase();
        return !query || text.includes(query);
    });
    const visibleRows = searchedRows.filter(row => hasTask(row, filter));
    const summaryCards: Array<{ key: QueueFilter; title: string; helper: string; icon: React.ReactNode; tone: string }> = [
        { key: "prepare", title: "To Prepare", helper: "Bookings with items to get ready", icon: <ClipboardList size={16} strokeWidth={1.9}/>, tone: "bg-[#F0E9FF] text-[#5A35A5]" },
        { key: "handover", title: "Ready to Hand Over", helper: "Prepared, waiting for pickup or delivery", icon: <Truck size={16} strokeWidth={1.9}/>, tone: "bg-[#FFF3D8] text-[#9A6200]" },
        { key: "return", title: "Equipment Out", helper: "Waiting for the equipment to come back", icon: <RotateCcw size={16} strokeWidth={1.9}/>, tone: "bg-[#EAF8EF] text-[#168A48]" },
        { key: "inspect", title: "Checking Returns", helper: "Returned items still being checked", icon: <BadgeCheck size={16} strokeWidth={1.9}/>, tone: "bg-[#F0E9FF] text-[#5A35A5]" },
    ];
    const open = rows.find(row => row.reference === openRef) || null;

    // ── Consumables rules (same as the old Sales queue) ──
    const cb = open?.consumables || null;
    const cbReady = !!cb && cb.items.length > 0 && cb.items.every(i => i.prepared && !i.issued);
    const cbPaid = !!cb && consumablesPaid(cb);
    const cbDeposit = !!cb && consumableDepositSettled(cb);
    const cbHandoverDate = open?.handoverDate || cb?.eventDate || "";
    const cbCanRelease = cbReady && cbPaid && cbDeposit && !!cb && cbHandoverDate <= today && canOperateConsumables && !saving;

    // ── Rental rules (same as the old Rental queue) ──
    const rentalLines = open?.rental || [];
    const rentalUnits = rentalLines.reduce((sum, r) => sum + r.item.quantity, 0);
    const rentalPay = rentalLines[0]?.item;
    const rentalPaid = !!rentalPay && Number.isFinite(rentalPay.bookingTotal) && Number.isFinite(rentalPay.amountPaid) && Number.isFinite(rentalPay.bookingBalance) &&
        rentalPay.bookingTotal > 0 && rentalPay.amountPaid + 0.005 >= rentalPay.bookingTotal && rentalPay.bookingBalance <= 0.005;
    // Missing deposit figures fail closed, like before.
    const rentalDeposit = !!rentalPay && rentalPay.depositRequired != null && rentalPay.depositCollected != null &&
        Number.isFinite(Number(rentalPay.depositRequired)) && Number.isFinite(Number(rentalPay.depositCollected)) &&
        Number(rentalPay.depositCollected) + 0.005 >= Number(rentalPay.depositRequired);
    const allReserved = rentalLines.length > 0 && rentalLines.every(r => r.task === "prepare" || r.task === "release");
    const allPrepared = allReserved && rentalLines.every(r => r.task === "release");
    const allOut = rentalLines.length > 0 && rentalLines.every(r => r.task === "return");
    const releaseDateReached = rentalLines.every(r => r.item.startDate <= today);
    const rentalBusy = rental.saving || saving;
    const rentalCanRelease = allPrepared && rentalPaid && rentalDeposit && releaseDateReached && canOperateRental && !rentalBusy;

    const closeAll = () => { setOpenRef(null); setConfirm(null); setFinalizeItem(null); setReturnOpen(false); setIssue(null); setError(""); };
    React.useEffect(() => {
        if (!openRef) return;
        const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !rentalBusy) closeAll(); };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [openRef, rentalBusy]);

    async function consumableAction(action: "prepare_staff_sales_booking_item" | "release_staff_sales_booking", itemId?: number) {
        if (!cb || saving) return;
        setSaving(true); setError(""); setNotice("");
        try {
            const token = sessionStorage.getItem("token");
            if (!token) throw new Error("Your session has expired. Please sign in again.");
            const response = await fetch("/api/bookings", { method: "POST", cache: "no-store",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ action, booking_id: cb.bookingId, ...(itemId ? { item_id: itemId } : {}) }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || result.success !== true) throw new Error(String(result.error || "Unable to record this step."));
            setNotice(action === "release_staff_sales_booking"
                ? `Consumables handed over for ${cb.reference}.${open?.hasRentals ? " Release the rental equipment below when it is ready." : ""}`
                : `Consumable marked prepared for ${cb.reference}.`);
            setConfirm(null);
            setReloadKey(k => k + 1);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to record this step."); }
        finally { setSaving(false); }
    }
    async function rentalStep(run: () => Promise<unknown>, message: string) {
        setError(""); setNotice("");
        try { await run(); setNotice(message); setReloadKey(k => k + 1); return true; }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save this rental step."); return false; }
    }
    // One click, like consumables: same Rental Lambda action as before, without the extra confirmation popup.
    async function markEquipmentPrepared(item: RentalLine) {
        if (!canOperateRental || rentalBusy) return;
        await rentalStep(() => rental.act("prepare_rental_allocation", item.allocationId, {}),
            `${item.equipmentName} marked prepared for ${item.bookingReference}.`);
    }
    async function confirmFinalize() {
        if (!finalizeItem || !canOperateRental) return;
        const item = finalizeItem;
        if (await rentalStep(() => rental.act("inspect_rental_allocation", item.allocationId, { useRecordedReturn: true }),
            `Previous return finalized for ${item.bookingReference}. Existing damage notes were kept.`)) setFinalizeItem(null);
    }
    async function confirmEquipmentRelease() {
        if (!open || !rentalCanRelease) return;
        const reference = open.reference;
        if (await rentalStep(() => rental.actBooking({ action: "release_rental_booking", bookingReference: reference }),
            `Rental equipment released for ${reference}.`)) setConfirm(null);
    }
    function startReturn() {
        setReturnMissing(Object.fromEntries(rentalLines.map(r => [r.item.allocationId, "0"])));
        setReturnDamaged(Object.fromEntries(rentalLines.map(r => [r.item.allocationId, "0"])));
        setReturnNotes(""); setReturnChecked(false); setError(""); setReturnOpen(true);
    }
    async function confirmReturn() {
        if (!open || !allOut || !canOperateRental) return;
        const returns = rentalLines.map(r => ({ allocationId: r.item.allocationId,
            missingUnits: Number(returnMissing[r.item.allocationId] ?? ""), damagedUnitsObserved: Number(returnDamaged[r.item.allocationId] ?? "") }));
        if (returns.some((line, i) => !Number.isSafeInteger(line.missingUnits) || !Number.isSafeInteger(line.damagedUnitsObserved) ||
            line.missingUnits < 0 || line.damagedUnitsObserved < 0 || line.missingUnits + line.damagedUnitsObserved > rentalLines[i].item.quantity)) {
            setError("Enter valid missing and damaged quantities; together they cannot be more than the booked quantity."); return;
        }
        if (returns.some(x => x.missingUnits > 0 || x.damagedUnitsObserved > 0) && returnNotes.trim().length < 5) {
            setError("Describe the missing or damaged equipment (at least 5 characters)."); return;
        }
        if (!returnChecked) { setError("Confirm you checked the returned items before recording the return."); return; }
        const reference = open.reference;
        if (await rentalStep(() => rental.actBooking({ action: "return_rental_booking", bookingReference: reference, returns,
                notes: returnNotes.trim(), conditionChecked: true, inspectionDeferred: false }),
            `Return recorded for ${reference}. Damaged units stay on hold until repaired.`)) setReturnOpen(false);
    }
    function startIssue(item: RentalLine) {
        const equipment = rental.equipment.find(e => e.id === item.equipmentId);
        if (!equipment) { setError("Equipment could not be loaded. Refresh and try again."); return; }
        const available = Math.max(0, equipment.totalUnits - equipment.rentedOutUnits - equipment.maintenanceUnits - equipment.missingUnits);
        if (available < 1) { setError("No available units can be flagged. Ask the Manager to resolve the shortage."); return; }
        setIssueQty("1"); setIssueType("damage"); setIssueNotes(""); setError("");
        setIssue({ equipmentId: equipment.id, name: equipment.name, max: available, reference: item.bookingReference });
    }
    async function confirmIssue() {
        if (!issue || !canOperateRental) return;
        const quantity = Number(issueQty);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > issue.max) { setError(`Enter 1–${issue.max} units.`); return; }
        if (issueNotes.trim().length < 5) { setError("Describe the issue (at least 5 characters)."); return; }
        const current = issue;
        if (await rentalStep(() => rental.actStock({ action: "staff_report_equipment_issue", equipmentId: current.equipmentId, quantity,
                reason: `Booking ${current.reference}: ${issueNotes.trim()}`, issueType, bookingReference: current.reference }),
            issueType === "routine" ? "Routine-care task created." : "Equipment flagged unavailable. The booking stays in preparation.")) setIssue(null);
    }

    // ── What each row still needs (shown as small chips) ──
    function todoChips(row: QueueRow) {
        const chips: React.ReactNode[] = [];
        const items = row.consumables?.items || [];
        if (items.length) {
            const toPrepare = items.filter(i => !i.prepared && !i.issued).length;
            chips.push(toPrepare > 0 ? <Chip key="c" tone="todo">Consumables: prepare {toPrepare}</Chip> : <Chip key="c" tone="ready">Consumables: ready to hand over</Chip>);
        } else if (row.hasConsumables && row.consumablesDone) chips.push(<Chip key="c" tone="done">Consumables: handed over</Chip>);
        if (row.rental.length) {
            const toPrepare = row.rental.filter(r => r.task === "prepare").length;
            chips.push(toPrepare > 0 ? <Chip key="r" tone="todo">Equipment: prepare {toPrepare}</Chip>
                : row.rental.every(r => r.task === "release") ? <Chip key="r" tone="ready">Equipment: ready to release</Chip>
                    : row.rental.some(r => r.task === "inspect") ? <Chip key="r" tone="todo">Equipment: finalize return</Chip>
                        : <Chip key="r" tone="out">Equipment: out, receive return</Chip>);
        } else if (row.hasRentals) chips.push(rental.error ? <Chip key="r" tone="todo">Equipment: unavailable</Chip>
            : rental.loading ? <Chip key="r" tone="done">Equipment: loading…</Chip> : <Chip key="r" tone="done">Equipment: done</Chip>);
        return chips;
    }

    return <>
        {/* Task counts for Staff (replaces the sales and balance cards). Inline grid so it never depends on new Tailwind classes. */}
        <div role="group" aria-label="Booking task summary" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 12 }}>
            {summaryCards.map(cardInfo => {
                const count = searchedRows.filter(row => hasTask(row, cardInfo.key)).length;
                const selected = filter === cardInfo.key;
                // Same size and layout as the Owner cards: icon, title, number, short helper.
                return <button key={cardInfo.key} type="button" aria-pressed={selected}
                               onClick={() => setFilter(selected ? "all" : cardInfo.key)}
                               title={selected ? "Click to show all tasks." : "Click to show only these."}
                               className="flex items-center gap-3 rounded-[14px] border border-[#E6DDF0] bg-white text-left shadow-sm transition hover:bg-[#FCF9FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]"
                               style={{ padding: "12px 14px", ...(selected ? { borderColor: "#6C3AD6", boxShadow: "0 0 0 1px #6C3AD6" } : {}) }}>
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${cardInfo.tone}`}>{cardInfo.icon}</span>
                    <span className="block min-w-0">
                        <span className="block text-xs font-medium text-[#75657E]">{cardInfo.title}</span>
                        <span className="block truncate text-lg font-bold text-[#1A1220]">{loading && rows.length === 0 ? "—" : count}</span>
                        <span className="block truncate text-[11px] text-[#8A7D90]">{cardInfo.helper}</span>
                    </span>
                </button>;
            })}
        </div>
        <section ref={queueRef} className={`${card} flex min-h-0 flex-col`} aria-label="Booking Operations Queue"
                 style={fillHeight ? { height: fillHeight } : undefined}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><ClipboardList size={18}/></span>
                    <div><h3 className="text-[15px] font-bold text-[#21132E]">Booking Operations Queue</h3>
                        <p className="mt-0.5 text-[11px] text-[#86778F]">Prepare and hand over consumables and rental equipment, one booking at a time</p></div>
                </div>
                <select aria-label="Filter booking tasks" value={filter} onChange={e => setFilter(e.target.value as QueueFilter)}
                        className="h-9 rounded-xl border border-[#E6DDF0] bg-white px-2 text-xs font-semibold text-[#2B174C] outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]">
                    <option value="all">All Tasks</option>
                    <option value="prepare">To Prepare</option>
                    <option value="handover">Ready to Hand Over</option>
                    <option value="return">Equipment Out</option>
                    <option value="inspect">Checking Returns</option>
                </select>
            </div>
            {loadError && <p role="alert" className="px-4 py-2 text-[11px] text-red-700">{loadError} <button type="button" className="ml-2 underline" onClick={() => setReloadKey(k => k + 1)}>Retry</button></p>}
            {rental.error && <p role="alert" className="px-4 py-2 text-[11px] text-amber-800">Rental equipment tasks are unavailable: {rental.error} <button type="button" className="ml-2 underline" onClick={() => void rental.refresh(true)}>Retry</button></p>}
            {loading && rows.length === 0 ? <div className="space-y-3 p-4" aria-busy="true">{[1, 2, 3].map(x => <div key={x} className="h-8 animate-pulse rounded-lg bg-[#F2EDF8]"/>)}</div> :
                <div className="min-h-0 flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED]" role="region" aria-label="Booking tasks list" tabIndex={0}>
                    <table className={tableClass.replace("min-w-0", "min-w-[720px]")}>
                        <colgroup><col className="w-[19%]"/><col className="w-[14%]"/><col className="w-[17%]"/><col className="w-[12%]"/><col className="w-[24%]"/><col className="w-[14%]"/></colgroup>
                        <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>
                            {["Client / Booking Ref", "Schedule", "Booking Type", "Status", "To Do", "Action"].map(headCell)}
                        </tr></thead>
                        <tbody>{visibleRows.map(row => {
                            const status = statusLabel(row.status);
                            const openRow = () => { setOpenRef(row.reference); setError(""); };
                            return <tr key={row.reference} tabIndex={0} onClick={openRow}
                                       onKeyDown={e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openRow(); } }}
                                       className="cursor-pointer border-t border-[#F0EAF4] text-[#2B174C] outline-none hover:bg-[#FCF9FF] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED]">
                                <td className="px-4 py-2 text-left"><span className="block break-words font-semibold">{row.clientName}</span>
                                    <span className="mt-1 block break-all text-[11px] text-[#75657E]">{row.reference}</span></td>
                                <td className="px-2 py-2"><span className="block font-medium">{showDate(row.handoverDate)}</span>
                                    <span className="mt-1 block text-[11px] text-[#75657E]">{row.handoverLabel}{row.handoverTime ? ` · ${showTime(row.handoverTime)}` : ""}</span>
                                    {row.returnDate && <span className="mt-0.5 block text-[11px] text-[#75657E]">Return {showDate(row.returnDate)}</span>}</td>
                                <td className="px-2 py-2"><span className="block font-semibold">{row.typeLabel}</span>
                                    {row.contentsLabel && <span className="mt-1 block text-[11px] text-[#75657E]">{row.contentsLabel}</span>}</td>
                                <td className="px-2 py-2"><span className={`text-[11px] font-semibold ${statusColor[status] || "text-[#2B174C]"}`}>{status}</span></td>
                                <td className="px-2 py-2"><div className="flex flex-col items-center gap-1">{todoChips(row)}</div></td>
                                <td className="px-2 py-2"><button type="button" aria-haspopup="dialog" onClick={e => { e.stopPropagation(); openRow(); }}
                                                                  className="inline-flex min-h-[32px] w-full max-w-[100px] items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-[11px] font-medium text-[#5B32C5] hover:bg-[#EAE0FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C3AED]">View Items</button></td>
                            </tr>;
                        })}</tbody>
                    </table>
                    {visibleRows.length === 0 && <p className="p-5 text-center text-xs text-[#75657E]">{date ? "No booking tasks on this date." : "No booking tasks match this filter."}</p>}
                </div>}
        </section>

        {open && <div role="presentation" className="fixed inset-0 z-[85] flex items-center justify-center bg-[#21132E]/55 p-4"
                      onMouseDown={e => { if (e.target === e.currentTarget && !rentalBusy) closeAll(); }}>
            <section role="dialog" aria-modal="true" aria-label="Items for this booking" className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-xl">
                <header className="flex items-start justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div><h3 className="text-lg font-bold text-[#21132E]">Items for this Booking</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{open.reference}</p></div>
                    <button type="button" className={`${outline} h-9 px-3`} disabled={rentalBusy} onClick={closeAll}><X size={15}/> Close</button>
                </header>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="grid gap-3 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-4 text-xs sm:grid-cols-3">
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Client</p><p className="mt-1 font-semibold text-[#21132E]">{open.clientName}</p></div>
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Schedule</p>
                            <p className="mt-1 font-semibold text-[#21132E]">{open.handoverLabel}: {showDate(open.handoverDate)}{open.handoverTime ? ` · ${showTime(open.handoverTime)}` : ""}</p>
                            <p className="mt-1 text-[#806A8C]">Event: {showDate(open.eventDate)}</p>
                            {open.returnDate && <p className="mt-1 text-[#806A8C]">Return: {showDate(open.returnDate)}{open.returnTime ? ` · ${showTime(open.returnTime)}` : ""}</p>}
                            {open.deliveryAddress && <p className="mt-1 break-words text-[#806A8C]">Deliver to: {open.deliveryAddress}</p>}</div>
                        <div><p className="text-[10px] font-semibold uppercase text-[#806A8C]">Booking Type</p>
                            <p className="mt-1 font-semibold text-[#21132E]">{open.typeLabel}{open.contentsLabel ? ` · ${open.contentsLabel}` : ""}</p>
                            {open.packageName && <p className="mt-1 text-[#806A8C]">{open.packageName}</p>}</div>
                    </div>
                    {open.hasConsumables && open.hasRentals && <p role="note" className="rounded-lg bg-[#F5F0FF] px-3 py-2 text-[11px] text-[#4D2B85]">
                        This booking has consumables and rental equipment. Hand over each part when it is ready. The booking becomes <strong>Released</strong> after both are handed over.</p>}
                    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}

                    {/* Consumables */}
                    {open.hasConsumables && <section className="overflow-hidden rounded-xl border border-[#E6DDF0]" aria-label="Consumables">
                        <SectionTitle icon={<Package2 size={15}/>} title="Consumables"
                                      subtitle={cb ? `${cb.items.length} ${cb.items.length === 1 ? "line" : "lines"} · ${cb.items.filter(i => i.prepared).length} of ${cb.items.length} prepared` : "All consumables were handed over."}
                                      badge={cb ? <Chip tone={cbPaid && cbDeposit ? "ready" : "todo"}>{!cbPaid ? "Balance Pending" : !cbDeposit ? "Security Deposit Pending" : "Fully Paid"}</Chip> : <Chip tone="done">Handed over</Chip>}/>
                        {cb && <>
                            <div className="overflow-x-auto"><table className={tableClass.replace("min-w-0", "min-w-[520px]")}>
                                <colgroup><col className="w-[44%]"/><col className="w-[10%]"/><col className="w-[20%]"/><col className="w-[26%]"/></colgroup>
                                <thead className="bg-[#FFFDF8]"><tr>{["Item", "Qty", "Status", "Action"].map(headCell)}</tr></thead>
                                <tbody>{cb.items.map(item => <tr key={item.itemId} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                    <td className="px-4 py-2 text-left font-medium">{item.productName}{item.variantName ? ` — ${item.variantName}` : ""}</td>
                                    <td className="px-2 py-2 font-semibold">{item.quantity}</td>
                                    <td className={`px-2 py-2 text-[10px] font-semibold ${item.issued ? "text-[#1D4ED8]" : item.prepared ? "text-[#23834A]" : "text-[#A56607]"}`}>{item.issued ? "Handed Over" : item.prepared ? "Prepared" : "Needs Preparation"}</td>
                                    <td className="px-2 py-2">{!item.prepared && !item.issued
                                        ? <button type="button" className={`${outline} h-9 w-full px-2`} disabled={!canOperateConsumables || saving}
                                                  onClick={() => void consumableAction("prepare_staff_sales_booking_item", item.itemId)}>Mark Prepared</button>
                                        : <span className="text-[11px] text-[#806A8C]">Ready for hand over</span>}</td>
                                </tr>)}</tbody>
                            </table></div>
                            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EAF4] px-4 py-3">
                                <p className="max-w-lg text-[11px] text-[#806A8C]">Prepare every consumable first. The full booking payment{open.hasRentals ? " and the security deposit" : ""} must be recorded before hand over.</p>
                                <button type="button" className={primary} disabled={!cbCanRelease} onClick={() => setConfirm("consumables")}><Truck size={15}/> Hand Over Consumables</button>
                            </div>
                            {!cbReady && <p className="px-4 pb-3 text-[11px] text-[#926400]">Prepare every consumable line first.</p>}
                            {!canOperateConsumables && <p className="px-4 pb-3 text-[11px] text-[#926400]">Full Inventory access is required to prepare or hand over consumables.</p>}
                            {cbReady && !cbPaid && <p className="px-4 pb-3 text-[11px] text-[#926400]">Full booking payment is required before hand over.</p>}
                            {cbReady && cbPaid && !cbDeposit && <p className="px-4 pb-3 text-[11px] text-[#926400]">Collect the security deposit first ({pesoText(Number(cb.depositCollected ?? 0))} of {pesoText(Number(cb.depositRequired ?? 0))} received).</p>}
                            {cbReady && cbPaid && cbDeposit && cbHandoverDate > today && <p className="px-4 pb-3 text-[11px] text-[#926400]">Hand over on the {open.handoverLabel.toLowerCase()} date ({showDate(cbHandoverDate)}).</p>}
                        </>}
                    </section>}

                    {/* Rental equipment */}
                    {open.hasRentals && <section className="overflow-hidden rounded-xl border border-[#E6DDF0]" aria-label="Rental equipment">
                        <SectionTitle icon={<Truck size={15}/>} title="Rental Equipment"
                                      subtitle={rentalLines.length ? `${rentalLines.length} ${rentalLines.length === 1 ? "line" : "lines"} · ${rentalUnits} ${rentalUnits === 1 ? "unit" : "units"}` : rental.loading ? "Loading rental equipment…" : rental.error ? "Rental equipment could not be loaded." : "No equipment steps left for this booking."}
                                      badge={rentalLines.length ? <Chip tone={rentalPaid && rentalDeposit ? "ready" : "todo"}>{!rentalPaid ? "Balance Pending" : !rentalDeposit ? "Security Deposit Pending" : "Fully Settled"}</Chip> : undefined}/>
                        {rentalLines.length > 0 && <>
                            <div className="overflow-x-auto"><table className={tableClass.replace("min-w-0", "min-w-[520px]")}>
                                <colgroup><col className="w-[44%]"/><col className="w-[10%]"/><col className="w-[20%]"/><col className="w-[26%]"/></colgroup>
                                <thead className="bg-[#FFFDF8]"><tr>{["Equipment", "Qty", "Status", "Action"].map(headCell)}</tr></thead>
                                <tbody>{rentalLines.map(({ item, task }) => <tr key={item.allocationId} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                    <td className="px-4 py-2 text-left font-medium">{item.equipmentName}</td>
                                    <td className="px-2 py-2 font-semibold">{item.quantity}</td>
                                    <td className={`px-2 py-2 text-[10px] font-semibold ${task === "release" ? "text-[#23834A]" : task === "return" ? "text-[#1D4ED8]" : "text-[#A56607]"}`}>
                                        {task === "prepare" ? "Needs Preparation" : task === "release" ? "Prepared" : task === "return" ? "Out on Rental" : "Previous Return Pending"}</td>
                                    <td className="px-2 py-2">{task === "prepare"
                                        ? <div className="flex flex-col items-center gap-1">
                                            <button type="button" className={`${outline} h-9 w-full px-2`} disabled={!canOperateRental || rentalBusy} onClick={() => void markEquipmentPrepared(item)}>Mark Prepared</button>
                                            <button type="button" className="text-[10px] font-semibold text-[#A56607] hover:underline disabled:opacity-40" disabled={!canOperateRental || rentalBusy}
                                                    onClick={() => startIssue(item)}>Broken, dirty or missing? Report issue</button>
                                        </div>
                                        : task === "inspect"
                                            ? <button type="button" className={`${outline} h-9 w-full px-2`} disabled={!canOperateRental || rentalBusy} onClick={() => setFinalizeItem(item)}>Finalize Return</button>
                                            : <span className="text-[11px] text-[#806A8C]">{task === "release" ? "Ready to release" : "Included in the return"}</span>}</td>
                                </tr>)}</tbody>
                            </table></div>
                            {allReserved && <div className="space-y-1 border-t border-[#F0EAF4] px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="max-w-lg text-[11px] text-[#806A8C]">Prepare all equipment first. The booking balance and the agreed security deposit must be paid, and the rental start date reached.</p>
                                    <button type="button" className={primary} disabled={!rentalCanRelease} onClick={() => setConfirm("equipment")}><Truck size={15}/> Release Equipment</button>
                                </div>
                                {!allPrepared && <p className="text-[11px] text-[#926400]">Prepare every equipment line first.</p>}
                                {allPrepared && !rentalPaid && <p className="text-[11px] text-[#926400]">Full payment has not been recorded yet.</p>}
                                {allPrepared && rentalPaid && !rentalDeposit && <p className="text-[11px] text-[#926400]">The security deposit is unpaid or cannot be verified.</p>}
                                {allPrepared && rentalPaid && rentalDeposit && !releaseDateReached && <p className="text-[11px] text-[#926400]">Release is available on or after the rental start date.</p>}
                                {!canOperateRental && <p className="text-[11px] text-[#926400]">Full Inventory access is required for rental hand over.</p>}
                            </div>}
                            {allOut && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EAF4] px-4 py-3">
                                <p className="text-[11px] text-[#5A476A]">Receive all equipment in one return. Record any missing or damaged units.</p>
                                <button type="button" className={primary} disabled={!canOperateRental || rentalBusy} onClick={startReturn}>Receive Return</button>
                            </div>}
                            {!allReserved && !allOut && rentalLines.some(r => r.task === "return") &&
                                <p className="border-t border-[#F0EAF4] px-4 py-3 text-[11px] text-[#926400]">This booking has equipment at different stages from an older partial hand over. Ask the Manager to fix it before a full return.</p>}
                        </>}
                    </section>}
                </div>
                <div className="flex justify-end border-t border-[#E9E1EE] px-5 py-3"><button type="button" className={`${outline} h-9`} disabled={rentalBusy} onClick={closeAll}>Close</button></div>
            </section>
        </div>}

        {/* Hand over consumables / release equipment */}
        {open && confirm && <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/55 p-4">
            <section role="alertdialog" aria-modal="true" aria-label={confirm === "consumables" ? "Confirm consumables hand over" : "Confirm equipment release"}
                     className="w-full max-w-lg space-y-4 rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">{confirm === "consumables" ? "Hand Over Consumables" : "Release Equipment"}</h3>
                <p className="text-xs text-[#5A476A]">{confirm === "consumables"
                    ? `Confirm the hand over of all ${cb?.items.reduce((s, i) => s + i.quantity, 0) || 0} consumable units for ${open.reference}. Stock is not deducted twice.${open.hasRentals ? " The rental equipment is released separately." : ""}`
                    : `Confirm the hand over of all ${rentalLines.reduce((s, r) => s + r.item.quantity, 0)} equipment units for ${open.reference}.${open.hasConsumables && !open.consumablesDone ? " The consumables are handed over separately." : ""}`}</p>
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" className={outline} disabled={rentalBusy} onClick={() => setConfirm(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={confirm === "consumables" ? !cbCanRelease : !rentalCanRelease}
                            onClick={() => void (confirm === "consumables" ? consumableAction("release_staff_sales_booking") : confirmEquipmentRelease())}>
                        {rentalBusy ? "Saving..." : "Confirm Hand Over"}</button>
                </div>
            </section>
        </div>}

        {/* Report an equipment issue found while preparing */}
        {issue && <div role="presentation" className="fixed inset-0 z-[105] flex items-center justify-center bg-[#21132E]/55 p-4">
            <section role="dialog" aria-modal="true" aria-label="Report equipment issue" className="w-full max-w-lg space-y-3 rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Report Equipment Issue</h3>
                <p className="text-sm text-[#5A476A]">{issue.name} · found while preparing {issue.reference}</p>
                <label className="block text-xs font-semibold text-[#5A476A]">Quantity (maximum {issue.max})
                    <input type="number" min={1} max={issue.max} step={1} value={issueQty} onChange={e => setIssueQty(e.target.value)} className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                <label className="block text-xs font-semibold text-[#5A476A]">Issue type
                    <select value={issueType} onChange={e => setIssueType(e.target.value as typeof issueType)} className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm">
                        <option value="damage">Damaged / Needs Inspection</option><option value="missing">Missing Equipment</option>
                        <option value="routine">Routine Cleaning / Minor Upkeep (no safety issue)</option>
                    </select></label>
                <label className="block text-xs font-semibold text-[#5A476A]">What happened? (required)
                    <textarea rows={3} maxLength={500} value={issueNotes} onChange={e => setIssueNotes(e.target.value)} className="mt-1 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" className={outline} disabled={rentalBusy} onClick={() => setIssue(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rentalBusy || !canOperateRental} onClick={() => void confirmIssue()}>{rentalBusy ? "Saving..." : "Submit Issue Report"}</button>
                </div>
            </section>
        </div>}

        {/* Receive the full equipment return */}
        {open && returnOpen && <div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/55 p-4">
            <section role="alertdialog" aria-modal="true" aria-label="Receive equipment return" className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Receive Return</h3>
                <p className="text-xs text-[#5A476A]">Enter only missing or damaged units. 0 means no problem.</p>
                <div className="space-y-2">{rentalLines.map(({ item }) => {
                    const missing = Number(returnMissing[item.allocationId] ?? "0"), damaged = Number(returnDamaged[item.allocationId] ?? "0");
                    return <div key={item.allocationId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] p-3 text-xs">
                        <span className="min-w-[150px] flex-1"><strong className="block text-[#2B174C]">{item.equipmentName}</strong>
                            <span className="mt-1 block text-[#806A8C]">Rented: {item.quantity} · Returned: {Number.isSafeInteger(missing) && missing >= 0 ? Math.max(0, item.quantity - missing) : "—"}</span></span>
                        <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Missing
                            <input type="number" min={0} max={item.quantity} step={1} value={returnMissing[item.allocationId] ?? "0"} disabled={rentalBusy}
                                   onChange={e => setReturnMissing(prev => ({ ...prev, [item.allocationId]: e.target.value }))} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                        <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Damaged
                            <input type="number" min={0} max={item.quantity} step={1} value={returnDamaged[item.allocationId] ?? "0"} disabled={rentalBusy}
                                   onChange={e => setReturnDamaged(prev => ({ ...prev, [item.allocationId]: e.target.value }))} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                        {missing + damaged > item.quantity && <p role="alert" className="w-full text-red-700">Missing + damaged cannot be more than {item.quantity}.</p>}
                    </div>;
                })}</div>
                <label className="block text-xs font-semibold text-[#2B174C]">Return notes (required if anything is missing or damaged)
                    <textarea rows={3} maxLength={400} value={returnNotes} disabled={rentalBusy} onChange={e => setReturnNotes(e.target.value)} className="mt-2 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                <label className="flex items-start gap-2 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs text-[#4F3A5A]">
                    <input type="checkbox" checked={returnChecked} disabled={rentalBusy} onChange={e => setReturnChecked(e.target.checked)} className="mt-0.5"/>
                    <span><strong>I checked the returned items and did the routine care for the units not reported damaged.</strong> Only damaged units stay on hold.</span></label>
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                <div className="flex justify-end gap-2 border-t border-[#E9E1EE] pt-3">
                    <button type="button" className={outline} disabled={rentalBusy} onClick={() => setReturnOpen(false)}>Cancel</button>
                    <button type="button" className={primary} disabled={rentalBusy} onClick={() => void confirmReturn()}>{rentalBusy ? "Saving..." : "Confirm Return"}</button>
                </div>
            </section>
        </div>}

        {/* Finalize a return recorded under the older two-step inspection */}
        {finalizeItem && <div role="presentation" className="fixed inset-0 z-[110] flex items-center justify-center bg-[#21132E]/55 p-4">
            <section role="alertdialog" aria-modal="true" aria-label="Finalize recorded return" className="w-full max-w-md space-y-4 rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Finalize Recorded Return</h3>
                <div className="rounded-xl bg-[#F7F1FF] p-3 text-xs text-[#5330B6]">
                    <p>{finalizeItem.equipmentName} · {finalizeItem.bookingReference}</p>
                    <p>Returned: <strong>{finalizeItem.returnedReceivedUnits ?? finalizeItem.quantity}</strong> · Recorded damaged: <strong>{Math.max(0, Number(finalizeItem.damagedUnits || 0))}</strong></p>
                </div>
                <p className="text-xs text-[#6A5D6F]">Confirm the damage record is correct and routine care is done for the other units.</p>
                {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" className={outline} disabled={rentalBusy} onClick={() => setFinalizeItem(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rentalBusy || !canOperateRental} onClick={() => void confirmFinalize()}>{rentalBusy ? "Saving..." : "Confirm Return"}</button>
                </div>
            </section>
        </div>}

        <SuccessToast toast={notice ? { title: "Booking task completed", message: notice } : null} onClose={closeNotice}/>
    </>;
}
