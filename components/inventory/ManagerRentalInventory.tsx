"use client";

import * as React from "react";
import * as XLSX from "xlsx";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
    Boxes, CalendarClock, CheckCircle2,
    PackagePlus, Pencil, Plus, Search, Settings2, Wrench, X, Trash2,
    Download, Upload, ChevronDown, Wallet, ArrowRight, AlertTriangle, Truck,
} from "lucide-react";
import {
    useRentalInventory, availableNow, hasRentalStockDiscrepancy,
    type RentalEquipment, type RentalActivity, type RentalMaintenanceRecord,
    type RentalPendingDamageObservation,
    type RentalMutation, type RentalSummary, type RentalImportRow, type RentalPurchaseDetails,
    type RentalBulkPurchase, type RentalPricingMethod,
    calculateCostBasedRentalRate,
} from "@/hooks/useRentalInventory";

// The manager manages physical equipment and maintenance, not checkout/return
// transactions. Staff's booking workflow is the authority for rentals/returns.
export default function ManagerRentalInventory({ branchId }: { branchId?: number }) {
    const rental = useRentalInventory(branchId);
    const {user}=useCurrentUser();
    const inventoryPermission=user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    // Legacy Managers default to Full unless explicitly denied; the Lambda is authoritative.
    const canManage=user?.role==="manager" && (inventoryPermission==null || inventoryPermission===true ||
        inventoryPermission==="true" || inventoryPermission==="full");
    const [search, setSearch] = React.useState("");
    const [category, setCategory] = React.useState("All Categories");
    const [status, setStatus] = React.useState("All Status");
    const [dialog, setDialog] = React.useState<{
        mode: "add" | "edit" | "receive" | "maintenance" | "review";
        item: RentalEquipment | null;
    } | null>(null);
    const [retireItem,setRetireItem] = React.useState<RentalEquipment|null>(null);
    const [notice, setNotice] = React.useState("");
    const [importOpen, setImportOpen] = React.useState(false);
    const [categoriesOpen, setCategoriesOpen] = React.useState(false);
    const [supplierPaymentsOpen, setSupplierPaymentsOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const [dateFiltersOpen, setDateFiltersOpen] = React.useState(false);
    const [fromDate, setFromDate] = React.useState("");
    const [toDate, setToDate] = React.useState("");
    const [appliedDates, setAppliedDates] = React.useState<{from:string;to:string}|null>(null);
    const [datesAvailability, setDatesAvailability] = React.useState<Map<number,number>|null>(null);
    const [datesLoading, setDatesLoading] = React.useState(false);
    const [datesError, setDatesError] = React.useState("");

    const categories = rental.categories;
    // Today's branch operations only. The backend retains earlier rental history.
    const todayRentalActivity = React.useMemo(() => {
        const todayKey = new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
        return rental.recentActivity.filter(record => {
            const occurredAt = new Date(record.occurredAt);
            return !Number.isNaN(occurredAt.getTime()) &&
                occurredAt.toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }) === todayKey;
        });
    }, [rental.recentActivity]);
    const filtered = React.useMemo(() => rental.equipment.filter(item => {
        // Retired equipment stays in history but not the default active catalog.
        if(!item.active && status!=="Archived")return false;
        const query = search.trim().toLowerCase();
        const found = !query || [item.name, item.category, item.equipmentNumber, item.lastSupplier || ""]
            .some(value => value.toLowerCase().includes(query));
        const availability = datesAvailability?.get(item.id);
        return found && (category === "All Categories" || item.category === category) &&
            (status === "All Status" || equipmentStatuses(item, Boolean(appliedDates), availability).includes(status));
    }), [rental.equipment, search, category, status, datesAvailability, appliedDates]);

    const resetDates = () => {
        setAppliedDates(null); setDatesAvailability(null);
        // Fully Booked can only be established for a checked booking date range.
        setStatus(previous => previous === "Fully Booked" ? "All Status" : previous);
        setDatesError("");
    };
    const checkDates = async () => {
        if (!fromDate || !toDate || toDate < fromDate) {
            setDatesError("Choose a valid start and end date."); return;
        }
        setDatesError(""); setDatesLoading(true); setAppliedDates(null); setDatesAvailability(null);
        try {
            const rows = await rental.checkAvailability(fromDate, toDate);
            setDatesAvailability(new Map(rows.map(row => [row.equipmentId,row.availableUnits])));
            setAppliedDates({from:fromDate,to:toDate});
        } catch(error) {
            setDatesError(error instanceof Error ? error.message : "Unable to check availability.");
        } finally { setDatesLoading(false); }
    };
    const onSaved = async (mutation:RentalMutation) => {
        if(!canManage)throw new Error("Full Inventory access is required to change equipment or purchase records.");
        const reference = await rental.mutate(mutation);
        resetDates();
        setNotice(mutation.action === "resolve_missing_equipment"
            ? mutation.resolution === "found"
                ? "Missing equipment recovered. Staff must inspect and complete the recovery-care task before units become ready."
                : "Permanent loss confirmed. The equipment stock has been adjusted."
            : mutation.action === "approve_maintenance_repair"
                ? "Repair authorized. Equipment stays on hold until Staff completes repairs and the Manager approves stock release."
                : mutation.action === "approve_repair_completion"
                    ? "Repaired units released to ready stock after Manager approval."
                    : ["receive_equipment","import_equipment"].includes(mutation.action) || (mutation.action==="create_equipment" && Boolean(mutation.initialPurchase))
                        ? `Purchase recorded${reference ? ` · ${reference}` : ""}. Staff must confirm physical receipt before stock increases.`
                        : `Rental inventory saved${reference ? ` · ${reference}` : ""}.`);
    };
    const downloadExport = (format:"xlsx"|"pdf") => {
        setExportOpen(false);
        const details = {category,status,appliedDates};
        if (format === "xlsx") exportRentalExcel(filtered, details, datesAvailability);
        else exportRentalPdf(filtered, details, datesAvailability);
    };

    return (
        <div className="space-y-4" aria-label="Rental inventory">
            {!canManage&&<p role="status" className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-xs text-[#5330B6]">View-only Inventory access: product details and maintenance reports remain visible, but catalog changes, repair approvals and purchases require Full access.</p>}
            {rental.error && (
                <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E8CAD2] bg-[#FFF5F7] px-4 py-3 text-sm text-[#A92741]">
                    <span>{rental.error}{rental.connected ? " Showing the last loaded data." : ""}</span>
                    <button type="button" onClick={() => void rental.refresh()} className="rounded-lg border border-[#E8CAD2] px-3 py-1.5 font-semibold hover:bg-white">Try Again</button>
                </div>
            )}


            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <RentalMetric label="Total Equipment Units" value={rental.summary.totalUnits}
                              description="Total rental units owned by this branch" tone="purple" icon={<Boxes size={20}/>} loading={rental.loading}/>
                <RentalMetric label="Physically Ready Now" value={rental.summary.availableUnits}
                              description="On hand now; future reservations checked by date" tone="green" icon={<CheckCircle2 size={20}/>} loading={rental.loading}/>
                <RentalMetric label="Out on Rental" value={rental.summary.rentedOutUnits}
                              description="Units physically with customers" tone="blue" icon={<CalendarClock size={20}/>} loading={rental.loading}/>
                <RentalMetric label="On Hold" value={rental.summary.maintenanceUnits}
                              description="Pending inspection, cleaning, or repair" tone="amber" icon={<Wrench size={20}/>} loading={rental.loading}/>
            </div>

            {notice.startsWith("Missing equipment") || notice.startsWith("Permanent loss") ? (
                <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-[#D9CDF0] bg-[#F7F1FF] px-4 py-3 text-xs font-semibold text-[#5330B6]">
                    <span>{notice}</span>
                    <button type="button" onClick={() => setNotice("")} aria-label="Dismiss missing equipment update"><X size={16}/></button>
                </div>
            ) : null}
            {rental.missingReports.length>0&&<section className="rounded-xl border border-[#E7DFEC] bg-white p-4 shadow-sm" style={{backgroundColor:"#FFF8F9"}} aria-label="Missing equipment review">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2">
                            <AlertTriangle size={17} className="text-[#AA6A00]" style={{color:"#BD3652"}} aria-hidden="true"/>
                            <h3 className="text-sm font-bold text-[#21132E]">Missing Equipment Review</h3>
                        </div>
                        <p className="mt-1 text-xs text-[#86778F]">Review missing equipment reported by Staff and record the outcome.</p>
                    </div>
                    <span className="rounded-full bg-[#FFF2DB] px-3 py-1.5 text-[11px] font-semibold text-[#996000]" style={{backgroundColor:"#FFE5EC",color:"#AA2847"}}>
                        {rental.missingReports.length} pending
                    </span>
                </div>
                <div className="space-y-2">{rental.missingReports.map(report=><MissingReviewRow key={report.id} report={report}
                                                                                                saving={rental.saving} canManage={canManage} onSave={onSaved}/>)}</div>
            </section>}
            {rental.pendingReceipts.length>0&&<section aria-label="Deliveries awaiting staff confirmation" className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7DFEC] bg-[#FAF8FC] px-4 py-3 text-xs text-[#4F3A5A]" style={{backgroundColor:"#F5F1FF"}}>
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-[#665679]" style={{backgroundColor:"#ECE3FF",color:"#5A35A5"}} aria-hidden="true"><Truck size={19}/></span>
                <div className="min-w-0 flex-1">
                    <strong className="text-[#21132E]">{rental.pendingReceipts.length} {rental.pendingReceipts.length===1?"Delivery":"Deliveries"} Awaiting Staff Confirmation</strong>
                    <p className="mt-0.5 text-[11px] text-[#86778F]">Purchased equipment will be added to available stock after Staff confirms receipt.</p>
                </div>
                <span className="rounded-full border border-[#E6DDF0] bg-white px-3 py-1 font-semibold text-[#695D75]" style={{backgroundColor:"#FFF0D7",color:"#93600A"}}>Pending</span>
            </section>}

            <div className="grid items-stretch gap-4 xl:grid-cols-[1.15fr_1fr]">
                {/* Every open maintenance case is visible here. Actions stay in the
                    Manager's table instead of being hidden in a separate dialog. */}
                <section className="flex h-[470px] min-h-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm" aria-label="Maintenance and condition approvals">
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
                        <div className="flex min-w-0 items-start gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><Wrench size={19}/></span>
                            <div>
                                <h2 className="text-[15px] font-bold text-[#21132E]">Maintenance &amp; Condition</h2>
                                <p className="mt-0.5 text-[11px] text-[#86778F]">Approve reported repairs or completed stock releases using the Action column.</p>
                            </div>
                        </div>
                        {!rental.loading && rental.maintenanceDataReady && <span className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold ${rental.maintenanceRecords.some(needsManagerMaintenanceDecision) ? "bg-[#FFF1E4] text-[#A85B16]" : "bg-[#F5F1F8] text-[#695D75]"}`}>
                            {rental.maintenanceRecords.filter(needsManagerMaintenanceDecision).length} for Manager approval
                        </span>}
                    </div>
                    {/* Preliminary Staff damage observations and confirmed maintenance cases
                        share the same standard table. Observations remain view-only; only
                        confirmed repairs can receive Manager approval. */}
                    {rental.loading ? <PanelSkeleton/> : !rental.connected ?
                        <EmptyPanel label="Connect rental inventory to see maintenance records."/> :
                        !rental.maintenanceDataReady ?
                            <EmptyPanel label="The rental backend needs the maintenance records response. Apply the accompanying Lambda and SQL update."/> :
                            rental.maintenanceRecords.length===0 && rental.pendingDamageObservations.length===0 ?
                                <EmptyPanel label="No open repair or damage cases. Routine return inspections and cleaning are managed by Staff."/> :
                                <MaintenanceRecordsTable records={rental.maintenanceRecords}
                                                         pendingObservations={rental.pendingDamageObservations}
                                                         saving={rental.saving} canManage={canManage} onSave={onSaved}/>}
                    {rental.connected && rental.maintenanceDataReady && rental.maintenanceRecords.length>0 && <div className="shrink-0 border-t border-[#E9E1EE] bg-[#FCFAFF] px-4 py-2 text-[11px] text-[#786887]">
                        Repair approval authorizes the work, but units stay on hold. Staff reports completion before the Manager approves stock release.
                    </div>}
                </section>

                <section className="flex h-[470px] min-h-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
                    <PanelHeading icon={<CalendarClock size={18}/>} title="Today's Rental Stock Activity"
                                  subtitle="Equipment receipts, rental movements, and repairs recorded today."/>
                    {rental.loading ? <PanelSkeleton/> : !rental.connected ? <EmptyPanel label="Connect rental records to view activity."/> :
                        todayRentalActivity.length === 0 ? <EmptyPanel label="No rental stock movements recorded today."/> : (
                            <div className="min-h-0 flex-1 overflow-auto">
                                <table className="w-full min-w-[510px] text-left text-[11px]">
                                    <thead className="sticky top-0 bg-[#FFFCF8] text-[10px] uppercase text-[#806A8C]">
                                    <tr className="border-b border-[#E9E1EE]">
                                        <th className="px-3 py-3 font-semibold">Date &amp; Time</th>
                                        <th className="px-3 py-3 font-semibold">Equipment</th>
                                        <th className="px-3 py-3 font-semibold">Activity</th>
                                        <th className="px-2 py-3 text-center font-semibold">Qty</th>
                                        <th className="px-3 py-3 font-semibold">Reference No.</th>
                                    </tr></thead>
                                    <tbody>{todayRentalActivity.slice(0, 100).map(record => (
                                        <ActivityRow key={record.id} item={record}/>
                                    ))}</tbody>
                                </table>
                            </div>
                        )}
                </section>
            </div>



            {/* Rental supplier payments are separate from equipment stock actions. */}
            <section aria-label="Rental supplier payments" className="rounded-2xl border border-[#E7DFEC] bg-white px-4 py-3.5 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">
                            <Wallet size={18}/>
                        </span>
                        <div>
                            <h2 className="text-[15px] font-bold text-[#21132E]">Supplier Payments</h2>
                            <p className="mt-0.5 text-[11px] text-[#86778F]">Track and settle outstanding balances for rental equipment purchases.</p>
                        </div>
                    </div>
                    <button type="button" onClick={()=>setSupplierPaymentsOpen(true)}
                            className="inline-flex h-[42px] shrink-0 items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31]">
                        Supplier Payables <ArrowRight size={16}/>
                    </button>
                </div>
            </section>

            <section className="overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                    <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><Boxes size={18}/></span>
                        <div>
                            <h2 className="text-[15px] font-bold text-[#21132E]">Branch Rental Equipment List</h2>
                            <p className="mt-0.5 text-[11px] text-[#86778F]">Check physical stock and condition, or choose dates to check booking availability.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <select value={category} onChange={e=>setCategory(e.target.value)} aria-label="Filter rental category"
                                className="h-10 min-w-[150px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C]">
                            <option>All Categories</option>{categories.map(name=><option key={name}>{name}</option>)}
                        </select>
                        <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter rental equipment status"
                                className="h-10 min-w-[145px] rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C]">
                            {["All Status","Fully Available","Available","Low Availability","Unavailable",...(appliedDates?["Fully Booked"]:[]),"Needs Review","On Hold","Out on Rental","Missing Units","Stock Discrepancy"].map(value=><option key={value}>{value}</option>)}
                        </select>
                        <button type="button" aria-expanded={dateFiltersOpen} onClick={()=>setDateFiltersOpen(v=>!v)}
                                className="flex h-10 items-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]">
                            <CalendarClock size={15}/> {appliedDates ? "Dates Applied" : "Date Availability"} <ChevronDown size={14}/>
                        </button>
                        <div className="relative">
                            <button type="button" aria-expanded={exportOpen} onClick={()=>setExportOpen(v=>!v)}
                                    className="flex h-10 items-center gap-2 rounded-xl border border-[#D9CDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]">
                                <Download size={15}/> Export <ChevronDown size={13}/>
                            </button>
                            {exportOpen && <div className="absolute right-0 top-full z-20 mt-1 min-w-[155px] rounded-xl border border-[#E3D8EA] bg-white p-1 shadow-lg">
                                <button type="button" onClick={()=>downloadExport("xlsx")} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[#2B174C] hover:bg-[#F5F0FF]">Export Excel (.xlsx)</button>
                                <button type="button" onClick={()=>downloadExport("pdf")} className="block w-full rounded-lg px-3 py-2 text-left text-xs text-[#2B174C] hover:bg-[#F5F0FF]">Export PDF (.pdf)</button>
                            </div>}
                        </div>
                    </div>
                </div>
                {dateFiltersOpen && <div className="flex flex-wrap items-end gap-3 border-t border-[#E9E1EE] bg-[#FCFAFF] px-4 py-3 text-xs">
                    <label className="space-y-1 font-semibold text-[#4E2C66]">From
                        <input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);resetDates();}} className="block h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-[#2B174C]"/>
                    </label>
                    <label className="space-y-1 font-semibold text-[#4E2C66]">To (inclusive)
                        <input type="date" min={fromDate||undefined} value={toDate} onChange={e=>{setToDate(e.target.value);resetDates();}} className="block h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-[#2B174C]"/>
                    </label>
                    <button type="button" disabled={!fromDate||!toDate||toDate<fromDate||datesLoading} onClick={()=>void checkDates()}
                            className="h-10 rounded-xl bg-[#2B174C] px-4 font-semibold text-white disabled:opacity-50">{datesLoading?"Checking...":"Check Dates"}</button>
                    <button type="button" onClick={()=>{setFromDate("");setToDate("");resetDates();}}
                            className="h-10 rounded-xl border border-[#E3D8EA] bg-white px-4 font-semibold text-[#2B174C]">Clear</button>
                    {datesError && <p role="alert" className="w-full text-red-700">{datesError}</p>}
                    <p className="w-full text-[#86778F]">Checking dates changes the Availability status and bookable quantity for that period. Fully Booked counts only confirmed reservations. Physical stock and equipment conditions are shown separately.</p>
                </div>}
                <div className="grid gap-3 px-4 pb-4 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
                    <label className="relative min-w-0">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                        <input value={search} onChange={e=>setSearch(e.target.value)}
                               placeholder="Search equipment no., rental products, or categories..." aria-label="Search rental equipment"
                               className="h-11 w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-3 text-sm text-[#2B174C] outline-none placeholder:text-[#9B8AAA] focus:border-[#5A35A5]"/>
                    </label>
                    <button type="button" disabled={!canManage} onClick={()=>setImportOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-4 text-sm font-semibold text-[#5330B6] hover:bg-[#ECE3FF]">
                        <Upload size={16}/> Upload File
                    </button>
                    <button type="button" disabled={!canManage} onClick={()=>setCategoriesOpen(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-4 text-sm font-semibold text-[#5330B6] hover:bg-[#ECE3FF]">
                        <Settings2 size={16}/> Manage Categories
                    </button>
                    <button type="button" disabled={!canManage} onClick={()=>setDialog({mode:"add",item:null})} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-4 text-sm font-semibold text-[#5330B6] hover:bg-[#ECE3FF]">
                        <Plus size={16}/> Add Equipment
                    </button>
                </div>
                {appliedDates && <p className="border-t border-[#E9E1EE] bg-[#FCFAFF] px-4 py-2 text-xs font-medium text-[#5330B6]">
                    Booking availability for {appliedDates.from} to {appliedDates.to} · The "Bookable" column and Availability badges refer to these dates.
                </p>}
                <p className="border-t border-[#E9E1EE] bg-[#FCFAFF] px-4 py-2 text-[11px] text-[#786887]">
                    {appliedDates ? "Availability uses confirmed reservations for the chosen dates. The Rented Out and On Hold quantities still reflect physical stock now." : "Availability describes physical stock now; future bookings are checked using Date Availability."}
                    {" "}Low Availability uses the equipment's configured alert level. Needs Review identifies missing units or stock discrepancies without hiding remaining availability.
                </p>
                <div className="max-h-[360px] w-full overflow-auto overscroll-contain border-t border-[#E9E1EE]" style={{ maxHeight: 360 }} role="region" aria-label="Branch rental equipment list" tabIndex={0}>
                    <table className="w-full min-w-[1090px] text-left text-[11px]">
                        <thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase tracking-wide text-[#806A8C]">
                        <tr className="border-b border-[#E9E1EE]">
                            <th className="px-4 py-3 font-semibold">Equipment No.</th>
                            <th className="px-3 py-3 font-semibold">Rental Product</th>
                            <th className="px-3 py-3 font-semibold">Category</th>
                            <th className="px-2 py-3 text-center font-semibold">Total Units</th>
                            <th className="px-2 py-3 text-center font-semibold">{appliedDates ? "Bookable" : "Ready Now"}</th>
                            <th className="px-2 py-3 text-center font-semibold">Rented Out</th>
                            <th className="px-2 py-3 text-center font-semibold">On Hold</th>
                            <th className="px-2 py-3 text-center font-semibold">Availability</th>
                            <th className="px-2 py-3 text-center font-semibold">Condition</th>
                            <th className="px-3 py-3 text-center font-semibold">Action</th>
                        </tr>
                        </thead>
                        <tbody>
                        {rental.loading ? <tr><td colSpan={10} className="p-5"><PanelSkeleton/></td></tr> :
                            !rental.connected ? <tr><td colSpan={10} className="px-5 py-12 text-center text-sm text-[#86778F]">Rental data is not connected. No equipment is displayed here.</td></tr> :
                                filtered.length === 0 ? <tr><td colSpan={10} className="px-5 py-12 text-center text-sm text-[#86778F]">No matching rental equipment.</td></tr> :
                                    filtered.map(item => (
                                        <tr key={item.id} className="border-b border-[#EFE8F2] last:border-0">
                                            <td className="px-4 py-3 text-[#4E2C66]">{item.equipmentNumber || "—"}</td>
                                            <td className="px-3 py-3 font-semibold text-[#2B174C]">{item.name}</td>
                                            <td className="px-3 py-3 text-[#5F4E75]">{item.category}</td>
                                            <td className="px-2 py-3 text-center font-semibold">{item.totalUnits}</td>
                                            <td className="px-2 py-3 text-center font-semibold" title={appliedDates ? "Remaining bookable units for the selected date range" : "Physically ready units now"}>{appliedDates ? (datesAvailability?.get(item.id) ?? "—") : availableNow(item)}</td>
                                            <td className="px-2 py-3 text-center">{item.rentedOutUnits}</td>
                                            <td className="px-2 py-3 text-center">{item.maintenanceUnits}</td>
                                            <td className="px-2 py-3 text-center"><IssueBadge issue={equipmentDisplayStatus(item, appliedDates !== null, datesAvailability?.get(item.id))} /></td>
                                            <td className="px-2 py-3 text-center">
                                                {equipmentConditionLabels(item).length ?
                                                    <div className="flex flex-wrap items-center justify-center gap-1">
                                                        {equipmentConditionLabels(item).map(label=><IssueBadge key={label} issue={label}/>)}
                                                    </div> : <span className="text-[#9B8AAA]">—</span>}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <div className="flex flex-wrap items-center justify-center gap-1.5">
                                                    <button type="button" onClick={()=>setDialog({mode:"receive",item})} disabled={!canManage||!item.active}
                                                            aria-label={`Restock ${item.name}`}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-[#E5F8EC] px-2.5 py-1.5 font-semibold text-[#23834A] hover:bg-[#D5F0DF] disabled:opacity-40"><PackagePlus size={13}/> Restock</button>
                                                    <button type="button" onClick={()=>setDialog({mode:"edit",item})} disabled={!canManage||!item.active}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-[#F1EBFF] px-2.5 py-1.5 font-semibold text-[#5330B6] hover:bg-[#EAE0FF] disabled:opacity-40"><Pencil size={13}/> Edit</button>
                                                    <button type="button" onClick={()=>setRetireItem(item)} disabled={!canManage||!item.active}
                                                            className="inline-flex items-center gap-1 rounded-lg bg-[#FFF0F0] px-2.5 py-1.5 font-semibold text-[#C52C45] hover:bg-[#FFE2E6] disabled:opacity-40"><Trash2 size={13}/> Delete</button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                        </tbody>
                    </table>
                </div>
            </section>


            {notice && !notice.startsWith("Missing equipment") && !notice.startsWith("Permanent loss") && <div role="status" className="flex items-center justify-between rounded-xl border border-[#E2DCF2] bg-[#F5F0FF] px-4 py-3 text-xs font-semibold text-[#5330B6]">
                {notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss message"><X size={16}/></button>
            </div>}
            {dialog && <EquipmentDialog key={`${dialog.mode}-${dialog.item?.id ?? "new"}`} mode={dialog.mode} item={dialog.item} saving={rental.saving}
                                        close={() => setDialog(null)}
                                        onNavigate={(mode) => setDialog({mode, item:dialog.item})}
                                        categories={categories}
                                        onSave={async (mutation) => { await onSaved(mutation); setDialog(null); }}/>
            }
            {retireItem&&<RetireEquipmentDialog item={retireItem} saving={rental.saving}
                                                close={()=>setRetireItem(null)} onSave={async (mutation)=>{await onSaved(mutation);setRetireItem(null);}}/>}
            {importOpen && <RentalImportDialog close={()=>setImportOpen(false)} onSave={async (rows,purchase)=>{
                await onSaved({action:"import_equipment",importMode:"single_purchase",rows,purchase}); setImportOpen(false);
            }} saving={rental.saving} existingEquipment={rental.equipment}/>}
            {supplierPaymentsOpen && <RentalSupplierPayablesDialog branchId={branchId} canManage={canManage} onClose={()=>setSupplierPaymentsOpen(false)}/>}
            {categoriesOpen && <RentalCategoriesDialog categories={categories} equipment={rental.equipment}
                                                       saving={rental.saving} close={()=>setCategoriesOpen(false)} onSave={onSaved}/>}
        </div>
    );
}

type RentalAvailabilityLabel = "Fully Available" | "Available" | "Low Availability" | "Unavailable" | "Fully Booked" | "Archived" | "Not Checked";

// Bookable-on-dates comes ONLY from the existing server-side allocation check.
// Physical readiness is separate: future reservations do not reduce Ready Now.
function equipmentDisplayStatus(item: RentalEquipment, checkingDates: boolean, onDates?: number): RentalAvailabilityLabel {
    if (!item.active) return "Archived";
    if (checkingDates && (onDates === undefined || !Number.isFinite(onDates))) return "Not Checked";
    const quantity = checkingDates ? Math.max(0, onDates as number) : availableNow(item);
    const maximumUsable = Math.max(0, item.totalUnits - item.maintenanceUnits - item.missingUnits);
    if (quantity <= 0) {
        // With usable equipment but no date availability, confirmed allocations occupy every unit.
        // Otherwise equipment itself is physically unavailable (not "fully booked").
        return checkingDates && maximumUsable > 0 ? "Fully Booked" : "Unavailable";
    }
    if (item.alertLevel > 0 && quantity <= item.alertLevel) return "Low Availability";
    // "Fully Available" means there are no stock holds, missing/out units or
    // confirmed reservations for the selected period.
    if (quantity === item.totalUnits && item.maintenanceUnits === 0 && item.missingUnits === 0 &&
        (checkingDates || item.rentedOutUnits === 0)) return "Fully Available";
    return "Available";
}

// Condition alerts should not conceal available units: e.g. 27 tables may
// still be available even though 1 table is missing and needs review.
function equipmentConditionLabels(item: RentalEquipment): string[] {
    if (!item.active) return [];
    const labels: string[] = [];
    if (hasRentalStockDiscrepancy(item) || item.missingUnits > 0) labels.push("Needs Review");
    if (item.maintenanceUnits > 0) labels.push("On Hold");
    return labels;
}

function equipmentStatuses(item: RentalEquipment, checkingDates: boolean, onDates?: number): string[] {
    if (!item.active) return ["Archived"];
    return [
        equipmentDisplayStatus(item, checkingDates, onDates),
        ...equipmentConditionLabels(item),
        ...(item.rentedOutUnits > 0 ? ["Out on Rental"] : []),
        ...(item.missingUnits > 0 ? ["Missing Units"] : []),
        ...(hasRentalStockDiscrepancy(item) ? ["Stock Discrepancy"] : []),
    ];
}

function IssueBadge({issue}:{issue:string}) {
    const style = ["Fully Available", "Available"].includes(issue) ? "bg-[#E5F8EC] text-[#23834A]" :
        ["Needs Review", "Unavailable", "Fully Booked"].includes(issue) ? "bg-[#FFE7EA] text-[#D92C3F]" :
            issue === "Low Availability" ? "bg-[#FFF2D3] text-[#A66A00]" :
                issue === "Archived" || issue === "Not Checked" ? "bg-[#ECE7EE] text-[#6B6174]" :
                    "bg-[#EEE8FF] text-[#6944C9]";
    const explanation:Record<string,string> = {
        "Fully Available": "All units are available in the current context (now or on the checked dates).",
        "Available": "Some units are available; other units may be booked, rented out, missing or on hold.",
        "Low Availability": "Bookable units are at or below this equipment's configured alert level.",
        "Unavailable": "No physically usable units available.",
        "Fully Booked": "All usable units are allocated to overlapping confirmed rentals for the selected dates.",
        "Needs Review": "Missing units or a stock discrepancy needs Manager attention.",
        "On Hold": "Equipment awaiting inspection, cleaning or repair.",
        "Not Checked": "No date availability result returned for this equipment.",
    };
    return <span title={explanation[issue]} className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${style}`}>{issue}</span>;
}

/* The maintenance panel reads open transactions from rental_maintenance_records.
   A repair's estimated completion is optional: never invent one for historical data. */
function MaintenanceDate({value}:{value:string|null}) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return <>—</>;
    const parsed = new Date(`${value}T12:00:00Z`);
    return <>{parsed.toLocaleDateString("en-US",{timeZone:"UTC",month:"short",day:"numeric",year:"numeric"})}</>;
}
// Two existing backend approvals, surfaced directly in the Manager table.
// Staff work in progress must never be confused with stock already released.
function managerMaintenanceStage(record:RentalMaintenanceRecord):"release"|"approve"|"staff" {
    if(!record.repairApproved) return "approve";
    return record.pendingCompletionId ? "release" : "staff";
}
function needsManagerMaintenanceDecision(record:RentalMaintenanceRecord):boolean {
    return managerMaintenanceStage(record)!=="staff";
}
function MaintenanceStageBadge({record}:{record:RentalMaintenanceRecord}) {
    const stage=managerMaintenanceStage(record);
    return <span className={`inline-flex rounded-md px-2 py-1 text-[10px] font-semibold ${
        stage==="release" ? "bg-[#EAF0FF] text-[#2855A5]" :
            stage==="approve" ? "bg-[#FFF2D7] text-[#995F00]" :
                "bg-[#F1EBFF] text-[#5330B6]"
    }`}>{stage==="release"?"Awaiting Stock Release":stage==="approve"?"Awaiting Repair Approval":"Repair Authorized"}</span>;
}
function MaintenanceRecordsTable({records,pendingObservations,saving,canManage,onSave}:{
    records:RentalMaintenanceRecord[];
    pendingObservations:RentalPendingDamageObservation[];
    saving:boolean;canManage:boolean;
    onSave:(mutation:RentalMutation)=>Promise<void>;
}) {
    const [approvalError,setApprovalError]=React.useState("");
    const [approvalSuccess,setApprovalSuccess]=React.useState("");
    const [pendingId,setPendingId]=React.useState<number|null>(null);
    const prioritized=React.useMemo(()=>[...records].sort((a,b)=>
        Number(needsManagerMaintenanceDecision(b))-Number(needsManagerMaintenanceDecision(a)) ||
        Number(managerMaintenanceStage(b)==="release")-Number(managerMaintenanceStage(a)==="release") ||
        a.dateReported.localeCompare(b.dateReported)),[records]);
    const approve=async(record:RentalMaintenanceRecord)=>{
        if(!canManage){setApprovalError("Full Inventory access is required for Manager approvals.");return;}
        const isRelease=managerMaintenanceStage(record)==="release";
        if(!isRelease && managerMaintenanceStage(record)!=="approve") return;
        const message=isRelease
            ? `Approve release of ${record.pendingCompletionUnits ?? 0} repaired ${record.equipmentName} unit(s) back into available stock?`
            : `Authorize repair for ${record.equipmentName}? The equipment remains on hold until Staff finishes and the Manager approves its release.`;
        if(!window.confirm(message))return;
        setApprovalError("");setApprovalSuccess("");setPendingId(record.id);
        try {
            await onSave(isRelease
                ? {action:"approve_repair_completion",requestId:record.pendingCompletionId!}
                : {action:"approve_maintenance_repair",maintenanceId:record.id});
            setApprovalSuccess(isRelease
                ? `Stock release approved for ${record.equipmentName}.`
                : `Repair authorized for ${record.equipmentName}. Staff can complete the work.`);
        } catch(error) {
            setApprovalError(error instanceof Error?error.message:"Unable to approve the maintenance request.");
        } finally {setPendingId(null);}
    };
    return <div className="min-h-0 flex-1 overflow-auto overscroll-contain" role="region" aria-label="Open maintenance records and approval actions" tabIndex={0}>
        {approvalError&&<p role="alert" className="mx-3 mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{approvalError}</p>}
        {approvalSuccess&&<p role="status" className="mx-3 mt-3 rounded-lg border border-[#D3EAD9] bg-[#F2FBF4] p-2.5 text-xs text-[#237442]">{approvalSuccess}</p>}
        <table className="w-full min-w-[570px] text-left text-[11px]">
            <thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase text-[#806A8C]">
            <tr className="border-b border-[#E9E1EE]">
                <th className="px-3 py-3 font-semibold">Equipment / Units</th>
                <th className="px-3 py-3 font-semibold">Issue / Schedule</th>
                <th className="px-2 py-3 font-semibold">Approval Status</th>
                <th className="px-3 py-3 text-center font-semibold">Action</th>
            </tr></thead>
            <tbody>
            {pendingObservations.map(observation=><tr key={`observed-${observation.allocationId}`}
                                                      className="border-b border-[#EFE8F2] align-top last:border-0">
                <td className="px-3 py-3">
                    <p className="font-semibold text-[#2B174C]">{observation.equipmentName}</p>
                    <p className="mt-1 text-[#776887]">{observation.observedDamagedUnits} possibly damaged {observation.observedDamagedUnits===1?"unit":"units"}</p>
                    <p className="mt-1 break-all text-[10px] text-[#5330B6]">Booking: {observation.bookingReference}</p>
                </td>
                <td className="px-3 py-3 text-[#5F4E75]">
                    <p className="break-words">Damage observed at return (not yet confirmed)</p>
                    {observation.notes&&<p className="mt-1 break-words text-[10px] text-[#86778F]" title={observation.notes}>{observation.notes}</p>}
                    <p className="mt-1 text-[10px] text-[#86778F]">Reported: <MaintenanceDate value={observation.reportedAt}/></p>
                </td>
                <td className="px-2 py-3">
                    <span className="inline-flex rounded-md bg-[#FFF2D7] px-2 py-1 text-[10px] font-semibold text-[#995F00]">Pending Staff Inspection</span>
                </td>
                <td className="px-3 py-3 text-center">
                    <span className="text-[11px] text-[#86778F]">Waiting for Staff inspection</span>
                </td>
            </tr>)}
            {prioritized.map(record=>{
                const stage=managerMaintenanceStage(record);
                return <tr key={record.id} className="border-b border-[#EFE8F2] align-top last:border-0">
                    <td className="px-3 py-3">
                        <p className="font-semibold text-[#2B174C]">{record.equipmentName}</p>
                        <p className="mt-1 text-[#776887]">{record.units} unit(s) on hold</p>
                        <p className="mt-0.5 text-[#9B8AAA]">Record #{record.id}</p>
                        {record.bookingReference&&<p className="mt-1 break-all text-[10px] text-[#5330B6]" title="Customer charge decisions are made from the booking's Billing tab">Booking: {record.bookingReference}</p>}
                    </td>
                    <td className="px-3 py-3 text-[#5F4E75]">
                        <p className="max-w-[210px] break-words" title={record.reason}>{record.reason||"No reason provided"}</p>
                        <p className="mt-1 text-[10px] text-[#86778F]">Reported: <MaintenanceDate value={record.dateReported}/></p>
                        {record.estimatedCompletion&&<p className="mt-0.5 text-[10px] text-[#86778F]">Estimated: <MaintenanceDate value={record.estimatedCompletion}/></p>}
                        {stage==="release"&&<p className="mt-1 text-[10px] text-[#5330B6]">{record.pendingCompletionUnits} unit(s) completed by Staff</p>}
                    </td>
                    <td className="px-2 py-3"><MaintenanceStageBadge record={record}/></td>
                    <td className="px-3 py-3 text-center">
                        {stage==="staff" ? <span className="text-[11px] text-[#86778F]">Waiting for Staff completion</span> :
                            <button type="button" disabled={saving||pendingId!==null||!canManage}
                                    onClick={()=>void approve(record)}
                                    title={!canManage?"Full Inventory access is required":undefined}
                                    className="inline-flex min-h-[35px] items-center justify-center rounded-lg bg-[#2B174C] px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-[#432569] disabled:cursor-not-allowed disabled:opacity-40">
                                {pendingId===record.id?"Saving…":stage==="release"?"Approve Stock Release":"Approve Repair"}
                            </button>}
                    </td>
                </tr>;
            })}</tbody>
        </table>
    </div>;
}
function MissingReviewRow({report,saving,canManage,onSave}:{
    report:import("@/hooks/useRentalInventory").RentalMissingReport;saving:boolean;canManage:boolean;
    onSave:(mutation:RentalMutation)=>Promise<void>;
}) {
    const [reviewOpen,setReviewOpen]=React.useState(false);
    const [resolution,setResolution]=React.useState<"found"|"writeoff"|null>(null);
    const [notes,setNotes]=React.useState("");
    const [confirmPermanentLoss,setConfirmPermanentLoss]=React.useState(false);
    const [error,setError]=React.useState("");
    const [submitting,setSubmitting]=React.useState(false);
    const reviewButtonRef=React.useRef<HTMLButtonElement>(null);
    const dialogRef=React.useRef<HTMLDivElement>(null);
    const closeButtonRef=React.useRef<HTMLButtonElement>(null);

    const close=()=>{
        if(submitting||saving)return;
        setReviewOpen(false);
        setError("");
        reviewButtonRef.current?.focus();
    };
    const open=()=>{
        if(!canManage||saving)return;
        setResolution(null);
        setNotes("");
        setConfirmPermanentLoss(false);
        setError("");
        setReviewOpen(true);
    };
    React.useEffect(()=>{
        if(reviewOpen)closeButtonRef.current?.focus();
    },[reviewOpen]);
    React.useEffect(()=>{
        if(!reviewOpen)return;
        const onKeyDown=(event:KeyboardEvent)=>{
            if(event.key==="Escape"){
                event.preventDefault();
                if(!submitting&&!saving){setReviewOpen(false);setError("");reviewButtonRef.current?.focus();}
            }
            if(event.key==="Tab"&&dialogRef.current){
                const controls=Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
                    'button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'
                )).filter(control=>control.getClientRects().length>0);
                if(!controls.length)return;
                const first=controls[0],last=controls[controls.length-1];
                if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
                else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
            }
        };
        document.addEventListener("keydown",onKeyDown);
        return ()=>document.removeEventListener("keydown",onKeyDown);
    },[reviewOpen,submitting,saving]);
    const resolve=async(event:React.FormEvent<HTMLFormElement>)=>{
        event.preventDefault();
        if(submitting||saving)return;
        if(!canManage){setError("Full Inventory access is required to resolve missing equipment.");return;}
        if(!resolution){setError("Choose whether the equipment was found or permanently lost.");return;}
        if(notes.trim().length<10){setError("Please provide at least 10 characters of notes.");return;}
        if(resolution==="writeoff"&&!confirmPermanentLoss){
            setError("Confirm that the loss is verified and recorded stock must be permanently reduced.");return;
        }
        setError("");
        setSubmitting(true);
        try{
            // Reuse the existing backend action, payload and Manager permission checks.
            await onSave({action:"resolve_missing_equipment",reportId:report.id,resolution,notes:notes.trim()});
            setReviewOpen(false);
        }catch(cause){
            setError(cause instanceof Error?cause.message:"Unable to resolve missing report.");
        }finally{setSubmitting(false);}
    };
    return <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E9E1EE] p-3 text-xs" style={{backgroundColor:"#FFF0F3"}}>
        <div className="min-w-0 flex-1">
            <strong className="text-[#2B174C]">{report.equipmentName} · {report.quantity} missing {report.quantity===1?"unit":"units"}</strong>
            <p className="mt-1 break-words text-[#86778F]">{report.reason}</p>
            {report.bookingReference&&<p className="mt-1 break-all text-[10px] text-[#5330B6]">Booking: {report.bookingReference} · After resolving the missing equipment, review any customer charge or waiver in Bookings → Billing.</p>}
        </div>
        <div className="flex items-center gap-3">
            <span className="rounded-full bg-[#FFF2DB] px-2.5 py-1 text-[10px] font-semibold text-[#996000]" style={{backgroundColor:"#FFDBE5",color:"#A52646"}}>Needs Review</span>
            <button ref={reviewButtonRef} type="button" disabled={saving||!canManage} onClick={open}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#2B174C] px-3 py-2 font-semibold text-white transition hover:bg-[#432569] disabled:cursor-not-allowed disabled:opacity-40">
                Review Missing Equipment <ArrowRight size={14} aria-hidden="true"/>
            </button>
        </div>
        {reviewOpen&&<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/55 p-3 sm:p-6" role="presentation">
            <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={`missing-review-title-${report.id}`}
                 aria-describedby={`missing-review-description-${report.id}`}
                 className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-2xl">
                <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div>
                        <h3 id={`missing-review-title-${report.id}`} className="text-lg font-bold text-[#21132E]">Resolve Missing Equipment</h3>
                        <p id={`missing-review-description-${report.id}`} className="mt-1 text-xs text-[#806A8C]">
                            {report.equipmentName} · {report.quantity} missing {report.quantity===1?"unit":"units"}
                        </p>
                    </div>
                    <button ref={closeButtonRef} type="button" onClick={close} disabled={saving||submitting} aria-label="Close missing equipment review"
                            className="rounded-lg border border-[#E6DDF0] p-2 text-[#5F4E75] hover:bg-[#F7F1FF] disabled:opacity-40"><X size={17}/></button>
                </div>
                <form onSubmit={event=>void resolve(event)} className="min-h-0 overflow-y-auto px-5 py-4">
                    {report.reason&&<p className="mb-4 rounded-lg border border-[#E9E1EE] bg-[#FFFCF8] p-3 text-xs text-[#695D75]">
                        <span className="font-semibold text-[#2B174C]">Reported reason: </span>{report.reason}
                    </p>}
                    <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm font-bold text-[#21132E]">Choose how to resolve this report</legend>
                        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${resolution==="found"?"border-[#9F88CF] bg-[#F7F1FF]":"border-[#E6DDF0] bg-white"}`}>
                            <input type="radio" name={`missing-resolution-${report.id}`} value="found" checked={resolution==="found"}
                                   onChange={()=>{setResolution("found");setConfirmPermanentLoss(false);setError("");}} disabled={saving||submitting}
                                   className="mt-0.5 accent-[#2B174C]"/>
                            <span><strong className="block text-sm text-[#21132E]">Mark as Found</strong>
                                <span className="mt-1 block text-xs leading-5 text-[#806A8C]">The missing equipment was located. Resolve the missing-unit report.</span></span>
                        </label>
                        <label className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${resolution==="writeoff"?"border-[#E4A3AE] bg-[#FFF8F8]":"border-[#E6DDF0] bg-white"}`}>
                            <input type="radio" name={`missing-resolution-${report.id}`} value="writeoff" checked={resolution==="writeoff"}
                                   onChange={()=>{setResolution("writeoff");setError("");}} disabled={saving||submitting}
                                   className="mt-0.5 accent-[#B62C42]"/>
                            <span><strong className="block text-sm text-[#21132E]">Confirm Permanent Loss</strong>
                                <span className="mt-1 block text-xs leading-5 text-[#806A8C]">The equipment could not be recovered. Permanently deduct the lost units from recorded stock.</span></span>
                        </label>
                    </fieldset>
                    <label className="mt-4 block text-xs font-semibold text-[#5A476A]" htmlFor={`missing-notes-${report.id}`}>Reason / Notes <span className="font-normal text-[#806A8C]">(at least 10 characters)</span></label>
                    <textarea id={`missing-notes-${report.id}`} rows={3} maxLength={400} value={notes}
                              onChange={event=>{setNotes(event.target.value);setError("");}} disabled={saving||submitting}
                              placeholder="Describe how the equipment was found or why the loss is confirmed."
                              className="mt-2 w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#21132E] outline-none focus:border-[#2B174C] focus:ring-1 focus:ring-[#2B174C] disabled:opacity-60"/>
                    {resolution==="writeoff"&&<div className="mt-3 rounded-xl border border-[#F0B7C2] bg-[#FFF4F6] p-3">
                        <div className="flex items-start gap-2 text-xs leading-5 text-[#9D2438]"><AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true"/>
                            <span>Permanent loss will reduce the recorded equipment quantity. Confirm the investigation before proceeding.</span>
                        </div>
                        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs font-semibold text-[#762339]">
                            <input type="checkbox" checked={confirmPermanentLoss} onChange={event=>setConfirmPermanentLoss(event.target.checked)}
                                   disabled={saving||submitting} className="mt-0.5 accent-[#B62C42]"/>
                            <span>I verified the loss and authorize the permanent stock adjustment.</span>
                        </label>
                    </div>}
                    {error&&<p role="alert" className="mt-3 text-xs font-semibold text-[#B62C42]">{error}</p>}
                    <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-[#E9E1EE] pt-4">
                        <button type="button" onClick={close} disabled={saving||submitting}
                                className="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2.5 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-40">Cancel</button>
                        <button type="submit" disabled={!canManage||saving||submitting||!resolution||notes.trim().length<10||(resolution==="writeoff"&&!confirmPermanentLoss)}
                                className={`rounded-xl px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${resolution==="writeoff"?"bg-[#B62C42] hover:bg-[#9C2137]":"bg-[#2B174C] hover:bg-[#432569]"}`}>
                            {submitting||saving?"Saving...":resolution==="found"?"Confirm Found":resolution==="writeoff"?"Confirm Permanent Loss":"Choose a resolution"}
                        </button>
                    </div>
                </form>
            </div>
        </div>}
    </div>;
}

function RetireEquipmentDialog({item,saving,close,onSave}:{
    item:RentalEquipment;saving:boolean;close:()=>void;onSave:(mutation:RentalMutation)=>Promise<void>;
}) {
    const [confirmName,setConfirmName]=React.useState("");
    const [reason,setReason]=React.useState("");
    const [error,setError]=React.useState("");
    const [submitting,setSubmitting]=React.useState(false);
    const blocked=item.rentedOutUnits>0||item.maintenanceUnits>0||item.missingUnits>0;
    const submit=async(event:React.FormEvent)=>{
        event.preventDefault();setError("");
        if(blocked){setError("Resolve rented-out, held or missing equipment first.");return;}
        if(confirmName.trim()!==item.name||reason.trim().length<10){setError("Type the exact equipment name and explain the deletion (10+ characters).");return;}
        setSubmitting(true);
        try{await onSave({action:"archive_equipment",equipmentId:item.id,confirmName,reason:reason.trim()});}
        catch(cause){setError(cause instanceof Error?cause.message:"Unable to delete equipment from the active catalog.");}
        finally{setSubmitting(false);}
    };
    return <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/50 p-4" role="presentation">
        <form role="dialog" aria-modal="true" aria-label="Delete rental equipment" onSubmit={submit}
              className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[#21132E]">Delete Rental Equipment</h3>
            <p className="text-sm text-[#5A476A]">Delete <strong>{item.name}</strong> from the active rental equipment list.
                To protect existing bookings and accounting records, the system keeps historical supplier payments, purchases, bookings, and audit entries.</p>
            {item.totalUnits>0&&<p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                {item.totalUnits} remaining units will be removed from available inventory with an audited stock adjustment.
                Only proceed if the equipment has actually been taken out of service.</p>}
            {blocked&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">Cannot delete equipment with rentals, holds, or missing units.</p>}
            <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Reason for deletion
                <textarea required rows={3} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)} className={rentalFieldClass} placeholder="Example: Equipment permanently retired after physical disposal"/></label>
            <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Type equipment name to confirm: {item.name}
                <input required value={confirmName} onChange={e=>setConfirmName(e.target.value)} className={rentalFieldClass}/></label>
            {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
            <div className="flex justify-end gap-2"><button type="button" onClick={close} disabled={submitting} className="rounded-lg border px-4 py-2 text-sm">Cancel</button>
                <button disabled={saving||submitting||blocked} className="rounded-lg bg-[#B62C42] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{submitting?"Deleting...":"Confirm Delete"}</button></div>
        </form>
    </div>;
}

function PanelHeading({title,subtitle,icon}:{title:string;subtitle:string;icon:React.ReactNode}) {
    return <div className="flex items-start gap-3 border-b border-[#E9E1EE] px-4 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]">{icon}</span>
        <div><h2 className="text-[15px] font-bold text-[#21132E]">{title}</h2>
            <p className="mt-0.5 text-[11px] text-[#86778F]">{subtitle}</p></div>
    </div>;
}
function EmptyPanel({label}:{label:string}) {
    return <div className="flex min-h-[156px] flex-col items-center justify-center gap-2 px-5 py-8 text-center">
        <Boxes size={24} className="text-[#9C8EB8]"/><p className="text-xs text-[#86778F]">{label}</p></div>;
}
function PanelSkeleton() {
    return <div aria-label="Loading rental inventory" className="space-y-3 px-4 py-5">
        {[0,1,2].map(index => <div key={index} className="h-8 animate-pulse rounded-lg bg-[#F3EFF8]"/>)}
    </div>;
}
function RentalMetric({label,value,description,icon,tone,loading}:{
    label:string;value:RentalSummary[keyof RentalSummary];description:string;
    icon:React.ReactNode;tone:"purple"|"green"|"blue"|"amber";loading:boolean;
}) {
    const toneStyle = {
        purple:"bg-[#F1ECFF] text-[#5F35D8]",green:"bg-[#E5F8EC] text-[#23834A]",
        blue:"bg-[#E9F2FF] text-[#1E6FE8]",amber:"bg-[#FFF3DE] text-[#E68A00]",
    }[tone];
    return <section className="rounded-2xl border border-[#E7DFEC] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div>
            <p className="text-sm font-bold text-[#21132E]">{label}</p>
            {loading ? <div className="mt-2 h-8 w-16 animate-pulse rounded bg-[#F3EFF8]"/> :
                <p className="mt-2 text-[27px] font-bold leading-none text-[#4E2C66]">{value === null ? "—" : value.toLocaleString("en-PH")}</p>}
            <p className="mt-1.5 text-[11px] leading-4 text-[#86778F]">{description}</p>
        </div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${toneStyle}`}>{icon}</span></div>
    </section>;
}
const activityNames:Record<RentalActivity["type"],string> = {
    received:"Stock Received",rented_out:"Rented Out",returned:"Returned",
    maintenance_started:"Maintenance",maintenance_completed:"Repair Completed",
    missing_reported:"Missing",missing_resolved:"Found",adjustment:"Stock Adjustment",
};
function ActivityRow({item}:{item:RentalActivity}) {
    const isPositive = ["received", "returned", "maintenance_completed", "missing_resolved"].includes(item.type);
    const when = new Date(item.occurredAt);
    return <tr className="border-b border-[#EFE8F2] last:border-0">
        <td className="whitespace-nowrap px-3 py-2.5 text-[#5F4E75]">
            {when.toLocaleDateString("en-PH",{timeZone:"Asia/Manila",month:"short",day:"numeric",year:"numeric"})}
            <div className="mt-0.5 text-[10px] text-[#8A7D90]">{when.toLocaleTimeString("en-PH",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit"})}</div>
        </td>
        <td className="px-3 py-2.5 font-semibold text-[#2B174C]">{item.equipmentName}</td>
        <td className="px-3 py-2.5 text-[#4F3A5A]">{activityNames[item.type]}</td>
        <td className={`px-2 py-2.5 text-center font-semibold ${isPositive ? "text-[#23834A]" : "text-[#D92C3F]"}`}>
            {isPositive ? "+" : "−"}{item.quantity}
        </td>
        <td className="break-all px-3 py-2.5 text-[#5F4E75]">{item.referenceNumber || "—"}</td>
    </tr>;
}

type EditorMode = "add"|"edit"|"receive"|"maintenance"|"review";
/* Add/Edit follows Sales Inventory's sections, spacing, category dropdown,
 * pricing and supplier confirmation. Rentals have no variants or reorder point. */
const rentalFieldClass = "w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] placeholder:text-[#9B8AAA] focus:border-[#2B174C] focus:outline-none focus:ring-1 focus:ring-[#2B174C]";
const rentalLabelClass = "text-xs font-semibold text-[#5A476A]";
function validRentalMoney(value:string) {
    return /^\d+(?:\.\d{1,2})?$/.test(value.trim()) && Number(value) <= 100000000;
}
function rentalToday() { return new Date().toLocaleDateString("sv-SE",{timeZone:"Asia/Manila"}); }
function validRentalDate(value:string) {
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const parsed=new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
function EquipmentDialog({mode,item,close,onNavigate,onSave,saving,categories}:{
    mode:EditorMode;item:RentalEquipment|null;close:()=>void;
    onNavigate:(mode:EditorMode)=>void;onSave:(mutation:RentalMutation)=>Promise<void>;saving:boolean;
    categories:string[];
}) {
    const [name,setName]=React.useState(item?.name||"");
    const [category,setCategory]=React.useState(item?.category||"");
    const [quantity,setQuantity]=React.useState(mode==="add"?"0":"");
    const [supplier,setSupplier]=React.useState("");
    const [invoice,setInvoice]=React.useState("");
    const [date,setDate]=React.useState(rentalToday);
    const [unitCost,setUnitCost]=React.useState("");
    const [rentalRate,setRentalRate]=React.useState(item?.rentalRatePerDay==null?"":String(item.rentalRatePerDay));
    const [paymentMethod,setPaymentMethod]=React.useState<"cash"|"credit">("cash");
    const [amountPaid,setAmountPaid]=React.useState("0");
    const [dueDate,setDueDate]=React.useState("");
    const [reason,setReason]=React.useState("");
    const [maintenanceMode,setMaintenanceMode]=React.useState<"start"|"complete">("start");
    const [conditionStatus,setConditionStatus]=React.useState<"In Repair"|"For Inspection">("In Repair");
    const [estimatedCompletionDate,setEstimatedCompletionDate]=React.useState("");
    const [error,setError]=React.useState("");
    const [pending,setPending]=React.useState<RentalMutation|null>(null);
    const [submitting,setSubmitting]=React.useState(false);
    const submittingRef=React.useRef(false);
    const qty=Number(quantity);
    const limited=maintenanceMode==="start"?(item?availableNow(item):0):(item?.maintenanceUnits??0);
    const purchaseVisible=mode==="receive"||(mode==="add"&&qty>0);
    const purchaseTotal=qty*Number(unitCost||0);
    const purchasePaid=paymentMethod==="cash"?purchaseTotal:Number(amountPaid||0);
    const balance=Math.round((purchaseTotal-purchasePaid)*100)/100;
    const title=mode==="add"?"Add Rental Product":mode==="edit"?"Edit Rental Product":
        mode==="receive"?"Restock Rental Equipment":mode==="maintenance"?"Manage Maintenance":"Equipment Stock Review";

    const purchaseDetails=():RentalPurchaseDetails|null=>{
        if(!Number.isSafeInteger(qty)||qty<1||qty>2147483647||!supplier.trim()||
            supplier.trim().length>150||!validRentalDate(date)||date>rentalToday()||!validRentalMoney(unitCost)){
            setError("Enter a valid received quantity, supplier, date (not future), and unit cost.");return null;
        }
        if(paymentMethod==="credit"&&(!validRentalMoney(amountPaid)||purchasePaid>purchaseTotal)){
            setError("Amount Paid must be between zero and the total purchase cost.");return null;
        }
        if(!Number.isSafeInteger(Math.round(purchaseTotal*100))||purchaseTotal>100000000000){
            setError("The purchase total is too large.");return null;
        }
        if(paymentMethod==="credit"&&balance>0&&(!validRentalDate(dueDate)||dueDate<date)){
            setError("An outstanding credit purchase needs a due date on or after the purchase date.");return null;
        }
        return {quantity:qty,unitCost:Number(unitCost),supplier:supplier.trim(),
            supplierInvoiceNumber:invoice.trim()||undefined,purchaseDate:date,
            paymentMethod,amountPaid:Math.round(purchasePaid*100)/100,
            paymentDueDate:paymentMethod==="credit"&&balance>0?dueDate:null};
    };
    const prepare=(event:React.FormEvent)=>{
        event.preventDefault();setError("");if(saving||submitting||pending)return;
        let mutation:RentalMutation;
        if(mode==="add"||mode==="edit"){
            if(!name.trim()||name.trim().length>150||!category.trim()){
                setError("Enter a product name and select a category.");return;
            }
            if(!validRentalMoney(rentalRate)){
                setError("Rental Rate per day must be a nonnegative amount with up to two decimals.");return;
            }
            if(mode==="add"){
                if(!Number.isSafeInteger(qty)||qty<0||qty>2147483647){
                    setError("Stock must be a nonnegative whole number.");return;
                }
                const purchase=qty>0?purchaseDetails():undefined;
                if(qty>0&&!purchase)return;
                mutation={action:"create_equipment",name:name.trim(),category:category.trim(),
                    alertLevel:0,rentalRatePerDay:Number(rentalRate), pricingMethod:"manual",
                    ...(purchase?{initialPurchase:purchase}:{})};
            }else{
                mutation={action:"update_equipment",equipmentId:item!.id,name:name.trim(),category:category.trim(),
                    alertLevel:item!.alertLevel,rentalRatePerDay:Number(rentalRate), pricingMethod:"manual"};
            }
        }else if(mode==="receive"&&item){
            const purchase=purchaseDetails();if(!purchase)return;
            mutation={action:"receive_equipment",equipmentId:item.id,...purchase};
        }else if(mode==="maintenance"&&item){
            if(!Number.isSafeInteger(qty)||qty<1||qty>limited||reason.trim().length<5){
                setError(`Enter 1–${limited} units and a reason of at least 5 characters.`);return;
            }
            if(maintenanceMode==="start" && estimatedCompletionDate &&
                (!validRentalDate(estimatedCompletionDate) || estimatedCompletionDate<rentalToday())){
                setError("Estimated completion must be today or a future date.");return;
            }
            mutation=maintenanceMode==="start"
                ? {action:"start_maintenance",equipmentId:item.id,quantity:qty,reason:reason.trim(),
                    conditionStatus,estimatedCompletionDate:estimatedCompletionDate||null}
                : {action:"complete_maintenance",equipmentId:item.id,quantity:qty,reason:reason.trim()};
        }else{return;}
        setPending(mutation);
    };
    const confirm=async()=>{
        if(!pending||submittingRef.current||saving)return;
        submittingRef.current=true;setSubmitting(true);setError("");
        try{await onSave(pending);setPending(null);}
        catch(cause){setPending(null);setError(cause instanceof Error?cause.message:"Unable to save equipment.");}
        finally{submittingRef.current=false;setSubmitting(false);}
    };
    const btn="rounded-xl bg-[#2B174C] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-40";
    return <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 px-3 py-4 backdrop-blur-sm" role="presentation">
        <div role="dialog" aria-modal="true" aria-label={title} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-[#E6DDF0] px-5 py-4 sm:px-6">
                <h2 className="text-[18px] font-bold text-[#1A1220]">{title}</h2>
                <button type="button" onClick={close} disabled={submitting} aria-label="Close" className="text-[#9B8AAA] hover:text-[#1A1220]"><X size={20}/></button>
            </div>
            <form onSubmit={prepare} className="min-h-0 space-y-5 overflow-y-auto p-5 sm:p-6">
                {item&&<div className="rounded-xl bg-[#F7F1FF] px-3 py-2 text-xs font-semibold text-[#4E2C66]">Equipment No.: {item.equipmentNumber} · {item.name}</div>}
                {mode==="review"&&item&&<>
                    <h3 className="text-sm font-bold text-[#1A1220]">Rental Equipment Summary</h3>
                    <div className="grid gap-3 rounded-xl border border-[#E6DDF0] bg-[#FFFCF7] p-4 sm:grid-cols-3">
                        {[["Total Units",item.totalUnits],["Available Now",availableNow(item)],
                            ["Rented Out",item.rentedOutUnits],["Under Maintenance",item.maintenanceUnits],
                            ["Missing Units",item.missingUnits],["Rental Rate / Day",peso(item.rentalRatePerDay)],
                            ["Average Unit Cost",peso(item.averageUnitCost)],["Last Supplier",item.lastSupplier||"—"]].map(([label,value])=><div key={label}>
                            <p className="text-xs text-[#86778F]">{label}</p><strong className="text-sm text-[#2B174C]">{value}</strong></div>)}
                    </div>
                    <p className="mb-3 text-xs text-[#86778F]">Pricing: {item.pricingMethod==="cost_based"?"Suggested Cost-Based Rate":"Manual Rental Rate"}. Daily rates are reviewed by the manager; equipment age does not automatically reduce customer charges.</p>
                    {hasRentalStockDiscrepancy(item)&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">Assigned units exceed physical stock. Review booking, repair and missing records before correcting.</p>}
                    <p className="text-xs text-[#86778F]">Staff handle rental check-outs and returns through the booking workflow. The manager maintains equipment, pricing and repairs.</p>
                    <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={()=>onNavigate("edit")} className={btn}><Pencil size={14} className="mr-1 inline"/> Edit Product</button>
                        <button type="button" onClick={()=>onNavigate("receive")} className={btn}><PackagePlus size={14} className="mr-1 inline"/> Restock Equipment</button>
                        <button type="button" onClick={()=>onNavigate("maintenance")} className={btn}><Wrench size={14} className="mr-1 inline"/> Maintenance</button>
                    </div>
                </>}
                {(mode==="add"||mode==="edit")&&<>
                    <h3 className="text-sm font-bold text-[#1A1220]">Product Information</h3>
                    <div className="space-y-1"><label className={rentalLabelClass}>Rental Product Name</label>
                        <input required maxLength={150} value={name} onChange={e=>setName(e.target.value)} className={rentalFieldClass} placeholder="Enter rental product name"/></div>
                    <div className="space-y-1"><label className={rentalLabelClass}>Category</label>
                        <select required value={category} onChange={e=>setCategory(e.target.value)} className={rentalFieldClass}>
                            <option value="">Select category</option>{categories.map(value=><option key={value} value={value}>{value}</option>)}
                        </select>
                        {categories.length===0&&<p className="text-xs text-[#9B8AAA]">Create a rental category in Manage Categories first.</p>}
                    </div>
                    <h3 className="border-t border-[#E6DDF0] pt-5 text-sm font-bold text-[#1A1220]">Inventory &amp; Pricing</h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1"><label className={rentalLabelClass}>Stock (Units)</label>
                            <input type="number" min="0" step="1" required readOnly={mode==="edit"} value={mode==="edit"?item?.totalUnits??0:quantity}
                                   title={mode==="edit"?"Record a supplier purchase and have Staff confirm its physical receipt":undefined}
                                   onChange={e=>setQuantity(e.target.value)} className={rentalFieldClass}/>
                            {mode==="edit"&&<p className="text-xs text-[#9B8AAA]">Stock is read-only here. Stock is updated only when Staff confirms the physical receipt.</p>}
                        </div>
                        {mode==="add"&&<div className="space-y-1"><label className={rentalLabelClass}>Cost Price (₱ / unit)</label>
                            <input type="number" min="0" step="0.01" required={qty>0} disabled={qty===0} value={unitCost} onChange={e=>setUnitCost(e.target.value)} className={rentalFieldClass} placeholder="0.00"/>
                            <p className="text-xs text-[#9B8AAA]">Purchase cost, not the rental charge.</p></div>}
                        {mode==="edit"&&<div className="space-y-1"><label className={rentalLabelClass}>Average Unit Cost</label>
                            <input readOnly className={`${rentalFieldClass} bg-[#F7F1FF]`} value={peso(item?.averageUnitCost)}/></div>}
                        <div className="space-y-1 sm:col-span-2"><label className={rentalLabelClass}>Final Daily Rental Rate (₱ for one item)</label>
                            <input type="number" min="0" max="100000000" step="0.01" required value={rentalRate}
                                   onChange={e=>setRentalRate(e.target.value)}
                                   className={rentalFieldClass} placeholder="Enter daily rental rate"/>
                            <p className="text-xs text-[#9B8AAA]">Charge for ONE item for ONE day. For example, 10 tables × this daily price × 2 days. Set your business's daily rental price; confirmed past bookings aren't repriced.</p>
                        </div>
                    </div>
                    {mode==="edit"&&<p className="text-xs text-[#86778F]">Supplier purchasing history is not edited here. Use the Restock action in the equipment list to record new purchases; Staff verifies the delivered units.</p>}
                    {mode==="add"&&qty===0&&<p className="rounded-xl bg-[#FFFCF7] p-3 text-xs text-[#86778F]">Zero opening stock: you can create a catalog item without a purchase cost and receive equipment later.</p>}
                </>}
                {mode==="maintenance"&&item&&<>
                    <h3 className="text-sm font-bold text-[#1A1220]">Equipment Inspection &amp; Repair</h3>
                    <div className="space-y-1"><label className={rentalLabelClass}>Maintenance Action</label>
                        <select className={rentalFieldClass} value={maintenanceMode} onChange={e=>{setMaintenanceMode(e.target.value as "start"|"complete");setQuantity("");}}>
                            <option value="start">Move available units into maintenance</option><option value="complete">Return repaired units to available</option>
                        </select></div>
                    <p className="text-xs text-[#86778F]">Maximum eligible units: {limited}. Checked-out and missing equipment cannot enter maintenance.</p>
                    <div className="space-y-1"><label className={rentalLabelClass}>Quantity</label>
                        <input type="number" min="1" max={limited} required step="1" className={rentalFieldClass} value={quantity} onChange={e=>setQuantity(e.target.value)}/></div>
                    <div className="space-y-1"><label className={rentalLabelClass}>Inspection / Repair Notes</label>
                        <textarea required className={`${rentalFieldClass} min-h-24`} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Reason and inspection details"/></div>
                    {maintenanceMode==="start"&&<div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1"><label className={rentalLabelClass}>Condition Status</label>
                            <select className={rentalFieldClass} value={conditionStatus} onChange={e=>setConditionStatus(e.target.value as typeof conditionStatus)}>
                                <option value="In Repair">In Repair</option><option value="For Inspection">For Inspection</option>
                            </select></div>
                        <div className="space-y-1"><label className={rentalLabelClass}>Estimated Completion (Optional)</label>
                            <input type="date" min={rentalToday()} className={rentalFieldClass}
                                   value={estimatedCompletionDate} onChange={e=>setEstimatedCompletionDate(e.target.value)}/>
                        </div>
                    </div>}
                </>}
                {purchaseVisible&&<section className="space-y-3 border-t border-[#E6DDF0] pt-5">
                    <h3 className="text-sm font-bold text-[#1A1220]">{mode==="receive"?"Supplier & Purchase Details":"Initial Purchase Details"}</h3>
                    <p className="text-xs text-[#806A8C]">Purchase totals and supplier balances are transaction records; changing equipment details will not rewrite previous purchases.</p>
                    {mode==="receive"&&<div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1"><label className={rentalLabelClass}>Units to Purchase</label><input required type="number" min="1" step="1" className={rentalFieldClass} value={quantity} onChange={e=>setQuantity(e.target.value)}/></div>
                        <div className="space-y-1"><label className={rentalLabelClass}>Unit Purchase Cost (₱)</label><input required type="number" min="0" step="0.01" className={rentalFieldClass} value={unitCost} onChange={e=>setUnitCost(e.target.value)}/></div>
                    </div>}
                    <div className="space-y-1"><label className={rentalLabelClass}>Supplier</label><input required maxLength={150} value={supplier} onChange={e=>setSupplier(e.target.value)} className={rentalFieldClass} placeholder="Enter supplier name"/></div>
                    <div className="space-y-1"><label className={rentalLabelClass}>Supplier Invoice Number (Optional)</label><input maxLength={80} value={invoice} onChange={e=>setInvoice(e.target.value)} className={rentalFieldClass} placeholder="Enter supplier invoice or receipt number"/></div>
                    <div className="space-y-1"><label className={rentalLabelClass}>Purchase Date</label><input type="date" max={rentalToday()} required className={rentalFieldClass} value={date} onChange={e=>setDate(e.target.value)}/></div>
                    <div className="space-y-1"><label className={rentalLabelClass}>Payment Method</label>
                        <div className="grid grid-cols-2 gap-2">{(["cash","credit"] as const).map(method=><button type="button" key={method} onClick={()=>setPaymentMethod(method)}
                                                                                                                  className={`rounded-xl border px-4 py-3 text-sm font-semibold ${paymentMethod===method?"border-[#2B174C] bg-[#F1EBFF] text-[#2B174C]":"border-[#E3D8EA] bg-white text-[#86778F]"}`}>{method==="cash"?"Cash (Paid in Full)":"Credit (Unpaid / Partial)"}</button>)}</div>
                    </div>
                    <div className="grid gap-3 rounded-xl bg-[#F7F1FF] p-4 sm:grid-cols-3">
                        <div><p className="text-xs text-[#806A8C]">Purchase Total</p><strong className="text-lg text-[#2B174C]">{Number.isFinite(purchaseTotal)?peso(purchaseTotal):"—"}</strong></div>
                        <div><p className="text-xs text-[#806A8C]">Amount Paid</p><strong className="text-lg text-[#2B174C]">{Number.isFinite(purchasePaid)?peso(purchasePaid):"—"}</strong></div>
                        <div><p className="text-xs text-[#806A8C]">Outstanding Balance</p><strong className="text-lg text-[#2B174C]">{Number.isFinite(balance)?peso(balance):"—"}</strong></div>
                    </div>
                    {paymentMethod==="credit"&&<div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1"><label className={rentalLabelClass}>Amount Paid (₱)</label><input required type="number" min="0" step="0.01" className={rentalFieldClass} value={amountPaid} onChange={e=>setAmountPaid(e.target.value)}/></div>
                        <div className="space-y-1"><label className={rentalLabelClass}>Payment Due Date</label><input type="date" min={date||undefined} required={balance>0} className={rentalFieldClass} value={dueDate} onChange={e=>setDueDate(e.target.value)}/></div>
                    </div>}
                </section>}
                {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
                <div className="flex justify-end gap-2 border-t border-[#E6DDF0] pt-4">
                    <button type="button" disabled={submitting} onClick={close} className="rounded-xl border border-[#E6DDF0] px-5 py-3 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]">{mode==="review"?"Close":"Cancel"}</button>
                    {mode!=="review"&&<button type="submit" disabled={saving||submitting||(mode==="maintenance"&&limited===0)} className={btn}>
                        {mode==="add"?"Save Product":mode==="edit"?"Update Product":mode==="receive"?"Record Restock":"Save Maintenance"}</button>}
                </div>
            </form>
        </div>
        {pending&&<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 p-4" role="presentation">
            <div role="alertdialog" aria-modal="true" aria-label="Confirm rental inventory changes" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow-2xl">
                <h3 className="text-lg font-bold text-[#1A1220]">{mode==="add"?"Confirm Add Product":mode==="edit"?"Confirm Update":mode==="receive"?"Confirm Purchase":"Confirm Maintenance"}</h3>
                <p className="text-sm text-[#6A5D6F]">{mode==="add"?`Add ${name.trim()} to rental inventory?`:mode==="edit"?`Save the changes to ${name.trim()}?`:mode==="receive"?`Record an order for ${qty} unit(s) of ${item?.name}? Staff will confirm physical receipt later.`:`Record this maintenance action for ${item?.name}?`}</p>
                <p className="text-xs text-[#806A8C]">Physical stock and supplier transactions will be confirmed by the Rental backend, not generated by the interface.</p>
                <div className="flex justify-end gap-2"><button type="button" disabled={submitting} onClick={()=>setPending(null)} className="rounded-xl border border-[#E6DDF0] px-4 py-2 text-sm">Back</button>
                    <button type="button" disabled={saving||submitting} onClick={()=>void confirm()} className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{submitting?"Saving...":"Confirm"}</button></div>
            </div>
        </div>}
    </div>;
}

/* -------------------------------------------------------------------------- */
/*    RENTAL INVENTORY IMPORT / CATEGORIES / EXPORT — SALES DATA UNTOUCHED     */
/* -------------------------------------------------------------------------- */

function peso(value:number|null|undefined) {
    return value == null ? "—" : `₱${value.toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

type RentalExportFilters = {
    category:string;status:string;appliedDates:{from:string;to:string}|null;
};
function rentalReportRows(items:RentalEquipment[],filters:RentalExportFilters,availability:Map<number,number>|null) {
    const headings = ["Equipment No.","Rental Product","Category","Last Supplier","Avg. Unit Cost (PHP)",
        "Rental Rate / Day (PHP)","Total Units","Available Now",
        ...(filters.appliedDates?["Available in Selected Dates"]:[]),
        "Rented Out","Maintenance","Missing","Availability","Condition / Alert"];
    const rows = items.map(item => [item.equipmentNumber||"—",item.name,item.category,item.lastSupplier||"—",
        item.averageUnitCost??"—",item.rentalRatePerDay??"—",item.totalUnits,availableNow(item),
        ...(filters.appliedDates?[availability?.get(item.id)??"—"]:[]),
        item.rentedOutUnits,item.maintenanceUnits,item.missingUnits,
        equipmentDisplayStatus(item,Boolean(filters.appliedDates),availability?.get(item.id)),
        equipmentConditionLabels(item).join(", ")||"—"]);
    return {headings,rows};
}
function rentalFilename(ext:"xlsx"|"pdf") {
    const d=new Date();
    return `StockNBook_Rental_Inventory_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}.${ext}`;
}
function exportRentalExcel(items:RentalEquipment[],filters:RentalExportFilters,availability:Map<number,number>|null) {
    const {headings,rows}=rentalReportRows(items,filters,availability);
    const meta:(string|number)[][] = [
        ["StockNBook — Branch Rental Inventory"],
        ["Category Filter",filters.category],
        ["Status Filter",filters.status],
        ["Availability Dates",filters.appliedDates?`${filters.appliedDates.from} to ${filters.appliedDates.to}`:"Not applied"],
        ["Availability Scope",filters.appliedDates?"Selected booking dates":"Physical stock now"],
        ["Exported On",new Date().toLocaleString("en-PH")],
        ["Matching Equipment",items.length],[],headings,...rows,
    ];
    const sheet=XLSX.utils.aoa_to_sheet(meta);
    sheet["!cols"]=headings.map((_,i)=>({wch:[21,34,24,28,23,24,16,18,22,16,16,15,23,24][i]||18}));
    const book=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book,sheet,"Rental Inventory");
    XLSX.writeFile(book,rentalFilename("xlsx"),{bookType:"xlsx"});
}

// Direct downloadable PDF, using the same built-in canvas/JPEG approach as Sales;
// intentionally does not require another library or a browser print dialog.
function exportRentalPdf(items:RentalEquipment[],filters:RentalExportFilters,availability:Map<number,number>|null) {
    const {headings,rows}=rentalReportRows(items,filters,availability);
    const pageWidth=1190.55,pageHeight=841.89,scale=1.5,pad=3,lineHeight=11;
    const canvas=document.createElement("canvas");
    canvas.width=Math.round(pageWidth*scale);canvas.height=Math.round(pageHeight*scale);
    const context=canvas.getContext("2d");
    if(!context) throw new Error("PDF export is unavailable in this browser.");
    const ctx:CanvasRenderingContext2D=context;
    ctx.setTransform(scale,0,0,scale,0,0);
    const margin=25,tableWidth=pageWidth-2*margin;
    const baseWidths=filters.appliedDates?[95,150,94,105,78,85,62,72,78,60,72,53,90,93]:
        [105,160,105,115,85,90,67,77,66,74,59,90,93];
    const totalBase=baseWidths.reduce((a,b)=>a+b,0);
    const widths=baseWidths.map(w=>w/totalBase*tableWidth);
    function wrapCell(v:unknown,w:number) {
        const text=String(v??"—").replace(/\s+/g," ").trim()||"—";
        const lines:string[]=[];let line="";
        for(const word of text.split(" ")){
            const candidate=line?`${line} ${word}`:word;
            if(ctx.measureText(candidate).width<=w){line=candidate;continue;}
            if(line){lines.push(line);line="";}
            for(const c of word){if(line && ctx.measureText(line+c).width>w){lines.push(line);line="";}line+=c;}
        }
        if(line)lines.push(line);
        return lines.length?lines:["—"];
    }
    ctx.font="9px Arial,sans-serif";
    const cells=[headings,...rows].map((row,index)=>{
        ctx.font=index===0?"bold 8px Arial,sans-serif":"9px Arial,sans-serif";
        const wrapped=row.map((value,i)=>wrapCell(value,widths[i]-2*pad));
        const height=Math.max(24,Math.max(...wrapped.map(lines=>lines.length))*lineHeight+8);
        return {wrapped,height};
    });
    const top=125,limit=pageHeight-50;
    const grouped:Array<typeof cells>=[];
    const header=cells[0];
    let segment:typeof cells=[header];let used=top+header.height;
    for(const cell of cells.slice(1)){
        if(used+cell.height>limit && segment.length>1){
            grouped.push(segment);segment=[header];used=top+header.height;
        }
        segment.push(cell);used+=cell.height;
    }
    grouped.push(segment);
    const images:Uint8Array[]=[];
    grouped.forEach((page,pageIndex)=>{
        ctx.fillStyle="#FFFFFF";ctx.fillRect(0,0,pageWidth,pageHeight);
        ctx.fillStyle="#2B174C";ctx.font="bold 18px Arial,sans-serif";
        ctx.fillText("StockNBook — Branch Rental Inventory",margin,34);
        ctx.font="10px Arial,sans-serif";
        ctx.fillText(`Category: ${filters.category}  |  Status: ${filters.status}  |  Equipment: ${items.length}`,margin,57);
        ctx.fillText(`Availability: ${filters.appliedDates?`${filters.appliedDates.from} to ${filters.appliedDates.to} (confirmed bookings)`:"Physical stock now"}`,margin,75);
        ctx.fillText(`Generated: ${new Date().toLocaleString("en-PH")}`,margin,92);
        let y=top;
        page.forEach((cell,index)=>{
            const isHeading=index===0;
            ctx.fillStyle=isHeading?"#F1EBFF":index%2?"#FAF8FD":"#FFFFFF";
            ctx.fillRect(margin,y,tableWidth,cell.height);
            let x=margin;
            cell.wrapped.forEach((lines,i)=>{
                ctx.strokeStyle="#E3D8EA";ctx.lineWidth=0.5;
                ctx.strokeRect(x,y,widths[i],cell.height);
                ctx.fillStyle=isHeading?"#4E2C66":"#21132E";
                ctx.font=isHeading?"bold 8px Arial,sans-serif":"9px Arial,sans-serif";
                lines.forEach((line,j)=>ctx.fillText(line,x+pad,y+12+j*lineHeight));
                x+=widths[i];
            });
            y+=cell.height;
        });
        ctx.fillStyle="#806A8C";ctx.font="10px Arial,sans-serif";
        ctx.fillText(`Page ${pageIndex+1} of ${grouped.length}`,margin,pageHeight-20);
        const bin=atob(canvas.toDataURL("image/jpeg",0.87).split(",")[1]);
        const bytes=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
        images.push(bytes);
    });
    const encoder=new TextEncoder(),chunks:BlobPart[]=[],offsets:number[]=[];
    let written=0;
    function write(part:string|Uint8Array){const data=typeof part==="string"?encoder.encode(part):part;
        chunks.push(data as BlobPart);written+=data.byteLength;}
    function object(id:number,writer:()=>void){offsets[id]=written;write(`${id} 0 obj\n`);writer();write("\nendobj\n");}
    write("%PDF-1.4\n%StockNBook\n");
    object(1,()=>write("<< /Type /Catalog /Pages 2 0 R >>"));
    const refs=images.map((_,i)=>`${3+i*3} 0 R`).join(" ");
    object(2,()=>write(`<< /Type /Pages /Kids [${refs}] /Count ${images.length} >>`));
    images.forEach((jpeg,i)=>{
        const id=3+i*3,imageId=id+1,streamId=id+2;
        object(id,()=>write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /PageImage ${imageId} 0 R >> >> /Contents ${streamId} 0 R >>`));
        object(imageId,()=>{write(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);write(jpeg);write("\nendstream");});
        const stream=`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/PageImage Do\nQ\n`;
        object(streamId,()=>write(`<< /Length ${encoder.encode(stream).length} >>\nstream\n${stream}endstream`));
    });
    const count=images.length*3+2,xref=written;
    write(`xref\n0 ${count+1}\n0000000000 65535 f \n`);
    for(let i=1;i<=count;i++)write(`${String(offsets[i]).padStart(10,"0")} 00000 n \n`);
    write(`trailer\n<< /Size ${count+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    const url=URL.createObjectURL(new Blob(chunks,{type:"application/pdf"}));
    const link=document.createElement("a");link.href=url;link.download=rentalFilename("pdf");
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}

/* SAME SALES WORKFLOW: select XLSX → preview → confirm. One purchase per
 * workbook, not one purchase per equipment row. No variants / reorder point. */
const RENTAL_EQUIPMENT_HEADERS = ["Equipment Name","Category","Stock","Unit Purchase Cost (₱)","Rental Rate Per Day (₱)"];
const RENTAL_PRICING_HEADERS = ["Pricing Method","Target Paid Rental Days to Recover Cost","Residual Value (₱)","Operating Cost / Paid Day (₱)","Target Margin (%)"];
const LEGACY_PRICING_HEADERS = ["Pricing Method","Useful Life (Years)","Paid Rental Days / Year","Residual Value (₱)","Operating Cost / Paid Day (₱)","Target Margin (%)"];
const RENTAL_PURCHASE_HEADERS = ["Supplier","Supplier Invoice Number (Optional)","Purchase Date","Payment Method","Amount Paid (₱)","Payment Due Date"];
type ParsedRentalImport = {rows:RentalImportRow[];purchase:RentalBulkPurchase;purchaseTotal:number;outstandingBalance:number};
function downloadRentalTemplate() {
    const workbook=XLSX.utils.book_new();
    const lines=XLSX.utils.aoa_to_sheet([[...RENTAL_EQUIPMENT_HEADERS,...RENTAL_PRICING_HEADERS],
        ["Folding Chair","Chairs",50,300,"","Cost-Based",30,0,4,30],
        ["Round Table","Tables",10,1800,"","Cost-Based",45,200,12,30]]);
    lines["!cols"]=[{wch:35},{wch:24},{wch:17},{wch:28},{wch:29},...RENTAL_PRICING_HEADERS.map(()=>({wch:25}))];
    XLSX.utils.book_append_sheet(workbook,lines,"RENTAL EQUIPMENT");
    const purchase=XLSX.utils.aoa_to_sheet([RENTAL_PURCHASE_HEADERS,
        ["Example Supplier","INV-001",rentalToday(),"Cash","",""]]);
    purchase["!cols"]=[{wch:30},{wch:35},{wch:20},{wch:22},{wch:21},{wch:22}];
    XLSX.utils.book_append_sheet(workbook,purchase,"PURCHASE DETAILS");
    const instructions=XLSX.utils.aoa_to_sheet([
        ["StockNBook — Rental Inventory Import Format"],
        ["1. One workbook is ONE supplier purchase (same as Sales Inventory)."],
        ["2. Put each distinct equipment product on one row of RENTAL EQUIPMENT."],
        ["3. Stock is the quantity physically received. All rows must have positive stock."],
        ["4. Cost is what you paid PER UNIT. Rental Rate is the fee PER UNIT PER DAY."],
        ["5. Provide only ONE supplier/payment row on PURCHASE DETAILS."],
        ["6. Cash means fully paid; leave Amount Paid blank. Credit may be unpaid or partially paid."],
        ["7. For an unpaid credit purchase, fill a payment due date."],
        ["8. Dates: YYYY-MM-DD. Do not add variants or Reorder Point fields."],
        ["9. Replace the sample rows with your own data; do not keep the examples."],
        ["10. Use Add Rental Product for zero-stock catalogue entries."],
        ["11. New rental equipment defaults to Cost-Based pricing. Manual remains available."],
        ["11a. Legacy five-column XLSX files still use Manual pricing to preserve the prices entered in those files."],
        ["11b. In this updated format, leave Pricing Method and Rental Rate blank to select Cost-Based pricing, but fill the recovery target and other required inputs."],
        ["12. Manual requires Rental Rate Per Day. Cost-Based calculates that value automatically; leave rate blank."],
        ["13. Cost-Based requires Target Paid Rental Days to Recover Cost (per item), Residual Value, Operating Cost/Day, and Target Margin %."],
        ["14. The calculated rate is rounded UP to a whole peso; it is a cost-recovery suggestion only."],
    ]);
    instructions["!cols"]=[{wch:110}];
    XLSX.utils.book_append_sheet(workbook,instructions,"INSTRUCTIONS");
    XLSX.writeFile(workbook,"StockNBook_Rental_Bulk_Import_Format.xlsx");
}
function rentalWorkbookDate(value:unknown):string {
    if(value instanceof Date&&!Number.isNaN(value.getTime()))return [value.getFullYear(),String(value.getMonth()+1).padStart(2,"0"),String(value.getDate()).padStart(2,"0")].join("-");
    if(typeof value==="number"&&Number.isFinite(value)){
        const date=XLSX.SSF.parse_date_code(value);
        if(date)return `${date.y}-${String(date.m).padStart(2,"0")}-${String(date.d).padStart(2,"0")}`;
    }
    return String(value??"").trim();
}
function rentalWorkbookMoney(raw:unknown,label:string,location:string){
    const value=String(raw??"").replace(/[₱,\s]/g,"").trim();
    if(!/^\d+(?:\.\d{1,2})?$/.test(value)||Number(value)>100000000)throw new Error(`${location}: ${label} must be a nonnegative amount with at most 2 decimals.`);
    return Number(value);
}
function rentalWorkbookTable(sheet:XLSX.WorkSheet,sheetName:string,headers:string[]){
    const raw=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:""});
    const key=(value:unknown)=>String(value??"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const heading=raw.findIndex(row=>headers.every(header=>row.some(value=>key(value)===key(header))));
    if(heading<0)throw new Error(`${sheetName}: expected columns ${headers.join(", ")}. Download the rental format.`);
    const indexes=headers.map(header=>raw[heading].findIndex(value=>key(value)===key(header)));
    return raw.slice(heading+1).map((row,index)=>({rowNumber:heading+index+2,values:indexes.map(column=>row[column]??"")}))
        .filter(record=>record.values.some(value=>String(value??"").trim()!==""));
}
function parseRentalImport(buffer:ArrayBuffer,existingEquipment:RentalEquipment[]):ParsedRentalImport {
    const workbook=XLSX.read(buffer,{type:"array",cellDates:true});
    const equipSheet=workbook.Sheets["RENTAL EQUIPMENT"];
    const purchaseSheet=workbook.Sheets["PURCHASE DETAILS"];
    if(!equipSheet||!purchaseSheet)throw new Error('The XLSX file must include "RENTAL EQUIPMENT" and "PURCHASE DETAILS" sheets (one supplier purchase per file).');
    const productCells=rentalWorkbookTable(equipSheet,"RENTAL EQUIPMENT",RENTAL_EQUIPMENT_HEADERS);
    if(productCells.length<1||productCells.length>500)throw new Error("Enter between 1 and 500 rental equipment rows.");
    const existing=new Set(existingEquipment.filter(item=>item.active).map(item=>item.name.toLowerCase().trim().replace(/\s+/g," ")));
    const seen=new Set<string>();
    // Optional extra columns are detected by header name. Legacy five-column XLSX files still work.
    const rawEquip=XLSX.utils.sheet_to_json<unknown[]>(equipSheet,{header:1,raw:true,defval:""});
    const headerKey=(v:unknown)=>String(v??"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const headerRow=rawEquip.findIndex(row=>RENTAL_EQUIPMENT_HEADERS.every(h=>row.some(v=>headerKey(v)===headerKey(h))));
    const headerIndexes=new Map<string,number>();
    rawEquip[headerRow].forEach((value,index)=>headerIndexes.set(headerKey(value),index));
    const extra=(rowNumber:number,label:string)=>{
        const index=headerIndexes.get(headerKey(label));
        return index===undefined ? "" : rawEquip[rowNumber-1]?.[index]??"";
    };
    // Updated templates support cost-based pricing; older five-column workbooks
    // retain their manually entered rates. Old extended templates still parse
    // explicitly supplied years × annual days as a recovery target.
    const hasCostBasedColumns=RENTAL_PRICING_HEADERS.every(label=>headerIndexes.has(headerKey(label)));
    const hasLegacyPricingColumns=LEGACY_PRICING_HEADERS.every(label=>headerIndexes.has(headerKey(label)));
    const rows:RentalImportRow[]=productCells.map(({values,rowNumber})=>{
        const location=`RENTAL EQUIPMENT · row ${rowNumber}`;
        const name=String(values[0]??"").trim(),category=String(values[1]??"").trim();
        if(!name||!category||name.length>150||category.length>100)throw new Error(`${location}: name and category are required (max 150 / 100 characters).`);
        const signature=name.toLowerCase().replace(/\s+/g," ");
        if(seen.has(signature)||existing.has(signature))throw new Error(`${location}: "${name}" is already listed in this file or active branch inventory.`);
        seen.add(signature);
        const stockText=String(values[2]??"").trim();
        if(!/^\d+$/.test(stockText)||!Number.isSafeInteger(Number(stockText))||Number(stockText)<=0||Number(stockText)>2147483647){
            throw new Error(`${location}: Stock must be a positive whole number. Add zero-stock products through Add Product.`);
        }
        const unitCost=rentalWorkbookMoney(values[3],"Unit Purchase Cost",location);
        const selectedMethod=String(extra(rowNumber,"Pricing Method")??"").trim().toLowerCase();
        const rawMethod=selectedMethod||((hasCostBasedColumns||hasLegacyPricingColumns)&&String(values[4]??"").trim()===""?"cost-based":"manual");
        const method:RentalPricingMethod=rawMethod==="cost-based"||rawMethod==="cost_based"?"cost_based":"manual";
        if(!["cost-based","cost_based","manual"].includes(rawMethod)) throw new Error(`${location}: Pricing Method must be Manual or Cost-Based.`);
        if(method==="manual") return {name,category,openingUnits:Number(stockText),unitCost,
            rentalRatePerDay:rentalWorkbookMoney(values[4],"Rental Rate Per Day",location),pricingMethod:"manual"};
        const cleanMoney=(label:string)=>rentalWorkbookMoney(extra(rowNumber,label),label,location);
        const targetText=String(extra(rowNumber,"Target Paid Rental Days to Recover Cost")??"").trim();
        let recoveryDays:number;
        if(targetText){
            if(!/^\d+$/.test(targetText)||Number(targetText)<1||Number(targetText)>10980)
                throw new Error(`${location}: Target Paid Rental Days to Recover Cost must be 1–10,980.`);
            recoveryDays=Number(targetText);
        }else if(hasLegacyPricingColumns){
            // Compatibility for files that EXPLICITLY specify the old two inputs.
            const oldYears=String(extra(rowNumber,"Useful Life (Years)")??"").trim();
            const oldDays=String(extra(rowNumber,"Paid Rental Days / Year")??"").trim();
            if(!/^\d+$/.test(oldYears)||!/^\d+$/.test(oldDays)||Number(oldYears)<1||Number(oldYears)>30||Number(oldDays)<1||Number(oldDays)>366)
                throw new Error(`${location}: Enter a recovery target, or explicitly provide both legacy Years and Paid Rental Days / Year.`);
            recoveryDays=Number(oldYears)*Number(oldDays);
        }else{
            throw new Error(`${location}: Enter Target Paid Rental Days to Recover Cost for automatic pricing.`);
        }
        const residual=cleanMoney("Residual Value (₱)");
        const operating=cleanMoney("Operating Cost / Paid Day (₱)");
        const target=String(extra(rowNumber,"Target Margin (%)")??"").trim();
        if(!/^\d+(?:\.\d{1,2})?$/.test(target)||Number(target)>80) throw new Error(`${location}: Target Margin must be 0–80%.`);
        const rate=calculateCostBasedRentalRate(unitCost,residual,recoveryDays,operating,Number(target));
        if(rate===null)throw new Error(`${location}: Cost-based pricing inputs are invalid. Check recovery target, residual value and costs.`);
        if(values[4]!==""&&rentalWorkbookMoney(values[4],"Rental Rate Per Day",location)!==rate)
            throw new Error(`${location}: Suggested Rate does not match formula. Leave the rental rate blank for Cost-Based pricing.`);
        return {name,category,openingUnits:Number(stockText),unitCost,rentalRatePerDay:rate,
            pricingMethod:"cost_based",pricingRecoveryDays:recoveryDays,
            pricingResidualValue:residual,pricingOperatingCostPerDay:operating,pricingMarginPercent:Number(target)};
    });
    const purchaseCells=rentalWorkbookTable(purchaseSheet,"PURCHASE DETAILS",RENTAL_PURCHASE_HEADERS);
    if(purchaseCells.length!==1)throw new Error(`PURCHASE DETAILS: Enter exactly ONE supplier purchase row, not ${purchaseCells.length}.`);
    const values=purchaseCells[0].values;
    const supplier=String(values[0]??"").trim();
    const supplierInvoiceNumber=String(values[1]??"").trim();
    const purchaseDate=rentalWorkbookDate(values[2]);
    const method=String(values[3]??"").trim().toLowerCase();
    const paidText=String(values[4]??"").trim();
    const dueDate=rentalWorkbookDate(values[5]);
    if(!supplier||supplier.length>150||supplierInvoiceNumber.length>80)throw new Error("PURCHASE DETAILS: supplier is required; the invoice number must be at most 80 characters.");
    if(!validRentalDate(purchaseDate)||purchaseDate>rentalToday())throw new Error("PURCHASE DETAILS: Purchase Date must be a valid date (YYYY-MM-DD) and cannot be in the future.");
    if(method!=="cash"&&method!=="credit")throw new Error("PURCHASE DETAILS: Payment Method must be Cash or Credit.");
    const totalCents=rows.reduce((sum,row)=>sum+row.openingUnits*Math.round(row.unitCost*100),0);
    if(!Number.isSafeInteger(totalCents))throw new Error("Total purchase cost is too large.");
    const purchaseTotal=totalCents/100;
    const paid=paidText?rentalWorkbookMoney(paidText,"Amount Paid","PURCHASE DETAILS"):0;
    const paidCents=method==="cash"?totalCents:Math.round(paid*100);
    if(method==="cash"&&paidText&&Math.round(paid*100)!==totalCents)throw new Error("PURCHASE DETAILS: Cash must be paid in full. Leave Amount Paid blank or enter the entire purchase total.");
    if(paidCents>totalCents)throw new Error("PURCHASE DETAILS: Amount Paid cannot exceed the combined purchase cost.");
    const outstandingBalance=(totalCents-paidCents)/100;
    if(method==="credit"&&outstandingBalance>0&&(!validRentalDate(dueDate)||dueDate<purchaseDate))throw new Error("PURCHASE DETAILS: Unpaid or partial Credit requires a due date on or after the purchase date.");
    if(dueDate&&(!validRentalDate(dueDate)||dueDate<purchaseDate))throw new Error("PURCHASE DETAILS: Payment Due Date is invalid.");
    const purchase:RentalBulkPurchase={supplier,supplierInvoiceNumber:supplierInvoiceNumber||undefined,purchaseDate,
        paymentMethod:method,amountPaid:paidCents/100,
        paymentDueDate:method==="credit"&&outstandingBalance>0?dueDate:null};
    return {rows,purchase,purchaseTotal,outstandingBalance};
}
function RentalImportDialog({close,onSave,saving,existingEquipment}:{close:()=>void;
    onSave:(rows:RentalImportRow[],purchase:RentalBulkPurchase)=>Promise<void>;
    saving:boolean;existingEquipment:RentalEquipment[]}) {
    const [file,setFile]=React.useState<File|null>(null);
    const [preview,setPreview]=React.useState<ParsedRentalImport|null>(null);
    const [step,setStep]=React.useState<"select"|"confirm">("select");
    const [error,setError]=React.useState("");
    const [reading,setReading]=React.useState(false);
    const [submitting,setSubmitting]=React.useState(false);
    const running=React.useRef(false);
    const parse=async()=>{
        if(!file||reading)return;
        setError("");setReading(true);
        try{
            if(!/\.xlsx$/i.test(file.name))throw new Error("Use an .xlsx file because a supplier purchase needs a separate PURCHASE DETAILS sheet.");
            if(file.size>5*1024*1024)throw new Error("Choose a file smaller than 5 MB.");
            const data=parseRentalImport(await file.arrayBuffer(),existingEquipment);
            setPreview(data);setStep("confirm");
        }catch(cause){setPreview(null);setError(cause instanceof Error?cause.message:"Unable to preview file.");}
        finally{setReading(false);}
    };
    const confirm=async()=>{
        if(!preview||submitting||saving||running.current)return;
        running.current=true;setSubmitting(true);setError("");
        try{await onSave(preview.rows,preview.purchase);}
        catch(cause){setError(cause instanceof Error?cause.message:"Import failed. No products should be saved unless the server confirms success.");}
        finally{running.current=false;setSubmitting(false);}
    };
    const secondary="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]";
    return <div role="presentation" className="fixed inset-0 z-[145] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-label={step==="select"?"Upload rental inventory file":"Confirm imported rental products"}
             className={`flex max-h-[92vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl ${step==="select"?"max-w-lg":"max-w-6xl"}`}>
            {step==="select"?<>
                <div className="p-5 sm:p-6">
                    <div className="mb-4 flex items-start justify-between gap-3"><div>
                        <h2 className="text-[19px] font-bold text-[#1A1220]">Upload Rental Inventory File</h2>
                        <p className="mt-1 text-sm text-[#6A5D6F]">Select the StockNBook XLSX rental format. No equipment is added until you confirm.</p>
                    </div><button type="button" disabled={submitting} onClick={close} aria-label="Close upload" className="text-[#9B8AAA]"><X size={18}/></button></div>
                    <input type="file" accept=".xlsx" disabled={reading} onChange={e=>{setFile(e.target.files?.[0]||null);setError("");setPreview(null);}}
                           className="w-full rounded-xl border border-[#E3D8EA] bg-white p-3 text-sm text-[#1A1220] file:mr-4 file:rounded-lg file:border-0 file:bg-[#2B174C] file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"/>
                    {file&&<p className="mt-2 text-xs text-[#6A5D6F]">Selected: <strong>{file.name}</strong></p>}
                    {error&&<div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Check your Excel file</strong><p className="mt-1">{error}</p><p className="mt-1 text-xs">No equipment has been saved. Correct the file and preview again.</p></div>}
                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                        <button type="button" onClick={downloadRentalTemplate} className="inline-flex items-center gap-2 rounded-xl border border-[#CDB9E1] bg-[#F7F1FF] px-4 py-2 text-sm font-semibold text-[#2B174C]"><Download size={15}/> Download Format</button>
                        <div className="flex gap-2"><button type="button" onClick={close} className={secondary}>Cancel</button>
                            <button type="button" disabled={!file||reading} onClick={()=>void parse()} className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{reading?"Reading...":"Preview Import"}</button></div>
                    </div>
                </div>
            </>:<>
                <div className="flex shrink-0 justify-between gap-4 border-b border-[#E6DDF0] px-5 py-4 sm:px-6">
                    <div><h2 className="text-[19px] font-bold text-[#1A1220]">Confirm Imported Rental Products</h2>
                        <p className="mt-1 text-sm text-[#6A5D6F]">Review all equipment under one supplier purchase before importing.</p>
                        <p className="mt-1 text-xs font-semibold text-[#5A476A]">{preview?.rows.length??0} equipment product(s) • One supplier purchase</p>
                    </div><button type="button" disabled={submitting} onClick={close} aria-label="Close preview" className="text-[#9B8AAA]"><X size={18}/></button>
                </div>
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
                    {error&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><strong>Import not saved — check the following</strong><p>{error}</p></div>}
                    <section className="overflow-hidden rounded-xl border border-[#E3D8EA] bg-[#FFFCF8]">
                        <div className="border-b border-[#E3D8EA] bg-white p-4"><h3 className="text-sm font-bold text-[#21132E]">Rental Inventory &amp; Pricing Details</h3><p className="mt-1 text-xs text-[#675875]">Regular equipment only — no variants or Reorder Point.</p></div>
                        <div className="overflow-x-auto"><table className="w-full min-w-[770px] text-left text-xs">
                            <thead className="bg-[#F8F3FC] text-[#5A476A]"><tr>{["Rental Product","Category","Stock","Cost Price","Rental Rate / Day","Purchase Cost","Status"].map(h=><th className="px-3 py-3" key={h}>{h}</th>)}</tr></thead>
                            <tbody>{(preview?.rows||[]).map((row,i)=><tr key={`${row.name}-${i}`} className="border-t border-[#EFE7F4]">
                                <td className="px-3 py-3 font-semibold text-[#2B174C]">{row.name}</td><td className="px-3 py-3">{row.category}</td>
                                <td className="px-3 py-3">{row.openingUnits}</td><td className="px-3 py-3">{peso(row.unitCost)}</td>
                                <td className="px-3 py-3">{peso(row.rentalRatePerDay)}<div className="text-[10px] text-[#806A8C]">{row.pricingMethod==="cost_based"?"Cost-Based":"Manual"}</div></td><td className="px-3 py-3">{peso(row.openingUnits*row.unitCost)}</td>
                                <td className="px-3 py-3 font-semibold text-[#23834A]">Valid</td>
                            </tr>)}</tbody></table></div>
                    </section>
                    {preview&&<section className="rounded-xl border border-[#E3D8EA] bg-white p-4">
                        <h3 className="text-sm font-bold text-[#21132E]">Supplier &amp; Purchase Details</h3>
                        <p className="mt-1 text-xs text-[#675875]">StockNBook Rental Purchase No.: Generated by the backend when imported</p>
                        <div className="mt-4 grid gap-4 text-xs text-[#5A476A] sm:grid-cols-2">
                            {[["Supplier",preview.purchase.supplier],["Supplier Invoice Number",preview.purchase.supplierInvoiceNumber||"—"],
                                ["Purchase Date",preview.purchase.purchaseDate],["Payment Method",preview.purchase.paymentMethod==="cash"?"Cash":"Credit"],
                                ["Combined Purchase Total",peso(preview.purchaseTotal)],["Amount Paid",peso(preview.purchase.amountPaid)],
                                ["Payment Due Date",preview.purchase.paymentDueDate||"—"],["Outstanding Balance",peso(preview.outstandingBalance)]].map(([label,value])=><div key={label}>
                                {label}<div className="mt-0.5 font-bold text-[#21132E]">{value}</div></div>)}
                        </div>
                    </section>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-[#E6DDF0] px-5 py-4 sm:px-6">
                    <button type="button" disabled={submitting} onClick={()=>{setStep("select");setError("");}} className={secondary}>Back</button>
                    <button type="button" disabled={submitting} onClick={close} className={secondary}>Cancel</button>
                    <button type="button" disabled={!preview||submitting||saving} onClick={()=>void confirm()} className="rounded-xl bg-[#2B174C] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">{submitting?"Importing...":"Confirm Import"}</button>
                </div>
            </>}
        </div>
    </div>;
}
type RentalCategoryMutation = Extract<RentalMutation,
    { action: "create_rental_category" | "rename_rental_category" | "archive_rental_category" }>;
function RentalCategoriesDialog({categories,equipment,close,onSave,saving}:{
    categories:string[];equipment:RentalEquipment[];close:()=>void;onSave:(action:RentalMutation)=>Promise<void>;saving:boolean;
}) {
    const [draft,setDraft]=React.useState("");
    const [filter,setFilter]=React.useState("");
    const [editing,setEditing]=React.useState<string|null>(null);
    const [editDraft,setEditDraft]=React.useState("");
    const [confirmAction,setConfirmAction]=React.useState<RentalCategoryMutation|null>(null);
    const [blocked,setBlocked]=React.useState<string|null>(null);
    const [error,setError]=React.useState("");
    const [success,setSuccess]=React.useState("");
    const [working,setWorking]=React.useState(false);
    const inFlight=React.useRef(false);
    const matches=(name:string)=>categories.some(c=>c.toLowerCase().trim()===name.toLowerCase().trim());
    const beginAdd=()=>{
        setError("");setSuccess("");const name=draft.trim();
        if(!name||name.length>100){setError("Enter a category name (max 100 characters).");return;}
        if(matches(name)){setError(`Category "${name}" already exists.`);return;}
        setConfirmAction({action:"create_rental_category",name});
    };
    const beginEdit=()=>{
        const name=editDraft.trim();setError("");
        if(!editing||!name||name.length>100){setError("Enter a valid category name (max 100 characters).");return;}
        if(name===editing){setError("No changes made.");return;}
        if(matches(name)){setError(`Category "${name}" already exists.`);return;}
        setEditing(null);setConfirmAction({action:"rename_rental_category",previousName:editing,name});
    };
    const beginArchive=(name:string)=>{
        const linked=equipment.filter(item=>item.active&&item.category===name).length;
        setError("");if(linked>0){setBlocked(name);return;}
        setConfirmAction({action:"archive_rental_category",name});
    };
    const confirm=async()=>{
        if(!confirmAction||working||saving||inFlight.current)return;
        inFlight.current=true;setWorking(true);setError("");
        try{
            const action=confirmAction;
            await onSave(action);
            if(action.action==="create_rental_category")setDraft("");
            setSuccess(action.action==="create_rental_category"?`“${action.name}” added successfully.`:
                action.action==="rename_rental_category"?`“${action.previousName}” updated to “${action.name}”.`:
                    `“${action.name}” archived successfully.`);
            setConfirmAction(null);
        }catch(cause){setConfirmAction(null);setError(cause instanceof Error?cause.message:"Unable to save category.");}
        finally{inFlight.current=false;setWorking(false);}
    };
    const shown=categories.filter(name=>name.toLowerCase().includes(filter.trim().toLowerCase()));
    const secondary="rounded-xl border border-[#E6DDF0] bg-white px-4 py-2 text-sm font-medium text-[#6A5D6F] hover:bg-[#F7F1FF]";
    return <div role="presentation" className="fixed inset-0 z-[145] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
        <div role="dialog" aria-modal="true" aria-label="Manage rental categories" className="flex h-[560px] max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-[18px] font-bold text-[#1A1220]">Manage Categories</h2>
                <button type="button" disabled={working} aria-label="Close" onClick={close} className="text-[#9B8AAA] hover:text-[#1A1220]"><X size={20}/></button></div>
            {error&&<p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
            {success&&<p role="status" className="mb-3 rounded-xl bg-[#E5F8EC] p-3 text-xs font-semibold text-[#23834A]">{success}</p>}
            <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
                <div className="flex min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-[#FFFCF7] p-4">
                    <p className="text-sm font-semibold text-[#1A1220]">Add New Category</p>
                    <p className="mt-1 text-xs text-[#9B8AAA]">Type a category name, then click Add.</p>
                    <div className="mt-5 space-y-1"><label className={rentalLabelClass}>Category Name</label>
                        <input maxLength={100} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Type a new category..." className={rentalFieldClass}/></div>
                    <button type="button" disabled={working||saving||!draft.trim()} onClick={beginAdd} className="mt-3 w-full rounded-xl bg-[#2B174C] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-40">Add Category</button>
                </div>
                <div className="flex min-h-0 flex-col rounded-2xl border border-[#E6DDF0] bg-white p-4">
                    <div className="mb-3 shrink-0"><p className="text-sm font-semibold text-[#1A1220]">Existing Categories</p>
                        <p className="text-xs text-[#9B8AAA]">{shown.length} shown</p></div>
                    <input aria-label="Search rental categories" value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search categories..." className={`${rentalFieldClass} mb-3`}/>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
                        {shown.length===0?<p className="rounded-xl border border-dashed border-[#E6DDF0] bg-[#FFFCF7] p-4 text-sm text-[#9B8AAA]">No matching categories.</p>:
                            shown.map(name=><div key={name} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#F8F2EA] p-2 text-[#1A1220]">
                                <div><p className="text-sm font-medium">{name}</p><p className="text-[10px] text-[#86778F]">{equipment.filter(item=>item.active&&item.category===name).length} rental products</p></div>
                                <div className="flex gap-2"><button type="button" disabled={working} onClick={()=>{setEditing(name);setEditDraft(name);setError("");}} className="text-xs font-semibold text-[#2B174C] hover:underline">Edit</button>
                                    <button type="button" disabled={working} onClick={()=>beginArchive(name)} className="text-xs font-semibold text-red-500 hover:underline">Archive</button></div>
                            </div>)}
                    </div>
                </div>
            </div>
            {editing!==null&&<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 p-4" role="presentation">
                <div role="dialog" aria-modal="true" aria-label="Edit category" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
                    <div className="flex items-center justify-between"><h3 className="text-[18px] font-bold text-[#1A1220]">Edit Category</h3><button type="button" onClick={()=>setEditing(null)}><X size={18}/></button></div>
                    <p className="text-xs text-[#8A7A91]">Change the category name below.</p>
                    <div className="space-y-1"><label className={rentalLabelClass}>Category Name</label><input maxLength={100} className={rentalFieldClass} value={editDraft} onChange={e=>setEditDraft(e.target.value)}/></div>
                    <div className="flex justify-end gap-2"><button type="button" onClick={()=>setEditing(null)} className={secondary}>Cancel</button><button type="button" onClick={beginEdit} className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white">Continue</button></div>
                    {error&&<p role="alert" className="text-xs text-red-700">{error}</p>}
                </div>
            </div>}
            {blocked&&<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 p-4" role="presentation">
                <div role="alertdialog" aria-modal="true" aria-label="Cannot archive category" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
                    <h3 className="text-lg font-bold text-[#1A1220]">Cannot Archive Category</h3>
                    <p className="text-sm text-[#6A5D6F]">You cannot archive <strong>{blocked}</strong> because rental products still use it. Move those products to another category first.</p>
                    <div className="flex justify-end"><button type="button" onClick={()=>setBlocked(null)} className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white">Okay</button></div>
                </div>
            </div>}
            {confirmAction&&<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/50 p-4" role="presentation">
                <div role="alertdialog" aria-modal="true" aria-label="Confirm category change" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
                    <h3 className="text-[18px] font-bold text-[#1A1220]">{confirmAction.action==="create_rental_category"?"Add Category":confirmAction.action==="rename_rental_category"?"Confirm Category Update":"Archive Category"}</h3>
                    <p className="text-sm text-[#6A5D6F]">{confirmAction.action==="create_rental_category"?`Are you sure you want to add “${confirmAction.name}”?`:
                        confirmAction.action==="rename_rental_category"?`Change “${confirmAction.previousName}” to “${confirmAction.name}”?`:
                            `Archive “${confirmAction.name}” from active rental categories?`}</p>
                    <div className="flex justify-end gap-2"><button type="button" disabled={working} onClick={()=>{if(confirmAction.action==="rename_rental_category"){setEditing(confirmAction.previousName);setEditDraft(confirmAction.name);}setConfirmAction(null);}} className={secondary}>Back</button>
                        <button type="button" disabled={working||saving} onClick={()=>void confirm()} className="rounded-xl bg-[#2B174C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{working?"Saving...":"Confirm"}</button></div>
                </div>
            </div>}
        </div>
    </div>;
}


/* -------------------------------------------------------------------------- */
/*  RENTAL SUPPLIER PAYABLES — INLINE (matches Sales Inventory payment flow)    */
/* -------------------------------------------------------------------------- */

/**
 * Supplier payments for RENTAL equipment only.
 * Uses the dedicated /api/rental-inventory endpoint and rental_* ledgers.
 * Does not call /api/products or edit equipment quantities.
 */
type RentalSupplierPayable = {
    purchaseId: number;
    purchaseNumber: string;
    supplier: string;
    supplierInvoiceNumber: string | null;
    purchaseDate: string;
    paymentDueDate: string | null;
    paymentMethod: "cash" | "credit";
    purchaseTotal: number;
    amountPaid: number;
    outstandingBalance: number;
    paymentStatus: "Paid" | "Partially Paid" | "Unpaid";
};

type RentalPurchaseItem = {
    equipmentId: number;
    equipmentNumber: string;
    name: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
};

type RentalApiResponse = {
    success?: boolean;
    error?: string;
    payables?: unknown;
    items?: unknown;
    alreadyProcessed?: boolean;
};

function cents(value: string): number | null {
    if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;
    const number = Number(value);
    return Number.isSafeInteger(Math.round(number * 100)) && number > 0 ? Math.round(number * 100) : null;
}
function readPayable(value: unknown): RentalSupplierPayable | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const purchaseId = Number(item.purchaseId);
    const purchaseTotal = Number(item.purchaseTotal);
    const amountPaid = Number(item.amountPaid);
    if (!Number.isSafeInteger(purchaseId) || purchaseId < 1 ||
        !Number.isFinite(purchaseTotal) || purchaseTotal < 0 ||
        !Number.isFinite(amountPaid) || amountPaid < 0 || amountPaid > purchaseTotal + 0.011 ||
        !String(item.purchaseNumber || "").trim()) return null;
    const outstandingBalance = Math.max(0, Math.round((purchaseTotal - amountPaid) * 100) / 100);
    const paymentMethod = item.paymentMethod === "cash" ? "cash" : item.paymentMethod === "credit" ? "credit" : null;
    if (!paymentMethod) return null;
    return {
        purchaseId,
        purchaseNumber: String(item.purchaseNumber),
        supplier: String(item.supplier || ""),
        supplierInvoiceNumber: item.supplierInvoiceNumber == null ? null : String(item.supplierInvoiceNumber),
        purchaseDate: String(item.purchaseDate || ""),
        paymentDueDate: item.paymentDueDate == null ? null : String(item.paymentDueDate),
        paymentMethod, purchaseTotal, amountPaid, outstandingBalance,
        paymentStatus: outstandingBalance === 0 ? "Paid" : amountPaid > 0 ? "Partially Paid" : "Unpaid",
    };
}
function readItem(value: unknown): RentalPurchaseItem | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    const quantity = Number(item.quantity), unitCost = Number(item.unitCost);
    const equipmentId = Number(item.equipmentId);
    if (!Number.isSafeInteger(equipmentId) || equipmentId <= 0 || !Number.isSafeInteger(quantity) || quantity <= 0 ||
        !Number.isFinite(unitCost) || unitCost < 0) return null;
    return {
        equipmentId,
        equipmentNumber: String(item.equipmentNumber || ""),
        name: String(item.name || "Archived equipment"),
        quantity,
        unitCost,
        lineTotal: Number.isFinite(Number(item.lineTotal)) ? Number(item.lineTotal) : Math.round(quantity * unitCost * 100) / 100,
    };
}

const inputClass = "h-10 w-full min-w-0 rounded-xl border border-[#E3D8EA] bg-white px-3 text-sm text-[#2B174C] outline-none focus:border-[#5A35A5]";
const secondaryButton = "rounded-xl border border-[#D9CDF0] bg-[#F5F0FF] px-3 py-2 text-xs font-semibold text-[#5330B6] hover:bg-[#ECE3FF] disabled:opacity-50";
const primaryButton = "rounded-xl bg-[#2B174C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50";

function RentalSupplierPayablesDialog({
                                          branchId, canManage, onClose,
                                      }: { branchId?: number; canManage: boolean; onClose: () => void }) {
    const [payables, setPayables] = React.useState<RentalSupplierPayable[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState("");
    const [notice, setNotice] = React.useState("");
    const [search, setSearch] = React.useState("");
    const [methodFilter, setMethodFilter] = React.useState<"all" | "cash" | "credit">("all");
    const [selectedPurchase, setSelectedPurchase] = React.useState<RentalSupplierPayable | null>(null);
    const [purchaseItems, setPurchaseItems] = React.useState<RentalPurchaseItem[]>([]);
    const [itemsLoading, setItemsLoading] = React.useState(false);
    const [paymentPurchaseId, setPaymentPurchaseId] = React.useState("");
    const [paymentAmount, setPaymentAmount] = React.useState("");
    const [paymentDate, setPaymentDate] = React.useState(rentalToday);
    const [confirmation, setConfirmation] = React.useState<{
        purchaseId: number; purchaseNumber: string; amount: number; paymentDate: string;
    } | null>(null);
    const paymentKeyRef = React.useRef<string>("");
    const pendingRef = React.useRef(false);
    const loadedRef = React.useRef(false);
    const lastRequestRef = React.useRef(0);
    const lastItemRequestRef = React.useRef(0);

    const request = React.useCallback(async (data: Record<string, unknown>): Promise<RentalApiResponse> => {
        const token = sessionStorage.getItem("token");
        if (!token) throw new Error("Your session has expired. Please sign in again.");
        const response = await fetch("/api/rental-inventory", {
            method: "POST", cache: "no-store",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ ...data, ...(branchId ? { branch_id: branchId } : {}) }),
        });
        const result = await response.json().catch(() => ({})) as RentalApiResponse;
        if (!response.ok || result.success !== true) {
            throw new Error(result.error || `Unable to load rental supplier payments (HTTP ${response.status}).`);
        }
        return result;
    }, [branchId]);

    const reload = React.useCallback(async () => {
        const number = ++lastRequestRef.current;
        if (!loadedRef.current) setLoading(true);
        try {
            const result = await request({ action: "get_rental_supplier_payables" });
            if (!Array.isArray(result.payables)) throw new Error("Rental payables response is invalid.");
            const normalized = result.payables.map(readPayable);
            if (normalized.some(item => item === null)) throw new Error("A rental purchase returned invalid payment information.");
            if (number !== lastRequestRef.current) return;
            const nextRows = normalized as RentalSupplierPayable[];
            setPayables(nextRows);
            setSelectedPurchase(previous => previous
                ? nextRows.find(item => item.purchaseId === previous.purchaseId) || null : null);
            loadedRef.current = true;
            setError("");
        } catch (cause) {
            if (number === lastRequestRef.current) {
                setError(cause instanceof Error ? cause.message : "Could not load rental supplier payables.");
            }
        } finally {
            if (number === lastRequestRef.current) { setLoading(false); }
        }
    }, [request]);

    React.useEffect(() => {
        void reload();
        const onFocus = () => { if (document.visibilityState === "visible" && !pendingRef.current) void reload(); };
        window.addEventListener("focus", onFocus);
        const refreshEvery = window.setInterval(onFocus, 30000);
        return () => {
            lastRequestRef.current += 1;
            lastItemRequestRef.current += 1;
            window.removeEventListener("focus", onFocus);
            window.clearInterval(refreshEvery);
        };
    }, [reload]);

    const needToPay = payables.reduce((sum, item) => sum + Math.round(item.outstandingBalance * 100), 0) / 100;
    const alreadyPaid = payables.reduce((sum, item) => sum + Math.round(item.amountPaid * 100), 0) / 100;
    const filtered = payables.filter(item =>
        (methodFilter === "all" || item.paymentMethod === methodFilter) &&
        [item.purchaseNumber, item.supplier, item.supplierInvoiceNumber, item.paymentStatus, item.paymentMethod]
            .some(value => String(value || "").toLowerCase().includes(search.trim().toLowerCase())));
    const chosenPayment = payables.find(item => String(item.purchaseId) === paymentPurchaseId && item.outstandingBalance > 0);

    const view = async (item: RentalSupplierPayable) => {
        setSelectedPurchase(item);
        setPurchaseItems([]);
        setItemsLoading(true);
        const count = ++lastItemRequestRef.current;
        try {
            const response = await request({ action: "get_rental_purchase_items", purchaseId: item.purchaseId });
            if (!Array.isArray(response.items)) throw new Error("Purchased equipment data was not returned.");
            const rows = response.items.map(readItem);
            if (rows.some(row => row === null)) throw new Error("Purchased equipment information is invalid.");
            if (lastItemRequestRef.current === count) setPurchaseItems(rows as RentalPurchaseItem[]);
        } catch (cause) {
            if (lastItemRequestRef.current === count) setError(cause instanceof Error ? cause.message : "Unable to view purchased equipment.");
        } finally {
            if (lastItemRequestRef.current === count) setItemsLoading(false);
        }
    };

    const preparePayment = (event: React.FormEvent) => {
        event.preventDefault();
        if(!canManage){setError("Full Inventory access is required to record payments.");return;}
        if (saving || !chosenPayment) return;
        const amountCents = cents(paymentAmount);
        if (amountCents === null || amountCents > Math.round(chosenPayment.outstandingBalance * 100)) {
            setError("Enter a positive payment with up to two decimals, not exceeding the outstanding balance.");
            return;
        }
        if (!validRentalDate(paymentDate) || paymentDate > rentalToday()) {
            setError("Choose a valid payment date that is not in the future.");
            return;
        }
        setError("");
        if (!paymentKeyRef.current) paymentKeyRef.current = crypto.randomUUID();
        setConfirmation({ purchaseId: chosenPayment.purchaseId, purchaseNumber: chosenPayment.purchaseNumber,
            amount: amountCents / 100, paymentDate });
    };

    const confirmPayment = async () => {
        if(!canManage){setError("Full Inventory access is required to record payments.");return;}
        if (!confirmation || saving || pendingRef.current) return;
        pendingRef.current = true;
        setSaving(true);
        setError("");
        try {
            const result = await request({ action: "pay_rental_supplier_purchase", purchaseId: confirmation.purchaseId,
                amount: confirmation.amount, paymentDate: confirmation.paymentDate,
                requestKey: paymentKeyRef.current });
            const purchaseNumber = confirmation.purchaseNumber;
            paymentKeyRef.current = ""; // A successful request uses a new key next time.
            setConfirmation(null);
            setPaymentPurchaseId("");
            setPaymentAmount("");
            setNotice(result.alreadyProcessed ? "This payment was already recorded." : `Payment recorded for ${purchaseNumber}.`);
            await reload();
        } catch (cause) {
            // Keep the SAME requestKey after a failed/uncertain network reply, to prevent duplicate payment.
            setError(cause instanceof Error ? cause.message : "Unable to record the supplier payment.");
        } finally { pendingRef.current = false; setSaving(false); }
    };

    return <div role="presentation" className="fixed inset-0 z-[145] flex items-center justify-center bg-black/50 p-3 sm:p-4">
        <div role="dialog" aria-modal="true" aria-label="Supplier Payables" className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-[#E3D8EA] px-5 py-4 sm:px-6">
                <h2 className="text-lg font-bold text-[#2B174C]">Supplier Payables</h2>
                <button type="button" aria-label="Close Rental Supplier Payables" disabled={saving} onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50">Close</button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
                <p className="text-xs text-[#806A8C]">Purchase balances belong to the supplier transaction, not to each equipment unit. Payments do not alter rental stock.</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Rental supplier purchase balances">
                    <div className="rounded-xl border border-[#E3D8EA] bg-[#FBF8FF] p-4">
                        <p className="text-xs font-medium text-[#806A8C]">Need to Pay</p>
                        {loading ? <div className="mt-2 h-7 w-32 animate-pulse rounded bg-[#EDE5F6]"/> : <p className="mt-1 text-xl font-bold text-[#2B174C]">{peso(needToPay)}</p>}
                        <p className="mt-1 text-xs text-[#806A8C]">Outstanding across all rental purchases</p>
                    </div>
                    <div className="rounded-xl border border-[#E3D8EA] bg-[#FBF8FF] p-4">
                        <p className="text-xs font-medium text-[#806A8C]">Paid</p>
                        {loading ? <div className="mt-2 h-7 w-32 animate-pulse rounded bg-[#EDE5F6]"/> : <p className="mt-1 text-xl font-bold text-[#2B174C]">{peso(alreadyPaid)}</p>}
                        <p className="mt-1 text-xs text-[#806A8C]">Payments already recorded for rental purchases</p>
                    </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                    <input aria-label="Search rental supplier purchases" placeholder="Search Purchase No., supplier, invoice, or status..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>)=>setSearch(e.target.value)} className={`${inputClass} flex-1`}/>
                    <select aria-label="Filter rental supplier payment method" value={methodFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>)=>setMethodFilter(e.target.value as typeof methodFilter)} className={`${inputClass} sm:w-44`}>
                        <option value="all">All Payments</option><option value="cash">Cash</option><option value="credit">Credit (Utang)</option>
                    </select>
                </div>
                {notice && <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{notice}</p>}
                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
                {loading ? <div className="space-y-2" aria-label="Loading rental supplier purchases">{[0,1,2].map(n=><div key={n} className="h-11 animate-pulse rounded-xl bg-[#F4F0F8]"/>)}</div> :
                    filtered.length===0 ? <p className="rounded-lg bg-[#FCF9FF] p-4 text-sm text-[#806A8C]">{payables.length===0?"No rental supplier purchases recorded yet.":"No purchases match the selected filters."}</p> :
                        <div className="overflow-x-auto"><table className="w-full min-w-[740px] text-left text-xs">
                            <thead className="border-b border-[#E3D8EA] bg-white text-[#806A8C]"><tr>
                                <th className="p-2">Purchase</th><th className="p-2">Supplier</th><th className="p-2">Method</th><th className="p-2">Total</th>
                                <th className="p-2">Paid</th><th className="p-2">Outstanding</th><th className="p-2">Status</th>
                            </tr></thead>
                            <tbody>{filtered.map(item=><tr key={item.purchaseId} className="border-t border-[#EFE8F2] text-[#2B174C]">
                                <td className="px-2 py-2"><button type="button" onClick={()=>void view(item)} className="font-semibold text-[#5330B6] underline underline-offset-2">{item.purchaseNumber}</button></td>
                                <td className="px-2 py-2">{item.supplier}</td><td className="px-2 py-2">{item.paymentMethod==="cash"?"Cash":"Credit (Utang)"}</td>
                                <td className="px-2 py-2">{peso(item.purchaseTotal)}</td><td className="px-2 py-2">{peso(item.amountPaid)}</td>
                                <td className="px-2 py-2 font-semibold">{peso(item.outstandingBalance)}</td>
                                <td className="px-2 py-2"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${item.paymentStatus==="Paid"?"bg-[#E5F8EC] text-[#23834A]":item.paymentStatus==="Unpaid"?"bg-[#FFE7EA] text-[#D92C3F]":"bg-[#FFF2D3] text-[#C77A00]"}`}>{item.paymentStatus}</span></td>
                            </tr>)}</tbody>
                        </table></div>}

                {selectedPurchase && <section className="space-y-3 rounded-xl border border-[#E3D8EA] bg-[#FCF9FF] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-bold text-[#2B174C]">{selectedPurchase.purchaseNumber} — Purchased Equipment</h3>
                        <button type="button" onClick={()=>{setSelectedPurchase(null);lastItemRequestRef.current+=1;}} className="text-xs font-semibold text-[#806A8C]">Close Details</button></div>
                    <div className="grid gap-2 text-xs text-[#5A476A] sm:grid-cols-2 lg:grid-cols-4">
                        <span>Supplier Invoice: <strong>{selectedPurchase.supplierInvoiceNumber||"—"}</strong></span>
                        <span>Purchase Date: <strong>{selectedPurchase.purchaseDate}</strong></span>
                        <span>Due Date: <strong>{selectedPurchase.paymentDueDate||"—"}</strong></span>
                        <span>Payment Method: <strong>{selectedPurchase.paymentMethod==="cash"?"Cash":"Credit"}</strong></span>
                    </div>
                    {itemsLoading ? <p className="text-xs text-[#806A8C]">Loading purchased equipment...</p> : purchaseItems.length === 0 ?
                        <p className="text-xs text-[#806A8C]">No purchase item details were returned.</p> :
                        <div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-xs">
                            <thead className="text-[#806A8C]"><tr><th className="p-2">Rental Equipment</th><th className="p-2">Quantity Purchased</th><th className="p-2">Unit Cost</th><th className="p-2">Line Total</th></tr></thead>
                            <tbody>{purchaseItems.map((item,index)=><tr key={`${item.equipmentId}-${index}`} className="border-t border-[#E9E1EE]">
                                <td className="p-2"><strong>{item.name}</strong> <span className="text-[#806A8C]">{item.equipmentNumber||""}</span></td>
                                <td className="p-2">{item.quantity}</td><td className="p-2">{peso(item.unitCost)}</td><td className="p-2">{peso(item.lineTotal)}</td>
                            </tr>)}</tbody>
                        </table></div>}
                </section>}

                {canManage&&<form onSubmit={preparePayment} className="space-y-3 border-t border-[#E3D8EA] pt-4">
                    <h3 className="text-sm font-bold text-[#2B174C]">Record Payment for a Specific Purchase</h3>
                    <select aria-label="Select rental purchase with an outstanding balance" value={paymentPurchaseId}
                            onChange={(event: React.ChangeEvent<HTMLSelectElement>)=>{setPaymentPurchaseId(event.target.value);setPaymentAmount("");setError("");paymentKeyRef.current=crypto.randomUUID();}} className={inputClass}>
                        <option value="">Select an unpaid or partially paid purchase</option>
                        {payables.filter(item=>item.outstandingBalance>0).map(item=><option key={item.purchaseId} value={item.purchaseId}>
                            {item.purchaseNumber} — {item.supplier} — {peso(item.outstandingBalance)} outstanding
                        </option>)}
                    </select>
                    {chosenPayment && <p className="text-xs text-[#806A8C]">Remaining balance: <strong className="text-[#2B174C]">{peso(chosenPayment.outstandingBalance)}</strong></p>}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1"><span className="text-xs font-semibold text-[#5A476A]">Amount Paid (₱)</span>
                            <input type="number" min="0.01" step="0.01" required value={paymentAmount} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setPaymentAmount(event.target.value)} className={inputClass}/></label>
                        <label className="space-y-1"><span className="text-xs font-semibold text-[#5A476A]">Payment Date</span>
                            <input type="date" max={rentalToday()} required value={paymentDate} onChange={(event: React.ChangeEvent<HTMLInputElement>)=>setPaymentDate(event.target.value)} className={inputClass}/></label>
                    </div>
                    <div className="flex justify-end"><button type="submit" disabled={!chosenPayment||saving} className={primaryButton}>{saving?"Recording...":"Record Payment"}</button></div>
                </form>}
            </div>
        </div>
        {confirmation && <div role="presentation" className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 p-4">
            <div role="alertdialog" aria-modal="true" aria-label="Confirm Rental Supplier Payment" className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
                <div className="flex items-center gap-2"><CheckCircle2 size={20} className="text-[#5A35A5]"/><h3 className="text-lg font-bold text-[#2B174C]">Confirm Supplier Payment</h3></div>
                <p className="text-sm text-[#5A476A]">Record <strong>{peso(confirmation.amount)}</strong> for purchase <strong>{confirmation.purchaseNumber}</strong> on <strong>{confirmation.paymentDate}</strong>?</p>
                <p className="rounded-lg bg-[#FCF9FF] p-3 text-xs text-[#806A8C]">This adds a financial payment to the Rental Supplier Ledger. It does not receive or adjust equipment stock.</p>
                <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={()=>setConfirmation(null)} className={secondaryButton}>Back</button>
                    <button type="button" disabled={saving} onClick={()=>void confirmPayment()} className={primaryButton}>{saving?"Recording...":"Confirm Payment"}</button></div>
            </div>
        </div>}
    </div>;
}