"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
    type AnimationEvent as ReactAnimationEvent,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
    ArrowRight,
    BarChart3,
    Boxes,
    CalendarClock,
    CalendarDays,
    Check,
    CheckCircle2,
    CreditCard,
    Menu,
    ShieldCheck,
    Sparkles,
    Store,
    Users,
    X,
    LockKeyhole,
    LogIn,
    UserRound,
    Building2,
    ClipboardList,
    FileSpreadsheet,
    Info,
    ListChecks,
    Mail,
    Minus,
    PackageCheck,
    Plus,
    ReceiptText,
    Send,
    StickyNote,
    TrendingUp,
} from "lucide-react";


import AuthModal from "./AuthModal";




const lora = Lora({
    subsets: ["latin"],
    weight: ["600", "700"],
    display: "swap",
});

type AuthMode = "login" | "signup" | null;

type PricingPlan = {
    id: number;
    name: string;
    label: string;
    price: string;
    amount: number;
    period: string;
    description: string;
    features: string[];
    buttonText: string;
    highlighted?: boolean;
};

function formatPlanPrice(amount: number) {
    return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

function limitText(value: number | null, noun: string) {
    return value == null ? `Unlimited ${noun}` : `Up to ${value.toLocaleString("en-PH")} ${noun}`;
}

function buildPublicPlan(plan: {
    id: number;
    name: string;
    price: number;
    max_inventory: number | null;
    max_bookings: number | null;
    max_staff: number | null;
    max_branches: number | null;
    has_low_stock_alerts: boolean;
    has_analytics: boolean;
    has_forecasting: boolean;
    has_multi_store: boolean;
}): PricingPlan {
    const normalizedName = plan.name.toLowerCase();
    const isStarter = plan.price === 0 || normalizedName.includes("starter");
    const isBusiness = normalizedName.includes("business");

    const features = [
        "Inventory and product catalog",
        "Booking management",
        "Basic POS and sales recording",
        limitText(plan.max_inventory, "inventory items"),
        limitText(plan.max_bookings, "bookings per month"),
        limitText(plan.max_staff, "staff accounts"),
        limitText(plan.max_branches, "branches"),
        ...(plan.has_low_stock_alerts ? ["Low-stock notifications"] : []),
        ...(plan.has_analytics ? ["Business analytics and reports"] : []),
        ...(plan.has_forecasting ? ["Sales forecasting"] : []),
        ...(plan.has_multi_store ? ["Multi-store access"] : []),
    ];

    return {
        id: plan.id,
        name: plan.name,
        label: isStarter ? "Free" : isBusiness ? "Standard" : "Advanced",
        price: formatPlanPrice(plan.price),
        amount: plan.price,
        period: "/month",
        description: isStarter
            ? "A simple starting plan with the essential tools for your business."
            : `A ${isBusiness ? "standard" : "advanced"} plan with limits and features configured by the platform administrator.`,
        features,
        buttonText: isStarter ? `Use ${plan.name}` : `Choose ${plan.name}`,
        highlighted: isBusiness,
    };
}


const heroHighlights = [
    {
        title: "Inventory",
        detail: "Products, stock levels & alerts",
        icon: Boxes,
        position: "left-[3%] top-[5%] lg:-left-1 xl:-left-3",
        animationDelay: "0s",
    },
    {
        title: "Booking",
        detail: "Schedules, plans & payments",
        icon: CalendarDays,
        position: "right-[3%] top-[6%] lg:-right-1 xl:-right-3",
        animationDelay: "0.8s",
    },
    {
        title: "POS",
        detail: "Sales, orders & transactions",
        icon: CreditCard,
        position: "bottom-[5%] left-[4%] lg:left-0",
        animationDelay: "1.6s",
    },
    {
        title: "Scheduled Order",
        detail: "Future pickup & delivery",
        icon: CalendarClock,
        position: "bottom-[5%] right-[4%] lg:right-0",
        animationDelay: "2.4s",
    },
];

// Support address shown in Contacts. This is the address the landing page
// already used; it is not configured anywhere in the supplied backend (system
// emails are sent from, and replies go to, the SMTP account in lambda-auth).
// Confirm this inbox exists and is monitored before relying on it.
const SUPPORT_EMAIL = "support@stocknbook.com";

type CapabilityId =
    | "bookings"
    | "inventory"
    | "pos"
    | "multi-tenant"
    | "analytics"
    | "forecasting";

// About: the six core capabilities. Wording reflects what the current
// application supports; plan-dependent features say so.
const aboutCapabilities: {
    id: CapabilityId;
    name: string;
    headline: string;
    purpose: string;
    icon: typeof CalendarDays;
    challenge: string;
    solution: string;
    value: string;
    includes: string[];
    distinction?: { title: string; text: string }[];
    note?: string;
}[] = [
    {
        id: "bookings",
        name: "Bookings",
        headline: "Manage every booking with clarity",
        purpose: "Customer reservations, schedules, payments, and booking progress.",
        icon: CalendarDays,
        challenge:
            "Customer requests, event dates, payments, and preparation responsibilities can become difficult to coordinate.",
        solution:
            "StockNBook organizes booking requests from your booking link, price review, down payments, confirmed reservations, payment records, and preparation progress.",
        value:
            "Know which reservations need attention, which bookings are confirmed, and what must be prepared.",
        includes: [
            "Public booking link",
            "Price review and down payments",
            "Booking status tracking",
            "Preparation and release",
        ],
    },
    {
        id: "inventory",
        name: "Inventory",
        headline: "Know what is available and when",
        purpose: "Rental and consumable stock, reservations, availability, and stock monitoring.",
        icon: Boxes,
        challenge:
            "Rental items may be reserved for future events, while consumable products need separate stock monitoring.",
        solution:
            "StockNBook supports rental and consumable inventory, date-based rental availability, reservations, stock activity records, and inventory alerts.",
        value:
            "Help your team make informed inventory decisions based on recorded availability and stock movement.",
        includes: [
            "Rental and consumable items",
            "Date-based availability",
            "Reservations from confirmed bookings",
            "Stock activity history",
        ],
    },
    {
        id: "pos",
        name: "POS",
        headline: "Keep daily sales organized",
        purpose: "Walk-in sales, payment recording, and transaction history.",
        icon: CreditCard,
        challenge:
            "Walk-in transactions and booking-related sales can be difficult to review when records are scattered.",
        solution:
            "StockNBook records walk-in sales with cash, GCash, or bank transfer payments, deducts sold items from inventory, and keeps a transaction history. Sales reports can separate booking and walk-in sales.",
        value:
            "Improve visibility of daily transactions and where your business revenue comes from.",
        includes: [
            "Walk-in checkout",
            "Cash, GCash, and bank transfer",
            "Automatic stock deduction",
            "Booking and walk-in sales reports",
        ],
    },
    {
        id: "multi-tenant",
        name: "Multi-Tenant Management",
        headline: "Built for different businesses and branches",
        purpose: "Separate business accounts, branches, and role-based access.",
        icon: Building2,
        challenge:
            "Different businesses, branches, and employees need appropriate access to their own operational records.",
        solution:
            "Each business works in its own separate StockNBook account. Within a business, the owner organizes branches and gives Managers and Staff role-based access to the modules they need.",
        value:
            "Organize operations and responsibilities across your business account and its branches.",
        includes: [
            "Separate business accounts",
            "Branch structure",
            "Owner, Manager, and Staff roles",
            "Module-level access",
        ],
        distinction: [
            {
                title: "Multi-tenant",
                text: "Different businesses keep separate accounts and separate data.",
            },
            {
                title: "Multi-branch",
                text: "One business organizes its own locations and the people assigned to them.",
            },
        ],
        note: "The number of branches and staff accounts depends on your subscription plan.",
    },
    {
        id: "analytics",
        name: "Analytics",
        headline: "Turn business records into insights",
        purpose: "Business performance, sales trends, and operational insights.",
        icon: BarChart3,
        challenge:
            "Transaction history alone may not clearly show business performance, customer activity, and operational trends.",
        solution:
            "StockNBook analytics summarize recorded sales and bookings for a selected period, including trends, busy days, package revenue, and changes compared with the previous period.",
        value:
            "Help owners make decisions based on historical business records.",
        includes: [
            "Sales trends",
            "Booking patterns",
            "Package revenue",
            "Period comparisons",
        ],
        note: "Available on subscription plans that include analytics.",
    },
    {
        id: "forecasting",
        name: "Demand Forecasting",
        headline: "Plan ahead",
        purpose: "Historical demand patterns and planning support.",
        icon: TrendingUp,
        challenge:
            "Seasonal changes and shifting customer demand can make inventory and operational planning difficult.",
        solution:
            "StockNBook uses available historical sales and booking records to estimate possible future demand, including booking forecasts and seasonal patterns.",
        value:
            "Support planning for inventory, busy periods, and possible demand changes.",
        includes: [
            "Booking forecasts",
            "Seasonal analysis",
            "Forecast reports",
        ],
        note: "Forecasts are estimates, not guaranteed predictions, and need enough recorded history to be useful. Available on subscription plans that include forecasting.",
    },
];

// About: illustrative workflows built from the application's real modules.
const connectionScenarios: {
    title: string;
    description: string;
    flow: { label: string; icon: typeof CalendarDays }[];
}[] = [
    {
        title: "Customer event booking",
        description:
            "A customer submits a booking request through your booking link. A manager reviews the request and price, and once the booking is confirmed, the items it needs are reserved in inventory. Staff then prepare and release the rental or consumable items for the event.",
        flow: [
            { label: "Bookings", icon: CalendarDays },
            { label: "Inventory", icon: Boxes },
            { label: "Preparation", icon: PackageCheck },
        ],
    },
    {
        title: "Walk-in transaction",
        description:
            "A customer buys party supplies at your store. The POS records the sale and its payment, and the sold items are deducted from inventory. The transaction becomes part of your walk-in sales records.",
        flow: [
            { label: "POS", icon: CreditCard },
            { label: "Inventory", icon: Boxes },
            { label: "Sales records", icon: ReceiptText },
        ],
    },
    {
        title: "Business planning",
        description:
            "An owner reviews sales, booking patterns, and branch performance in analytics. Demand Forecasting uses that history to point out possible busy periods and seasonal demand, and the owner uses both to plan inventory and operations.",
        flow: [
            { label: "Business records", icon: ClipboardList },
            { label: "Analytics", icon: BarChart3 },
            { label: "Demand Forecasting", icon: TrendingUp },
            { label: "Planning", icon: ListChecks },
        ],
    },
];

const roleSummaries = [
    {
        title: "Owner",
        icon: Store,
        description:
            "Monitors business-wide operations, branches, sales information, inventory, and available analytics to support decisions.",
        access: "Full access to the business, including branches and branch managers.",
    },
    {
        title: "Manager",
        icon: Users,
        description:
            "Oversees assigned branch operations, booking reviews, inventory coordination, and permitted management functions.",
        access: "The owner sets each module to full, view-only, or no access.",
    },
    {
        title: "Staff",
        icon: UserRound,
        description:
            "Focuses on assigned daily operations, including permitted POS activities, inventory handling, and booking preparation.",
        access: "Works only in the modules their manager allows and cannot approve or confirm bookings.",
    },
];

const businessGains = [
    { from: "Scattered booking records", to: "Organized customer booking information" },
    { from: "Unclear rental availability", to: "Date-based availability and reservation monitoring" },
    { from: "Separate sales records", to: "Organized booking and walk-in sales information" },
    { from: "Multiple business locations", to: "Business and branch-based organization" },
    { from: "Difficult performance monitoring", to: "Analytics and historical reporting" },
    { from: "Uncertain future demand", to: "Demand Forecasting for planning support" },
];

const faqItems: {
    question: string;
    answer: string;
    link?: { href: string; label: string };
}[] = [
    {
        question: "What is StockNBook, and who can use it?",
        answer:
            "StockNBook is a business management platform for party supply and event businesses, especially those that offer booking services. It brings bookings, rental and consumable inventory, point-of-sale transactions, business and branch management, analytics, and demand forecasting into one system for business owners, managers, and staff.",
    },
    {
        question: "Can I start using StockNBook for free?",
        answer:
            "Yes. New businesses start on the Starter plan, which does not require a GCash payment. It includes the essential tools with set limits, and you can move to a paid plan when you need higher limits or more features.",
        link: { href: "#pricing", label: "See current plans and limits" },
    },
    {
        question: "Can I manage both rental and consumable inventory?",
        answer:
            "Yes. Rental items track how many units are on hand, reserved for bookings, or temporarily unavailable, and their availability is checked against booking dates. Consumable products track branch stock, reorder levels, received stock, and stock movement. When a booking is confirmed, the items it needs are reserved.",
    },
    {
        question: "Can I manage bookings and walk-in sales together?",
        answer:
            "Yes. Bookings follow their own flow, from request and price review to down payment, confirmation, preparation, and completion, with payments recorded against each booking. Walk-in purchases are recorded through the POS with cash, GCash, or bank transfer. Sales reports can show booking sales, walk-in sales, or both.",
    },
    {
        question: "Can multiple businesses and branches use StockNBook?",
        answer:
            "Yes. StockNBook is multi-tenant: each business has its own separate account and records. Within a business, the owner can set up branches and assign managers and staff to them. The number of branches and staff accounts depends on your subscription plan.",
    },
    {
        question: "What can Owners, Managers, and Staff access?",
        answer:
            "Owners have full access to their business, including branches, branch managers, and business-wide records. Managers work within their assigned branch, and the owner chooses whether each module is full access, view-only, or not available to them. Staff handle daily tasks such as POS sales, inventory work, and booking preparation in the modules their manager allows; staff cannot approve or confirm bookings.",
    },
    {
        question: "What is the difference between Analytics and Demand Forecasting?",
        answer:
            "Analytics looks back: it summarizes your recorded sales and bookings to show trends, busy periods, and performance for a selected time range. Demand Forecasting looks ahead: it uses that history to estimate possible future demand, such as busy booking periods and seasonal product patterns. Forecasts are estimates that support planning, not guaranteed results. Both are available on plans that include them.",
    },
    {
        question: "How do paid subscriptions work?",
        answer:
            "Choose a paid plan, confirm the verification code sent to your email, and pay through GCash using the payment details shown. Then submit your GCash reference number and payment proof. The platform administrator reviews the submission and activates the plan once it is approved, or gives the reason if it is rejected. There are no automatic recurring charges: renewals follow the same verification process, and an expired plan returns to Starter-level access until it is renewed.",
    },
];

const navigationItems = [
    { label: "Home", href: "#home", sectionId: "home" },
    { label: "About", href: "#about", sectionId: "about" },
    { label: "Pricing", href: "#pricing", sectionId: "pricing" },
    { label: "FAQ", href: "#faq", sectionId: "faq" },
    { label: "Contacts", href: "#contact", sectionId: "contact" },
];

/* -------------------------------------------------------------------------- */
/* Landing page animations                                                     */
/* -------------------------------------------------------------------------- */

/*
 * Intro modes:
 *   "play"  full introduction: first landing visit in a tab, a duplicated tab,
 *           a new window
 *   "short" brief branding introduction after an Owner/Manager/Staff logout
 *   "done"  instant homepage: reload (normal or hard), returning in the same
 *           tab, the decorative SetupScreen backdrop, reduced motion
 *
 * Per-tab memory (nothing is shared between tabs, no cookies):
 *   sessionStorage stocknbook_intro_seen   this tab has shown the landing page
 *   sessionStorage stocknbook_intro_open   token held only while a landing
 *                                          document is open in this tab
 *   window.name    stocknbook-intro-tab    same as "seen", but survives the
 *                                          sessionStorage.clear() done at login
 *
 * Duplicating a tab (or window.open) copies sessionStorage, including the
 * "open" token of the still-open original. A reload or same-tab navigation
 * removes that token in pagehide first, so finding it on load means the tab is
 * a copy. Browsers that do not copy sessionStorage start empty: also a new tab.
 * JavaScript cannot tell a hard refresh from a normal one; both are "reload".
 */
type IntroPhase = "play" | "short" | "done";

const INTRO_SEEN_KEY = "stocknbook_intro_seen";
const INTRO_OPEN_KEY = "stocknbook_intro_open";
// Set by RoleSidebar's logout handler; removed here when read.
const INTRO_LOGOUT_KEY = "stocknbook_intro_after_logout";
const INTRO_TAB_NAME = "stocknbook-intro-tab";

// The invisible .snb-intro-clock element's animation ends when every intro
// animation has finished, so its animationend event ends the intro.
const INTRO_TOTAL_MS = 4100;
const SHORT_INTRO_TOTAL_MS = 1450;

const REVEAL_STATE_ATTRIBUTE = "data-snb-reveal-state";
const REVEAL_CHILDREN_SELECTOR = "[data-snb-reveal-children]";

// Runs only in the server-rendered HTML, before the page is painted, so the
// first frame already matches the chosen mode (no intro flash on reload). It
// mirrors decideIntroForMount() below; keep the two in step. ES5 on purpose.
const INTRO_PRELOAD_SCRIPT = [
    "(function(){",
    "var m=document.currentScript&&document.currentScript.parentElement;if(!m)return;",
    `var SEEN=${JSON.stringify(INTRO_SEEN_KEY)},OPEN=${JSON.stringify(INTRO_OPEN_KEY)},OUT=${JSON.stringify(INTRO_LOGOUT_KEY)},TAB=${JSON.stringify(INTRO_TAB_NAME)};`,
    "var mode=\"play\";",
    "try{",
    "var w=window,s=null;",
    "try{s=w.sessionStorage;s.getItem(SEEN)}catch(e){s=null}",
    "var get=function(k){try{return s?s.getItem(k):null}catch(e){return null}};",
    "var put=function(k,v){try{if(s)s.setItem(k,v)}catch(e){}};",
    "var del=function(k){try{if(s)s.removeItem(k)}catch(e){}};",
    "var p=w.performance,n=\"navigate\";",
    "try{var en=p&&p.getEntriesByType?p.getEntriesByType(\"navigation\")[0]:null;",
    "if(en&&en.type){n=en.type}else if(p&&p.navigation){n=[\"navigate\",\"reload\",\"back_forward\"][p.navigation.type]||\"navigate\"}}catch(e){}",
    "var reduced=!!(w.matchMedia&&w.matchMedia(\"(prefers-reduced-motion: reduce)\").matches);",
    "var out=get(OUT)===\"1\";if(out)del(OUT);",
    "var copied=!!get(OPEN)&&n!==\"reload\"&&document.wasDiscarded!==true;",
    "var nm=\"\";try{nm=w.name||\"\"}catch(e){}",
    "var seen=!copied&&(nm===TAB||get(SEEN)===\"1\");",
    "if(reduced){mode=\"done\"}else if(out){mode=\"short\"}else if(copied){mode=\"play\"}",
    "else if(n===\"reload\"||n===\"back_forward\"||seen){mode=\"done\"}",
    "var st=w.__stocknbookIntro||(w.__stocknbookIntro={});",
    "st.mode=mode;st.token=Math.random().toString(36).slice(2)+Date.now().toString(36);",
    "put(SEEN,\"1\");put(OPEN,st.token);",
    "if(nm===\"\"||nm===TAB){try{w.name=TAB}catch(e){}}",
    "if(!st.tracking){st.tracking=true;",
    "w.addEventListener(\"pagehide\",function(){if(get(OPEN)===st.token)del(OPEN)});",
    "w.addEventListener(\"pageshow\",function(e){if(e.persisted&&st.token)put(OPEN,st.token)})}",
    "}catch(e){}",
    "if(mode!==\"play\")m.setAttribute(\"data-snb-intro\",mode);",
    "})();",
].join("");

/*
 * Every rule that hides content is scoped to main[data-snb-intro="play"] or to
 * an element JavaScript is actively observing, and every intro animation ends
 * in its normal visible state. Content therefore cannot stay hidden.
 *
 * Intro timeline (ms from first paint):
 *   0–900      Scene 1  centred logo + wordmark fade/scale in, soft gold glow
 *   900–1620   Scene 2  branding flies into the navigation logo position
 *   1230–1670           intro backdrop fades, homepage appears behind it
 *   1640–2100  Scene 3  nav, heading, tagline, description, buttons, devices
 *   2320–3300  Scene 4  laptop screen, then phone screen, power on
 *   3060–4010           floating feature cards
 *
 * Short intro after logout (same keyframes, shorter timings, no power-on):
 *   0–420      centred logo + wordmark fade/scale in
 *   420–980    branding flies into the navigation logo position
 *   640–980    intro backdrop fades
 *   820–1420   homepage fades in (devices already on)
 */
const LANDING_ANIMATION_STYLES = `
.snb-intro,
.snb-skip-intro,
.snb-screen,
.snb-intro-clock {
    display: none;
}

/* Invisible timer: its animationend marks the end of the intro. */
.snb-intro-clock {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    pointer-events: none;
}

main[data-snb-intro="play"] .snb-intro-clock {
    display: block;
    animation: snbLayerOff 1ms linear ${INTRO_TOTAL_MS}ms both;
}

main[data-snb-intro="short"] .snb-intro-clock {
    display: block;
    animation: snbLayerOff 1ms linear ${SHORT_INTRO_TOTAL_MS}ms both;
}

/* ---------- Scenes 1 & 2: brand introduction and logo transition ---------- */

main[data-snb-intro="play"] .snb-intro,
main[data-snb-intro="short"] .snb-intro {
    /* --snb-pad mirrors the navigation bar's px-4 / sm:px-6 / lg:px-10. */
    --snb-pad: 16px;
    --snb-scale: 1.75;
    position: fixed;
    inset: 0;
    z-index: 120;
    display: block;
    overflow: hidden;
    pointer-events: none;
    animation: snbLayerOff 1ms linear 1720ms both;
}

@media (max-width: 359px) {
    main[data-snb-intro="play"] .snb-intro,
    main[data-snb-intro="short"] .snb-intro {
        --snb-scale: 1.55;
    }
}

@media (min-width: 640px) {
    main[data-snb-intro="play"] .snb-intro,
    main[data-snb-intro="short"] .snb-intro {
        --snb-pad: 24px;
        --snb-scale: 2.25;
    }
}

@media (min-width: 1024px) {
    main[data-snb-intro="play"] .snb-intro,
    main[data-snb-intro="short"] .snb-intro {
        --snb-pad: 40px;
        --snb-scale: 2.6;
    }
}

@media (min-width: 1536px) {
    main[data-snb-intro="play"] .snb-intro,
    main[data-snb-intro="short"] .snb-intro {
        --snb-scale: 2.85;
    }
}

.snb-intro-backdrop {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    background: radial-gradient(circle at 50% 46%, #3b2763 0%, #2d1b4e 44%, #1d1031 100%);
    animation: snbBackdropOut 440ms cubic-bezier(0.4, 0, 0.2, 1) 1230ms both;
}

.snb-intro-glow {
    position: absolute;
    left: 50%;
    top: 50%;
    width: min(82vw, 640px);
    aspect-ratio: 1 / 1;
    border-radius: 9999px;
    transform: translate(-50%, -50%);
    background: radial-gradient(
        closest-side,
        rgba(212, 161, 38, 0.24),
        rgba(212, 161, 38, 0.09) 48%,
        rgba(212, 161, 38, 0) 74%
    );
    animation: snbGlow 1380ms ease-out 100ms both;
}

/* The track carries the viewport-centre offset and the row is a replica of the
   navigation bar, so the flying brand lands exactly on the real nav logo. */
.snb-intro-track {
    position: absolute;
    inset: 0;
    animation: snbTrack 720ms cubic-bezier(0.65, 0, 0.35, 1) 900ms both;
}

.snb-intro-row {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    box-sizing: border-box;
    display: flex;
    height: 80px;
    align-items: center;
    padding: 0 var(--snb-pad);
    border-bottom: 1px solid transparent;
}

.snb-intro-fly {
    flex-shrink: 0;
    transform-origin: 50% 50%;
    animation:
        snbFly 720ms cubic-bezier(0.65, 0, 0.35, 1) 900ms both,
        snbVanish 1ms linear 1660ms both;
}

.snb-intro-brand {
    display: flex;
    align-items: center;
    animation: snbBrandIn 820ms cubic-bezier(0.22, 1, 0.36, 1) 60ms both;
}

main[data-snb-intro="play"] .snb-nav-brand {
    animation: snbAppear 1ms linear 1620ms both;
}

main[data-snb-intro="play"] .snb-skip-intro {
    display: inline-flex;
    animation: snbSkipLife ${INTRO_TOTAL_MS}ms linear both;
}

/* ---------- Scene 3: homepage reveal ---------- */

main[data-snb-intro="play"] .snb-in {
    animation: snbRiseIn 720ms cubic-bezier(0.22, 1, 0.36, 1) var(--snb-delay, 1640ms) both;
}

.snb-in-nav { --snb-delay: 1640ms; }
.snb-in-auth { --snb-delay: 1720ms; }
.snb-in-title { --snb-delay: 1740ms; }
.snb-in-tagline { --snb-delay: 1820ms; }
.snb-in-headline { --snb-delay: 1890ms; }
.snb-in-desc { --snb-delay: 1960ms; }
.snb-in-cta { --snb-delay: 2040ms; }
.snb-in-device { --snb-delay: 2100ms; }
.snb-in-device-shadow { --snb-delay: 2200ms; }
.snb-in-card-1 { --snb-delay: 3060ms; }
.snb-in-card-2 { --snb-delay: 3160ms; }
.snb-in-card-3 { --snb-delay: 3260ms; }
.snb-in-card-4 { --snb-delay: 3360ms; }

main[data-snb-intro="play"] .snb-in-nav,
main[data-snb-intro="play"] .snb-in-auth {
    animation-name: snbNavIn;
    animation-duration: 600ms;
}

main[data-snb-intro="play"] .snb-in-device {
    animation-name: snbDeviceIn;
    animation-duration: 900ms;
}

main[data-snb-intro="play"] .snb-in-device-shadow {
    animation-name: snbFadeIn;
    animation-duration: 900ms;
}

main[data-snb-intro="play"] .snb-in-card {
    animation-name: snbCardIn;
    animation-duration: 650ms;
}

/* ---------- Scene 4: laptop and phone power-on ---------- */

/* Screen-off layers are traced from public/laptop_cp.png (577 x 433) and
   overlap the black bezels slightly, so they stay aligned at every size. */
main[data-snb-intro="play"] .snb-screen {
    display: block;
}

.snb-screen {
    position: absolute;
    overflow: hidden;
    pointer-events: none;
    background-color: #060509;
    background-image: linear-gradient(
        125deg,
        rgba(255, 255, 255, 0.08) 0%,
        rgba(255, 255, 255, 0.025) 30%,
        rgba(255, 255, 255, 0) 46%,
        rgba(255, 255, 255, 0) 74%,
        rgba(255, 255, 255, 0.03) 100%
    );
}

.snb-screen::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 55%;
    background: linear-gradient(
        180deg,
        rgba(205, 188, 255, 0) 0%,
        rgba(214, 200, 255, 0.26) 50%,
        rgba(205, 188, 255, 0) 100%
    );
    opacity: 0;
    transform: translate3d(0, -110%, 0);
}

.snb-screen::after {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(
        ellipse at 50% 42%,
        rgba(178, 158, 236, 0.38) 0%,
        rgba(122, 98, 196, 0.18) 46%,
        rgba(70, 52, 130, 0) 78%
    );
    opacity: 0;
}

.snb-screen-laptop {
    inset: 0;
    clip-path: polygon(
        16.308% 12.933%, 79.272% 13.256%, 79.029% 23.095%, 78.856% 31.547%,
        78.510% 31.778%, 78.042% 32.102%, 77.712% 32.333%, 77.504% 32.564%,
        77.366% 32.794%, 77.088% 33.256%, 76.950% 33.718%, 76.828% 34.180%,
        76.759% 34.642%, 76.724% 35.104%, 76.690% 35.797%, 76.672% 70.115%,
        14.593% 67.067%
    );
}

.snb-screen-phone {
    left: 77.712%;
    top: 32.517%;
    width: 14.003%;
    height: 47.921%;
    border-radius: 11.14% / 4.34%;
}

main[data-snb-intro="play"] .snb-screen-laptop {
    animation: snbScreenOn 820ms cubic-bezier(0.4, 0, 0.2, 1) 2320ms both;
}

main[data-snb-intro="play"] .snb-screen-laptop::before {
    animation: snbScreenScan 820ms cubic-bezier(0.45, 0, 0.25, 1) 2320ms both;
}

main[data-snb-intro="play"] .snb-screen-laptop::after {
    animation: snbScreenGlow 820ms ease-out 2320ms both;
}

main[data-snb-intro="play"] .snb-screen-phone {
    animation: snbScreenOn 720ms cubic-bezier(0.4, 0, 0.2, 1) 2580ms both;
}

main[data-snb-intro="play"] .snb-screen-phone::before {
    animation: snbScreenScan 720ms cubic-bezier(0.45, 0, 0.25, 1) 2580ms both;
}

main[data-snb-intro="play"] .snb-screen-phone::after {
    animation: snbScreenGlow 720ms ease-out 2580ms both;
}

/* ---------- Short introduction after logout ---------- */

/* Reuses the intro markup and keyframes with shorter timings. The laptop and
   phone screens are not rendered in this mode, so there is no power-on. */
main[data-snb-intro="short"] .snb-intro {
    animation: snbLayerOff 1ms linear 1060ms both;
}

main[data-snb-intro="short"] .snb-intro-backdrop {
    animation: snbBackdropOut 340ms cubic-bezier(0.4, 0, 0.2, 1) 640ms both;
}

main[data-snb-intro="short"] .snb-intro-glow {
    animation: snbGlow 900ms ease-out 0ms both;
}

main[data-snb-intro="short"] .snb-intro-brand {
    animation: snbBrandIn 420ms cubic-bezier(0.22, 1, 0.36, 1) 0ms both;
}

main[data-snb-intro="short"] .snb-intro-track {
    animation: snbTrack 560ms cubic-bezier(0.65, 0, 0.35, 1) 420ms both;
}

main[data-snb-intro="short"] .snb-intro-fly {
    animation:
        snbFly 560ms cubic-bezier(0.65, 0, 0.35, 1) 420ms both,
        snbVanish 1ms linear 1010ms both;
}

main[data-snb-intro="short"] .snb-nav-brand {
    animation: snbAppear 1ms linear 980ms both;
}

main[data-snb-intro="short"] .snb-in {
    animation: snbRiseIn 460ms cubic-bezier(0.22, 1, 0.36, 1) var(--snb-short-delay, 900ms) both;
}

.snb-in-nav { --snb-short-delay: 940ms; }
.snb-in-auth { --snb-short-delay: 990ms; }
.snb-in-title { --snb-short-delay: 820ms; }
.snb-in-tagline { --snb-short-delay: 860ms; }
.snb-in-headline { --snb-short-delay: 890ms; }
.snb-in-desc { --snb-short-delay: 920ms; }
.snb-in-cta { --snb-short-delay: 950ms; }
.snb-in-device { --snb-short-delay: 880ms; }
.snb-in-device-shadow { --snb-short-delay: 880ms; }
.snb-in-card-1 { --snb-short-delay: 940ms; }
.snb-in-card-2 { --snb-short-delay: 980ms; }
.snb-in-card-3 { --snb-short-delay: 1020ms; }
.snb-in-card-4 { --snb-short-delay: 1060ms; }

main[data-snb-intro="short"] .snb-in-nav,
main[data-snb-intro="short"] .snb-in-auth {
    animation-name: snbNavIn;
    animation-duration: 380ms;
}

main[data-snb-intro="short"] .snb-in-device,
main[data-snb-intro="short"] .snb-in-device-shadow {
    animation-name: snbFadeIn;
    animation-duration: 500ms;
}

main[data-snb-intro="short"] .snb-in-card {
    animation-name: snbFadeIn;
    animation-duration: 360ms;
}

/* ---------- Scene 5: cursor-following tilt (driven by requestAnimationFrame) ---------- */

.snb-device-tilt {
    transform-origin: 50% 55%;
}

/* ---------- Scroll reveal for the sections below the hero ---------- */

[data-snb-reveal-state="pending"] {
    opacity: 0;
    transform: translate3d(0, 24px, 0);
}

[data-snb-reveal-state="in"] {
    animation: snbRevealUp 690ms cubic-bezier(0.22, 1, 0.36, 1) var(--snb-reveal-delay, 0ms) both;
}

/* ---------- Scroll-responsive frosted-glass navigation ---------- */

.snb-nav {
    background: rgba(45, 27, 78, 0.92);
    -webkit-backdrop-filter: blur(9px) saturate(112%);
    backdrop-filter: blur(9px) saturate(112%);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    transition: background-color 350ms ease, box-shadow 350ms ease,
        backdrop-filter 350ms ease, -webkit-backdrop-filter 350ms ease;
}

.snb-nav[data-snb-scrolled="true"] {
    background: rgba(45, 27, 78, 0.80);
    -webkit-backdrop-filter: blur(19px) saturate(140%);
    backdrop-filter: blur(19px) saturate(140%);
    box-shadow: 0 12px 38px rgba(26, 13, 48, 0.22);
}

.snb-scroll-progress {
    transform: scaleX(0);
    transform-origin: left center;
    will-change: transform;
}

/* Only decorative existing / in-section background glows move with scroll. */
[data-snb-parallax] {
    will-change: transform;
}

/* ---------- Balanced, section-specific one-time scroll reveal ---------- */

[data-snb-reveal-state="pending"] {
    transform: translate3d(0, 20px, 0);
}

[data-snb-reveal-state="in"] {
    animation-duration: 690ms;
}

#about [data-snb-reveal-state="pending"] {
    transform: translate3d(0, 20px, 0) scale(0.985);
}
#about [data-snb-reveal-state="in"] {
    animation-name: snbRevealSoft;
}

#pricing [data-snb-reveal-state="pending"] {
    transform: translate3d(0, 22px, 0) scale(0.977);
}
#pricing [data-snb-reveal-state="in"] {
    animation-name: snbRevealSpotlight;
}

/* A static, subtle halo settles around the existing highlighted plan. */
.snb-pricing-spotlight::after {
    content: "";
    position: absolute;
    inset: 1px;
    border-radius: inherit;
    pointer-events: none;
    opacity: 0;
    box-shadow: inset 0 0 0 1px rgba(212, 161, 38, 0.27),
        0 0 24px rgba(212, 161, 38, 0.12);
    transition: opacity 850ms ease;
}
.snb-pricing-spotlight[data-snb-reveal-state="in"]::after,
.snb-pricing-spotlight[data-snb-reveal-state="done"]::after {
    opacity: 1;
}

#faq [data-snb-reveal-state="pending"] {
    transform: translate3d(-15px, 0, 0);
}
#faq [data-snb-reveal-state="in"] {
    animation-name: snbRevealFromLeft;
}

#contact [data-snb-reveal-state="pending"] {
    transform: translate3d(0, 20px, 0);
}
#contact [data-snb-reveal-state="in"] {
    animation-name: snbRevealContact;
}

/* Contacts: the support card enters from the left, the start card from the right. */
#contact .snb-contact-left[data-snb-reveal-state="pending"] {
    transform: translate3d(-15px, 0, 0);
}
#contact .snb-contact-left[data-snb-reveal-state="in"] {
    animation-name: snbRevealFromLeft;
}
#contact .snb-contact-right[data-snb-reveal-state="pending"] {
    transform: translate3d(15px, 0, 0);
}
#contact .snb-contact-right[data-snb-reveal-state="in"] {
    animation-name: snbRevealFromRight;
}

/* ---------- About: capability explorer and connected workflows ---------- */

.snb-capability-panel-content {
    animation: snbPanelIn 340ms cubic-bezier(0.22, 1, 0.36, 1) backwards;
}

/* Workflow steps are lit by default. They wait dimmed only while their card is
   still hidden, then light up one after another when the card is revealed. */
[data-snb-reveal-state="pending"] .snb-flow-step {
    border-color: #ECE6F2;
    background-color: #FFFFFF;
    color: #A397AE;
}
[data-snb-reveal-state="pending"] .snb-flow-link {
    opacity: 0.25;
}
.snb-flow[data-snb-flow-active="true"] .snb-flow-step {
    animation: snbFlowLight 560ms ease-out backwards;
}
.snb-flow[data-snb-flow-active="true"] .snb-flow-link {
    animation: snbFlowLink 380ms ease-out backwards;
}
.snb-flow[data-snb-flow-active="true"] > :nth-child(1) .snb-flow-step { animation-delay: 320ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(2) .snb-flow-link { animation-delay: 520ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(2) .snb-flow-step { animation-delay: 640ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(3) .snb-flow-link { animation-delay: 840ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(3) .snb-flow-step { animation-delay: 960ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(4) .snb-flow-link { animation-delay: 1160ms; }
.snb-flow[data-snb-flow-active="true"] > :nth-child(4) .snb-flow-step { animation-delay: 1280ms; }

/* ---------- FAQ accordion ---------- */

.snb-faq-panel {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows 320ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 200ms ease, visibility 0s linear 320ms;
}
.snb-faq-panel[data-open="true"] {
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    transition: grid-template-rows 320ms cubic-bezier(0.22, 1, 0.36, 1),
        opacity 260ms ease 60ms, visibility 0s linear 0s;
}
.snb-faq-panel > div {
    min-height: 0;
    overflow: hidden;
}
.snb-faq-icon {
    transition: background-color 300ms ease, color 300ms ease;
}

@keyframes snbRevealSoft {
    from { opacity: 0; transform: translate3d(0, 20px, 0) scale(0.985); }
    to { opacity: 1; transform: none; }
}
@keyframes snbRevealSpotlight {
    from { opacity: 0; transform: translate3d(0, 22px, 0) scale(0.977); }
    to { opacity: 1; transform: none; }
}
@keyframes snbRevealFromLeft {
    from { opacity: 0; transform: translate3d(-15px, 0, 0); }
    to { opacity: 1; transform: none; }
}
@keyframes snbRevealFromRight {
    from { opacity: 0; transform: translate3d(15px, 0, 0); }
    to { opacity: 1; transform: none; }
}
@keyframes snbRevealContact {
    from { opacity: 0; transform: translate3d(0, 20px, 0); }
    to { opacity: 1; transform: none; }
}
@keyframes snbPanelIn {
    from { opacity: 0; transform: translate3d(0, 8px, 0); }
    to { opacity: 1; transform: none; }
}
@keyframes snbFlowLight {
    0% {
        border-color: #ECE6F2;
        background-color: #FFFFFF;
        color: #A397AE;
        box-shadow: 0 0 0 0 rgba(212, 161, 38, 0);
    }
    55% {
        box-shadow: 0 0 0 4px rgba(212, 161, 38, 0.18);
    }
    100% {
        border-color: #EAD9B0;
        background-color: #FFF8E8;
        color: #2D1B4E;
        box-shadow: 0 0 0 0 rgba(212, 161, 38, 0);
    }
}
@keyframes snbFlowLink {
    from { opacity: 0.25; }
    to { opacity: 1; }
}

/* ---------- Accessibility and print safety ---------- */

@media (prefers-reduced-motion: reduce) {
    .snb-intro,
    .snb-skip-intro,
    .snb-screen {
        display: none !important;
    }

    .snb-in,
    .snb-nav-brand,
    [data-snb-reveal-state],
    [data-snb-parallax] {
        opacity: 1 !important;
        transform: none !important;
        animation: none !important;
    }
    .snb-capability-panel-content,
    .snb-flow-step,
    .snb-flow-link {
        animation: none !important;
    }
    .snb-faq-panel,
    .snb-faq-icon {
        transition: none !important;
    }
    .snb-nav { transition: none !important; }
    .snb-scroll-progress { will-change: auto; }
}

@media print {
    .snb-intro,
    .snb-skip-intro,
    .snb-screen {
        display: none !important;
    }

    .snb-in,
    .snb-nav-brand,
    [data-snb-reveal-state],
    [data-snb-parallax] {
        opacity: 1 !important;
        transform: none !important;
        animation: none !important;
    }
    .snb-scroll-progress { display: none !important; }
    .snb-faq-panel {
        grid-template-rows: 1fr !important;
        opacity: 1 !important;
        visibility: visible !important;
    }
}

/* ---------- Keyframes ---------- */

@keyframes snbLayerOff {
    to { visibility: hidden; }
}

@keyframes snbBackdropOut {
    from { opacity: 1; }
    to { opacity: 0; visibility: hidden; }
}

@keyframes snbGlow {
    0% { opacity: 0; }
    52% { opacity: 1; }
    62% { opacity: 1; }
    100% { opacity: 0; }
}

@keyframes snbBrandIn {
    from { opacity: 0; transform: scale(0.92); }
    to { opacity: 1; transform: scale(1); }
}

@keyframes snbTrack {
    from { transform: translate3d(50%, 50%, 0); }
    to { transform: translate3d(0, 0, 0); }
}

@keyframes snbFly {
    from {
        transform: translate3d(calc(-1 * var(--snb-pad) - 50%), -39.5px, 0) scale(var(--snb-scale));
    }
    to {
        transform: translate3d(0, 0, 0) scale(1);
    }
}

@keyframes snbVanish {
    to { opacity: 0; visibility: hidden; }
}

@keyframes snbAppear {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes snbSkipLife {
    0%, 8% { opacity: 0; }
    17% { opacity: 1; }
    92% { opacity: 1; visibility: visible; }
    100% { opacity: 0; visibility: hidden; }
}

@keyframes snbNavIn {
    from { opacity: 0; transform: translate3d(0, 8px, 0); }
    to { opacity: 1; transform: none; }
}

@keyframes snbRiseIn {
    from { opacity: 0; transform: translate3d(0, 18px, 0); }
    to { opacity: 1; transform: none; }
}

@keyframes snbFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

@keyframes snbDeviceIn {
    from { opacity: 0; transform: translate3d(0, 28px, 0) scale(0.965); }
    to { opacity: 1; transform: none; }
}

@keyframes snbCardIn {
    from { opacity: 0; transform: translate3d(0, 14px, 0) scale(0.94); }
    to { opacity: 1; transform: none; }
}

@keyframes snbScreenOn {
    0%, 30% { opacity: 1; }
    100% { opacity: 0; }
}

@keyframes snbScreenScan {
    0% { opacity: 0; transform: translate3d(0, -110%, 0); }
    12% { opacity: 1; }
    72% { opacity: 1; transform: translate3d(0, 190%, 0); }
    100% { opacity: 0; transform: translate3d(0, 190%, 0); }
}

@keyframes snbScreenGlow {
    0% { opacity: 0; }
    24% { opacity: 1; }
    60% { opacity: 0.55; }
    100% { opacity: 0; }
}

@keyframes snbRevealUp {
    from { opacity: 0; transform: translate3d(0, 24px, 0); }
    to { opacity: 1; transform: none; }
}
`;

const subscribeToNothing = () => () => undefined;

// useLayoutEffect lets the client decide before the first paint; useEffect is
// used during server rendering, where layout effects do not run.
const useIsomorphicLayoutEffect =
    typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Per-document state shared with the preload script (window.__stocknbookIntro).
type IntroWindowState = {
    mode?: IntroPhase; // decided by the preload script, consumed on first mount
    token?: string; // this document's value for stocknbook_intro_open
    tracking?: boolean; // pagehide/pageshow listeners registered (once per document)
    handled?: boolean; // the intro was already decided in this document
};

function getIntroWindowState(): IntroWindowState {
    const host = window as Window & { __stocknbookIntro?: IntroWindowState };

    host.__stocknbookIntro ??= {};

    return host.__stocknbookIntro;
}

// Storage access can throw in strict privacy modes; every helper fails safe.
function readSession(key: string) {
    try {
        return window.sessionStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeSession(key: string, value: string) {
    try {
        window.sessionStorage.setItem(key, value);
    } catch {
        // Without storage the tab simply cannot be remembered.
    }
}

function removeSession(key: string) {
    try {
        window.sessionStorage.removeItem(key);
    } catch {
        // Ignore unavailable storage.
    }
}

function readWindowName() {
    try {
        return window.name || "";
    } catch {
        return "";
    }
}

// Used when the landing page first renders client-side in a document (for
// example after a redirect from another route), where the preload script did
// not run. Same rules as the preload script, minus the navigation type.
function classifyClientSideVisit(state: IntroWindowState): IntroPhase {
    if (readSession(INTRO_LOGOUT_KEY) === "1") {
        removeSession(INTRO_LOGOUT_KEY);
        return "short";
    }

    const openToken = readSession(INTRO_OPEN_KEY);
    const wasDiscarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true;

    // A token this document did not write was copied from a still-open tab.
    if (openToken && openToken !== state.token && !wasDiscarded) {
        return "play";
    }

    if (readWindowName() === INTRO_TAB_NAME || readSession(INTRO_SEEN_KEY) === "1") {
        return "done";
    }

    return "play";
}

// Marks this tab as having shown the landing page and keeps the "open" token
// in place while this document is open. The two document-level listeners are
// registered once per document (shared with the preload script) and live as
// long as the document, because they must run when the page itself unloads.
function trackThisTab(state: IntroWindowState) {
    state.token ??= `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

    writeSession(INTRO_SEEN_KEY, "1");
    writeSession(INTRO_OPEN_KEY, state.token);

    const windowName = readWindowName();

    // Never overwrite a window name that something else has set.
    if (windowName === "" || windowName === INTRO_TAB_NAME) {
        try {
            window.name = INTRO_TAB_NAME;
        } catch {
            // Ignore.
        }
    }

    if (!state.tracking) {
        state.tracking = true;

        window.addEventListener("pagehide", () => {
            if (readSession(INTRO_OPEN_KEY) === state.token) {
                removeSession(INTRO_OPEN_KEY);
            }
        });

        window.addEventListener("pageshow", (event) => {
            if (event.persisted && state.token) {
                writeSession(INTRO_OPEN_KEY, state.token);
            }
        });
    }

    // The previous version mirrored the flag to a cookie shared by every tab.
    // It is no longer read; expire any copy that is left over.
    try {
        if (document.cookie.includes(`${INTRO_SEEN_KEY}=`)) {
            document.cookie = `${INTRO_SEEN_KEY}=; Max-Age=0; path=/; SameSite=Lax`;
        }
    } catch {
        // Ignore blocked cookies.
    }
}

function prefersReducedMotion() {
    return (
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
}

// SetupScreen renders this page as an aria-hidden decorative backdrop.
function isDecorativeBackdrop(element: HTMLElement) {
    return Boolean(element.parentElement?.closest('[aria-hidden="true"]'));
}

// Decides the intro mode when the landing page mounts.
function decideIntroForMount(root: HTMLElement): IntroPhase {
    // SetupScreen renders this page as a decorative backdrop: never animate it
    // and never let it change what the real landing page remembers.
    if (isDecorativeBackdrop(root)) {
        return "done";
    }

    const state = getIntroWindowState();
    let mode: IntroPhase;

    if (state.handled) {
        // Already shown in this document: client-side return, Login/Signup
        // remounts, React Strict Mode or Fast Refresh remounts.
        mode = "done";
    } else if (state.mode) {
        // Decided by the preload script before the first paint.
        mode = state.mode;
    } else {
        mode = classifyClientSideVisit(state);
    }

    state.handled = true;
    state.mode = undefined;
    trackThisTab(state);

    return prefersReducedMotion() ? "done" : mode;
}

// How far the CSS intro timeline has already progressed (it starts at first
// paint, which can be before hydration).
function getIntroElapsedMs(root: HTMLElement) {
    const clock = root.querySelector<HTMLElement>(".snb-intro-clock");

    if (!clock || typeof clock.getAnimations !== "function") {
        return 0;
    }

    const currentTime = clock.getAnimations()[0]?.currentTime;

    return typeof currentTime === "number" ? currentTime : 0;
}

function clampUnit(value: number) {
    return Math.min(1, Math.max(-1, value));
}

export default function LandingPage({
                                        onSignupSuccess,
                                    }: {
    onSignupSuccess: () => void;
}) {
    const [authMode, setAuthMode] = useState<AuthMode>(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [activeSection, setActiveSection] = useState("home");
    const [activeCapabilityId, setActiveCapabilityId] =
        useState<CapabilityId>("bookings");
    const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);
    const capabilityTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const [selectedPlan, setSelectedPlan] =
        useState<PricingPlan | null>(null);

    const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] =
        useState(false);
    const [pricingPlans, setPricingPlans] = useState<PricingPlan[]>([]);
    const [pricingLoading, setPricingLoading] = useState(true);
    const [pricingError, setPricingError] = useState("");

    // Server HTML always starts in "play"; the preload script and the layout
    // effect below switch to "done" before paint when the intro should not run.
    const [introPhase, setIntroPhase] = useState<IntroPhase>("play");
    const introDecisionRef = useRef<IntroPhase | null>(null);
    const mainRef = useRef<HTMLElement | null>(null);
    const navRef = useRef<HTMLElement | null>(null);
    const scrollProgressRef = useRef<HTMLDivElement | null>(null);
    const deviceAreaRef = useRef<HTMLDivElement | null>(null);
    const deviceTiltRef = useRef<HTMLDivElement | null>(null);

    // True only for the server render and the hydration pass, so the preload
    // script exists in the initial HTML but is never created on the client.
    const isServerOrHydrating = useSyncExternalStore(
        subscribeToNothing,
        () => false,
        () => true,
    );

    const finishIntro = useCallback(() => {
        setIntroPhase("done");
    }, []);

    const handleSkipIntro = () => {
        finishIntro();
    };

    const handleIntroAnimationEnd = (event: ReactAnimationEvent<HTMLElement>) => {
        // elapsedTime is 0 when an animation is rewound past its start (for
        // example scrubbing in DevTools); only a real finish ends the intro.
        if (
            event.target instanceof Element &&
            event.target.classList.contains("snb-intro-clock") &&
            event.elapsedTime > 0
        ) {
            finishIntro();
        }
    };

    useIsomorphicLayoutEffect(() => {
        const root = mainRef.current;

        if (!root) {
            return;
        }

        // Decide once per mount (React Strict Mode runs effects twice in dev).
        if (introDecisionRef.current === null) {
            introDecisionRef.current = decideIntroForMount(root);
        }

        setIntroPhase(introDecisionRef.current);
    }, []);

    // Safety net in case animationend is missed (e.g. a background tab): the
    // intro always ends and the page never stays hidden.
    useEffect(() => {
        if (introPhase === "done") {
            return;
        }

        const root = mainRef.current;

        if (!root) {
            return;
        }

        const totalMs = introPhase === "short" ? SHORT_INTRO_TOTAL_MS : INTRO_TOTAL_MS;
        const remainingMs = Math.max(0, totalMs - getIntroElapsedMs(root));
        const fallbackTimer = window.setTimeout(finishIntro, remainingMs + 500);

        return () => window.clearTimeout(fallbackTimer);
    }, [introPhase, finishIntro]);

    // Scene 5: subtle cursor-following tilt for the laptop and phone mockup.
    useEffect(() => {
        if (introPhase !== "done") {
            return;
        }

        const area = deviceAreaRef.current;
        const tilt = deviceTiltRef.current;
        const root = mainRef.current;

        if (
            !area ||
            !tilt ||
            !root ||
            isDecorativeBackdrop(root) ||
            typeof window.matchMedia !== "function"
        ) {
            return;
        }

        const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
        const maxTiltX = 3.5;
        const maxTiltY = 4.5;
        const smoothing = 0.12;

        let frame = 0;
        let pointerX = 0;
        let pointerY = 0;
        let isHovering = false;
        let currentX = 0;
        let currentY = 0;

        const render = () => {
            frame = 0;

            let targetX = 0;
            let targetY = 0;

            if (isHovering) {
                const rect = area.getBoundingClientRect();

                if (rect.width > 0 && rect.height > 0) {
                    const horizontal = clampUnit(((pointerX - rect.left) / rect.width) * 2 - 1);
                    const vertical = clampUnit(((pointerY - rect.top) / rect.height) * 2 - 1);

                    targetX = -vertical * maxTiltX;
                    targetY = horizontal * maxTiltY;
                }
            }

            currentX += (targetX - currentX) * smoothing;
            currentY += (targetY - currentY) * smoothing;

            const settled =
                Math.abs(targetX - currentX) < 0.005 &&
                Math.abs(targetY - currentY) < 0.005;

            if (settled) {
                currentX = targetX;
                currentY = targetY;
            }

            if (currentX === 0 && currentY === 0) {
                tilt.style.transform = "";
                tilt.style.willChange = "";
            } else {
                tilt.style.transform = `perspective(1200px) rotateX(${currentX.toFixed(3)}deg) rotateY(${currentY.toFixed(3)}deg)`;
            }

            if (!settled) {
                frame = window.requestAnimationFrame(render);
            }
        };

        const scheduleRender = () => {
            if (!frame) {
                frame = window.requestAnimationFrame(render);
            }
        };

        const handlePointerMove = (event: PointerEvent) => {
            if (
                event.pointerType !== "mouse" ||
                !finePointer.matches ||
                reducedMotion.matches
            ) {
                return;
            }

            pointerX = event.clientX;
            pointerY = event.clientY;

            if (!isHovering) {
                isHovering = true;
                tilt.style.willChange = "transform";
            }

            scheduleRender();
        };

        const handlePointerLeave = () => {
            isHovering = false;
            scheduleRender();
        };

        area.addEventListener("pointermove", handlePointerMove, { passive: true });
        area.addEventListener("pointerleave", handlePointerLeave);

        return () => {
            area.removeEventListener("pointermove", handlePointerMove);
            area.removeEventListener("pointerleave", handlePointerLeave);

            if (frame) {
                window.cancelAnimationFrame(frame);
            }

            tilt.style.transform = "";
            tilt.style.willChange = "";
        };
    }, [introPhase]);

    // Frosted-glass header, gold reading progress, and restrained decorative
    // parallax. Apply transforms directly so scrolling does not re-render React.
    useEffect(() => {
        const root = mainRef.current;
        const nav = navRef.current;
        const progress = scrollProgressRef.current;

        if (!root || !nav || !progress || isDecorativeBackdrop(root)) {
            return;
        }

        const decorations = Array.from(
            root.querySelectorAll<HTMLElement>("[data-snb-parallax]"),
        );
        const motionPreference = typeof window.matchMedia === "function"
            ? window.matchMedia("(prefers-reduced-motion: reduce)")
            : null;
        let frame = 0;

        const update = () => {
            frame = 0;
            const top = Math.max(0, window.scrollY || window.pageYOffset || 0);
            const scrollable = Math.max(
                0,
                document.documentElement.scrollHeight - window.innerHeight,
            );
            const fraction = scrollable > 0 ? Math.min(1, top / scrollable) : 0;

            nav.dataset.snbScrolled = top > 36 ? "true" : "false";
            progress.style.transform = `scaleX(${fraction.toFixed(5)})`;

            decorations.forEach((decoration) => {
                if (motionPreference?.matches) {
                    decoration.style.transform = "";
                    return;
                }
                const section = decoration.closest("section");
                if (!section) return;
                const rect = section.getBoundingClientRect();
                if (rect.bottom < -100 || rect.top > window.innerHeight + 100) return;
                const viewportMiddle = window.innerHeight / 2;
                const sectionMiddle = rect.top + rect.height / 2;
                const distance = (viewportMiddle - sectionMiddle) /
                    Math.max(1, (window.innerHeight + rect.height) / 2);
                const shift = Math.max(-1, Math.min(1, distance)) * 18;
                decoration.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
            });
        };

        const scheduleUpdate = () => {
            if (!frame) frame = window.requestAnimationFrame(update);
        };

        update();
        window.addEventListener("scroll", scheduleUpdate, { passive: true });
        window.addEventListener("resize", scheduleUpdate);
        motionPreference?.addEventListener?.("change", scheduleUpdate);
        // Pricing results and FAQ answers can change the page height without scrolling.
        const sizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(scheduleUpdate)
            : null;
        sizeObserver?.observe(root);

        return () => {
            window.removeEventListener("scroll", scheduleUpdate);
            window.removeEventListener("resize", scheduleUpdate);
            motionPreference?.removeEventListener?.("change", scheduleUpdate);
            sizeObserver?.disconnect();
            if (frame) window.cancelAnimationFrame(frame);
            decorations.forEach((decoration) => { decoration.style.transform = ""; });
            progress.style.transform = "";
        };
    }, []);

    // Fade section content in once, the first time it enters the viewport.
    useEffect(() => {
        const root = mainRef.current;

        if (
            !root ||
            typeof IntersectionObserver === "undefined" ||
            typeof MutationObserver === "undefined" ||
            prefersReducedMotion() ||
            isDecorativeBackdrop(root)
        ) {
            return;
        }

        const revealObserver = new IntersectionObserver(
            (entries) => {
                const entering = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((first, second) => {
                        const verticalGap =
                            first.boundingClientRect.top -
                            second.boundingClientRect.top;

                        return Math.abs(verticalGap) > 4
                            ? verticalGap
                            : first.boundingClientRect.left -
                            second.boundingClientRect.left;
                    });

                // Elements entering together are staggered; a lone element
                // appears without delay.
                entering.forEach((entry, index) => {
                    const element = entry.target as HTMLElement;

                    revealObserver.unobserve(element);
                    element.style.setProperty(
                        "--snb-reveal-delay",
                        `${Math.min(index, 5) * 85}ms`,
                    );
                    // Light up a workflow card's connected steps in sequence.
                    // The attribute stays, so the steps remain lit afterwards.
                    element
                        .querySelectorAll<HTMLElement>("[data-snb-flow]")
                        .forEach((flow) => {
                            flow.dataset.snbFlowActive = "true";
                        });

                    // Clear animation fill when finished so original hover
                    // transforms and shadows continue working normally.
                    element.addEventListener("animationend", (event) => {
                        if (event.target === element &&
                            element.getAttribute(REVEAL_STATE_ATTRIBUTE) === "in") {
                            element.setAttribute(REVEAL_STATE_ATTRIBUTE, "done");
                        }
                    }, { once: true });
                    element.setAttribute(REVEAL_STATE_ATTRIBUTE, "in");
                });
            },
            { rootMargin: "0px 0px -6% 0px", threshold: 0 },
        );

        const registerElement = (element: Element, animateIfVisible: boolean) => {
            if (
                !(element instanceof HTMLElement) ||
                element.hasAttribute(REVEAL_STATE_ATTRIBUTE) ||
                element.matches(REVEAL_CHILDREN_SELECTOR)
            ) {
                return;
            }

            const rect = element.getBoundingClientRect();
            const viewportHeight =
                window.innerHeight || document.documentElement.clientHeight;
            const isAboveViewport = rect.bottom <= 0;
            const isInViewport = rect.top < viewportHeight && rect.bottom > 0;

            // Never hide something the visitor has already scrolled past or is
            // already looking at.
            if (isAboveViewport || (isInViewport && !animateIfVisible)) {
                element.setAttribute(REVEAL_STATE_ATTRIBUTE, "done");
                return;
            }

            // Only elements being observed are hidden, so each one is
            // guaranteed to be revealed when it enters the viewport.
            element.setAttribute(REVEAL_STATE_ATTRIBUTE, "pending");
            revealObserver.observe(element);
        };

        const registerGroups = (node: HTMLElement, animateIfVisible: boolean) => {
            const parent = node.parentElement;

            if (parent?.matches(REVEAL_CHILDREN_SELECTOR)) {
                registerElement(node, animateIfVisible);
            }

            const groups = Array.from(
                node.querySelectorAll<HTMLElement>(REVEAL_CHILDREN_SELECTOR),
            );

            if (node.matches(REVEAL_CHILDREN_SELECTOR)) {
                groups.unshift(node);
            }

            groups.forEach((group) => {
                Array.from(group.children).forEach((child) =>
                    registerElement(child, animateIfVisible),
                );
            });
        };

        registerGroups(root, false);

        // Pricing cards and other late content are registered as they mount.
        const mutationObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement) {
                        registerGroups(node, true);
                    }
                });
            });
        });

        mutationObserver.observe(root, { childList: true, subtree: true });

        return () => {
            mutationObserver.disconnect();
            revealObserver.disconnect();
        };
    }, []);

    const handleSelectPlan = (plan: PricingPlan) => {
        setSelectedPlan(plan);
        setIsSubscriptionModalOpen(true);
    };

    const handleCloseSubscriptionModal = () => {
        setIsSubscriptionModalOpen(false);
        setSelectedPlan(null);
    };

    const handlePlanAuthentication = (mode: Exclude<AuthMode, null>) => {
        if (selectedPlan) {
            sessionStorage.setItem(
                "pending_plan",
                JSON.stringify({
                    plan_id: selectedPlan.id,
                    plan_name: selectedPlan.name,
                }),
            );
        }

        setIsSubscriptionModalOpen(false);
        setAuthMode(mode);
    };

    useEffect(() => {
        let cancelled = false;

        async function loadPricingPlans() {
            setPricingLoading(true);
            setPricingError("");

            try {
                const response = await fetch("/api/subscription-admin/plans", { cache: "no-store" });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.message || "Unable to load pricing plans.");
                }

                if (!cancelled) {
                    setPricingPlans((data.plans || []).map(buildPublicPlan));
                }
            } catch (error) {
                if (!cancelled) {
                    setPricingError(
                        error instanceof Error
                            ? error.message
                            : "Unable to load pricing plans.",
                    );
                }
            } finally {
                if (!cancelled) setPricingLoading(false);
            }
        }

        loadPricingPlans();

        return () => {
            cancelled = true;
        };
    }, []);


    const activeCapability =
        aboutCapabilities.find((capability) => capability.id === activeCapabilityId) ??
        aboutCapabilities[0];
    const ActiveCapabilityIcon = activeCapability.icon;

    // Arrow keys, Home, and End move between capability tabs (WAI-ARIA tabs).
    const handleCapabilityKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const currentIndex = aboutCapabilities.findIndex(
            (capability) => capability.id === activeCapabilityId,
        );
        const lastIndex = aboutCapabilities.length - 1;
        let nextIndex: number;

        switch (event.key) {
            case "ArrowRight":
            case "ArrowDown":
                nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
                break;
            case "ArrowLeft":
            case "ArrowUp":
                nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
                break;
            case "Home":
                nextIndex = 0;
                break;
            case "End":
                nextIndex = lastIndex;
                break;
            default:
                return;
        }

        event.preventDefault();
        setActiveCapabilityId(aboutCapabilities[nextIndex].id);
        capabilityTabRefs.current[nextIndex]?.focus();
    };


    useEffect(() => {
        const sections = navigationItems
            .map((item) => document.getElementById(item.sectionId))
            .filter((section): section is HTMLElement => Boolean(section));

        const observer = new IntersectionObserver(
            (entries) => {
                const visibleEntries = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort(
                        (first, second) =>
                            second.intersectionRatio -
                            first.intersectionRatio
                    );

                if (visibleEntries[0]) {
                    setActiveSection(visibleEntries[0].target.id);
                }
            },
            {
                rootMargin: "-28% 0px -58% 0px",
                threshold: [0.01, 0.15, 0.35, 0.6],
            }
        );

        sections.forEach((section) => observer.observe(section));

        return () => observer.disconnect();
    }, []);

    const desktopNavigationClass = (sectionId: string) =>
        [
            "px-3 py-2 transition duration-300",
            activeSection === sectionId
                ? "font-semibold text-[#F1C85C]"
                : "text-white/80 hover:-translate-y-0.5 hover:text-[#F5E8C0]",
        ].join(" ");

    const mobileNavigationClass = (sectionId: string) =>
        [
            "px-4 py-3 text-sm font-medium transition",
            activeSection === sectionId
                ? "font-semibold text-[#F1C85C]"
                : "text-white/85 hover:text-[#F5E8C0]",
        ].join(" ");

    return (
        <main
            ref={mainRef}
            data-snb-intro={introPhase}
            onAnimationEnd={handleIntroAnimationEnd}
            suppressHydrationWarning
            className="min-h-screen overflow-x-hidden bg-[#F7F4FB] font-sans text-[#21172C] antialiased"
        >
            <style dangerouslySetInnerHTML={{ __html: LANDING_ANIMATION_STYLES }} />

            {isServerOrHydrating && (
                <script dangerouslySetInnerHTML={{ __html: INTRO_PRELOAD_SCRIPT }} />
            )}

            <style jsx global>{`
                @keyframes heroFeatureFloat {
                    0%,
                    100% {
                        transform: translate3d(0, 0, 0);
                    }

                    50% {
                        transform: translate3d(0, -6px, 0);
                    }
                }

                .hero-feature-float {
                    animation: heroFeatureFloat 4.8s ease-in-out infinite;
                    will-change: transform;
                }

                @media (prefers-reduced-motion: reduce) {
                    .hero-feature-float {
                        animation: none !important;
                    }
                }
            `}</style>

            {introPhase !== "done" && (
                <>
                    <span aria-hidden="true" className="snb-intro-clock" />

                    {/* Scenes 1 & 2: centred branding that becomes the nav logo. */}
                    <div className="snb-intro" aria-hidden="true">
                        <div className="snb-intro-backdrop" />
                        <div className="snb-intro-glow" />

                        <div className="snb-intro-track">
                            <div className="snb-intro-row">
                                <div className="snb-intro-fly">
                                    <div className="snb-intro-brand gap-2 sm:gap-3">
                                        <Image
                                            src="/logo.png"
                                            alt=""
                                            width={176}
                                            height={176}
                                            priority
                                            className="h-9 w-9 shrink-0 object-contain sm:h-11 sm:w-11"
                                        />

                                        <span
                                            className={`${lora.className} truncate text-lg font-bold tracking-[-0.045em] text-white sm:text-2xl`}
                                        >
                                            Stock<span className="text-[#D4A126]">N</span>Book
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {introPhase === "play" && (
                        <button
                            type="button"
                            onClick={handleSkipIntro}
                            className="snb-skip-intro fixed bottom-5 right-5 z-[130] items-center gap-1.5 rounded-full border border-white/20 bg-[#1D1031]/55 px-4 py-2 text-xs font-medium tracking-wide text-white/80 shadow-[0_8px_24px_rgba(0,0,0,0.25)] backdrop-blur-md transition-colors hover:border-[#F5E8C0]/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]/70 sm:bottom-6 sm:right-6"
                        >
                            Skip intro
                            <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                    )}
                </>
            )}

            <nav
                ref={navRef}
                data-snb-scrolled="false"
                className="snb-nav fixed left-0 right-0 top-0 z-50 flex h-20 items-center justify-between border-b border-white/10 px-4 sm:px-6 lg:px-10"
            >
                <a
                    href="#home"
                    aria-label="StockNBook home"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="snb-nav-brand flex min-w-0 shrink-0 items-center gap-2 sm:gap-3"
                >
                    <Image
                        src="/logo.png"
                        alt="StockNBook logo"
                        width={176}
                        height={176}
                        priority
                        className="h-9 w-9 shrink-0 object-contain sm:h-11 sm:w-11"
                    />

                    <span
                        className={`${lora.className} truncate text-lg font-bold tracking-[-0.045em] text-white sm:text-2xl`}
                    >
                        Stock<span className="text-[#D4A126]">N</span>Book
                    </span>
                </a>

                <div className="snb-in snb-in-nav hidden items-center gap-1 text-xs font-medium md:flex lg:gap-2 lg:text-sm">
                    {navigationItems.map((item) => (
                        <a
                            key={item.sectionId}
                            href={item.href}
                            onClick={() =>
                                setActiveSection(item.sectionId)
                            }
                            aria-current={
                                activeSection === item.sectionId
                                    ? "page"
                                    : undefined
                            }
                            className={desktopNavigationClass(
                                item.sectionId
                            )}
                        >
                            {item.label}
                        </a>
                    ))}
                </div>

                <div className="snb-in snb-in-auth hidden items-center gap-3 md:flex">
                    <button
                        onClick={() => setAuthMode("login")}
                        className="rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition duration-300 hover:border-[#F5E8C0] hover:bg-white/10"
                    >
                        Log in
                    </button>

                    <button
                        onClick={() => setAuthMode("signup")}
                        className="rounded-lg bg-[#C9951A] px-4 py-2 text-sm font-medium text-white transition duration-300 hover:bg-[#D8A52A] hover:shadow-lg hover:shadow-[#C9951A]/30"
                    >
                        Get started
                    </button>
                </div>

                <button
                    type="button"
                    aria-label={isMobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-expanded={isMobileMenuOpen}
                    onClick={() => setIsMobileMenuOpen((current) => !current)}
                    className="snb-in snb-in-nav flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white transition hover:border-[#F5E8C0]/60 hover:bg-white/10 md:hidden"
                >
                    {isMobileMenuOpen ? (
                        <X className="h-6 w-6" />
                    ) : (
                        <Menu className="h-6 w-6" />
                    )}
                </button>

                {isMobileMenuOpen && (
                    <div className="absolute left-0 right-0 top-20 border-t border-white/10 bg-[#2D1B4E]/95 px-4 py-5 shadow-2xl backdrop-blur-xl md:hidden">
                        <div className="mx-auto flex max-w-md flex-col gap-1">
                            {navigationItems.map((item) => (
                                <a
                                    key={item.sectionId}
                                    href={item.href}
                                    onClick={() => {
                                        setActiveSection(item.sectionId);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    aria-current={
                                        activeSection === item.sectionId
                                            ? "page"
                                            : undefined
                                    }
                                    className={mobileNavigationClass(
                                        item.sectionId
                                    )}
                                >
                                    {item.label}
                                </a>
                            ))}

                            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setAuthMode("login");
                                    }}
                                    className="rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/10"
                                >
                                    Log in
                                </button>

                                <button
                                    onClick={() => {
                                        setIsMobileMenuOpen(false);
                                        setAuthMode("signup");
                                    }}
                                    className="rounded-xl bg-[#C9951A] px-4 py-3 text-sm font-medium text-white transition hover:bg-[#D8A52A]"
                                >
                                    Get started
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-white/10">
                    <div
                        ref={scrollProgressRef}
                        className="snb-scroll-progress h-full w-full bg-[#F1C85C] shadow-[0_0_9px_rgba(241,200,92,0.42)]"
                    />
                </div>
            </nav>

            <section
                id="home"
                className="relative min-h-screen scroll-mt-20 overflow-hidden bg-[radial-gradient(circle_at_18%_22%,_#4D3970_0%,_#2D1B4E_44%,_#211333_100%)] px-5 pb-10 pt-24 sm:px-6 lg:flex lg:h-screen lg:min-h-[680px] lg:items-center lg:px-10 lg:pb-6 lg:pt-24"
            >
                <div data-snb-parallax aria-hidden="true" className="pointer-events-none absolute -left-40 top-24 h-80 w-80 rounded-full bg-[#7655A5]/15 blur-3xl" />
                <div data-snb-parallax aria-hidden="true" className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#C9951A]/10 blur-3xl" />

                <div className="relative z-10 mx-auto grid w-full max-w-[1480px] items-center gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:gap-5 xl:grid-cols-[0.8fr_1.2fr]">
                    <div className="max-w-[650px] text-center lg:text-left">
                        <div className="snb-in snb-in-title mx-auto mb-5 flex w-full items-center justify-center lg:mx-0 lg:justify-start">
                            <span
                                className={`${lora.className} block text-[clamp(3rem,5.8vw,5.8rem)] font-bold leading-[0.9] tracking-[-0.06em] text-white drop-shadow-[0_10px_28px_rgba(0,0,0,0.18)]`}
                            >
                                Stock<span className="text-[#D4A126]">N</span>Book
                            </span>
                        </div>

                        <div className="snb-in snb-in-tagline mx-auto mb-4 inline-flex max-w-full items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-center text-xs font-medium text-[#F5E8C0] shadow-sm backdrop-blur-md lg:mx-0">
                            <Sparkles className="h-3.5 w-3.5" />
                            Built for party supply businesses with booking services.
                        </div>

                        <h1 className="snb-in snb-in-headline mx-auto max-w-xl text-4xl font-semibold leading-[1.08] tracking-[-0.04em] text-white sm:text-5xl lg:mx-0 lg:text-[3rem] xl:text-[3.35rem]">
                            The business OS for every{" "}
                            <span className="italic text-[#F5E8C0]">celebration.</span>
                        </h1>

                        <p className="snb-in snb-in-desc mx-auto mt-4 max-w-lg text-sm leading-6 text-white/65 sm:text-[15px] lg:mx-0">
                            Manage bookings, inventory, packages, POS sales, staff
                            access, and business insights in one organized system
                            for party supply businesses with booking services.
                        </p>

                        <div className="snb-in snb-in-cta mt-6 flex flex-wrap justify-center gap-3 lg:justify-start">
                            <button
                                onClick={() => setAuthMode("signup")}
                                className="inline-flex items-center gap-2 rounded-xl bg-[#C9951A] px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#C9951A]/15 transition hover:-translate-y-0.5 hover:bg-[#D8A52A]"
                            >
                                Get started free
                                <ArrowRight className="h-4 w-4" />
                            </button>

                            <a
                                href="#about"
                                onClick={() => setActiveSection("about")}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-md transition hover:-translate-y-0.5 hover:border-[#F5E8C0]/60 hover:bg-white/15"
                            >
                                Explore StockNBook
                                <ArrowRight className="h-4 w-4" />
                            </a>
                        </div>
                    </div>

                    <div
                        ref={deviceAreaRef}
                        className="relative mx-auto w-full max-w-[760px] lg:ml-auto lg:mr-0 xl:max-w-[800px]"
                    >
                        <div className="snb-in snb-in-device-shadow absolute inset-x-[14%] bottom-[9%] h-20 rounded-full bg-black/35 blur-3xl" />

                        <div className="relative z-10 flex min-h-[350px] items-center justify-center sm:min-h-[420px] lg:min-h-[470px] xl:min-h-[500px]">
                            {/* Outer wrapper: entrance animation. Inner wrapper: cursor tilt. */}
                            <div className="snb-in snb-in-device relative w-[92%]">
                                <div ref={deviceTiltRef} className="snb-device-tilt relative">
                                    <Image
                                        src="/laptop_cp.png"
                                        alt="StockNBook dashboard displayed on a laptop and mobile phone"
                                        width={1500}
                                        height={1125}
                                        priority
                                        className="block h-auto w-full object-contain drop-shadow-[0_28px_48px_rgba(0,0,0,0.32)]"
                                    />

                                    {introPhase === "play" && (
                                        <>
                                            <div aria-hidden="true" className="snb-screen snb-screen-laptop" />
                                            <div aria-hidden="true" className="snb-screen snb-screen-phone" />
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {heroHighlights.map((highlight, index) => {
                            const HighlightIcon = highlight.icon;

                            return (
                                <HeroFeatureBubble
                                    key={highlight.title}
                                    title={highlight.title}
                                    detail={highlight.detail}
                                    icon={<HighlightIcon className="h-5 w-5" />}
                                    className={`${highlight.position} snb-in snb-in-card snb-in-card-${index + 1}`}
                                    animationDelay={highlight.animationDelay}
                                />
                            );
                        })}

                        <div className="relative z-20 mt-4 grid grid-cols-2 gap-2 sm:hidden">
                            {heroHighlights.map((highlight, index) => {
                                const HighlightIcon = highlight.icon;

                                return (
                                    <div
                                        key={highlight.title}
                                        className={`snb-in snb-in-card snb-in-card-${index + 1} flex min-h-[74px] items-center gap-2.5 rounded-2xl border border-white/20 bg-white/10 px-3 py-3 text-left shadow-lg backdrop-blur-md`}
                                    >
                                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF4D9] text-[#C9951A]">
                                            <HighlightIcon className="h-4 w-4" />
                                        </span>

                                        <div className="min-w-0">
                                            <p className="truncate text-xs font-semibold text-white">
                                                {highlight.title}
                                            </p>

                                            <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-white/60">
                                                {highlight.detail}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <section
                id="about"
                className="relative isolate scroll-mt-20 overflow-hidden border-b border-[#EADFCB] bg-[#FFF8EA] px-5 py-16 sm:px-6 lg:px-10 lg:py-20"
            >
                <div data-snb-parallax aria-hidden="true" className="pointer-events-none absolute -right-20 top-20 h-64 w-64 rounded-full bg-[#CDB9E8]/15 blur-3xl" />
                <div className="relative z-10 mx-auto max-w-6xl">
                    {/* Part A: why StockNBook exists */}
                    <div className="mx-auto max-w-3xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            About StockNBook
                        </p>

                        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                            One platform. Every part of your business connected.
                        </h2>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            From customer bookings and inventory monitoring to daily
                            sales, multiple business locations, analytics, and demand
                            planning, StockNBook brings essential business operations
                            together in one organized platform.
                        </p>
                    </div>

                    <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-2 lg:gap-6" data-snb-reveal-children>
                        <article className="rounded-3xl border border-[#E7DCEB] bg-white p-7 shadow-[0_16px_40px_rgba(45,27,78,0.07)] sm:p-8">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#9B8FA6]">
                                The challenge
                            </p>

                            <h3 className="mt-3 text-xl font-bold tracking-[-0.02em] text-[#21172C]">
                                When business records are scattered
                            </h3>

                            <p className="mt-3 text-sm leading-7 text-[#706578]">
                                Many party supply businesses keep bookings in
                                notebooks, stock counts in spreadsheets, customer
                                requests in chat messages, and payments in manual
                                records. With information spread across separate
                                places, it becomes hard to see what is booked, what
                                is available, and how the business is doing.
                            </p>

                            <ul className="mt-5 flex flex-wrap gap-2" aria-label="Common separate records">
                                {[
                                    { label: "Notebooks", icon: StickyNote },
                                    { label: "Spreadsheets", icon: FileSpreadsheet },
                                    { label: "Customer messages", icon: Send },
                                    { label: "Manual records", icon: ReceiptText },
                                ].map((record) => {
                                    const RecordIcon = record.icon;

                                    return (
                                        <li
                                            key={record.label}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-[#ECE4F0] bg-[#FCFAFD] px-3 py-1.5 text-xs font-medium text-[#6E6378]"
                                        >
                                            <RecordIcon className="h-3.5 w-3.5 text-[#9B8FA6]" />
                                            {record.label}
                                        </li>
                                    );
                                })}
                            </ul>
                        </article>

                        <article className="rounded-3xl border border-[#2D1B4E] bg-[#2D1B4E] p-7 text-white shadow-[0_20px_50px_rgba(45,27,78,0.22)] sm:p-8">
                            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#F1C85C]">
                                The StockNBook approach
                            </p>

                            <h3 className="mt-3 text-xl font-bold tracking-[-0.02em]">
                                When every part is connected
                            </h3>

                            <p className="mt-3 text-sm leading-7 text-white/70">
                                StockNBook organizes those activities in one place.
                                Confirmed bookings reserve inventory, sales update
                                stock records, and every branch and team member
                                works from the same business information, with
                                access that matches their role.
                            </p>

                            <ul className="mt-5 grid gap-2.5 text-sm text-white/85">
                                {[
                                    "One organized place for business records",
                                    "Connected bookings, inventory, and sales",
                                    "Role-based access for your team",
                                ].map((point) => (
                                    <li key={point} className="flex items-start gap-2.5">
                                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F1C85C]" />
                                        <span>{point}</span>
                                    </li>
                                ))}
                            </ul>
                        </article>
                    </div>

                    {/* Part B: interactive six core capabilities explorer */}
                    <div className="mx-auto mt-20 max-w-3xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            Six core capabilities
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl">
                            Explore what StockNBook brings together
                        </h3>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            Select a capability to see the challenge it addresses,
                            how StockNBook helps, and the value it brings to your
                            business.
                        </p>
                    </div>

                    <div className="mt-10" data-snb-reveal-children>
                        <div
                            role="tablist"
                            aria-label="StockNBook core capabilities"
                            onKeyDown={handleCapabilityKeyDown}
                            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
                        >
                            {aboutCapabilities.map((capability, index) => {
                                const CapabilityIcon = capability.icon;
                                const isActive = capability.id === activeCapability.id;

                                return (
                                    <button
                                        key={capability.id}
                                        ref={(element: HTMLButtonElement | null) => {
                                            capabilityTabRefs.current[index] = element;
                                        }}
                                        id={`capability-tab-${capability.id}`}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        aria-controls="capability-panel"
                                        tabIndex={isActive ? 0 : -1}
                                        onClick={() => setActiveCapabilityId(capability.id)}
                                        className={[
                                            "group relative flex min-h-[108px] flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border p-4 text-left transition duration-300 sm:min-h-[124px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9951A] focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFF8EA]",
                                            isActive
                                                ? "border-[#2D1B4E] bg-[#2D1B4E] text-white shadow-[0_18px_40px_rgba(45,27,78,0.22)]"
                                                : "border-[#E7DCEB] bg-white text-[#21172C] shadow-[0_10px_26px_rgba(45,27,78,0.06)] hover:-translate-y-0.5 hover:border-[#D6C4DE] hover:shadow-[0_16px_34px_rgba(45,27,78,0.10)]",
                                        ].join(" ")}
                                    >
                                        <span
                                            className={[
                                                "flex h-10 w-10 items-center justify-center rounded-xl transition duration-300",
                                                isActive
                                                    ? "bg-[#C9951A] text-white"
                                                    : "bg-[#FFF0C5] text-[#C9951A]",
                                            ].join(" ")}
                                        >
                                            <CapabilityIcon className="h-5 w-5" />
                                        </span>

                                        <span className="text-sm font-semibold leading-5">
                                            {capability.name}
                                        </span>

                                        <span
                                            aria-hidden="true"
                                            className={[
                                                "absolute inset-x-4 bottom-0 h-1 rounded-t-full transition duration-300",
                                                isActive ? "bg-[#F1C85C]" : "bg-transparent",
                                            ].join(" ")}
                                        />
                                    </button>
                                );
                            })}
                        </div>

                        <div
                            id="capability-panel"
                            role="tabpanel"
                            aria-labelledby={`capability-tab-${activeCapability.id}`}
                            tabIndex={0}
                            className="mt-5 rounded-3xl border border-[#E7DCEB] bg-white p-6 shadow-[0_20px_50px_rgba(45,27,78,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9951A] sm:p-8 lg:p-10"
                        >
                            <div key={activeCapability.id} className="snb-capability-panel-content">
                                <div className="flex items-start gap-4">
                                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#2D1B4E] text-[#F1C85C]">
                                        <ActiveCapabilityIcon className="h-7 w-7" />
                                    </span>

                                    <div className="min-w-0">
                                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#C9951A]">
                                            {activeCapability.name}
                                        </p>

                                        <h4 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-[#21172C] sm:text-3xl">
                                            {activeCapability.headline}
                                        </h4>

                                        <p className="mt-2 text-sm leading-6 text-[#706578]">
                                            {activeCapability.purpose}
                                        </p>
                                    </div>
                                </div>

                                <div className="mt-8 grid gap-4 md:grid-cols-3">
                                    <div className="rounded-2xl border border-[#EFE7F3] bg-[#FCFAFD] p-5">
                                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8A7F94]">
                                            The challenge
                                        </p>
                                        <p className="mt-2 text-sm leading-7 text-[#4F4559]">
                                            {activeCapability.challenge}
                                        </p>
                                    </div>

                                    <div className="rounded-2xl border border-[#E4D9EE] bg-[#F4EFF9] p-5">
                                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#2D1B4E]">
                                            How StockNBook helps
                                        </p>
                                        <p className="mt-2 text-sm leading-7 text-[#4F4559]">
                                            {activeCapability.solution}
                                        </p>
                                    </div>

                                    <div className="rounded-2xl border border-[#EFDDB0] bg-[#FFF8E6] p-5">
                                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A77B12]">
                                            Business value
                                        </p>
                                        <p className="mt-2 text-sm leading-7 text-[#4F4559]">
                                            {activeCapability.value}
                                        </p>
                                    </div>
                                </div>

                                {activeCapability.distinction && (
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        {activeCapability.distinction.map((item) => (
                                            <div
                                                key={item.title}
                                                className="flex items-start gap-3 rounded-2xl border border-[#E7DCEB] px-4 py-3"
                                            >
                                                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#C9951A]" />
                                                <p className="text-sm leading-6 text-[#4F4559]">
                                                    <span className="font-semibold text-[#21172C]">
                                                        {item.title}:
                                                    </span>{" "}
                                                    {item.text}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <ul className="mt-6 flex flex-wrap gap-2" aria-label={`${activeCapability.name} highlights`}>
                                    {activeCapability.includes.map((item) => (
                                        <li
                                            key={item}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-[#E7DCEB] bg-white px-3 py-1.5 text-xs font-medium text-[#2D1B4E]"
                                        >
                                            <Check className="h-3.5 w-3.5 text-[#C9951A]" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>

                                {activeCapability.note && (
                                    <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#7A6E88]">
                                        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#C9951A]" />
                                        <span>{activeCapability.note}</span>
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Part C: how everything connects */}
                    <div className="mx-auto mt-20 max-w-3xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            How everything connects
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl">
                            One record leads naturally to the next
                        </h3>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            Three everyday situations show how the capabilities work
                            together. These are illustrative workflows, not live
                            customer data.
                        </p>
                    </div>

                    <div className="mt-10 grid gap-5 lg:grid-cols-3" data-snb-reveal-children>
                        {connectionScenarios.map((scenario, index) => (
                            <article
                                key={scenario.title}
                                className="flex h-full flex-col rounded-3xl border border-[#E7DCEB] bg-white p-6 shadow-[0_16px_40px_rgba(45,27,78,0.07)] sm:p-7"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-xl bg-[#F1ECF8] px-3 text-sm font-medium text-[#2D1B4E]">
                                        {String(index + 1).padStart(2, "0")}
                                    </span>

                                    <h4 className="text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                                        {scenario.title}
                                    </h4>
                                </div>

                                <p className="mt-4 flex-1 text-sm leading-7 text-[#706578]">
                                    {scenario.description}
                                </p>

                                <ol
                                    data-snb-flow
                                    aria-label={`${scenario.title}: ${scenario.flow.map((step) => step.label).join(", then ")}`}
                                    className="snb-flow mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-2 border-t border-[#EFE7F3] pt-5"
                                >
                                    {scenario.flow.map((step, stepIndex) => {
                                        const StepIcon = step.icon;

                                        // Each arrow stays with the step it points to,
                                        // so a wrapped line never ends with an arrow.
                                        return (
                                            <li key={step.label} className="flex items-center gap-1.5">
                                                {stepIndex > 0 && (
                                                    <span aria-hidden="true" className="snb-flow-link flex text-[#C9951A]">
                                                        <ArrowRight className="h-3.5 w-3.5" />
                                                    </span>
                                                )}

                                                <span className="snb-flow-step inline-flex items-center gap-1.5 rounded-full border border-[#EAD9B0] bg-[#FFF8E8] px-3 py-1.5 text-xs font-semibold text-[#2D1B4E]">
                                                    <StepIcon className="h-3.5 w-3.5" />
                                                    {step.label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ol>
                            </article>
                        ))}
                    </div>

                    {/* Part D: who StockNBook supports */}
                    <div className="mx-auto mt-20 max-w-3xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            Who StockNBook supports
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl">
                            Clear responsibilities for every role
                        </h3>

                        <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                            Owners, Managers, and Staff each work with the tools that
                            match their responsibilities.
                        </p>
                    </div>

                    <div className="mt-10 grid gap-5 md:grid-cols-3" data-snb-reveal-children>
                        {roleSummaries.map((role) => {
                            const RoleIcon = role.icon;

                            return (
                                <article
                                    key={role.title}
                                    className="flex h-full flex-col rounded-3xl border border-[#E7DCEB] bg-white p-6 shadow-[0_16px_40px_rgba(45,27,78,0.07)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_22px_50px_rgba(45,27,78,0.11)]"
                                >
                                    <div className="flex items-center gap-3">
                                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#F1ECF8] text-[#2D1B4E]">
                                            <RoleIcon className="h-5 w-5" />
                                        </span>

                                        <h4 className="text-lg font-bold tracking-[-0.02em] text-[#21172C]">
                                            {role.title}
                                        </h4>
                                    </div>

                                    <p className="mt-4 flex-1 text-sm leading-7 text-[#706578]">
                                        {role.description}
                                    </p>

                                    <p className="mt-4 border-t border-[#EFE7F3] pt-4 text-xs leading-5 text-[#8A7F94]">
                                        {role.access}
                                    </p>
                                </article>
                            );
                        })}
                    </div>

                    {/* Part E: what businesses gain */}
                    <div className="mx-auto mt-20 max-w-3xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                            What businesses gain
                        </p>

                        <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl">
                            Practical improvements for everyday operations
                        </h3>
                    </div>

                    <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-snb-reveal-children>
                        {businessGains.map((gain) => (
                            <article
                                key={gain.from}
                                className="rounded-2xl border border-[#E7DCEB] bg-white p-5 shadow-[0_10px_26px_rgba(45,27,78,0.05)]"
                            >
                                <p className="text-sm font-medium text-[#7A6E88]">
                                    {gain.from}
                                </p>

                                <div aria-hidden="true" className="my-3 flex items-center gap-2 text-[#C9951A]">
                                    <ArrowRight className="h-4 w-4" />
                                    <span className="h-px flex-1 bg-[#EFE3C6]" />
                                </div>

                                <p className="text-sm font-semibold leading-6 text-[#21172C]">
                                    <span className="sr-only">With StockNBook: </span>
                                    {gain.to}
                                </p>
                            </article>
                        ))}
                    </div>
                </div>
            </section>

            <PricingSection
                pricingPlans={pricingPlans}
                loading={pricingLoading}
                error={pricingError}
                onSelectPlan={handleSelectPlan}
            />

            <section
                id="faq"
                className="scroll-mt-20 bg-white px-5 py-20 sm:px-6 lg:px-10"
            >
                <div className="mx-auto max-w-6xl">
                    <SectionHeading
                        eyebrow="Frequently asked questions"
                        title="Everything you need to know about StockNBook"
                        description="Quick answers about features, accounts, subscriptions, and everyday business operations."
                    />

                    <div className="mx-auto mt-12 max-w-3xl space-y-3" data-snb-reveal-children>
                        {faqItems.map((item, index) => (
                            <FaqItem
                                key={item.question}
                                index={index}
                                question={item.question}
                                answer={item.answer}
                                link={item.link}
                                isOpen={openFaqIndex === index}
                                onToggle={() =>
                                    setOpenFaqIndex((current) =>
                                        current === index ? null : index,
                                    )
                                }
                            />
                        ))}
                    </div>
                </div>
            </section>

            <section
                id="contact"
                className="relative isolate scroll-mt-20 overflow-hidden bg-[#2D1B4E] px-5 py-16 text-white sm:px-6 lg:px-10 lg:py-20"
            >
                <div data-snb-parallax aria-hidden="true" className="pointer-events-none absolute -right-16 top-6 h-64 w-64 rounded-full bg-[#C9951A]/[0.08] blur-3xl" />
                <div className="relative z-10 mx-auto max-w-6xl">
                    <div className="mx-auto max-w-2xl text-center" data-snb-reveal-children>
                        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#F1C85C]">
                            Contact us
                        </p>

                        <h2 className="mt-3 text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">
                            Have a question? We&apos;re here to help.
                        </h2>

                        <p className="mx-auto mt-3 max-w-xl text-sm leading-7 text-white/65 sm:text-base">
                            Learn more about StockNBook, ask about its features, or
                            get assistance with your account.
                        </p>
                    </div>

                    <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-2" data-snb-reveal-children>
                        <article className="snb-contact-left flex flex-col rounded-3xl border border-white/10 bg-white/[0.06] p-7 shadow-[0_20px_50px_rgba(10,4,22,0.25)] sm:p-8">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C9951A]/15 text-[#F1C85C]">
                                <Mail className="h-6 w-6" />
                            </span>

                            <h3 className="mt-5 text-xl font-semibold tracking-[-0.01em]">
                                Contact Support
                            </h3>

                            <p className="mt-2 flex-1 text-sm leading-7 text-white/65">
                                Have a question about your account, a subscription,
                                or how the platform works? Send an email with the
                                details and your business name.
                            </p>

                            <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-white/45">
                                Email
                            </p>
                            <p className="mt-1 break-all text-base font-semibold text-[#F5E8C0]">
                                {SUPPORT_EMAIL}
                            </p>

                            <a
                                href={`mailto:${SUPPORT_EMAIL}`}
                                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-6 py-3 text-sm font-medium text-white transition duration-300 hover:-translate-y-0.5 hover:border-[#F1C85C] hover:bg-white/10 sm:w-auto sm:self-start"
                            >
                                <Mail className="h-4 w-4" />
                                Email Support
                            </a>
                        </article>

                        <article className="snb-contact-right flex flex-col rounded-3xl border border-[#C9951A]/30 bg-[linear-gradient(145deg,_rgba(201,149,26,0.14)_0%,_rgba(255,255,255,0.05)_100%)] p-7 shadow-[0_20px_50px_rgba(10,4,22,0.25)] sm:p-8">
                            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#C9951A] text-white">
                                <Store className="h-6 w-6" />
                            </span>

                            <h3 className="mt-5 text-xl font-semibold tracking-[-0.01em]">
                                Start With StockNBook
                            </h3>

                            <p className="mt-2 text-sm leading-7 text-white/65">
                                Bring bookings, inventory, POS sales, branches,
                                analytics, and demand forecasting into one organized
                                platform for your party supply business.
                            </p>

                            <p className="mt-4 flex flex-1 items-start gap-2.5 text-sm leading-6 text-white/80">
                                <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#F1C85C]" />
                                <span>
                                    Begin on the Starter plan without a paid
                                    subscription, then upgrade when you need higher
                                    limits.
                                </span>
                            </p>

                            <button
                                type="button"
                                onClick={() => setAuthMode("signup")}
                                className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#C9951A] px-6 py-3 text-sm font-medium text-white transition duration-300 hover:-translate-y-0.5 hover:bg-[#D8A52A] hover:shadow-lg hover:shadow-[#C9951A]/30 sm:w-auto sm:self-start"
                            >
                                Get Started
                                <ArrowRight className="h-4 w-4" />
                            </button>
                        </article>
                    </div>
                </div>
            </section>

            {/* A concise final call to action, using StockNBook's existing signup flow. */}
            <section
                aria-label="Start using StockNBook"
                className="border-t border-[#EADFCB] bg-[#FFF8EA] px-5 py-9 sm:px-6 lg:px-10"
            >
                <div
                    className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-5 sm:flex-row sm:items-center"
                    data-snb-reveal-children
                >
                    <div className="max-w-2xl">
                        <h2 className="text-2xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-3xl">
                            Ready to organize your business?
                        </h2>
                        <p className="mt-2 text-sm leading-6 text-[#706578]">
                            Bring your bookings, inventory, sales, and business operations together with StockNBook.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setAuthMode("signup")}
                        className="inline-flex min-h-12 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-[#C9951A] px-6 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(201,149,26,0.20)] transition duration-300 hover:-translate-y-0.5 hover:bg-[#D8A52A] hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D1B4E] sm:w-auto"
                    >
                        Get Started
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                </div>
            </section>

            {/* Four-column footer inspired by the reference, with real links only. */}
            <footer className="border-t border-[#3F2C57] bg-[#241437] px-5 pb-8 pt-12 text-white sm:px-6 lg:px-10">
                <div className="mx-auto max-w-6xl">
                    <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4" data-snb-reveal-children>
                        {/* Brand and discreet four-person team acknowledgement. */}
                        <div className="min-w-0">
                            <a href="#home" className="inline-flex items-center gap-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]">
                                <Image
                                    src="/logo.png"
                                    alt=""
                                    width={176}
                                    height={176}
                                    className="h-9 w-9 shrink-0 object-contain"
                                />
                                <span className={`${lora.className} text-xl font-bold tracking-[-0.045em] text-white`}>
                                    Stock<span className="text-[#D4A126]">N</span>Book
                                </span>
                            </a>
                            <p className="mt-4 max-w-xs text-sm leading-6 text-white/60">
                                A business management platform for party supply businesses with booking services.
                            </p>
                            <div className="mt-4 flex items-center gap-2">
                                <span className="text-xs leading-5 text-white/60">
                                    Developed by the E.A.S.Y. Development Team
                                </span>
                            </div>
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold text-white">Quick Links</h3>
                            <ul className="mt-4 space-y-3">
                                {navigationItems.map((item) => (
                                    <li key={item.sectionId}>
                                        <a
                                            href={item.href}
                                            className="text-sm text-white/60 transition-colors hover:text-[#F1C85C] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]"
                                        >
                                            {item.label}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div>
                            <h3 className="text-sm font-semibold text-white">Core Capabilities</h3>
                            <ul className="mt-4 space-y-3">
                                {aboutCapabilities.map((capability) => (
                                    <li key={capability.id}>
                                        <a
                                            href={`#capability-tab-${capability.id}`}
                                            onClick={() => setActiveCapabilityId(capability.id)}
                                            className="text-sm text-white/60 transition-colors hover:text-[#F1C85C] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]"
                                        >
                                            {capability.name}
                                        </a>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="min-w-0">
                            <h3 className="text-sm font-semibold text-white">Contact &amp; Support</h3>
                            <div className="mt-4 space-y-3 text-sm">
                                <a
                                    href={`mailto:${SUPPORT_EMAIL}`}
                                    className="inline-flex max-w-full items-start gap-2 text-white/70 transition-colors hover:text-[#F1C85C] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]"
                                >
                                    <Mail className="mt-0.5 h-4 w-4 shrink-0 text-[#D4A126]" aria-hidden="true" />
                                    <span className="break-all">{SUPPORT_EMAIL}</span>
                                </a>
                                <div>
                                    <a href="#contact" className="text-white/60 transition-colors hover:text-[#F1C85C] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]">
                                        Contact Support
                                    </a>
                                </div>
                                <div>
                                    <a href="#faq" className="text-white/60 transition-colors hover:text-[#F1C85C] focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F1C85C]">
                                        Frequently Asked Questions
                                    </a>
                                </div>

                            </div>
                        </div>
                    </div>

                    <div className="mt-10 border-t border-white/10 pt-6">
                        <p className="text-xs text-white/40">
                            © {new Date().getFullYear()} StockNBook. All rights reserved.
                        </p>
                    </div>
                </div>
            </footer>

            {selectedPlan && isSubscriptionModalOpen && (
                <SubscriptionModal
                    plan={selectedPlan}
                    onClose={handleCloseSubscriptionModal}
                    onAuthenticate={handlePlanAuthentication}
                />
            )}

            {authMode && (
                <AuthModal
                    mode={authMode}
                    onClose={() => setAuthMode(null)}
                    onSwitch={setAuthMode}
                    onSignupSuccess={() => {
                        setAuthMode(null);
                        onSignupSuccess();
                    }}
                />
            )}
        </main>
    );
}
function PricingSection({
                            pricingPlans,
                            loading,
                            error,
                            onSelectPlan,
                        }: {
    pricingPlans: PricingPlan[];
    loading: boolean;
    error: string;
    onSelectPlan: (plan: PricingPlan) => void;
}) {
    return (
        <section id="pricing" className="relative isolate scroll-mt-20 overflow-hidden bg-[#F4EFF9] px-5 py-20 sm:px-6 lg:px-10">
            <div data-snb-parallax aria-hidden="true" className="pointer-events-none absolute -right-16 top-32 h-72 w-72 rounded-full bg-[#C9951A]/[0.06] blur-3xl" />
            <div className="relative z-10 mx-auto max-w-6xl" data-snb-reveal-children>
                <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-[#C9951A]">
                    Subscription plans
                </p>

                <h2 className="mt-3 text-center text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                    Choose the plan that fits your business
                </h2>

                <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-[#706578] sm:text-base">
                    Start with the free plan, then upgrade when your inventory,
                    bookings, staff, and reporting needs grow.
                </p>

                <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-[#E6D9BA] bg-[#FFFBF0] px-4 py-3">
                    <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[#C9951A]" />
                    <p className="text-sm leading-6 text-[#6F6043]">
                        Plan prices, limits, and feature access are managed by the platform administrator.
                    </p>
                </div>

                {loading ? (
                    <div className="mt-12 rounded-2xl border border-[#E7E0ED] bg-white px-6 py-16 text-center text-sm text-[#7A6E88]">
                        Loading current plans...
                    </div>
                ) : error ? (
                    <div className="mt-12 rounded-2xl border border-[#F0B9B9] bg-[#FFF0F0] px-6 py-10 text-center">
                        <p className="text-sm font-medium text-[#C32F2F]">{error}</p>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="mt-4 rounded-xl bg-[#2D1B4E] px-5 py-2.5 text-sm font-medium text-white"
                        >
                            Try again
                        </button>
                    </div>
                ) : pricingPlans.length === 0 ? (
                    <div className="mt-12 rounded-2xl border border-[#E7E0ED] bg-white px-6 py-16 text-center text-sm text-[#7A6E88]">
                        No plans are currently available.
                    </div>
                ) : (
                    <div className="mt-12 grid items-stretch gap-6 lg:grid-cols-3" data-snb-reveal-children>
                        {pricingPlans.map((plan) => (
                            <PricingCard
                                key={plan.id}
                                plan={plan}
                                onSelectPlan={onSelectPlan}
                            />
                        ))}
                    </div>
                )}

                <p className="mt-8 text-center text-xs leading-5 text-[#7A6E88]">
                    No automatic recurring charges. Paid subscriptions use manual GCash payment verification.
                </p>
            </div>
        </section>
    );
}

function PricingCard({
                         plan,
                         onSelectPlan,
                     }: {
    plan: PricingPlan;
    onSelectPlan: (plan: PricingPlan) => void;
}) {
    return (
        <article
            className={[
                "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-xl",
                plan.highlighted
                    ? "snb-pricing-spotlight border-[#2D1B4E] ring-2 ring-[#2D1B4E]"
                    : "border-[#EBE4F0]",
            ].join(" ")}
        >
            {plan.highlighted && (
                <div className="bg-[#2D1B4E] px-4 py-2 text-center text-xs font-medium uppercase tracking-[0.16em] text-white">
                    Standard plan
                </div>
            )}

            <div className="flex h-full flex-col p-6">
                <div>
                    <p className="text-xs font-medium uppercase tracking-[0.18em] text-[#C9951A]">
                        {plan.label}
                    </p>

                    <h3 className="mt-3 text-3xl font-semibold text-[#1A1220]">
                        {plan.name}
                    </h3>

                    <div className="mt-5 flex items-end gap-1">
                        <span className="text-4xl font-semibold tracking-tight text-[#1A1220]">
                            {plan.price}
                        </span>

                        <span className="pb-1 text-sm text-[#7A6E88]">
                            {plan.period}
                        </span>
                    </div>

                    <p className="mt-4 min-h-[72px] text-sm leading-6 text-[#7A6E88]">
                        {plan.description}
                    </p>
                </div>

                <div className="mt-7 flex-1 border-t border-[#EBE4F0] pt-6">
                    <p className="text-xs font-medium uppercase tracking-[0.16em] text-[#7A6E88]">
                        Included features
                    </p>

                    <ul className="mt-4 space-y-3">
                        {plan.features.map((feature) => (
                            <li
                                key={feature}
                                className="flex items-start gap-2.5 text-sm leading-5 text-[#3F354C]"
                            >
                                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#FFF7E2]">
                                    <Check className="h-3.5 w-3.5 text-[#C9951A]" />
                                </span>

                                <span>{feature}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <button
                    type="button"
                    onClick={() => onSelectPlan(plan)}
                    className={[
                        "mt-8 h-12 w-full rounded-xl text-sm font-medium transition duration-200",
                        plan.highlighted
                            ? "bg-[#2D1B4E] text-white hover:bg-[#3D2560]"
                            : "border border-[#2D1B4E] bg-white text-[#2D1B4E] hover:bg-[#2D1B4E] hover:text-white",
                    ].join(" ")}
                >
                    {plan.buttonText}
                </button>
            </div>
        </article>
    );
}

function SubscriptionModal({
                               plan,
                               onClose,
                               onAuthenticate,
                           }: {
    plan: PricingPlan;
    onClose: () => void;
    onAuthenticate: (mode: Exclude<AuthMode, null>) => void;
}) {
    const handleAuthenticate = (mode: Exclude<AuthMode, null>) => {
        onAuthenticate(mode);
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-access-dialog-title"
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#160C27]/65 px-4 py-6 backdrop-blur-[3px] sm:px-6"
            onMouseDown={onClose}
        >
            <div className="flex min-h-full w-full items-center justify-center py-6 sm:py-10">
                <div
                    className="relative w-full max-w-[720px] overflow-hidden rounded-[26px] border border-white/80 bg-white shadow-[0_30px_90px_rgba(26,13,48,0.30)]"
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close plan selection dialog"
                        className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-[#F2EEF8] text-[#70647F] transition hover:bg-[#E8E0F2] hover:text-[#2D1B4E]"
                    >
                        <X className="h-5 w-5" />
                    </button>

                    <div className="px-6 pb-5 pt-7 sm:px-8 sm:pb-6 sm:pt-8">
                        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
                            <div className="mx-auto flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,_#F5F0FF_0%,_#EAE1FB_55%,_#F8F5FC_100%)] text-[#5B35A5] shadow-inner sm:mx-0">
                                <div className="flex h-[74px] w-[60px] items-center justify-center rounded-[18px] border border-[#8060D0] bg-[linear-gradient(160deg,_#7B55D0_0%,_#4E2A9C_100%)] shadow-[0_12px_24px_rgba(91,53,165,0.25)]">
                                    <LockKeyhole className="h-9 w-9 text-white" strokeWidth={1.9} />
                                </div>
                            </div>

                            <div className="min-w-0 flex-1 text-center sm:text-left">
                                <div className="inline-flex items-center rounded-full border border-[#E5DCF2] bg-[#F8F5FF] px-3 py-1 text-xs font-semibold text-[#5B35A5]">
                                    {plan.name} plan selected
                                </div>

                                <h2
                                    id="plan-access-dialog-title"
                                    className="mt-3 max-w-[500px] text-2xl font-semibold leading-tight tracking-[-0.025em] text-[#171125] sm:text-[30px]"
                                >
                                    Continue to choose your plan
                                </h2>

                                <p className="mt-2 max-w-[520px] text-sm leading-6 text-[#6F657A] sm:text-[15px]">
                                    Log in or sign up first so we can connect your selected plan to your account and store securely.
                                </p>
                            </div>
                        </div>

                        <div className="mt-6 h-px bg-[#ECE6F2]" />

                        <div className="mt-5 grid gap-4 sm:grid-cols-2">
                            <div className="rounded-2xl border border-[#E8E0F3] bg-[linear-gradient(145deg,_#FBF9FF_0%,_#F4EFFC_100%)] p-5 sm:p-6">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E9E1FA] text-[#5B35A5]">
                                    <UserRound className="h-6 w-6" />
                                </div>

                                <h3 className="mt-4 text-lg font-semibold text-[#171125]">
                                    New to StockNBook?
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#6F657A]">
                                    Create your account to get started.
                                </p>

                                <ul className="mt-4 space-y-2.5">
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Create your store and account</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Start with the {plan.name} plan</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Manage everything in one place</span>
                                    </li>
                                </ul>

                                <button
                                    type="button"
                                    onClick={() => handleAuthenticate("signup")}
                                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5B35A5] px-5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(91,53,165,0.20)] transition hover:bg-[#4B238F] hover:shadow-[0_10px_24px_rgba(91,53,165,0.25)]"
                                >
                                    Sign up
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>

                            <div className="rounded-2xl border border-[#E8E0F3] bg-[linear-gradient(145deg,_#FBF9FF_0%,_#F4EFFC_100%)] p-5 sm:p-6">
                                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E9E1FA] text-[#5B35A5]">
                                    <LogIn className="h-6 w-6" />
                                </div>

                                <h3 className="mt-4 text-lg font-semibold text-[#171125]">
                                    Already have an account?
                                </h3>

                                <p className="mt-1 text-sm leading-6 text-[#6F657A]">
                                    Log in to continue with your selected plan.
                                </p>

                                <ul className="mt-4 space-y-2.5">
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Use your existing account</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Keep your data and settings</span>
                                    </li>
                                    <li className="flex items-start gap-2.5 text-sm text-[#4F465C]">
                                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#5B35A5]" />
                                        <span>Continue where you left off</span>
                                    </li>
                                </ul>

                                <button
                                    type="button"
                                    onClick={() => handleAuthenticate("login")}
                                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-[#6D49B5] bg-white px-5 text-sm font-semibold text-[#5B35A5] transition hover:bg-[#F7F2FD]"
                                >
                                    Log in
                                    <ArrowRight className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div className="mt-5 flex items-start justify-center gap-3 rounded-xl border border-[#E8E1F0] bg-[#FBFAFD] px-4 py-3.5 text-center sm:text-left">
                            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#5B35A5]" />
                            <div>
                                <p className="text-sm font-medium text-[#41374E]">
                                    Your information is safe with us.
                                </p>
                                <p className="mt-0.5 text-xs leading-5 text-[#7A7084]">
                                    We use your account to securely connect your plan and subscription activity to your store.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function HeroFeatureBubble({
                               title,
                               detail,
                               icon,
                               className = "",
                               animationDelay = "0s",
                           }: {
    title: string;
    detail: string;
    icon: React.ReactNode;
    className?: string;
    animationDelay?: string;
}) {
    return (
        <div
            className={[
                "absolute z-20 hidden md:block",
                className,
            ].join(" ")}
        >
            <div
                className="hero-feature-float flex w-[168px] items-center gap-2.5 rounded-[18px] border border-[#F2E9D7] bg-[#FFFDF8] px-3 py-2.5 text-left shadow-[0_14px_38px_rgba(17,7,32,0.26)] transition-shadow duration-300 hover:shadow-[0_22px_52px_rgba(17,7,32,0.34)]"
                style={{ animationDelay }}
            >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FFF0C5] text-[#C9951A]">
                    {icon}
                </span>

                <div className="min-w-0">
                    <p className="text-xs font-semibold leading-4 text-[#21172C]">
                        {title}
                    </p>

                    <p className="mt-0.5 text-[10px] leading-[14px] text-[#716778]">
                        {detail}
                    </p>
                </div>
            </div>
        </div>
    );
}

function SectionHeading({
                            eyebrow,
                            title,
                            description,
                        }: {
    eyebrow: string;
    title: string;
    description: string;
}) {
    return (
        <div className="mx-auto max-w-3xl text-center" data-snb-reveal-children>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#C9951A]">
                {eyebrow}
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#21172C] sm:text-4xl lg:text-5xl">
                {title}
            </h2>

            <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#706578] sm:text-base">
                {description}
            </p>
        </div>
    );
}

function FaqItem({
                     index,
                     question,
                     answer,
                     link,
                     isOpen,
                     onToggle,
                 }: {
    index: number;
    question: string;
    answer: string;
    link?: { href: string; label: string };
    isOpen: boolean;
    onToggle: () => void;
}) {
    const buttonId = `faq-question-${index + 1}`;
    const panelId = `faq-answer-${index + 1}`;

    return (
        <div
            className={[
                "rounded-2xl border bg-white transition duration-300",
                isOpen
                    ? "border-[#D8CBE3] shadow-[0_18px_40px_rgba(45,27,78,0.08)]"
                    : "border-[#E7E0ED] shadow-[0_10px_30px_rgba(45,27,78,0.04)] hover:border-[#D8CBE3]",
            ].join(" ")}
        >
            <h3>
                <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={onToggle}
                    className="flex w-full items-start gap-4 rounded-2xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9951A] sm:p-6"
                >
                    <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-[#F1ECF8] px-2 text-xs font-medium text-[#2D1B4E]">
                        {String(index + 1).padStart(2, "0")}
                    </span>

                    <span className="flex-1 pt-1.5 text-base font-bold leading-6 text-[#21172C] sm:text-lg sm:pt-1">
                        {question}
                    </span>

                    <span
                        aria-hidden="true"
                        className={[
                            "snb-faq-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            isOpen
                                ? "bg-[#2D1B4E] text-[#F1C85C]"
                                : "bg-[#F1ECF8] text-[#2D1B4E]",
                        ].join(" ")}
                    >
                        {isOpen ? (
                            <Minus className="h-4 w-4" />
                        ) : (
                            <Plus className="h-4 w-4" />
                        )}
                    </span>
                </button>
            </h3>

            <div
                id={panelId}
                role="region"
                aria-labelledby={buttonId}
                data-open={isOpen ? "true" : "false"}
                className="snb-faq-panel"
            >
                <div>
                    <div className="pb-6 pl-[4.5rem] pr-5 text-sm leading-7 text-[#706578] sm:pl-[4.75rem] sm:pr-16">
                        <p>{answer}</p>

                        {link && (
                            <a
                                href={link.href}
                                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#2D1B4E] underline-offset-4 transition hover:text-[#A77B12] hover:underline"
                            >
                                {link.label}
                                <ArrowRight className="h-3.5 w-3.5" />
                            </a>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}