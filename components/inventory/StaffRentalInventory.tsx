"use client";

import * as React from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { SuccessToast, labelClass, fieldClass } from "./_shared";
import {
    AlertTriangle, CalendarClock, CheckCircle2, ClipboardCheck, ClipboardList, CalendarDays,
    PackageCheck, PackagePlus, PackageSearch, Search, Truck, X, ChevronLeft, ChevronRight, ChevronDown,
} from "lucide-react";
import { useStaffRentalInventory, type StaffRentalEquipment, type StaffRentalAllocation, type StaffRentalAction, type StaffRentalEquipmentSchedule, type StaffRentalEquipmentCalendar } from "@/hooks/useRentalInventory";

const panel = "min-w-0 overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-sm";
const action = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl border border-[#E6DDF0] bg-white px-4 text-xs font-semibold text-[#2B174C] hover:bg-[#F7F1FF] disabled:opacity-50";
const primary = "inline-flex h-[40px] items-center justify-center gap-2 rounded-xl bg-[#2B174C] px-4 text-xs font-semibold text-white hover:bg-[#1B0D31] disabled:opacity-50";
const th = "truncate px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-normal text-[#806A8C]";
// Match the Manager rental inventory's compact, colored table action buttons.
const scheduleAction = "inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-[#EAF1FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#2D539D] hover:bg-[#DCE8FF] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2D539D]";
const restockAction = "inline-flex min-h-8 items-center justify-center gap-1 rounded-lg bg-[#E5F8EC] px-2.5 py-1.5 text-[11px] font-semibold text-[#23834A] hover:bg-[#D5F0DF] disabled:cursor-not-allowed disabled:opacity-40";
const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function shiftRentalMonth(month: string, offset: number) {
    const [year,number]=month.split("-").map(Number);
    return new Date(Date.UTC(year,number-1+offset,1)).toISOString().slice(0,7);
}

type TaskType = "prepare" | "release" | "return" | "inspect" | "clean" | "damage";

// Customer information is read from the existing branch-scoped rental workspace.
// Older API responses remain compatible, but cannot show a customer name/type.
type BookingQueueAllocation = StaffRentalAllocation & {
    clientName?: string | null;
    bookingType?: string | null;
    packageName?: string | null;
    eventDate?: string | null;
    eventTime?: string | null;
    depositRequired?: number | null;
    depositCollected?: number | null;
    bookingStatus?: string | null;
};
type BookingQueueItem = { item: StaffRentalAllocation; type: TaskType | null };
type BookingQueueGroup = {
    reference: string;
    clientName: string;
    bookingType: string;
    packageName: string;
    bookingStatus: string;
    scheduleDate: string;
    returnDate: string;
    eventTime: string;
    tasks: BookingQueueItem[];
};
const taskLabel: Record<TaskType, string> = {
    prepare: "Mark Prepared", release: "Release", return: "Receive Return",
    inspect: "Finalize Recorded Return", clean: "Mark Cleaned", damage: "Damage Reported",
};
// Keep operational state separate from the action the Staff will perform next.
const taskStatusLabel: Partial<Record<TaskType, string>> = {
    prepare: "Needs Preparation", release: "Prepared", return: "Out on Rental", inspect: "Previous Return Pending",
};
// These are transaction stages, not editable equipment statuses. Only the next valid
// operation is shown; the backend validates every transition and stock quantity.
const workflowStages = ["Prepare", "Release", "Receive Return", "Equipment care if needed"] as const;
const stageForTask: Record<Exclude<TaskType, "damage">, number> = {
    prepare: 0, release: 1, return: 2, inspect: 2, clean: 3,
};
const taskHelp: Record<TaskType, string> = {
    prepare: "Confirm equipment has been checked and gathered for this booking. This does not mark it as rented out.",
    release: "Confirm physical handover to the customer. Only then will Out on Rental increase.",
    return: "Record missing or damaged units; verify routine care, or defer condition checking until later.",
    inspect: "One-time closeout of a previously recorded return; reuses the original damaged quantity and notes without entering them again.",
    clean: "Finish the cleaning task from the equipment View details. Cleaned units return to Available; damaged units stay on hold.",
    damage: "Damaged equipment remains on hold until Staff confirms the repair and safety check.",
};
const taskToAction: Partial<Record<TaskType, StaffRentalAction>> = {
    prepare: "prepare_rental_allocation", release: "release_rental_allocation",
    return: "return_rental_allocation", inspect: "inspect_rental_allocation", clean: "clean_rental_allocation",
};
function taskType(a: StaffRentalAllocation): TaskType | null {
    if (a.status === "reserved") return a.preparedAt ? "release" : "prepare";
    if (a.status === "checked_out") return "return";
    if (a.status === "returned") {
        if (a.inspectionStatus === "pending") return "inspect";
        if (a.inspectionStatus === "cleaning") return "clean";
        if (a.inspectionStatus === "damaged") return "damage";
    }
    return null;
}
function manilaDate(date: Date = new Date()) {
    const bits = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Manila",day:"2-digit",month:"2-digit",year:"numeric"}).formatToParts(date);
    const get = (type: string) => bits.find(x=>x.type===type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}
// Prioritize today's scheduled bookings, then the most recent past dates, and
// finally upcoming dates (nearest first). Keep date strings in YYYY-MM-DD form.
function compareQueueEventDates(first: string, second: string, today: string): number {
    const bucket = (date: string) => !/^\d{4}-\d{2}-\d{2}$/.test(date) ? 3 :
        date === today ? 0 : date < today ? 1 : 2;
    const difference = bucket(first) - bucket(second);
    if (difference) return difference;
    if (bucket(first) === 1) return second.localeCompare(first);
    return first.localeCompare(second);
}

function queueScheduleDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
    return new Date(`${value}T12:00:00+08:00`).toLocaleDateString("en-US", {
        timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric",
    });
}
function queueBookingType(raw: string) {
    const label = raw.trim();
    if (!label) return "Booking type unavailable";
    if (label.toLowerCase().includes("custom")) return "Custom Inventory Booking";
    if (label.toLowerCase().includes("package")) return "Package Booking";
    return label;
}
// The queue displays the booking lifecycle status, not the equipment allocation status.
// Match the labels and badge colors used in Manager Bookings; no workflow changes.
function queueBookingStatus(value?: string | null) {
    const raw=String(value||"").trim();
    switch(raw.toLowerCase()) {
        case "pending": case "pending review": return "Pending Review";
        case "approved": case "awaiting down payment": case "waiting down payment":
        case "awaiting payment": case "down payment required": return "Approved";
        case "confirmed": return "Confirmed";
        case "preparing": return "Preparing";
        case "released": return "Released";
        case "return inspection": return "Return Inspection";
        case "pending settlement": return "Pending Settlement";
        case "completed": return "Completed";
        case "cancelled": case "canceled": return "Cancelled";
        default: return raw || "—";
    }
}
const queueBookingStatusStyles: Record<string,string> = {
    "Pending Review": "text-[#A56607]",
    "Approved": "text-[#A56607]",
    "Confirmed": "text-[#1D4ED8]",
    "Preparing": "text-[#4E2C66]",
    "Released": "text-[#1D4ED8]",
    "Return Inspection": "text-[#A56607]",
    "Pending Settlement": "text-[#A56607]",
    "Completed": "text-[#138342]",
    "Cancelled": "text-[#C32F2F]",
};
// Same filter control as the Manager Rental Inventory (RentalInventoryFilterSelect).
function StaffRentalFilterSelect({ containerClassName = "", className = "", children, ...props }:
                                     React.ComponentProps<"select"> & { containerClassName?: string }) {
    return (
        <span className={`relative inline-flex min-w-0 ${containerClassName}`}>
            <select {...props} className={`h-9 w-full min-w-0 appearance-none rounded-xl border border-[#E3D8EA] bg-white py-1 pl-3 pr-9 text-xs font-semibold text-[#2B174C] outline-none focus:border-[#BFA8E2] focus-visible:ring-2 focus-visible:ring-[#F1EBFF] ${className}`}>
                {children}
            </select>
            <ChevronDown aria-hidden="true" size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#806A8C]" />
        </span>
    );
}
// Same availability labels as the Manager Branch Rental Equipment List (equipmentDisplayStatus):
// quantity is today's bookable units, or the checked dates' available units.
function staffEquipmentStatus(e:StaffRentalEquipment, quantity?:number):string {
    if(quantity===undefined||!Number.isFinite(quantity))return "Not Checked";
    const maximumUsable=Math.max(0,e.totalUnits-e.maintenanceUnits-e.missingUnits);
    if(quantity<=0)return maximumUsable>0?"Fully Booked":"Unavailable";
    if(e.alertLevel>0&&quantity<=e.alertLevel)return "Low Availability";
    if(quantity===e.totalUnits&&e.maintenanceUnits===0&&e.missingUnits===0)return "Fully Available";
    return "Available";
}
// Status filter groups (no new statuses): same mapping as the Manager list.
function staffEquipmentStatusGroup(label:string):"Available"|"Unavailable"|null {
    if(label==="Fully Available"||label==="Available"||label==="Low Availability")return "Available";
    if(label==="Unavailable"||label==="Fully Booked")return "Unavailable";
    return null;
}
// Equipment Care & Maintenance: each task type has one Issue and one Status
// (same Issue/Status wording as the Manager's Equipment Condition & Monitoring).
type CareKind = "inspection" | "cleaning" | "routine" | "repairs" | "missing";
const careIssueLabel: Record<CareKind, string> = {
    inspection: "Return Inspection", cleaning: "Cleaning", routine: "Routine Care", repairs: "Damage", missing: "Missing",
};
const careStatusLabel: Record<CareKind, string> = {
    inspection: "Pending Inspection", cleaning: "Needs Cleaning", routine: "Under Care", repairs: "Under Repair", missing: "Unresolved",
};
const careStatusColor: Record<CareKind, string> = {
    inspection: "text-[#C27416]", cleaning: "text-[#C27416]", routine: "text-[#5330B6]", repairs: "text-[#C27416]", missing: "text-[#A43D48]",
};
const careButton = "inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
// Issues reported while preparing a booking are saved as "Booking REF: notes".
// Show only the notes in maintenance confirmations; retain the booking link internally.
function careIssueNotes(reason: string | null | undefined, bookingReference: string | null) {
    const text = String(reason || "").trim();
    const prefix = bookingReference ? `Booking ${bookingReference}: ` : "";
    return prefix && text.startsWith(prefix) ? text.slice(prefix.length).trim() : text;
}
function Empty({children}:{children:React.ReactNode}) {
    return <div className="flex min-h-28 flex-col items-center justify-center gap-2 p-5 text-center text-xs text-[#806A8C]"><PackageSearch size={22}/>{children}</div>;
}
export default function StaffRentalInventory({branchName,section="inventory",queueSearch}:{branchName:string;
    // "queue" renders only the Rental Operations Queue (used by Staff Bookings);
    // "inventory" renders the Staff Rental Inventory without the queue.
    section?:"inventory"|"queue";queueSearch?:string}) {
    const showInventory=section!=="queue";
    const rental=useStaffRentalInventory();
    const {user}=useCurrentUser();
    const inventoryPermission=user?.permissions?.inventory_access ?? user?.permissions?.inventory;
    // UI-only courtesy: the Rental Lambda separately enforces current DB grants.
    const canOperate=inventoryPermission===true || inventoryPermission==="true" || inventoryPermission==="full";
    const [search,setSearch]=React.useState("");
    const [taskFilter,setTaskFilter]=React.useState<"all" | "prepare" | "release" | "return" | "inspect">("all");
    const [selectedQueueReference,setSelectedQueueReference]=React.useState<string|null>(null);
    const [bookingOperation,setBookingOperation]=React.useState<"release"|"return"|null>(null);
    const [bookingReturnMissing,setBookingReturnMissing]=React.useState<Record<number,string>>({});
    const [bookingReturnDamaged,setBookingReturnDamaged]=React.useState<Record<number,string>>({});
    const [returnConditionChecked,setReturnConditionChecked]=React.useState(false);
    const [bookingOperationNotes,setBookingOperationNotes]=React.useState("");
    const [bookingOperationError,setBookingOperationError]=React.useState("");
    const [careFilter,setCareFilter]=React.useState<"all"|"inspection"|"cleaning"|"routine"|"repairs"|"missing">("all");
    const [categoryFilter,setCategoryFilter]=React.useState("All Categories");
    const [statusFilter,setStatusFilter]=React.useState("All Status");
    // Date Availability: same Lambda check and behavior as the Manager Branch Rental Equipment List.
    const [dateFiltersOpen,setDateFiltersOpen]=React.useState(false);
    // Date Availability opens on today (Asia/Manila) and loads automatically (see below).
    const [fromDate,setFromDate]=React.useState(manilaDate);
    const [toDate,setToDate]=React.useState(manilaDate);
    const [appliedDates,setAppliedDates]=React.useState<{from:string;to:string}|null>(null);
    const [datesAvailability,setDatesAvailability]=React.useState<Map<number,number>|null>(null);
    const [datesReserved,setDatesReserved]=React.useState<Map<number,number>|null>(null);
    const [datesLoading,setDatesLoading]=React.useState(false);
    const [datesError,setDatesError]=React.useState("");
    const resetDates=()=>{setAppliedDates(null);setDatesAvailability(null);setDatesReserved(null);setDatesError("");};
    const checkDates=async(from=fromDate,to=toDate)=>{
        if(!from||!to||to<from){setDatesError("Choose a valid start and end date.");return;}
        setDatesError("");setDatesLoading(true);setAppliedDates(null);setDatesAvailability(null);setDatesReserved(null);
        try{
            const rows=await rental.checkAvailability(from,to);
            setDatesAvailability(new Map(rows.map(row=>[row.equipmentId,row.availableUnits]))); setDatesReserved(new Map(rows.map(row=>[row.equipmentId,row.reservedUnits])));
            setAppliedDates({from,to});
        }catch(error){setDatesError(error instanceof Error?error.message:"Unable to check availability.");}
        finally{setDatesLoading(false);}
    };
    // Load today's availability when the inventory view opens (not needed for the Bookings queue).
    const initialDatesChecked=React.useRef(false);
    React.useEffect(()=>{
        if(!showInventory||initialDatesChecked.current)return;
        initialDatesChecked.current=true;
        void checkDates();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    },[]);
    React.useEffect(()=>{
        if(!appliedDates)return;
        let active=true;
        const update=async()=>{
            if(document.visibilityState!=="visible")return;
            try{
                const rows=await rental.checkAvailability(appliedDates.from,appliedDates.to);
                if(active){setDatesAvailability(new Map(rows.map(row=>[row.equipmentId,row.availableUnits]))); setDatesReserved(new Map(rows.map(row=>[row.equipmentId,row.reservedUnits])));setDatesError("");}
            }catch(error){
                if(active){
                    setDatesAvailability(null);setDatesReserved(null); // Never leave a stale date availability on screen.
                    setDatesError(error instanceof Error?error.message:"Unable to refresh rental availability.");
                }
            }
        };
        const onFocus=()=>{void update();};
        window.addEventListener("focus",onFocus);
        const timer=window.setInterval(onFocus,15_000);
        return ()=>{active=false;window.removeEventListener("focus",onFocus);window.clearInterval(timer);};
    },[appliedDates,rental.checkAvailability]);
    const [selected,setSelected]=React.useState<StaffRentalAllocation|null>(null);
    const [viewEquipment,setViewEquipment]=React.useState<number|null>(null);
    const [scheduleEquipmentId,setScheduleEquipmentId]=React.useState<number|null>(null);
    const [scheduleDate,setScheduleDate]=React.useState(manilaDate);
    const [scheduleMonth,setScheduleMonth]=React.useState(()=>manilaDate().slice(0,7));
    const [calendar,setCalendar]=React.useState<StaffRentalEquipmentCalendar|null>(null);
    const [calendarLoading,setCalendarLoading]=React.useState(false);
    const [calendarError,setCalendarError]=React.useState("");
    const [schedule,setSchedule]=React.useState<StaffRentalEquipmentSchedule|null>(null);
    const [scheduleError,setScheduleError]=React.useState("");
    const [scheduleLoading,setScheduleLoading]=React.useState(false);
    const [returnMissing,setReturnMissing]=React.useState("0");
    const [notes,setNotes]=React.useState("");
    const [submitError,setSubmitError]=React.useState("");
    const [notice,setNotice]=React.useState("");
    const closeStaffRentalToast = React.useCallback(() => setNotice(""), []);
    const [confirmRecordedReturn,setConfirmRecordedReturn]=React.useState<StaffRentalAllocation|null>(null);
    const [stockTask,setStockTask]=React.useState<
        {kind:"issue";id:number;label:string;max:number;bookingReference?:string} |
        {kind:"routine";id:number;label:string;max:number;bookingReference?:string|null} | null>(null);
    // Mark Repaired / Mark Replaced is a confirmation only (no inputs): it shows the
    // issue notes and returns every unit still held for that issue to Available.
    const [careConfirm,setCareConfirm]=React.useState<{kind:"complete"|"replace";id:number;label:string;
        units:number;bookingReference:string|null;notes:string}|null>(null);
    const [careConfirmError,setCareConfirmError]=React.useState("");
    // Staff Restock: same Receive Stock dialog as the Manager (quantity only).
    const [restockItem,setRestockItem]=React.useState<StaffRentalEquipment|null>(null);
    const [restockQuantity,setRestockQuantity]=React.useState("");
    const [restockError,setRestockError]=React.useState("");
    const [stockQuantity,setStockQuantity]=React.useState("");
    const [stockNotes,setStockNotes]=React.useState("");
    const [issueType,setIssueType]=React.useState<"routine"|"damage"|"missing">("damage");
    const today=manilaDate();
    const equipmentById=React.useMemo(()=>new Map(rental.equipment.map(e=>[e.id,e])),[rental.equipment]);
    const allTasks=React.useMemo(()=>rental.allocations.map(a=>({item:a,type:taskType(a)})).filter(x=>x.type!==null),[rental.allocations]);
    // Earlier returns awaiting their one-time condition check also hold stock.
    // Show the SAME pending allocation in Equipment Care (not a duplicate task
    // or new maintenance record) so every genuine hold has a visible action.
    const careTasks=React.useMemo(()=>[
        ...rental.allocations.filter(a=>taskType(a)==="inspect").map(a=>({
            key:`inspection-${a.allocationId}`,
            kind:"inspection" as const,
            equipmentId:a.equipmentId,
            equipmentName:a.equipmentName,
            units:a.returnedReceivedUnits??a.quantity,
            bookingReference:a.bookingReference||null,
            notes:a.inspectionNotes||"",
            allocation:a,
        })),
        ...rental.allocations.filter(a=>taskType(a)==="clean").map(a=>({
            key:`booking-${a.allocationId}`,
            kind:"cleaning" as const,
            equipmentId:a.equipmentId,
            equipmentName:a.equipmentName,
            units:a.cleaningUnits>0?a.cleaningUnits:a.quantity,
            bookingReference:a.bookingReference||null,
            notes:a.inspectionNotes||"",
            allocation:a,
        })),
        ...rental.maintenanceTasks.map(t=>({
            key:`maintenance-${t.id}`,
            kind:t.conditionStatus==="Routine"?"routine" as const:"repairs" as const,
            equipmentId:t.equipmentId,
            equipmentName:t.equipmentName,
            units:t.units,
            bookingReference:t.bookingReference||null,
            notes:careIssueNotes(t.reason,t.bookingReference||null),
            maintenance:t,
        })),
    ],[rental.allocations,rental.maintenanceTasks]);
    // Explain holds without counting damage twice: damaged inspection units are
    // represented by rental_maintenance_records. A residual means another hold
    // exists or the capped workspace did not return every underlying record.
    const holdBreakdown=React.useMemo(()=>{
        const breakdown=new Map<number,{inspection:number;cleaning:number;routine:number;repairs:number}>();
        const get=(id:number)=>{
            if(!breakdown.has(id))breakdown.set(id,{inspection:0,cleaning:0,routine:0,repairs:0});
            return breakdown.get(id)!;
        };
        for(const a of rental.allocations){
            if(a.status!=="returned")continue;
            if(a.inspectionStatus==="pending")get(a.equipmentId).inspection+=a.returnedReceivedUnits??a.quantity;
            else if(a.inspectionStatus==="cleaning")get(a.equipmentId).cleaning+=a.cleaningUnits;
        }
        for(const task of rental.maintenanceTasks){
            if(task.conditionStatus==="Routine")get(task.equipmentId).routine+=task.units;
            else get(task.equipmentId).repairs+=task.units;
        }
        return breakdown;
    },[rental.allocations,rental.maintenanceTasks]);
    const openSchedule=(equipmentId:number)=>{
        setScheduleDate(today);setScheduleMonth(today.slice(0,7));setSchedule(null);setScheduleError("");
        setCalendar(null);setCalendarError("");setScheduleEquipmentId(equipmentId);
    };
    const navigateScheduleMonth=(offset:number)=>{
        const next=shiftRentalMonth(scheduleMonth,offset);
        if(next<today.slice(0,7))return;
        setScheduleMonth(next);
        setScheduleDate(next===today.slice(0,7)?today:`${next}-01`);
    };
    const calendarCells=React.useMemo(()=>{
        const [year,number]=scheduleMonth.split("-").map(Number);
        const firstWeekday=new Date(Date.UTC(year,number-1,1)).getUTCDay();
        const days=new Date(Date.UTC(year,number,0)).getUTCDate();
        const slots=Math.ceil((firstWeekday+days)/7)*7;
        return Array.from({length:slots},(_,index)=>{
            const day=index-firstWeekday+1;
            return day>=1&&day<=days?`${scheduleMonth}-${String(day).padStart(2,"0")}`:null;
        });
    },[scheduleMonth]);
    const calendarMarked=React.useMemo(()=>new Map((calendar?.days||[]).map(day=>[day.date,day])),[calendar]);
    React.useEffect(()=>{
        if(scheduleEquipmentId===null)return;
        const abort=new AbortController();
        setScheduleLoading(true);setSchedule(null);setScheduleError("");
        void rental.getEquipmentSchedule(scheduleEquipmentId,scheduleDate,abort.signal).then(data=>{
            if(!abort.signal.aborted)setSchedule(data);
        }).catch(error=>{
            if(!abort.signal.aborted)setScheduleError(error instanceof Error?error.message:"Unable to load equipment schedule.");
        }).finally(()=>{if(!abort.signal.aborted)setScheduleLoading(false);});
        return ()=>abort.abort();
    },[scheduleEquipmentId,scheduleDate,rental.getEquipmentSchedule]);
    React.useEffect(()=>{
        if(scheduleEquipmentId===null)return;
        const abort=new AbortController();
        setCalendar(null);setCalendarError("");setCalendarLoading(true);
        void rental.getEquipmentCalendar(scheduleEquipmentId,scheduleMonth,abort.signal).then(data=>{
            if(!abort.signal.aborted)setCalendar(data);
        }).catch(error=>{
            if(!abort.signal.aborted)setCalendarError(error instanceof Error?error.message:"Unable to load calendar dates.");
        }).finally(()=>{if(!abort.signal.aborted)setCalendarLoading(false);});
        return ()=>abort.abort();
    },[scheduleEquipmentId,scheduleMonth,rental.getEquipmentCalendar]);
    // Missing rows are report-scoped so replacement cannot accidentally change
    // a different booking's unresolved equipment or its customer claim.
    const missingCareTasks=rental.missingReports.map(report=>({
        key:`missing-report-${report.id}`,kind:"missing" as const,
        equipmentId:report.equipmentId,equipmentName:report.equipmentName,units:report.remainingUnits,
        bookingReference:report.bookingReference||null,
        notes:careIssueNotes(report.reason,report.bookingReference||null),
        report,
    }));
    // Status filter (each care task type has exactly one displayed status) plus the list search.
    const careQuery=search.trim().toLowerCase();
    const visibleCareTasks=[...careTasks,...missingCareTasks].filter(task=>
        (careFilter==="all"||task.kind===careFilter)&&
        (!careQuery||[task.bookingReference||"",task.equipmentName,careIssueLabel[task.kind],careStatusLabel[task.kind]]
            .join(" ").toLowerCase().includes(careQuery)));
    // Repair/replacement returns every unit still held for the issue, capped by the
    // equipment's current hold so a stale row cannot request more than is held.
    const startCareConfirm=(kind:"complete"|"replace",task:{id:number;equipmentId:number;equipmentName:string;
        units:number;bookingReference:string|null;notes:string})=>{
        if(!canOperate)return;
        const equipment=equipmentById.get(task.equipmentId);
        const held=equipment?(kind==="complete"?equipment.maintenanceUnits:equipment.missingUnits):task.units;
        setCareConfirm({kind,id:task.id,label:task.equipmentName,units:Math.min(task.units,held),
            bookingReference:task.bookingReference,notes:task.notes});
        setCareConfirmError("");
    };
    const performCareConfirm=async()=>{
        if(!careConfirm||rental.saving)return;
        if(!canOperate){setCareConfirmError("Full Inventory access is required for equipment condition tasks.");return;}
        if(careConfirm.units<1){setCareConfirmError("No units are currently held for this issue. Refresh and try again.");return;}
        const {kind,id,label,units}=careConfirm;
        setCareConfirmError("");setNotice("");
        try {
            if(kind==="complete")await rental.actStock({action:"staff_mark_repaired_ready",maintenanceId:id,quantity:units,
                notes:"Repaired and confirmed ready to be rented again.",safetyChecked:true});
            else await rental.actStock({action:"staff_mark_missing_replaced",reportId:id,quantity:units,
                notes:"Replacement received and confirmed ready to be rented again.",
                conditionChecked:true,replacementNotPreviouslyReceived:true});
            setNotice(kind==="complete"
                ?`${units} unit(s) of ${label} repaired and available to rent again.`
                :`${units} replacement unit(s) of ${label} recorded and available to rent again.`);
            setCareConfirm(null);
        } catch(error){setCareConfirmError(error instanceof Error?error.message:"Unable to save this equipment update.");}
    };

    const bookingTasks=allTasks.filter(x=>x.type!=="clean"&&x.type!=="damage");
    // Show ONE row per booking. Keep every equipment line's existing workflow action
    // in the selected booking checklist; no mutation or allocation logic changes.
    const bookingGroups=React.useMemo(()=>{
        const groups=new Map<string,BookingQueueGroup>();
        bookingTasks.forEach(task=>{
            const item=task.item as BookingQueueAllocation;
            const reference=item.bookingReference;
            let group=groups.get(reference);
            if(!group){
                group={reference,clientName:item.clientName?.trim()||"Customer name unavailable",
                    bookingType:queueBookingType(item.bookingType||""),
                    packageName:item.packageName?.trim()||"",
                    bookingStatus:item.bookingStatus?.trim()||"",
                    scheduleDate:item.eventDate||item.startDate,
                    returnDate:item.endDate,eventTime:item.eventTime?.trim()||"",tasks:[]};
                groups.set(reference,group);
            }
            group.tasks.push(task);
        });
        return Array.from(groups.values()).sort((left,right)=>
            compareQueueEventDates(left.scheduleDate,right.scheduleDate,today) || left.reference.localeCompare(right.reference));
    },[bookingTasks,today]);
    // Filter booking rows by their matching individual task; the selected checklist
    // still shows ALL currently actionable equipment for that booking.
    const queueQuery=(queueSearch ?? search).trim().toLowerCase();
    const visibleBookingGroups=bookingGroups.filter(group=>{
        const text=[group.reference,group.clientName,group.bookingType,group.packageName,
            ...group.tasks.flatMap(x=>[x.item.equipmentName,x.item.equipmentNumber])].join(" ").toLowerCase();
        return text.includes(queueQuery)&&group.tasks.some(x=>taskFilter==="all"||taskFilter===x.type);
    });
    const selectedQueueBooking=visibleBookingGroups.find(group=>group.reference===selectedQueueReference)||null;
    const selectedQueuePayment=selectedQueueBooking?.tasks[0]?.item as BookingQueueAllocation | undefined;
    const selectedQueuePaid=!!selectedQueuePayment&&Number.isFinite(selectedQueuePayment.bookingTotal)
        &&Number.isFinite(selectedQueuePayment.amountPaid)&&Number.isFinite(selectedQueuePayment.bookingBalance)
        &&selectedQueuePayment.bookingTotal>0&&selectedQueuePayment.amountPaid+0.005>=selectedQueuePayment.bookingTotal
        &&selectedQueuePayment.bookingBalance<=0.005;
    // Missing financial terms fail closed: do not enable handover using only booking payments.
    const selectedQueueDepositSettled=!!selectedQueuePayment &&
        selectedQueuePayment.depositRequired != null && selectedQueuePayment.depositCollected != null &&
        Number.isFinite(Number(selectedQueuePayment.depositRequired)) &&
        Number.isFinite(Number(selectedQueuePayment.depositCollected)) &&
        Number(selectedQueuePayment.depositRequired)>=0 && Number(selectedQueuePayment.depositCollected)>=0 &&
        Number(selectedQueuePayment.depositCollected)+0.005>=Number(selectedQueuePayment.depositRequired);
    React.useEffect(()=>{
        if(!selectedQueueReference)return;
        const onKeyDown=(event:KeyboardEvent)=>{
            if(event.key==="Escape"&&!selected&&!stockTask&&!careConfirm&&!bookingOperation&&!rental.saving)setSelectedQueueReference(null);
        };
        window.addEventListener("keydown",onKeyDown);
        return ()=>window.removeEventListener("keydown",onKeyDown);
    },[selectedQueueReference,selected,stockTask,careConfirm,bookingOperation,rental.saving]);
    const queueAllReserved=!!selectedQueueBooking&&selectedQueueBooking.tasks.length>0&&
        selectedQueueBooking.tasks.every(x=>x.type==="prepare"||x.type==="release");
    const queueAllPrepared=queueAllReserved&&selectedQueueBooking!.tasks.every(x=>x.type==="release");
    const queueAllOut=!!selectedQueueBooking&&selectedQueueBooking.tasks.length>0&&
        selectedQueueBooking.tasks.every(x=>x.type==="return");
    const queueReleaseDateValid=!!selectedQueueBooking&&selectedQueueBooking.tasks.every(x=>x.item.startDate<=today);
    const queueReleaseReady=queueAllPrepared&&selectedQueuePaid&&selectedQueueDepositSettled&&queueReleaseDateValid&&canOperate&&!rental.saving;
    const startBookingOperation=(kind:"release"|"return")=>{
        if(!selectedQueueBooking)return;
        setBookingOperation(kind);setBookingOperationError("");setBookingOperationNotes("");
        setBookingReturnMissing(Object.fromEntries(selectedQueueBooking.tasks.map(x=>[x.item.allocationId,"0"])));
        setBookingReturnDamaged(Object.fromEntries(selectedQueueBooking.tasks.map(x=>[x.item.allocationId,"0"])));
        setReturnConditionChecked(false);
    };
    const performBookingOperation=async()=>{
        if(!selectedQueueBooking||!bookingOperation||rental.saving)return;
        setBookingOperationError("");
        try {
            if(bookingOperation==="release") {
                if(!queueReleaseReady)throw new Error("All items must be prepared, the booking balance and security deposit settled, and the scheduled release date reached.");
                await rental.actBooking({action:"release_rental_booking",bookingReference:selectedQueueBooking.reference});
                setNotice(`All rental equipment released for ${selectedQueueBooking.reference}.`);
            } else {
                if(!queueAllOut||!canOperate)throw new Error("The booking must be fully out on rental before receiving all items.");
                const returns=selectedQueueBooking.tasks.map(x=>({
                    allocationId:x.item.allocationId,
                    missingUnits:Number(bookingReturnMissing[x.item.allocationId]??""),
                    // Confirmed immediately when Staff finishes the condition check; otherwise deferred.
                    damagedUnitsObserved:Number(bookingReturnDamaged[x.item.allocationId]??"")
                }));
                if(returns.some((line,i)=>{
                    const missingRaw=bookingReturnMissing[line.allocationId];
                    const damagedRaw=bookingReturnDamaged[line.allocationId];
                    return missingRaw==null||missingRaw.trim()===""||damagedRaw==null||damagedRaw.trim()===""||
                        !Number.isSafeInteger(line.missingUnits)||!Number.isSafeInteger(line.damagedUnitsObserved)||
                        line.missingUnits<0||line.damagedUnitsObserved<0||
                        line.missingUnits+line.damagedUnitsObserved>selectedQueueBooking.tasks[i].item.quantity;
                }))throw new Error("Enter valid missing and observed damaged quantities; together they cannot exceed the booked quantity.");
                if(returns.some(x=>x.missingUnits>0||x.damagedUnitsObserved>0)&&bookingOperationNotes.trim().length<5)
                    throw new Error("Describe missing or damaged equipment (at least five characters).");
                if(!returnConditionChecked)
                    throw new Error("Confirm you checked the returned units and completed necessary routine care before recording the return.");
                await rental.actBooking({action:"return_rental_booking",bookingReference:selectedQueueBooking.reference,
                    returns,notes:bookingOperationNotes.trim(),conditionChecked:true,inspectionDeferred:false});
                setNotice(`Rental return and condition check recorded for ${selectedQueueBooking.reference}. Damaged units are on hold until Staff verifies repair and safe reuse.`);
            }
            setBookingOperation(null);setBookingOperationNotes("");
        } catch(error) {
            setBookingOperationError(error instanceof Error?error.message:"Unable to process this booking.");
        }
    };
    const rentalCategories=[...new Set(rental.equipment.map(e=>e.category))].sort((a,b)=>a.localeCompare(b));
    const visibleEquipment=rental.equipment.filter(e=>{
        if(![e.name,e.category,e.equipmentNumber,...(e.unitNumbers||[])].join(" ").toLowerCase().includes(search.trim().toLowerCase()))return false;
        if(categoryFilter!=="All Categories"&&e.category!==categoryFilter)return false;
        return statusFilter==="All Status"||staffEquipmentStatusGroup(staffEquipmentStatus(e,appliedDates?datesAvailability?.get(e.id):e.bookableToday))===statusFilter;
    });
    const selectedEquipment=rental.equipment.find(e=>e.id===viewEquipment);
    const openRentalAction=(item:StaffRentalAllocation)=>{
        if(taskType(item)==="release"||taskType(item)==="return")return;
        setSelected(item);setSubmitError("");setReturnMissing("0");
        setNotes("");
    };
    // Compatibility for returns already awaiting the former second inspection.
    // The original Staff report is retained; a one-time confirmation releases
    // only non-damaged units and creates at most one Manager damage case.
    const finalizeRecordedReturn=async(item:StaffRentalAllocation)=>{
        if(!canOperate||rental.saving||taskType(item)!=="inspect")return;
        setConfirmRecordedReturn(null);
        setSubmitError("");setNotice("");
        try{
            await rental.act("inspect_rental_allocation",item.allocationId,{useRecordedReturn:true});
            setNotice(`Previous return finalized for ${item.bookingReference}. Existing damage notes were retained.`);
        }catch(error){setNotice("");setSubmitError(error instanceof Error?error.message:"Unable to finalize the previous return.");}
    };
    const reportIssueBeforeRelease=(allocation:StaffRentalAllocation)=>{
        if(!canOperate)return;
        const equipment=equipmentById.get(allocation.equipmentId);
        if(!equipment){setSubmitError("Equipment could not be loaded. Refresh and try again.");return;}
        const physicallyAvailable=Math.max(0,equipment.totalUnits-equipment.rentedOutUnits-
            equipment.maintenanceUnits-equipment.missingUnits);
        if(physicallyAvailable<1){
            setSubmitError("No physically available units can be flagged. Ask the Manager to resolve the shortage.");
            return;
        }
        setSelected(null);
        startStockTask({kind:"issue",id:equipment.id,label:equipment.name,max:physicallyAvailable,
            bookingReference:allocation.bookingReference});
    };
    const perform=async()=>{
        if(!canOperate) {setSubmitError("Full Inventory access is required for rental operations.");return;}
        if(!selected)return;
        const kind=taskType(selected);
        const apiAction=kind&&taskToAction[kind];
        if(!apiAction)return;
        if(kind==="release"||kind==="return"){
            setSubmitError("Use the booking-level Release Booking / Receive Booking Return action.");return;
        }
        setSubmitError("");setNotice("");
        try {
            // Previously returned equipment is finalized using the recorded return,
            // not by re-entering damaged counts or notes in a second dialog.
            if(kind==="inspect")throw new Error("Use Finalize Recorded Return in the booking checklist.");
            await rental.act(apiAction,selected.allocationId,{notes:notes.trim()});
            setNotice(`${taskLabel[kind]} recorded for ${selected.bookingReference}.`);
            setSelected(null);setNotes("");
        } catch(error) {setSubmitError(error instanceof Error?error.message:"Unable to save rental action.");}
    };
    const startStockTask=(task:NonNullable<typeof stockTask>)=>{
        if(!canOperate)return;
        setStockTask(task);setStockQuantity("1");setStockNotes("");setIssueType("damage");setSubmitError("");
    };
    const submitRestock=async(event:React.FormEvent)=>{
        event.preventDefault();
        if(!restockItem||rental.saving)return;
        if(!canOperate){setRestockError("Full Inventory access is required to restock.");return;}
        if(restockQuantity.trim()===""||!Number.isSafeInteger(Number(restockQuantity))||Number(restockQuantity)<=0||Number(restockQuantity)>2147483647){
            setRestockError("Enter a positive whole quantity to add.");return;
        }
        const quantity=Number(restockQuantity);
        setRestockError("");setNotice("");
        try{
            await rental.actStock({action:"staff_restock_equipment",equipmentId:restockItem.id,quantity});
            setNotice(`“${restockItem.name}” received +${quantity.toLocaleString("en-PH")} units in inventory.`);
            setRestockItem(null);
            if(appliedDates)void checkDates(appliedDates.from,appliedDates.to);
        }catch(error){setRestockError(error instanceof Error?error.message:"Unable to receive stock.");}
    };
    const performStock=async()=>{
        if(!canOperate){setSubmitError("Full Inventory access is required for equipment condition tasks.");return;}
        if(!stockTask)return;
        const quantity=Number(stockQuantity);
        if(!Number.isSafeInteger(quantity)||quantity<1||quantity>stockTask.max){
            setSubmitError(`Enter 1–${stockTask.max} units.`);return;
        }
        if(stockNotes.trim().length<5){
            setSubmitError("Describe the issue or completed work (at least 5 characters).");return;
        }
        setSubmitError("");setNotice("");
        try {
            // The booking is sent explicitly (saved as booking_id); the reason keeps its
            // "Booking REF:" prefix so an older Lambda still links the booking.
            if(stockTask.kind==="issue")await rental.actStock({action:"staff_report_equipment_issue",equipmentId:stockTask.id,quantity,
                reason:stockTask.bookingReference?`Booking ${stockTask.bookingReference}: ${stockNotes.trim()}`:stockNotes.trim(),issueType,
                ...(stockTask.bookingReference?{bookingReference:stockTask.bookingReference}:{})});
            else await rental.actStock({action:"staff_complete_routine_maintenance",maintenanceId:stockTask.id,quantity,notes:stockNotes.trim()});
            setNotice(stockTask.kind==="issue"?(issueType==="routine"?"Routine-care task created. Staff can complete it without Manager approval.":
                    "Equipment flagged unavailable. The booking remains pending preparation; available stock will be rechecked on release."):
                "Routine care completed. The units are now available again.");
            setStockTask(null);
        } catch(error){setSubmitError(error instanceof Error?error.message:"Unable to save rental operation.");}
    };
    return <div className="space-y-4" aria-label={showInventory?"Staff Rental Inventory":"Rental Operations Queue"}>
        {!canOperate&&<p role="status" className="rounded-xl border border-[#E6DDF0] bg-[#F7F1FF] px-4 py-3 text-xs text-[#5330B6]">View-only Inventory access: equipment activity is visible, but receiving, rental handover, returns, and condition changes require Full access.</p>}
        {/* Staff Rental: match the three-card Consumable inventory presentation. */}
        {showInventory&&<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
            {title:"Reserved Today",num:appliedDates?.from===today&&appliedDates?.to===today&&datesReserved
                    ? Array.from(datesReserved.values()).reduce((total,units)=>total+units,0)
                    : rental.allocations.filter(a=>a.status==="reserved"&&a.startDate<=today&&a.endDate>=today)
                        .reduce((total,a)=>total+a.quantity,0),
                caption:"Confirmed bookings not yet released",icon:<CalendarClock size={23}/>,tone:"purple"},
            {title:"Rented Out",num:rental.equipment.reduce((total,e)=>total+e.rentedOutUnits,0),
                caption:"Units physically released to customers",icon:<Truck size={23}/>,tone:"blue"},
            {title:"On Hold",num:rental.equipment.reduce((total,e)=>total+e.maintenanceUnits,0),
                caption:"Units held for equipment care or repair",icon:<ClipboardCheck size={23}/>,tone:"amber"},
        ].map(c=>{
            const iconTones: Record<string,string>={
                purple:"bg-[#F3EBFF] text-[#6C3AD6]",
                blue:"bg-[#E8F1FF] text-[#2169CF]",
                amber:"bg-[#FFF7E9] text-[#B7832E]",
            };
            const iconTone=iconTones[c.tone];
            return <section key={c.title} aria-busy={rental.loading} className="flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm">
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${rental.loading ? "animate-pulse bg-[#EEE8F3]" : iconTone}`} aria-hidden="true">{!rental.loading && c.icon}</span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{c.title}</span>
                    {rental.loading ? <span className="mt-1 block h-6 w-12 animate-pulse rounded bg-[#EEE8F3]"/> :
                        <span className="mt-1 block break-words text-[24px] font-bold leading-none tabular-nums text-[#25153D]">{rental.connected ? c.num.toLocaleString("en-PH") : "—"}</span>}
                    <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{rental.loading || rental.connected ? c.caption : "Rental data unavailable"}</span>
                </span>
            </section>;
        })}</div>}
        {/* Rental Operations Queue: rendered only in Staff Bookings (section="queue"). */}
        {!showInventory&&<section className={`${panel} flex h-[340px] min-h-0 flex-col`}>
            <div className="flex min-w-0 items-center justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="shrink-0 rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]"><ClipboardList size={18}/></span>
                    <div className="min-w-0">
                        <h3 className="text-[15px] font-bold text-[#21132E]">Rental Operations Queue</h3>
                        <p className="text-[11px] leading-4 text-[#86778F]">Review a booking, prepare each item, then release or receive the complete order</p>
                    </div>
                </div>
                <select aria-label="Filter rental tasks" value={taskFilter}
                        onChange={e=>setTaskFilter(e.target.value as typeof taskFilter)}
                        className="h-9 w-[104px] shrink-0 rounded-xl border border-[#E6DDF0] bg-white px-2 text-[11px] font-semibold text-[#2B174C] outline-none focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 focus:border-[#E6DDF0]">
                    <option value="all">All Tasks</option>
                    <option value="prepare">Prepare</option>
                    <option value="release">Release</option>
                    <option value="return">Returns</option>
                    <option value="inspect">Previous Returns</option>
                </select>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain" role="region" aria-label="Rental operations bookings" tabIndex={0}>
                <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                    <colgroup><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/><col className="w-[20%]"/></colgroup>
                    <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>{["Client / Booking Ref","Schedule","Booking Type","Status","Action"].map(h=><th className={th} key={h}>{h}</th>)}</tr></thead>
                    <tbody>{visibleBookingGroups.slice(0,50).map(group=>{
                        const active=selectedQueueReference===group.reference;
                        const open=()=>setSelectedQueueReference(group.reference);
                        return <tr key={group.reference} tabIndex={0} aria-selected={active}
                                   onClick={open} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==="Enter"||e.key===" ")){e.preventDefault();open();}}}
                                   className={`cursor-pointer border-t border-[#F0EAF4] text-[#2B174C] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#7C3AED] ${active?"":"hover:bg-[#FCF9FF]"}`}>
                            <td className={`py-2 text-left align-middle ${active?"border-l-4 border-[#6F3FD3] px-3":"px-4"}`}>
                                <span className="block break-words font-semibold">{group.clientName}</span>
                                <span className="mt-1 block break-all text-[10px] text-[#806A8C]">{group.reference}</span>
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                <span className="block font-medium">{queueScheduleDate(group.scheduleDate)}</span>
                                {group.eventTime&&<span className="mt-1 block text-[10px] text-[#806A8C]">{group.eventTime}</span>}
                                {group.returnDate!==group.scheduleDate&&<span className="mt-1 block text-[10px] text-[#806A8C]">Return: {queueScheduleDate(group.returnDate)}</span>}
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                <span className="block break-words font-medium">{group.bookingType}</span>
                                <span className="mt-1 block text-[10px] text-[#806A8C]">{group.tasks.length} equipment {group.tasks.length===1?"line":"lines"}</span>
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                                    <span className={`inline-block max-w-full text-center text-[10px] font-semibold leading-4 break-words ${queueBookingStatusStyles[queueBookingStatus(group.bookingStatus)]||"text-[#2B174C]"}`}>
                                        {queueBookingStatus(group.bookingStatus)}
                                    </span>
                            </td>
                            <td className="px-2 py-2 align-middle text-center">
                                <button type="button" aria-haspopup="dialog"
                                        onClick={e=>{e.stopPropagation();open();}}
                                        className="inline-flex min-h-[30px] w-[100px] max-w-full items-center justify-center rounded-lg border border-[#E2D7FA] bg-[#F4EFFD] px-2 py-1 text-center text-[11px] font-medium leading-4 text-[#5B32C5] transition-colors hover:border-[#C6B2F1] hover:bg-[#EAE0FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6F3FD3] cursor-pointer">
                                    View Items
                                </button>
                            </td>
                        </tr>;
                    })}</tbody>
                </table>
                {rental.connected&&visibleBookingGroups.length===0&&<Empty>No matching booking tasks. Select All Tasks, or confirm a booking with rental equipment.</Empty>}
                {visibleBookingGroups.length>50&&<p className="border-t border-[#F0EAF4] px-3 py-2 text-[11px] text-[#806A8C]">Showing the first 50 bookings. Use the search or filters to find another booking.</p>}
            </div>
        </section>}
        {rental.error&&<p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Rental operations unavailable: {rental.error} <button type="button" className="underline" onClick={()=>void rental.refresh(true)}>Retry</button></p>}
        {showInventory&&<>
            <div className="grid min-w-0 grid-cols-1 gap-4">
                {/* Reinstated using the original purple/white table design; operations reuse existing rental actions. */}
                <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm" aria-label="Equipment Care and Maintenance">
                    <div className="flex min-w-0 shrink-0 flex-wrap items-start justify-between gap-2 border-b border-[#E9E1EE] px-4 py-3.5">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="shrink-0 rounded-xl bg-[#F1EBFF] p-2 text-[#5A35A5]"><ClipboardCheck size={18}/></span>
                            <div className="min-w-0">
                                <h3 className="text-[15px] font-bold text-[#21132E]">Equipment Care &amp; Maintenance</h3>
                                <p className="text-[11px] leading-4 text-[#86778F]">Finalize older return inspections, repair equipment, and track missing items.</p>
                            </div>
                        </div>
                        <StaffRentalFilterSelect containerClassName="w-[160px] shrink-0" aria-label="Filter equipment care by status" value={careFilter}
                                                 onChange={e=>setCareFilter(e.target.value as typeof careFilter)}>
                            <option value="all">All Status</option>
                            {(Object.keys(careStatusLabel) as CareKind[]).map(kind=>
                                <option key={kind} value={kind}>{careStatusLabel[kind]}</option>)}
                        </StaffRentalFilterSelect>
                    </div>
                    <div className="max-h-[220px] w-full overflow-auto overscroll-contain" role="region" aria-label="Equipment care and maintenance tasks" tabIndex={0}>
                        <table className="w-full min-w-[430px] table-fixed text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[28%]"/><col className="w-[10%]"/><col className="w-[19%]"/><col className="w-[20%]"/><col className="w-[23%]"/></colgroup>
                            <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>
                                {['Equipment','Units','Issue','Status','Action'].map(h=><th key={h} className={th}>{h}</th>)}
                            </tr></thead>
                            <tbody>{visibleCareTasks.map(task=><tr key={task.key} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                <td className="px-4 py-2 text-left align-middle font-medium">{task.equipmentName}</td>
                                <td className="px-2 py-2 text-center align-middle font-semibold tabular-nums">{task.units}</td>
                                <td className="px-2 py-2 text-center align-middle" title={task.notes||undefined}>{careIssueLabel[task.kind]}</td>
                                <td className="px-2 py-2 text-center align-middle">
                                    <span className={`break-words text-[10px] font-semibold ${careStatusColor[task.kind]}`}>{careStatusLabel[task.kind]}</span>
                                </td>
                                <td className="px-2 py-2 align-middle text-center">
                                    {task.kind==="inspection"?
                                        <button type="button" className={careButton} disabled={!canOperate||rental.saving}
                                                onClick={()=>setConfirmRecordedReturn(task.allocation)}>Finalize Return</button>:
                                        task.kind==="cleaning"?
                                            <button type="button" className={careButton} disabled={!canOperate||rental.saving}
                                                    onClick={()=>openRentalAction(task.allocation)}>Mark Cleaned</button>:
                                            task.kind==="routine"?
                                                <button type="button" className={careButton} disabled={!canOperate||rental.saving||task.units<1}
                                                        onClick={()=>startStockTask({kind:'routine',id:task.maintenance.id,label:task.equipmentName,max:task.units,bookingReference:task.bookingReference})}>Mark Care Done</button>:
                                                task.kind==="missing"?
                                                    <button type="button" className={careButton} disabled={!canOperate||rental.saving||task.units<1}
                                                            onClick={()=>startCareConfirm('replace',{...task,id:task.report.id})}>Mark Replaced</button>:
                                                    <button type="button" className={careButton} disabled={!canOperate||rental.saving||task.units<1}
                                                            onClick={()=>startCareConfirm('complete',{...task,id:task.maintenance.id})}>Mark Repaired</button>}
                                </td>
                            </tr>)}</tbody>
                        </table>
                        {rental.connected&&visibleCareTasks.length===0&&<Empty>{careFilter==='all'&&!careQuery?
                            'No pending inspections, care, repair, or missing-equipment tasks.':'No matching equipment care tasks.'}</Empty>}
                    </div>
                </section>
                {/* Same header, filter and search layout as the Manager Branch Rental Equipment List. */}
                <section className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#E7DFEC] bg-white shadow-sm ${dateFiltersOpen ? "min-h-[470px]" : "h-[470px]"}`}>
                    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 px-4 py-3.5">
                        <div className="flex items-start gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F1EBFF] text-[#5A35A5]"><PackageCheck size={18}/></span>
                            <div>
                                <h2 className="text-[15px] font-bold text-[#21132E]">Branch Rental Equipment List</h2>
                                <p className="mt-0.5 text-[11px] text-[#86778F]">Daily rental availability · {branchName}</p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <StaffRentalFilterSelect containerClassName="w-[154px]" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)} aria-label="Filter rental category">
                                <option>All Categories</option>{rentalCategories.map(name=><option key={name}>{name}</option>)}
                            </StaffRentalFilterSelect>
                            <StaffRentalFilterSelect containerClassName="w-[148px]" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} aria-label="Filter rental equipment status">
                                {["All Status","Available","Unavailable"].map(value=><option key={value}>{value}</option>)}
                            </StaffRentalFilterSelect>
                            <button type="button" aria-expanded={dateFiltersOpen} onClick={()=>setDateFiltersOpen(v=>!v)}
                                    className="flex h-9 items-center gap-2 rounded-xl border border-[#E3D8EA] bg-white px-3 text-xs font-semibold text-[#2B174C] hover:bg-[#F8F3FC]">
                                <CalendarClock size={15}/> {appliedDates ? (appliedDates.from === manilaDate() && appliedDates.to === manilaDate() ? "Today" : "Dates Applied") : "Date Availability"} <ChevronDown size={14}/>
                            </button>
                        </div>
                    </div>
                    {dateFiltersOpen && <div className="flex shrink-0 flex-wrap items-end gap-3 border-t border-[#E9E1EE] bg-[#FCFAFF] px-4 py-3 text-xs">
                        <label className="space-y-1 font-semibold text-[#4E2C66]">From
                            <input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);resetDates();}} className="block h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-[#2B174C]"/>
                        </label>
                        <label className="space-y-1 font-semibold text-[#4E2C66]">To (inclusive)
                            <input type="date" min={fromDate||undefined} value={toDate} onChange={e=>{setToDate(e.target.value);resetDates();}} className="block h-10 rounded-xl border border-[#E3D8EA] bg-white px-3 text-[#2B174C]"/>
                        </label>
                        <button type="button" disabled={!fromDate||!toDate||toDate<fromDate||datesLoading} onClick={()=>void checkDates()}
                                className="h-10 rounded-xl bg-[#2B174C] px-4 font-semibold text-white disabled:opacity-50">{datesLoading?"Checking...":"Check Dates"}</button>
                        <button type="button" onClick={()=>{const today=manilaDate();setFromDate(today);setToDate(today);void checkDates(today,today);}}
                                className="h-10 rounded-xl border border-[#E3D8EA] bg-white px-4 font-semibold text-[#2B174C]">Clear</button>
                        {datesError && <p role="alert" className="w-full text-red-700">{datesError}</p>}
                        <p className="w-full text-[#86778F]">Checking dates changes the Status and available quantity for that period. Fully Booked counts only confirmed reservations. Physical stock and equipment conditions are shown separately.</p>
                    </div>}
                    <div className="grid shrink-0 gap-3 px-4 pb-4">
                        <label className="relative min-w-0"><span className="sr-only">Search rental equipment</span>
                            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9B8AAA]"/>
                            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search equipment no., rental products, or categories..."
                                   className="h-11 w-full rounded-xl border border-[#E3D8EA] bg-white pl-11 pr-3 text-sm text-[#2B174C] outline-none placeholder:text-[#9B8AAA] focus:border-[#5A35A5]"/>
                        </label>
                    </div>
                    <div className={`w-full flex-1 overflow-auto overscroll-contain border-t border-[#E9E1EE] ${dateFiltersOpen ? "max-h-[360px] min-h-[180px]" : "min-h-0"}`} role="region" aria-label="Branch rental equipment list" tabIndex={0}>
                        <table className="w-full min-w-[980px] table-auto text-center text-[11px] [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                            <colgroup><col className="w-[13%]"/><col className="w-[15%]"/><col className="w-[9%]"/><col className="w-[7%]"/><col className="w-[8%]"/><col className="w-[7.5%]"/><col className="w-[7%]"/><col className="w-[7.5%]"/><col className="w-[9%]"/><col className="w-[17%]"/></colgroup>
                            <thead className="sticky top-0 z-10 bg-[#FFFCF8] text-[10px] uppercase tracking-wide text-[#806A8C]">
                            <tr className="border-b border-[#E9E1EE]">
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Equipment No.</th>
                                <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Rental Product</th>
                                <th className="truncate px-2 py-2 font-semibold text-center text-[10px] uppercase tracking-normal text-[#806A8C]">Category</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Total Units</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Available</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Reserved</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Rented Out</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">On Hold</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Status</th>
                                <th className="truncate px-2 py-2 text-center font-semibold text-[10px] uppercase tracking-normal text-[#806A8C]">Action</th>
                            </tr>
                            </thead>
                            <tbody>{visibleEquipment.map(e=>{
                                const availability=staffEquipmentStatus(e,appliedDates?datesAvailability?.get(e.id):e.bookableToday);
                                const availabilityColor=availability==='Fully Available'||availability==='Available'?'text-[#23834A]':availability==='Low Availability'?'text-[#A66A00]':availability==='Not Checked'?'text-[#6B6174]':'text-[#D92C3F]';
                                return <tr key={e.id} className="h-12 border-b border-[#EFE8F2] text-[#2B174C] last:border-0 hover:bg-[#FFFCF8]">
                                    <td className="whitespace-nowrap py-2 px-4 text-left font-semibold">{e.equipmentNumber||'—'}</td>
                                    <td className="px-2 py-2 font-semibold">{e.name}</td>
                                    <td className="px-2 py-2 text-[#5F4E75]">{e.category}</td>
                                    <td className="px-2 py-2 text-center font-semibold">{e.totalUnits}</td>
                                    <td className="px-2 py-2 text-center font-semibold" title={appliedDates?"Available units for the selected date range":"Available today after overlapping confirmed reservations, not just physically ready units"}>{appliedDates?(datesAvailability?.get(e.id)??"—"):e.bookableToday}</td>
                                    <td className="px-2 py-2 text-center" title="Confirmed bookings not yet released, for the selected dates">{appliedDates?(datesReserved?.get(e.id)??"—"):"—"}</td>
                                    <td className="px-2 py-2 text-center">{e.rentedOutUnits}</td>
                                    <td className="px-2 py-2 text-center" title={`On Hold: ${holdBreakdown.get(e.id)?.inspection??0} inspection, ${holdBreakdown.get(e.id)?.cleaning??0} cleaning, ${holdBreakdown.get(e.id)?.routine??0} routine care, ${holdBreakdown.get(e.id)?.repairs??0} repair. Outstanding missing units: ${e.missingUnits}.`}>
                                        <span>{e.maintenanceUnits}</span>
                                        {e.missingUnits > 0 && <span className="mt-1 block whitespace-nowrap text-[10px] font-semibold text-[#B45309]">Missing: {e.missingUnits}</span>}
                                    </td>
                                    <td className="px-2 py-2 text-center"><span className={`inline-block text-[10px] font-semibold ${availabilityColor}`}>{availability}</span></td>
                                    <td className="px-2 py-2 text-center"><div className="flex flex-nowrap items-center justify-center gap-1.5 whitespace-nowrap">
                                        <button type="button" className={scheduleAction} onClick={()=>openSchedule(e.id)}><CalendarDays size={13}/> View Schedule</button>
                                        <button type="button" className={restockAction} disabled={!canOperate} aria-label={`Restock ${e.name}`}
                                                title={canOperate?undefined:"Full Inventory access is required to restock."}
                                                onClick={()=>{setRestockItem(e);setRestockQuantity("");setRestockError("");}}><PackagePlus size={13}/> Restock</button>
                                    </div></td>
                                </tr>;
                            })}</tbody>
                        </table>
                        {rental.connected&&visibleEquipment.length===0&&<Empty>No rental equipment matches the selected filters.</Empty>}
                    </div>
                </section>
            </div>
        </>}
        {/* Only the queue presentation changes: equipment actions still use their existing confirmation dialogs and API. */}
        {selectedQueueBooking && <div role="presentation" className="fixed inset-0 z-[80] flex items-center justify-center bg-[#21132E]/55 p-4"
                                      onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving)setSelectedQueueReference(null);}}>
            <section role="dialog" aria-modal="true" aria-labelledby="staff-rental-queue-dialog-title"
                     className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[#E6DDF0] bg-white shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-5 py-4">
                    <div className="min-w-0">
                        <h3 id="staff-rental-queue-dialog-title" className="text-lg font-bold text-[#21132E]">Equipment for this Booking</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{selectedQueueBooking.reference}</p>
                    </div>
                    <button type="button" aria-label="Close equipment checklist" className={`${action} h-9 px-3`}
                            onClick={()=>setSelectedQueueReference(null)}><X size={16}/> Close</button>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-4">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Client</p>
                                <p className="mt-1 break-words text-sm font-semibold text-[#21132E]">{selectedQueueBooking.clientName}</p></div>
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Schedule</p>
                                <p className="mt-1 text-sm font-semibold text-[#21132E]">{queueScheduleDate(selectedQueueBooking.scheduleDate)}{selectedQueueBooking.eventTime?` · ${selectedQueueBooking.eventTime}`:""}</p>
                                {selectedQueueBooking.returnDate!==selectedQueueBooking.scheduleDate&&
                                    <p className="mt-1 text-xs text-[#806A8C]">Return: {queueScheduleDate(selectedQueueBooking.returnDate)}</p>}</div>
                            <div><p className="text-[10px] font-semibold uppercase tracking-wide text-[#806A8C]">Booking Type</p>
                                <p className="mt-1 text-sm font-semibold text-[#21132E]">{selectedQueueBooking.bookingType}</p>
                                {selectedQueueBooking.packageName&&<p className="mt-1 text-xs text-[#806A8C]">{selectedQueueBooking.packageName}</p>}</div>
                        </div>
                    </div>
                    <div className="overflow-hidden rounded-xl border border-[#E6DDF0]">
                        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E9E1EE] px-4 py-3">
                            <div>
                                <h4 className="text-sm font-bold text-[#21132E]">Rental Equipment Checklist</h4>
                                <p className="mt-1 text-[11px] text-[#806A8C]">{selectedQueueBooking.tasks.length} equipment {selectedQueueBooking.tasks.length===1?"line":"lines"} · {selectedQueueBooking.tasks.reduce((sum,x)=>sum+x.item.quantity,0)} booked units</p>
                                <p className="mt-1 text-[11px] text-[#806A8C]">{selectedQueueBooking.tasks.filter(x=>x.type!=="prepare").length} of {selectedQueueBooking.tasks.length} equipment lines prepared or further along</p>
                            </div>
                            <span className={`rounded-full px-3 py-1 text-[10px] font-semibold ${selectedQueuePaid && selectedQueueDepositSettled ? "bg-[#E5F7ED] text-[#218246]" : "bg-[#FFF3D8] text-[#986408]"}`}>
                                {!selectedQueuePaid ? (selectedQueuePayment && Number.isFinite(selectedQueuePayment.bookingBalance) ? "Booking Balance Pending" : "Payment Unavailable")
                                    : !selectedQueueDepositSettled ? "Security Deposit Pending" : "Fully Settled"}
                            </span>
                        </div>
                        <div className="max-h-[320px] min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain">
                            <table className="w-full min-w-0 table-fixed text-center text-xs [&_th]:align-middle [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:overflow-hidden [&_th]:text-ellipsis [&_th]:text-[10px] [&_th]:font-semibold [&_th]:uppercase [&_th]:leading-tight [&_th]:tracking-normal [&_th]:text-[#806A8C] [&_td]:leading-snug [&_td]:[overflow-wrap:anywhere]">
                                <colgroup><col className="w-[39%]"/><col className="w-[11%]"/><col className="w-[23%]"/><col className="w-[27%]"/></colgroup>
                                <thead className="sticky top-0 z-10 bg-[#FFFDF8]"><tr>{["Equipment","Qty","Status","Action"].map(h=><th key={h} className={th}>{h}</th>)}</tr></thead>
                                <tbody>{selectedQueueBooking.tasks.map(({item,type})=>{
                                    const perItemAction=type==="prepare"||type==="inspect";
                                    const nextLabel=type==="release"?"Ready for booking release":
                                        type==="return"?"Include in booking return":taskLabel[type||"prepare"];
                                    return <tr key={item.allocationId} className="border-t border-[#F0EAF4] text-[#2B174C]">
                                        <td className="break-words py-2 font-medium px-4 text-left">{item.equipmentName}</td>
                                        <td className="px-2 py-2 text-center font-semibold tabular-nums">{item.quantity}</td>
                                        <td className={`px-2 py-2 text-center text-[10px] font-semibold ${type==="release"?"text-[#23834A]":type==="return"?"text-[#1D4ED8]":type==="damage"?"text-[#D92C3F]":"text-[#A56607]"}`}>{taskStatusLabel[type||"prepare"]||taskLabel[type||"prepare"]}</td>
                                        <td className="px-2 py-2 text-center">
                                            {perItemAction?<button type="button" className={`${action} h-auto min-h-9 w-full break-words px-2 py-1.5 text-[11px]`}
                                                                   disabled={!canOperate||rental.saving} title={taskHelp[type||"prepare"]}
                                                                   onClick={()=>type==="inspect"?setConfirmRecordedReturn(item):openRentalAction(item)}>{taskLabel[type||"prepare"]}</button>:
                                                <span className="text-[11px] text-[#806A8C]">{nextLabel}</span>}
                                        </td>
                                    </tr>;
                                })}</tbody>
                            </table>
                        </div>
                        {submitError&&<p role="alert" className="border-t border-[#F0EAF4] bg-red-50 px-4 py-2 text-xs text-red-700">{submitError}</p>}
                        {queueAllReserved&&<div className="space-y-2 border-t border-[#F0EAF4] px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-[#2B174C]">Release the complete booking</p>
                                    <p className="mt-1 text-[11px] text-[#806A8C]">All equipment must be prepared; the booking balance and any agreed security deposit must be fully paid, and the release date must be reached.</p>
                                </div>
                                <button type="button" className={`${primary} disabled:cursor-not-allowed disabled:opacity-40`}
                                        disabled={!queueReleaseReady} onClick={()=>startBookingOperation("release")}>Release Booking</button>
                            </div>
                            {!queueAllPrepared&&<p className="text-[11px] text-[#986408]">Prepare every equipment line before releasing the booking.</p>}
                            {queueAllPrepared&&!selectedQueuePaid&&<p className="text-[11px] text-[#986408]">Full payment has not been recorded; Release Booking remains disabled.</p>}
                            {queueAllPrepared&&selectedQueuePaid&&!selectedQueueDepositSettled&&<p className="text-[11px] text-[#986408]">The agreed refundable security deposit is unpaid or cannot be verified; release remains disabled.</p>}
                            {queueAllPrepared&&selectedQueuePaid&&selectedQueueDepositSettled&&!queueReleaseDateValid&&<p className="text-[11px] text-[#986408]">Release is available on or after the scheduled rental start date.</p>}
                        </div>}
                        {queueAllOut&&<div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#F0EAF4] px-4 py-3">
                            <p className="text-xs text-[#5A476A]">Receive all booked equipment in one return transaction, with missing quantities recorded separately.</p>
                            <button type="button" className={primary} disabled={!canOperate||rental.saving}
                                    onClick={()=>startBookingOperation("return")}>Receive Booking Return</button>
                        </div>}
                        {!queueAllReserved&&!queueAllOut&&selectedQueueBooking.tasks.some(x=>x.type==="return")&&
                            <p className="border-t border-[#F0EAF4] px-4 py-3 text-[11px] text-[#986408]">This booking has mixed rental stages from an older partial handover. Ask the Manager to reconcile it before a booking-wide return.</p>}
                    </div>
                    <p className="px-4 py-2 text-[11px] text-[#806A8C]">Prepare and release equipment by booking. On return, Staff records missing/damaged units and confirms the condition check once. Only damaged units remain on hold until Staff verifies their repair. Older returns have a one-time closeout action.</p>
                </div>
                <div className="flex justify-end border-t border-[#E9E1EE] px-5 py-3">
                    <button type="button" className={`${action} h-9 px-4`} onClick={()=>setSelectedQueueReference(null)}>Close</button>
                </div>
            </section>
        </div>}
        {bookingOperation&&selectedQueueBooking&&<div role="presentation" className="fixed inset-0 z-[95] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4"
                                                      onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving)setBookingOperation(null);}}>
            <section role="alertdialog" aria-modal="true" aria-label={bookingOperation==="release"?"Confirm complete booking release":"Receive complete booking return"}
                     className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                    <div><h3 className="text-lg font-bold text-[#21132E]">{bookingOperation==="release"?"Release Booking":"Receive Booking Return"}</h3>
                        <p className="mt-1 break-all text-xs text-[#806A8C]">{selectedQueueBooking.reference}</p></div>
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setBookingOperation(null)}><X size={16}/> Close</button>
                </div>
                {bookingOperation==="release"?<div className="rounded-xl bg-[#F7F3FC] p-3 text-xs text-[#5A476A]">
                    Confirm the complete physical handover of <strong>{selectedQueueBooking.tasks.reduce((sum,x)=>sum+x.item.quantity,0)} units</strong> across {selectedQueueBooking.tasks.length} equipment lines. All must be ready and the booking fully paid. This updates each rental allocation together.
                </div>:<>
                    <p className="text-xs text-[#5A476A]">Record only missing or damaged quantities. Zero means no issue was reported. Staff checks the returned units and completes necessary routine care before confirming this return. Customer charges always require Manager review.</p>
                    <div className="space-y-2">{selectedQueueBooking.tasks.map(({item})=>{
                        const missing=Number(bookingReturnMissing[item.allocationId]??"0");
                        const observedDamage=Number(bookingReturnDamaged[item.allocationId]??"0");
                        const received=Number.isSafeInteger(missing)&&missing>=0?Math.max(0,item.quantity-missing):null;
                        return <div key={item.allocationId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E6DDF0] p-3 text-xs">
                            <span className="min-w-[155px] flex-1"><strong className="block text-[#2B174C]">{item.equipmentName}</strong>
                                <span className="mt-1 block text-[#806A8C]">Booked: {item.quantity} units · Returned: {received??"—"}</span></span>
                            <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Missing
                                    <input type="number" min="0" max={item.quantity} step="1" required value={bookingReturnMissing[item.allocationId]??"0"}
                                           onChange={e=>setBookingReturnMissing(prev=>({...prev,[item.allocationId]:e.target.value}))}
                                           disabled={rental.saving} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                                <label className="flex items-center gap-2 font-semibold text-[#5A476A]">Damaged
                                    <input type="number" min="0" max={received??item.quantity} step="1" required value={bookingReturnDamaged[item.allocationId]??"0"}
                                           onChange={e=>setBookingReturnDamaged(prev=>({...prev,[item.allocationId]:e.target.value}))}
                                           disabled={rental.saving} className="w-16 rounded-lg border border-[#E6DDF0] p-2 text-sm"/></label>
                            </div>
                            {Number.isSafeInteger(missing)&&Number.isSafeInteger(observedDamage)&&missing+observedDamage>item.quantity&&
                                <p role="alert" className="w-full text-red-700">Missing + damaged cannot exceed {item.quantity} units.</p>}
                        </div>;
                    })}</div>
                    <label className="block text-xs font-semibold text-[#2B174C]">Return notes (required if anything is missing or visibly damaged)
                        <textarea rows={3} maxLength={400} value={bookingOperationNotes} onChange={e=>setBookingOperationNotes(e.target.value)}
                                  disabled={rental.saving} className="mt-2 w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" placeholder="Describe missing units, visible damage or return details..."/></label>
                    <div className="space-y-2 rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs text-[#4F3A5A]">
                        <label className="flex items-start gap-2"><input type="checkbox" checked={returnConditionChecked}
                                                                         onChange={e=>setReturnConditionChecked(e.target.checked)} disabled={rental.saving} className="mt-0.5"/>
                            <span><strong>I checked the returned items and completed necessary routine care for all units not reported damaged.</strong> Other returned units can now be rented again. Only damaged units remain On Hold.</span></label>
                    </div>
                    <p className="text-[11px] text-[#806A8C]">Missing items go to Manager investigation. Confirmed damage creates a Manager maintenance case, but customer billing still requires a separate Manager decision. No second inspection is needed when the condition check is completed here.</p>
                </>}
                {bookingOperationError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{bookingOperationError}</p>}
                <div className="flex justify-end gap-2 border-t border-[#E9E1EE] pt-3">
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setBookingOperation(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rental.saving} onClick={()=>void performBookingOperation()}>
                        {rental.saving?"Saving...":bookingOperation==="release"?"Confirm Full Release":"Confirm Complete Return"}</button>
                </div>
            </section>
        </div>}
        {scheduleEquipmentId!==null&&<div role="presentation" className="fixed inset-0 z-[100] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4"
                                          onMouseDown={e=>{if(e.target===e.currentTarget)setScheduleEquipmentId(null);}}>
            <section role="dialog" aria-modal="true" aria-label="Rental equipment booking schedule"
                     className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-2">
                    <div><h3 className="text-lg font-bold text-[#21132E]">View Equipment Schedule</h3>
                        <p className="text-xs text-[#86778F]">{equipmentById.get(scheduleEquipmentId)?.name||"Rental equipment"} · {branchName}</p></div>
                    <button type="button" aria-label="Close schedule" onClick={()=>setScheduleEquipmentId(null)}><X size={19}/></button>
                </div>
                <div className="rounded-xl border border-[#E6DDF0] p-3 sm:p-4" aria-label="Booking calendar">
                    <div className="mb-3 flex items-center justify-between gap-2">
                        <button type="button" className={`${action} h-9 w-9 p-0`} aria-label="Previous month"
                                disabled={scheduleMonth<=today.slice(0,7)} onClick={()=>navigateScheduleMonth(-1)}><ChevronLeft size={17}/></button>
                        <h4 className="text-sm font-bold text-[#2B174C]">{new Date(`${scheduleMonth}-01T12:00:00+08:00`).toLocaleDateString("en-PH",{month:"long",year:"numeric",timeZone:"Asia/Manila"})}</h4>
                        <button type="button" className={`${action} h-9 w-9 p-0`} aria-label="Next month"
                                onClick={()=>navigateScheduleMonth(1)}><ChevronRight size={17}/></button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                        {weekDays.map(day=><span key={day} className="py-1 font-semibold text-[#806A8C]">{day}</span>)}
                        {calendarCells.map((date,index)=>{
                            if(!date)return <span key={`empty-${index}`} aria-hidden="true"/>;
                            const marked=calendar?.month===scheduleMonth?calendarMarked.get(date):undefined;
                            const isSelected=scheduleDate===date;
                            const isPast=date<today;
                            return <button type="button" key={date} disabled={isPast} onClick={()=>setScheduleDate(date)}
                                           aria-label={`${queueScheduleDate(date)}${marked?`, ${marked.allocationCount} booked allocation(s)`:""}`}
                                           aria-pressed={isSelected} title={marked?`${marked.allocationCount} booking allocation(s) · ${marked.bookedUnits} units`:"No confirmed allocation"}
                                           className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5330B6] ${isSelected
                                               ?"border-[#2B174C] bg-[#2B174C] text-white"
                                               :marked?"border-[#CEB9F3] bg-[#F1EBFF] text-[#5330B6] hover:bg-[#E5D9FF]"
                                                   :"border-transparent text-[#2B174C] hover:bg-[#F7F1FF]"} ${isPast?"cursor-not-allowed opacity-30":""}`}>
                                {Number(date.slice(-2))}
                                <span aria-hidden="true" className={`mt-1 h-1.5 w-1.5 rounded-full ${marked?(isSelected?"bg-white":"bg-[#7240CA]"):"bg-transparent"}`}/>
                            </button>;
                        })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#806A8C]">
                        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#7240CA]"/> Confirmed rental allocation</span>
                        <span>Click a date to view booking details below.</span>
                    </div>
                    {calendarLoading&&<p role="status" className="mt-2 text-xs text-[#806A8C]">Loading marked dates...</p>}
                    {calendarError&&<p role="alert" className="mt-2 text-xs text-red-700">{calendarError}</p>}
                </div>
                {scheduleLoading&&<p role="status" className="text-sm text-[#86778F]">Loading booking details for the selected day...</p>}
                {scheduleError&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{scheduleError}</p>}
                {schedule&&!scheduleLoading&&<>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {[
                            {title:"Total Owned",value:schedule.totalUnits},
                            {title:"Physically Available Now",value:schedule.physicallyAvailableNow},
                            {title:"Reserved / Out on Date",value:schedule.bookedUnits},
                            {title:"Available on Date (est.)",value:schedule.availableOnDate},
                            {title:"On Hold Now",value:schedule.maintenanceUnits},
                            {title:"Missing",value:schedule.missingUnits},
                        ].map(c=><div key={c.title} className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                            <p className="text-[10px] text-[#806A8C]">{c.title}</p><p className="mt-1 text-lg font-bold text-[#2B174C]">{c.value}</p>
                        </div>)}
                    </div>
                    <p className="text-xs text-[#86778F]">Date estimate = total owned − current holds − missing − overlapping confirmed allocations. Current and future quantities may change after returns or new bookings. Overdue checked-out equipment stays blocked for future bookings until physically returned. A confirmed booking does not mean equipment is physically checked out.</p>
                    <div className="rounded-xl border border-[#E6DDF0]">
                        <div className="border-b border-[#E6DDF0] px-3 py-2 text-xs font-semibold">Booking details · {queueScheduleDate(schedule.date)} ({schedule.allocationCount} allocations)</div>
                        {schedule.allocationCount>schedule.bookings.length&&<p className="px-3 pt-2 text-xs text-amber-800">Showing the first {schedule.bookings.length} bookings; availability includes all {schedule.allocationCount} allocations.</p>}
                        <div className="max-h-48 overflow-y-auto">
                            {schedule.bookings.length===0?<p className="p-3 text-xs text-[#86778F]">No confirmed allocations cover this date.</p>:
                                schedule.bookings.map(b=><div key={b.allocationId} className="flex items-start justify-between gap-2 border-b border-[#F0EAF4] p-3 text-xs">
                                    <div><p className="break-all font-semibold text-[#2B174C]">{b.bookingReference}</p>
                                        <p className="mt-1 text-[#86778F]">{b.startDate} – {b.endDate} · {b.status==="checked_out"?"Out on Rental":"Reserved"}</p></div>
                                    <strong>{b.quantity} units</strong>
                                </div>)}
                        </div>
                    </div>
                    <p className="text-xs text-[#806A8C]">Only operational booking references, dates, quantities and rental statuses are shown. Staff completes handovers and returns through the Rental Operations Queue.</p>
                </>}
                <div className="flex justify-end"><button type="button" className={action} onClick={()=>setScheduleEquipmentId(null)}>Close</button></div>
            </section>
        </div>}
        {restockItem&&(()=>{
            // Same layout and wording as the Manager's rental Receive Stock dialog.
            const availableBefore=Math.max(0,restockItem.totalUnits-restockItem.rentedOutUnits-restockItem.maintenanceUnits-restockItem.missingUnits);
            const needsReconciliation=restockItem.rentedOutUnits+restockItem.maintenanceUnits+restockItem.missingUnits>restockItem.totalUnits;
            const qty=Number(restockQuantity)||0;
            const busy=rental.saving;
            const formatUnits=(value:number)=>value.toLocaleString("en-PH");
            return <div role="dialog" aria-modal="true" aria-label="Receive Stock"
                        className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50 px-3 py-5">
                <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                    <div className="flex items-center justify-between border-b border-[#E9E1EE] px-6 py-4">
                        <h2 className="text-xl font-bold text-[#21132E]">Receive Stock</h2>
                        <button type="button" onClick={()=>setRestockItem(null)} disabled={busy} aria-label="Close Receive Stock"
                                className="text-2xl text-[#806A8C] hover:text-[#2B174C] disabled:opacity-50">×</button>
                    </div>
                    <form onSubmit={submitRestock} className="flex min-h-0 flex-col">
                        <div className="space-y-5 overflow-y-auto px-6 py-5">
                            <div>
                                <h3 className="text-base font-bold text-[#21132E]">{restockItem.name}</h3>
                                <p className="mt-1 text-xs text-[#806A8C]">Product No. {restockItem.equipmentNumber || "—"} · {restockItem.category}</p>
                                <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-[#F7F1FF] p-4">
                                    <div><div className="text-xs text-[#806A8C]">Available Now (Physically Ready)</div>
                                        <div className="mt-1 text-xl font-bold text-[#2B174C]">{formatUnits(availableBefore)}</div></div>
                                    <div><div className="text-xs text-[#806A8C]">Available After Receiving</div>
                                        <div className="mt-1 text-xl font-bold text-[#2B174C]">{needsReconciliation ? "—" : formatUnits(availableBefore + qty)}</div></div>
                                </div>
                                {needsReconciliation && <p role="alert" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                    Assigned units exceed physical stock. Review booking, repair and missing records before receiving more stock; no new availability is projected until the records agree.
                                </p>}
                            </div>
                            <section className="space-y-3">
                                <h3 className="text-sm font-bold text-[#21132E]">Stock to Receive</h3>
                                <p className="text-xs text-[#806A8C]">Enter the quantity to add.</p>
                                <div className="space-y-3 rounded-xl border border-[#E3D8EA] p-4">
                                    <div className="flex justify-between gap-3">
                                        <div><strong className="text-sm text-[#2B174C]">Regular</strong></div>
                                        <span className="text-xs text-[#806A8C]">Available: {formatUnits(availableBefore)} pcs</span>
                                    </div>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1"><label className={labelClass}>Quantity to Add</label>
                                            <input type="number" min="0" step="1" value={restockQuantity}
                                                   onChange={e => setRestockQuantity(e.target.value)}
                                                   placeholder="0" className={fieldClass}/></div>
                                    </div>
                                    <p className="text-xs text-[#806A8C]">Available after receiving: {needsReconciliation ? "Reconciliation required" : `${formatUnits(availableBefore + qty)} pcs`}</p>
                                </div>
                                <div className="flex justify-between border-t border-[#E3D8EA] pt-3 text-sm font-semibold text-[#2B174C]">
                                    <span>Total Stock to Add</span><span>+{formatUnits(qty)} pcs</span>
                                </div>
                            </section>
                            {restockError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{restockError}</p>}
                        </div>
                        <div className="flex justify-end gap-2 border-t border-[#E3D8EA] bg-white px-6 py-4">
                            <button type="button" onClick={()=>setRestockItem(null)} disabled={busy}
                                    className="rounded-xl border border-[#E3D8EA] px-5 py-2.5 text-sm font-semibold text-[#2B174C]">Cancel</button>
                            <button type="submit" disabled={busy || qty <= 0}
                                    className="rounded-xl bg-[#2B174C] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                                {busy ? "Saving..." : "Confirm Stock In"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>;
        })()}
        {stockTask&&<div role="presentation" className="fixed inset-0 z-[105] flex items-center justify-center bg-[#21132E]/50 p-4">
            <section role="dialog" aria-modal="true" aria-label="Physical rental equipment task" className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-[#21132E]">
                    {stockTask.kind==="issue"?"Report Equipment Issue":"Complete Routine Care"}
                </h3><button type="button" disabled={rental.saving} onClick={()=>setStockTask(null)} aria-label="Close"><X size={19}/></button></div>
                <p className="text-sm text-[#5A476A]">{stockTask.label}</p>
                {stockTask.kind==="issue"&&stockTask.bookingReference&&<p className="rounded-lg bg-[#F7F1FF] p-2 text-xs text-[#56378B]">Found while preparing booking <strong>{stockTask.bookingReference}</strong>. The issue is recorded against available equipment; the booking&apos;s allocated quantity is not silently changed.</p>}
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Quantity (maximum {stockTask.max})
                    <input type="number" min={1} max={stockTask.max} step={1} value={stockQuantity} onChange={e=>setStockQuantity(e.target.value)}
                           className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm"/></label>
                {stockTask.kind==="issue"&&<label className="block space-y-1 text-xs font-semibold text-[#5A476A]">Issue type
                    <select value={issueType} onChange={e=>setIssueType(e.target.value as typeof issueType)} className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm">
                        <option value="damage">Damaged / Needs Inspection</option><option value="missing">Missing Equipment</option>
                        <option value="routine">Routine Cleaning / Minor Upkeep (no safety issue)</option>
                    </select></label>}
                <label className="block space-y-1 text-xs font-semibold text-[#5A476A]">
                    {stockTask.kind==="issue"?"What happened? (required)":"Completed routine work"}
                    <textarea rows={3} maxLength={500} value={stockNotes} onChange={e=>setStockNotes(e.target.value)}
                              className="w-full rounded-xl border border-[#E6DDF0] p-3 text-sm" placeholder={stockTask.kind==="issue"?"Describe what was found...":"Describe the completed care..."}/></label>
                <p className="text-xs text-[#86778F]">{stockTask.kind==="issue"?(issueType==="routine"?
                        "Routine is for cleaning and non-safety upkeep only. Broken, unstable, electrical, or unsafe equipment must be reported as Damaged. Units remain on hold until Staff marks routine care complete.":
                        "Damaged or missing units become unavailable immediately. Staff verifies repairs and physical replacements; Manager controls permanent write-offs and customer charges."):
                    "Routine care returns verified units to Available."}</p>
                {submitError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                <div className="flex justify-end gap-2"><button type="button" className={action} onClick={()=>setStockTask(null)} disabled={rental.saving}>Cancel</button>
                    <button type="button" className={primary} onClick={()=>void performStock()} disabled={rental.saving}>{rental.saving?"Saving...":stockTask.kind==="issue"?"Submit Issue Report":"Confirm"}</button></div>
            </section>
        </div>}
        {careConfirm&&<div role="presentation" className="fixed inset-0 z-[105] flex items-center justify-center bg-[#21132E]/50 p-4">
            <section role="alertdialog" aria-modal="true" aria-labelledby="staff-care-confirm-title"
                     className="max-h-[90dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 id="staff-care-confirm-title" className="text-lg font-bold text-[#21132E]">{careConfirm.kind==="complete"?"Mark Repaired":"Mark Replaced"}</h3>
                        <p className="mt-1 text-sm text-[#5A476A]">{careConfirm.label}</p>
                    </div>
                    <button type="button" disabled={rental.saving} onClick={()=>setCareConfirm(null)} aria-label="Close"><X size={19}/></button>
                </div>
                <dl className="text-xs">
                    <div><dt className="text-[#86778F]">Units</dt><dd className="mt-1 font-semibold text-[#21132E]">{careConfirm.units} unit(s)</dd></div>
                </dl>
                <div className="rounded-xl border border-[#E9E1EE] bg-[#FCFAFF] p-3">
                    <p className="text-xs font-semibold text-[#21132E]">{careConfirm.kind==="complete"?"Damage notes":"Missing equipment notes"}</p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-[#5F4E75]">{careConfirm.notes||"No notes recorded."}</p>
                </div>
                <div className="flex items-start gap-2 rounded-xl border border-[#CDEBD8] bg-[#F1FBF5] p-3 text-xs leading-5 text-[#1E6B3D]">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0"/>
                    <p>{careConfirm.kind==="complete"
                        ?<>These units have been repaired and are <strong>available to be rented again</strong> by customers.</>
                        :<>Replacement units have been received and are <strong>available to be rented again</strong> by customers. Don&apos;t confirm units already added through Restock.</>}</p>
                </div>
                {careConfirmError&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-xs text-red-700">{careConfirmError}</p>}
                <div className="flex justify-end gap-2">
                    <button type="button" className={action} onClick={()=>setCareConfirm(null)} disabled={rental.saving}>Cancel</button>
                    <button type="button" className={primary} onClick={()=>void performCareConfirm()} disabled={rental.saving||!canOperate||careConfirm.units<1}>{rental.saving?"Saving...":"Confirm"}</button>
                </div>
            </section>
        </div>}
        <SuccessToast toast={notice ? {title:"Rental task completed",message:notice} : null} onClose={closeStaffRentalToast} />
        {confirmRecordedReturn && <div role="presentation" className="fixed inset-0 z-[160] flex items-center justify-center bg-[#21132E]/55 p-3 sm:p-4">
            <section role="alertdialog" aria-modal="true" aria-label="Confirm recorded rental return" className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <h3 className="text-lg font-bold text-[#21132E]">Finalize Recorded Return</h3>
                <p className="text-sm text-[#6A5D6F]">Finish the previously recorded return for <strong>{confirmRecordedReturn.equipmentName}</strong>?</p>
                <div className="rounded-xl bg-[#F7F1FF] p-3 text-xs text-[#5330B6]">
                    <p>Booking Reference: <strong className="break-all">{confirmRecordedReturn.bookingReference || "—"}</strong></p>
                    <p>Physically returned: <strong>{confirmRecordedReturn.returnedReceivedUnits ?? confirmRecordedReturn.quantity}</strong></p>
                    <p>Recorded damaged: <strong>{Math.max(0, Number(confirmRecordedReturn.damagedUnits || 0))}</strong></p>
                </div>
                <p className="text-xs leading-5 text-[#6A5D6F]">Confirm you checked these units, the damage record is accurate, and routine care is complete for the other returned units. A Manager reviews damaged units; no customer charge is created automatically.</p>
                <div className="flex flex-wrap justify-end gap-2">
                    <button type="button" className={action} disabled={rental.saving} onClick={()=>setConfirmRecordedReturn(null)}>Cancel</button>
                    <button type="button" className={primary} disabled={rental.saving||!canOperate} onClick={()=>void finalizeRecordedReturn(confirmRecordedReturn)}>{rental.saving?"Saving...":"Confirm Return"}</button>
                </div>
            </section>
        </div>}
        {(selected||selectedEquipment)&&<div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-[#21132E]/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!rental.saving){setSelected(null);setViewEquipment(null);}}}>
            <section role="dialog" aria-modal="true" aria-label="Rental operation review" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#E6DDF0] bg-white p-5 shadow-xl">
                <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-bold text-[#21132E]">{selected?taskLabel[taskType(selected)||"prepare"]:selectedEquipment?.name}</h3><button aria-label="Close dialog" disabled={rental.saving} onClick={()=>{setSelected(null);setViewEquipment(null);}}><X size={19}/></button></div>
                {selected?<div className="mt-4 space-y-3 text-sm"><p className="font-semibold">{selected.equipmentName} · {selected.quantity} booked units</p><p>Confirmed booking: <strong>{selected.bookingReference}</strong></p><p>Rental period: {selected.startDate} – {selected.endDate}</p>
                    <p className="rounded-lg bg-[#F7F1FF] px-3 py-2 text-xs text-[#4D2B85]">Units for this action: <strong>{taskType(selected)==="inspect"?selected.returnedReceivedUnits:taskType(selected)==="clean"?selected.cleaningUnits:taskType(selected)==="damage"?selected.damagedUnits:selected.quantity}</strong></p>
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3">
                        <p className="text-[11px] font-semibold text-[#2B174C]">Booking equipment workflow</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {workflowStages.map((stage,index)=><span key={stage} className={`rounded-lg px-2 py-1 text-[10px] font-semibold ${taskType(selected)!=="damage"&&stageForTask[taskType(selected) as Exclude<TaskType,"damage">]===index
                                ?"bg-[#4D2B85] text-white":"bg-white text-[#86778F]"}`}>{stage}</span>)}
                        </div>
                        <p className="mt-2 text-xs text-[#6F5B7E]">{taskHelp[taskType(selected)||"prepare"]}</p>
                    </div>
                    {(taskType(selected)==="prepare"||taskType(selected)==="release")&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                        <p className="font-semibold">Found broken, dirty, or missing equipment before handover?</p>
                        <p className="mt-1">Report the affected available units first. They become unavailable or flagged missing, and this booking stays in its current stage. Stock is checked again before preparation and release. Obtain safe replacements if needed.</p>
                        <button type="button" className={`${action} mt-2`} disabled={!canOperate||rental.saving}
                                onClick={()=>reportIssueBeforeRelease(selected)}><AlertTriangle size={14}/> Report Equipment Issue</button>
                    </div>}
                    {taskType(selected)==="return"&&<div className="space-y-2 rounded-xl bg-amber-50 p-3 text-xs">
                        <p>Use Receive Booking Return to record missing/damaged units and finish the return condition check for the complete booking.</p>
                        <label className="block font-semibold">Missing units on return (0–{selected.quantity})
                            <input type="number" min={0} max={selected.quantity} step={1} value={returnMissing}
                                   onChange={e=>setReturnMissing(e.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm"/>
                        </label><p>Staff can record physically received replacement units in Equipment Care & Maintenance. Permanent write-offs and customer charges remain Manager-controlled. Damaged units stay on hold until Staff verifies repairs.</p>
                    </div>}
                    {taskType(selected)==="damage"&&<div className="rounded-lg bg-amber-50 p-3 text-xs"><AlertTriangle size={16} className="inline"/> Damaged units remain on hold until Staff records a verified repair and safety check.</div>}
                    {taskType(selected)!=="damage"&&<label className="block text-xs font-semibold">Notes
                        {taskType(selected)==="return"&&Number(returnMissing)>0?" (required for missing units)":" (optional)"}
                        <textarea className="mt-1 w-full rounded-xl border p-3 text-sm" maxLength={400} rows={3}
                                  value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Condition, missing accessories, handover notes..."/></label>}
                    {submitError&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-xs text-red-700">{submitError}</p>}
                    <div className="flex justify-end gap-2"><button className={action} disabled={rental.saving} onClick={()=>setSelected(null)}>Cancel</button>{taskType(selected)!=="damage"&&<button className={primary} disabled={rental.saving} onClick={()=>void perform()}>{rental.saving?"Saving...":taskType(selected)==="prepare"?"Confirm Preparation":"Confirm "+taskLabel[taskType(selected)||"prepare"]}</button>}</div>
                </div>:selectedEquipment&&<div className="mt-4 space-y-3 text-sm">
                    <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs">
                        <p className="font-semibold text-[#2B174C]">Equipment No.: {selectedEquipment.equipmentNumber}</p>
                        <p className="mt-2">Last stock received: <strong>{selectedEquipment.lastStockReceivedDate ? queueScheduleDate(selectedEquipment.lastStockReceivedDate) : "No stock receipt recorded"}</strong></p>
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {[{label:"Total Units",count:selectedEquipment.totalUnits},
                                {label:"Out",count:selectedEquipment.rentedOutUnits},
                                {label:"On Hold",count:selectedEquipment.maintenanceUnits},
                                {label:"Missing",count:selectedEquipment.missingUnits}].map(item=><div key={item.label} className="rounded-lg border border-[#E6DDF0] bg-white p-2">
                                <p className="text-[10px] text-[#806A8C]">{item.label}</p><p className="mt-1 text-base font-bold">{item.count}</p>
                            </div>)}
                        </div>
                    </div>
                    {(selectedEquipment.unitNumbers?.length||0)>0&&<div className="rounded-xl border border-[#E6DDF0] p-3"><p className="text-xs font-semibold text-[#2B174C]">Individual Equipment Nos. ({selectedEquipment.unitNumbers!.length} units):</p><div className="mt-1 flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">{selectedEquipment.unitNumbers!.map(number=><span key={number} className="rounded-md border border-[#E6DDF0] bg-[#FBF8FF] px-2 py-0.5 text-[11px] font-semibold text-[#4E2C66]">{number}</span>)}</div></div>}
                    {(()=>{
                        const h=holdBreakdown.get(selectedEquipment.id)||{inspection:0,cleaning:0,routine:0,repairs:0};
                        const known=h.inspection+h.cleaning+h.routine+h.repairs;
                        const other=Math.max(0,selectedEquipment.maintenanceUnits-known);
                        return <div className="rounded-xl border border-[#E6DDF0] bg-[#FBF9FE] p-3 text-xs">
                            <p className="font-semibold">Why units are On Hold</p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                                <span>Pending inspection: <strong>{h.inspection}</strong></span>
                                <span>Needs cleaning: <strong>{h.cleaning}</strong></span>
                                <span>Routine care: <strong>{h.routine}</strong></span>
                                <span>Repair / safety review: <strong>{h.repairs}</strong></span>
                                {other>0&&<span className="col-span-2">Other holds / older records: <strong>{other}</strong></span>}
                            </div>
                            {known>selectedEquipment.maintenanceUnits&&<p role="alert" className="mt-2 text-red-700">Hold task quantities exceed the equipment hold total. Ask the Manager to reconcile records.</p>}
                            <p className="mt-2 text-[#86778F]">Known tasks from the current workspace. Previous returns may need a one-time confirmation; new returns have their condition check completed when received.</p>
                        </div>;
                    })()}
                    {careTasks.filter(task=>task.equipmentId===selectedEquipment.id).length>0&&
                        <div className="space-y-2 rounded-xl border border-[#E6DDF0] p-3 text-xs">
                            <p className="font-semibold text-[#2B174C]">Outstanding stock care</p>
                            {careTasks.filter(task=>task.equipmentId===selectedEquipment.id).map(task=><div key={task.key} className="flex flex-wrap items-center justify-between gap-2 border-t border-[#F0EAF4] pt-2">
                                <span className="min-w-0 flex-1 text-[#5A476A]">{task.kind==="inspection"?"Previous return pending inspection":task.kind==="cleaning"?"Clean returned equipment":task.kind==="routine"?"Routine care":"Repair / safety review"} · {task.units} unit(s)</span>
                                {task.kind==="inspection"?
                                    <button type="button" disabled={!canOperate||rental.saving} className={action}
                                            onClick={()=>{setViewEquipment(null);setConfirmRecordedReturn(task.allocation);}}>Finalize Return</button>:
                                    task.kind==="cleaning"?
                                        <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                onClick={()=>{setViewEquipment(null);openRentalAction(task.allocation);}}>Mark Cleaned</button>:
                                        task.kind==="routine"?
                                            <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                    onClick={()=>{setViewEquipment(null);startStockTask({kind:"routine",id:task.maintenance.id,label:task.equipmentName,max:task.units,bookingReference:task.bookingReference});}}>Mark Care Done</button>:
                                            <button type="button" disabled={!canOperate||rental.saving} className={action}
                                                    onClick={()=>{setViewEquipment(null);startCareConfirm("complete",{...task,id:task.maintenance.id});}}>Mark Repaired</button>}
                            </div>)}
                        </div>}
                    <p className="text-xs font-semibold text-[#5A476A]">Stock check: {selectedEquipment.totalUnits} owned = {Math.max(0,selectedEquipment.totalUnits-selectedEquipment.rentedOutUnits-selectedEquipment.maintenanceUnits-selectedEquipment.missingUnits)} available + {selectedEquipment.rentedOutUnits} out + {selectedEquipment.maintenanceUnits} held + {selectedEquipment.missingUnits} missing.</p><p className="rounded-lg bg-[#F7F3FC] p-3 text-xs">Product catalog and rental pricing are managed by the Manager.</p></div>}
            </section>
        </div>}
    </div>;
}