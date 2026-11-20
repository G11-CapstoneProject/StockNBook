"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { AlertTriangle, Box, CalendarClock, ClipboardCheck, CornerUpLeft, RefreshCw, Wrench, PieChart, BarChart3, ShoppingCart, Package, ShieldCheck, CheckCircle2, Clock3 } from "lucide-react";

type TaskStatus = "To Prepare" | "For Release" | "Expected Return";
type Task = {key:string; reference:string;customer:string;scheduledDate:string;status:TaskStatus};
type Alert = {key:string;product:string;available:number;status:"Low Stock"|"Out of Stock"};
type Repair = {key:string;equipmentNo:string;product:string;units:number;status:"Under Repair"};
type Access = {bookings:boolean;inventory:boolean;pos:boolean};
type Hour = {hour:number;transactions:number;items:number};
type ConsumableHealth = {healthy:number;lowStock:number;outOfStock:number};
type InventoryAlertSummary = {expiring:number;expired:number;lowStock:number;outOfStock:number;underRepair:number};
type RentalHealth = {serviceable:number;underRepair:number;otherUnavailable?:number};
type Summary = {success:true;access:Access;today:string;branchId:number;staffId:string;tasks:Task[]|null;alerts:Alert[]|null;repair:Repair[]|null;condition:RentalHealth|null;consumableHealth?:ConsumableHealth|null;inventoryAlertSummary?:InventoryAlertSummary|null;walkIn:Hour[]|null;errors:string[]};
const statuses:TaskStatus[]=["To Prepare","For Release","Expected Return"];
const statusColors:Record<TaskStatus,string>={"To Prepare":"#6C3AD6","For Release":"#25865B","Expected Return":"#2169CF"};
const cardClass = "min-w-0 rounded-2xl border border-[#E7DFEC] bg-white shadow-sm";
const headerClass = "flex min-h-[64px] min-w-0 items-center gap-2.5 px-4 py-3.5";
const iconClass = "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]";
const tableHeader = "sticky top-0 z-10 bg-[#FFFCF7] text-[10px] font-semibold uppercase text-[#806A8C]";
const linkClass = "shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold text-[#6D35D4] transition hover:bg-[#FAF7FE] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]";
const panelRowClass = "border-t border-[#F1ECF4] transition-colors hover:bg-[#FBF8FE]";
function PanelFooter({label,onClick}:{label:string;onClick?:()=>void}) {
    if (!onClick) return null;
    return <footer className="mt-auto flex shrink-0 justify-end border-t border-[#F1ECF4] px-3 py-1.5">
        <button type="button" onClick={onClick} className={linkClass}>{label}</button>
    </footer>;
}
const fmtInt = (value: number) => value.toLocaleString("en-PH");
function saved(key: string) { return typeof window === "undefined" ? "" : sessionStorage.getItem(key) || localStorage.getItem(key) || ""; }
function manilaDay(value: Date): string { const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Manila", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(value); const part = (key: string) => parts.find(p=>p.type===key)?.value || ""; return `${part("year")}-${part("month")}-${part("day")}`; }
function clock(value: Date) { return `${value.toLocaleDateString("en-US",{timeZone:"Asia/Manila",month:"long",day:"numeric",year:"numeric"})} | ${value.toLocaleTimeString("en-US",{timeZone:"Asia/Manila",hour:"numeric",minute:"2-digit",hour12:true}).toLowerCase()}`; }
const metricColors = {
    violet: "bg-[#F3EBFF] text-[#6C3AD6]",
    green: "bg-[#EAF7F0] text-[#25865B]",
    blue: "bg-[#E8F1FF] text-[#2169CF]",
    orange: "bg-[#FFF7E9] text-[#B7832E]",
    teal: "bg-[#E5F7F5] text-[#147D77]",
} as const;
const kpiCardClass = "flex min-h-[108px] min-w-0 w-full items-center gap-3 rounded-[16px] border border-[#E6DDF0] bg-white px-3.5 py-3 text-left shadow-sm";
function Metric({label,value,helper,icon,tone,onClick,loading}:{label:string;value:number|null;helper:string;icon:ReactNode;tone:keyof typeof metricColors;onClick?:()=>void;loading:boolean}) {
    const contents = <>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${loading ? "animate-pulse bg-[#EEE8F3]" : metricColors[tone]}`} aria-hidden="true">{!loading && icon}</span>
        <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-4 text-[#25153D]">{label}</span>
            {loading ? <span className="mt-1 block h-6 w-12 animate-pulse rounded bg-[#EEE8F3]"/> : <span className="mt-1 block break-words text-[24px] font-bold leading-none tabular-nums text-[#25153D]">{value===null ? "—" : fmtInt(value)}</span>}
            <span className="mt-1 block text-[11px] leading-4 text-[#806A8C]">{helper}</span>
        </span>
    </>;
    return onClick && !loading ? <button type="button" className={`${kpiCardClass} group cursor-pointer transition hover:border-[#B6A1D4] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]`} onClick={onClick}>{contents}</button> : <div className={kpiCardClass} aria-busy={loading}>{contents}</div>;
}

function Status({value}:{value:TaskStatus|Alert['status']|Repair['status']}) {
    return <span className="font-semibold" style={{color:statuses.includes(value as TaskStatus)?statusColors[value as TaskStatus]:value==='Out of Stock'?'#D52B2B':'#A66A00'}}>{value}</span>;
}
function Title({title,description,icon,tone,action}:{title:string;description:string;icon:ReactNode;tone:string;action?:ReactNode}) {
    return <div className={`${headerClass} flex-wrap justify-between`}><div className="flex min-w-0 flex-1 items-center gap-2.5"><span className={`${iconClass} ${tone}`} aria-hidden="true">{icon}</span><div className="min-w-0"><h2 className="break-words text-[15px] font-bold leading-5 text-[#1A1220]">{title}</h2><p className="mt-0.5 text-[11px] leading-4 text-[#86778F]">{description}</p></div></div>{action}</div>;
}
function TablePanel({title,description,icon,tone,headers,rows,empty,unavailable,action,footer}:{title:string;description:string;icon:ReactNode;tone:string;headers:string[];rows:{key:string;cells:ReactNode[]}[];empty:string;unavailable:boolean;action?:ReactNode;footer?:{label:string;onClick:()=>void}}) {
    return <section className={`${cardClass} flex min-h-[185px] flex-col overflow-hidden`}><Title {...{title,description,icon,tone,action}}/>
        <div className="min-h-0 max-h-[360px] flex-1 overflow-auto border-t border-[#F1ECF4]">
            <table className={`w-full ${headers.length===4?'min-w-[430px]':'min-w-[300px]'} table-fixed text-[11px]`}><thead className={tableHeader}><tr>{headers.map((h,i)=><th key={h} scope="col" className={`px-3 py-2.5 ${i===0?'text-left':i===headers.length-1?'text-right':'text-center'}`}>{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.key} className={panelRowClass}>{r.cells.map((cell,i)=><td key={i} className={`break-words px-3 py-2.5 tabular-nums text-[#392648] ${i===0?'text-left font-semibold':i===headers.length-1?'text-right':'text-center'}`}>{cell}</td>)}</tr>)}{rows.length===0&&<tr><td colSpan={headers.length} className="h-24 px-4 text-center text-[#86778F]">{unavailable?'Data unavailable. Refresh to try again.':empty}</td></tr>}</tbody></table>
        </div>{footer&&<PanelFooter {...footer}/>}</section>;
}
type Slice = {label:string;value:number;color:string};
function Donut({title,description,icon,tone,slices,unavailable,selected,onSelect,totalLabel='Total Tasks'}:{title:string;description:string;icon:ReactNode;tone:string;slices:Slice[];unavailable:boolean;selected?:string;onSelect?:(label:string)=>void;totalLabel?:string}) {
    const total = slices.reduce((sum, slice) => sum + slice.value, 0);
    const radius = 54, circumference = 2 * Math.PI * radius;
    const segments = slices.map((slice, index) => ({
        ...slice,
        length: total > 0 ? slice.value / total * circumference : 0,
        offset: total > 0 ? slices.slice(0, index).reduce((sum, previous) => sum + previous.value, 0) / total * circumference : 0,
    })).filter(slice => slice.value > 0);
    const legendBackgrounds: Record<string, string> = {
        'To Prepare': 'bg-[#F6F0FF]',
        'For Release': 'bg-[#ECFAF4]',
        'Expected Return': 'bg-[#E8F1FF]',
    };
    return <section className={`${cardClass} flex min-h-[220px] flex-col overflow-hidden`}>
        <Title {...{title,description,icon,tone}}/>
        {unavailable ? <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-[#86778F]">Data unavailable. Refresh to try again.</p> :
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-3">
                <div className="relative mx-auto h-[132px] w-[132px] shrink-0">
                    <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label={slices.map(slice => `${slice.label}: ${slice.value}`).join(', ')}>
                        <circle cx="80" cy="80" r={radius} fill="none" stroke="#F2ECF6" strokeWidth="22"/>
                        {segments.map(segment => <circle key={segment.label} cx="80" cy="80" r={radius} fill="none" stroke={segment.color} strokeWidth="22" strokeLinecap="butt" strokeDasharray={`${segment.length} ${Math.max(0, circumference-segment.length)}`} strokeDashoffset={-segment.offset}/>)}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                        <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#86778F]">{totalLabel}</span>
                        <span className="mt-1 text-[24px] font-bold leading-none tabular-nums text-[#1A1220]">{fmtInt(total)}</span>
                    </div>
                </div>
                <div className="grid w-full min-w-0 flex-1 grid-cols-1 gap-1.5">
                    {slices.map(slice => {
                        const content = <>
                            <span className="flex min-w-0 items-center gap-2.5"><span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:slice.color}} aria-hidden="true"/><span className="text-left text-[12px] font-medium text-[#392648]">{slice.label}</span></span>
                            <span className="ml-3 shrink-0 text-[13px] font-bold tabular-nums text-[#1A1220]">{fmtInt(slice.value)}</span>
                        </>;
                        const cls = `flex w-full items-center justify-between rounded-xl border px-3 py-1 ${legendBackgrounds[slice.label] ?? 'bg-[#FAF8FC]'} ${selected===slice.label?'border-[#B6A1D4] ring-1 ring-[#B6A1D4]':'border-[#EFE7F4]'}`;
                        return onSelect ? <button type="button" key={slice.label} className={`${cls} transition hover:border-[#B6A1D4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7651BA]`} aria-pressed={selected===slice.label} onClick={()=>onSelect(slice.label)}>{content}</button> : <div key={slice.label} className={cls}>{content}</div>;
                    })}
                    {total===0&&<p className="text-center text-[11px] text-[#86778F]">No tasks to display.</p>}
                </div>
            </div>}
    </section>;
}
function InventoryHealth({summary,onViewAll}:{summary:InventoryAlertSummary|null|undefined;onViewAll:()=>void}) {
    const slices = [
        {label:'Soon to Expire',value:summary?.expiring??0,color:'#E19A21',bg:'bg-[#FFF8EA]'},
        {label:'Expired',value:summary?.expired??0,color:'#D64545',bg:'bg-[#FFF1F1]'},
        {label:'Low Stock',value:summary?.lowStock??0,color:'#8A63D2',bg:'bg-[#F6F0FF]'},
        {label:'Out of Stock',value:summary?.outOfStock??0,color:'#237C9B',bg:'bg-[#ECF8FB]'},
        {label:'Under Repair',value:summary?.underRepair??0,color:'#1FA87A',bg:'bg-[#ECFAF4]'},
    ];
    const total=slices.reduce((n,s)=>n+s.value,0), radius=54, circumference=2*Math.PI*radius;
    const segments=slices.map((s,i)=>({...s,length:total?circumference*s.value/total:0,offset:total?circumference*slices.slice(0,i).reduce((n,x)=>n+x.value,0)/total:0}));
    return <section className={`${cardClass} flex min-h-[260px] flex-col overflow-hidden`}>
        <Title title="Inventory Alert Summary" description="Stock, expiration, and rental equipment alerts." icon={<PieChart size={18}/>} tone="bg-[#FCECF1] text-[#B74470]"/>
        {!summary?<p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-[#86778F]">Inventory alert summary unavailable. Refresh to try again.</p>:
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-4 sm:flex-row">
                <div className="relative mx-auto h-[144px] w-[144px] shrink-0 2xl:h-[164px] 2xl:w-[164px]">
                    <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90" role="img" aria-label={slices.map(s=>`${s.label}: ${s.value}`).join(', ')}>
                        <circle cx="80" cy="80" r={radius} stroke="#F2ECF6" strokeWidth="22" fill="none"/>
                        {segments.filter(s=>s.value>0).map(s=><circle key={s.label} cx="80" cy="80" r={radius} fill="none" stroke={s.color} strokeWidth="22" strokeDasharray={`${s.length} ${Math.max(0,circumference-s.length)}`} strokeDashoffset={-s.offset}/>)}
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-[10px] uppercase tracking-wide text-[#86778F]">Alerts</span><strong className="text-[26px] tabular-nums text-[#25153D]">{fmtInt(total)}</strong></div>
                </div>
                <div className="w-full min-w-0 flex-1 space-y-2">
                    {slices.map(s=><div key={s.label} className={`flex items-center justify-between gap-2 rounded-xl border border-[#EFE7F4] ${s.bg} px-3 py-2 text-[11px] text-[#392648]`}><span className="flex min-w-0 items-center gap-2"><span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:s.color}} aria-hidden="true"/><span>{s.label}</span></span><strong className="shrink-0 tabular-nums text-[#1A1220]">{fmtInt(s.value)}</strong></div>)}
                    {total===0&&<p className="text-center text-[11px] text-[#86778F]">No inventory alerts.</p>}
                </div>
            </div>}
        <PanelFooter label="View Inventory" onClick={onViewAll}/>
    </section>;
}
function formatHourLabel(hour: number): string {
    return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}
function WalkInChart({hours}:{hours:Hour[]|null}) {
    // Keep all 24 distinct hour buckets; only the displayed labels use 12-hour time.
    const chartHours = Array.from({length:24}, (_,hour) => ({
        hour, label:formatHourLabel(hour), transactions:hours?.find(h=>h.hour===hour)?.transactions??0,
    }));
    const total = chartHours.reduce((sum,h)=>sum+h.transactions,0);
    const peak = Math.max(1,...chartHours.map(h=>h.transactions));
    const tickStep = Math.max(1,Math.ceil(peak/4));
    const axisMax = Math.ceil(peak/tickStep)*tickStep;
    const ticks = Array.from({length:axisMax/tickStep+1},(_,i)=>i*tickStep);
    const left=38, right=1188, top=21, baseline=207;
    const slotWidth=(right-left)/24, barWidth=slotWidth*0.64;
    return <section className={`${cardClass} flex min-h-[280px] flex-col overflow-hidden`}>
        <Title title="Today's Walk-In Activity" description="Completed walk-in transactions by hour." icon={<BarChart3 size={18}/>} tone="bg-[#E8F1FF] text-[#2169CF]"/>
        {hours===null ? <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-[#86778F]">Walk-in activity unavailable.</p> : total===0 ? <p className="flex flex-1 items-center justify-center px-4 py-8 text-center text-xs text-[#86778F]">No completed walk-in transactions today.</p> :
            <div className="min-w-0 overflow-x-auto px-4 pb-3" tabIndex={0} aria-label="Hourly walk-in chart; scroll horizontally on small screens">
                <div className="w-full min-w-[960px]">
                    <svg viewBox="0 0 1200 235" className="block h-auto w-full" role="img" aria-label={chartHours.map(h=>`${h.label}: ${h.transactions} transactions`).join('; ')}>
                        {ticks.map(tick=>{
                            const y=baseline-(tick/axisMax)*(baseline-top);
                            return <g key={tick}><line x1={left} x2={right} y1={y} y2={y} stroke="#EEE7F5"/><text x={left-9} y={y+4} textAnchor="end" fontSize="11" fill="#806A8C">{fmtInt(tick)}</text></g>;
                        })}
                        {chartHours.map(h=>{
                            const center=left+(h.hour+0.5)*slotWidth;
                            const height=(h.transactions/axisMax)*(baseline-top);
                            const y=baseline-height;
                            return <g key={h.hour}>
                                <rect x={center-barWidth/2} y={y} width={barWidth} height={height} rx="4" fill="#8670D9"><title>{`${h.label} — ${h.transactions} transactions`}</title></rect>
                                {h.transactions>0&&<text x={center} y={y-7} textAnchor="middle" fontSize="12" fontWeight="600" fill="#25153D">{fmtInt(h.transactions)}</text>}
                                <text x={center} y={baseline+20} textAnchor="middle" fontSize="11" fill="#806A8C">{h.label}</text>
                            </g>;
                        })}
                    </svg>
                </div>
            </div>}
    </section>;
}
function scheduledDateLabel(date:string,today:string) {return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',...(date.slice(0,4)!==today.slice(0,4)?{year:'numeric' as const}:{})});}
const apiAction='get_staff_operational_dashboard';
export default function StaffDashboard() {
    const router=useRouter();const {user,loading:userLoading}=useCurrentUser();
    const [ready,setReady]=useState(false),[now,setNow]=useState(()=>new Date()),[refreshing,setRefreshing]=useState(false);
    const [snapshot,setSnapshot]=useState<{scope:string;data:Summary}|null>(null),[failure,setFailure]=useState<{scope:string;message:string}|null>(null);
    const [filter,setFilter]=useState<TaskStatus|'All Statuses'>('All Statuses');
    const request=useRef<AbortController|null>(null);
    useEffect(()=>{setReady(true);const t=window.setInterval(()=>setNow(new Date()),30_000);return()=>window.clearInterval(t);},[]);
    const today=manilaDay(now),staffId=String(user?.staff_id??''),branchId=String(user?.branch_id??''),storeId=String(user?.store_id??'');
    const scope=JSON.stringify([storeId,branchId,staffId,user?.role,user?.permissions,today]);
    const userReady=ready&&!userLoading&&user?.role==='staff'&&!!staffId&&!!branchId&&!!storeId;
    const load=useCallback(async(silent=false)=>{
        if(!userReady||(silent&&request.current))return;
        request.current?.abort();const controller=new AbortController();request.current=controller;
        if(!silent)setRefreshing(true);
        try {
            const token=saved('token');if(!token)throw new Error('Your session has expired. Please sign in again.');
            const response=await fetch('/api/bookings',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action:apiAction}),cache:'no-store',signal:controller.signal});
            const data=await response.json() as Summary&{error?:string};
            if(!response.ok||data.success!==true||!data.access)throw new Error(data.error||'Operational dashboard unavailable.');
            if(String(data.branchId)!==branchId||data.staffId!==staffId||data.today!==today)throw new Error('Account or reporting date changed. Refresh to try again.');
            if(!controller.signal.aborted){setSnapshot({scope,data});setFailure(null);}
        }catch(e){if(!controller.signal.aborted){setSnapshot(null);setFailure({scope,message:e instanceof Error?e.message:'Operational dashboard unavailable.'});}}
        finally {if(request.current===controller){request.current=null;setRefreshing(false);}}
    },[userReady,scope,branchId,staffId,today]);
    useEffect(()=>{if(!userReady)return;void load();const refresh=()=>{if(document.visibilityState==='visible')void load(true);};const timer=window.setInterval(refresh,15000);const events=['focus','stocknbook:booking-updated','stocknbook:stock-activity-refresh','stocknbook-permissions-updated','stocknbook-current-user-refreshed'];events.forEach(e=>window.addEventListener(e,refresh));document.addEventListener('visibilitychange',refresh);return()=>{window.clearInterval(timer);events.forEach(e=>window.removeEventListener(e,refresh));document.removeEventListener('visibilitychange',refresh);request.current?.abort();request.current=null;};},[load,userReady]);
    const data=userReady&&snapshot?.scope===scope?snapshot.data:null;
    const error=failure?.scope===scope?failure.message:'';
    const access=data?.access, B=!!access?.bookings,I=!!access?.inventory,P=!!access?.pos;
    const tasks=data?.tasks??[],alerts=data?.alerts??[],repair=data?.repair??[],hours=data?.walkIn??null;
    const counts=statuses.map(label=>({label,value:tasks.filter(t=>t.status===label).length,color:statusColors[label]}));
    const condition=data?.condition, consumable=data?.consumableHealth;
    const openBookings=()=>router.push('/bookings');
    const openInventory=()=>router.push('/inventory');
    const openRental=()=>router.push('/inventory?tab=rental');
    const openPOS=()=>router.push('/pos');
    const metrics:ReactNode[]=[];
    if(B){metrics.push(...counts.map((s,i)=><Metric key={s.label} label={s.label==='Expected Return'?'Expected Returns':s.label} value={data?.tasks===null?null:s.value} helper={['Due within two days or outstanding','Due today or outstanding','Due today or outstanding'][i]} icon={[<ClipboardCheck key="p" size={23}/>,<Box key="r" size={23}/>,<CornerUpLeft key="e" size={23}/>][i]} tone={(['violet','green','blue'] as const)[i]} loading={false} onClick={openBookings}/>));}
    if(I){
        if(!B&&!P)metrics.push(<Metric key="healthy" label="Healthy Stock" value={consumable?.healthy??null} helper="Stock records above alert level" icon={<CheckCircle2 size={23}/>} tone="green" loading={false} onClick={openInventory}/>);
        metrics.push(<Metric key="stock" label="Stock Alerts" value={data?.alerts===null?null:alerts.length} helper="Low or out-of-stock items" icon={<AlertTriangle size={23}/>} tone="orange" loading={false} onClick={openInventory}/>);
        if(!B){
            if(!P)metrics.push(<Metric key="serviceable" label="Serviceable Equipment" value={condition?.serviceable??null} helper="Rental units in serviceable condition" icon={<Box size={23}/>} tone="teal" loading={false} onClick={openRental}/>);
            metrics.push(<Metric key="repair" label="Under Repair" value={data?.repair===null?null:repair.reduce((n,r)=>n+r.units,0)} helper="Rental units currently under repair" icon={<Wrench size={23}/>} tone="violet" loading={false} onClick={openRental}/>);
        }
    }
    if(P&&!B){metrics.push(<Metric key="tx" label="Transactions Today" value={hours?hours.reduce((n,h)=>n+h.transactions,0):null} helper="Completed walk-in transactions" icon={<ShoppingCart size={23}/>} tone="blue" loading={false} onClick={openPOS}/>,<Metric key="sold" label="Items Sold Today" value={hours?hours.reduce((n,h)=>n+h.items,0):null} helper="Units sold through walk-in POS" icon={<Package size={23}/>} tone="green" loading={false} onClick={openPOS}/>);
        if(!I)metrics.push(<Metric key="hours" label="Active Sales Hours" value={hours?hours.filter(h=>h.transactions>0).length:null} helper="Hours with completed transactions today" icon={<Clock3 size={23}/>} tone="teal" loading={false} onClick={openPOS}/>);
    }
    const filtered=filter==='All Statuses'?tasks:tasks.filter(t=>t.status===filter);
    return <div className="flex min-h-dvh min-w-0 flex-col"><header className="sticky top-0 z-20 border-b border-[#E9E0EF] bg-[#FFFDF8]/95 font-sans backdrop-blur"><div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3"><div className="min-w-0"><h1 className="text-[25px] font-bold text-[#1A1220]">Staff Dashboard</h1><p className="mt-0.5 text-xs text-[#766983]">Daily operations overview for {user?.branch_name||'Assigned Branch'}.</p></div><div className="flex flex-wrap items-center gap-2.5"><time className="inline-flex h-[42px] items-center rounded-xl border border-[#E6DDF0] bg-white px-3.5 text-sm font-semibold text-[#2B174C] shadow-sm">{ready?clock(now):'Loading date...'}</time><button type="button" onClick={()=>void load()} disabled={!userReady||refreshing} className="inline-flex h-[42px] items-center gap-2 rounded-xl bg-[#2B174C] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1B0D31] disabled:opacity-60"><RefreshCw size={16} className={refreshing?'animate-spin':''}/>{refreshing?'Refreshing...':'Refresh'}</button></div></div></header>
        <main className="flex min-w-0 flex-1 flex-col gap-3 px-5 py-5 font-sans" aria-busy={refreshing||(!data&&!error&&userReady)}>
            {error?<p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{error}</p>:!data?<div className={`${cardClass} p-8 text-center text-xs text-[#86778F]`}>{ready&&!userLoading&&!userReady?'Unable to verify your staff account. Please sign in again.':'Loading authorized operational tasks...'}</div>:<>
                {data.errors.length>0&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{data.errors.join(' ')}</p>}
                {!metrics.length?<div className={`${cardClass} flex min-h-[180px] flex-col items-center justify-center gap-3 p-6 text-center`}><span className={`${iconClass} bg-[#F3EBFF] text-[#6C3AD6]`}><ShieldCheck size={20}/></span><h2 className="text-sm font-semibold text-[#25153D]">No assigned operational tasks.</h2></div>:<div className={`grid shrink-0 grid-cols-1 gap-3 sm:grid-cols-2 ${metrics.length===3?'xl:grid-cols-3':metrics.length===4?'xl:grid-cols-4':''}`}>{metrics}</div>}
                {B&&<div className={`grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] ${!I?'xl:flex-1 xl:min-h-[360px]':''}`}>
                    <TablePanel title="Booking Task Schedule" description="Booking activities requiring staff attention." icon={<CalendarClock size={18}/>} tone="bg-[#F3EBFF] text-[#6C3AD6]" headers={['Booking No.','Customer','Scheduled Date','Status']} rows={filtered.map(t=>({key:t.key,cells:[t.reference,t.customer,scheduledDateLabel(t.scheduledDate,today),<Status value={t.status}/>]}))} empty={filter==='All Statuses'?'No outstanding booking tasks.':'No tasks match this status.'} unavailable={data.tasks===null} action={<select aria-label="Filter booking tasks" value={filter} onChange={e=>setFilter(e.target.value as typeof filter)} className="h-9 max-w-full rounded-xl border border-[#E3D8EA] bg-white px-2 text-[11px] font-semibold text-[#2B174C] outline-none focus:ring-2 focus:ring-[#7651BA]"><option>All Statuses</option>{statuses.map(s=><option key={s}>{s}</option>)}</select>} footer={{label:'View Bookings',onClick:()=>router.push('/bookings')}}/>
                    <Donut title="Booking Status" description="Overview of current booking tasks." icon={<PieChart size={18}/>} tone="bg-[#ECEEFF] text-[#4F57C5]" slices={counts} unavailable={data.tasks===null} selected={filter} onSelect={label=>setFilter(previous=>previous===label?'All Statuses':label as TaskStatus)}/>
                </div>}
                {I&&(!B ? <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                    <InventoryHealth summary={data.inventoryAlertSummary} onViewAll={openInventory}/>
                    <div className="grid min-w-0 grid-cols-1 content-start gap-3">
                        <TablePanel title="Inventory Stock Alerts" description="Products requiring stock attention." icon={<AlertTriangle size={18}/>} tone="bg-[#FFF7E9] text-[#B7832E]" headers={['Product','Available Stock','Status']} rows={alerts.map(a=>({key:a.key,cells:[a.product,fmtInt(a.available),<Status value={a.status}/>]}))} empty="No stock alerts." unavailable={data.alerts===null} footer={{label:'View Inventory',onClick:()=>router.push('/inventory')}}/>
                        <TablePanel title="Equipment Care & Maintenance" description="Rental equipment currently under repair." icon={<Wrench size={18}/>} tone="bg-[#FCECF1] text-[#B74470]" headers={['Equipment No.','Rental Product','Quantity','Status']} rows={repair.map(r=>({key:r.key,cells:[r.equipmentNo,r.product,fmtInt(r.units),<Status value={r.status}/>]}))} empty="No rental equipment under repair." unavailable={data.repair===null} footer={{label:'View Inventory',onClick:()=>router.push('/inventory?tab=rental')}}/>
                    </div>
                </div> : <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                    <TablePanel title="Inventory Stock Alerts" description="Products requiring stock attention." icon={<AlertTriangle size={18}/>} tone="bg-[#FFF7E9] text-[#B7832E]" headers={['Product','Available Stock','Status']} rows={alerts.map(a=>({key:a.key,cells:[a.product,fmtInt(a.available),<Status value={a.status}/>]}))} empty="No stock alerts." unavailable={data.alerts===null} footer={{label:'View Inventory',onClick:()=>router.push('/inventory')}}/>
                    <TablePanel title="Equipment Care & Maintenance" description="Rental equipment currently under repair." icon={<Wrench size={18}/>} tone="bg-[#FCECF1] text-[#B74470]" headers={['Equipment No.','Rental Product','Quantity','Status']} rows={repair.map(r=>({key:r.key,cells:[r.equipmentNo,r.product,fmtInt(r.units),<Status value={r.status}/>]}))} empty="No rental equipment under repair." unavailable={data.repair===null} footer={{label:'View Inventory',onClick:()=>router.push('/inventory?tab=rental')}}/>
                </div>)}
                {P&&!B&&<WalkInChart hours={hours}/>}
            </>}
        </main></div>;
}
