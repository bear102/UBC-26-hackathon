// Playbook ideas for perils with NO direct prediction market (flood, air quality, hail, wildfire).
// USER DECISION (2026-11-19): real markets only. By default these perils are hedged with the closest REAL market
// (Kalshi monthly rain totals, the Kalshi US tornado count, Napa season rain) with an honest basis-risk note, and the
// ones with no usable real market (air quality, hail at a car wash, wildfire at an event, a river gauge for the
// campground) sit on the REJECTED watchlist. The Hedgehog parametric ideas (venue "hedgehog", lib/markets/parametric)
// are only added when HEDGEHOG_PARAMETRIC=1. Appended to PLAYBOOK / INDUSTRIES / REJECTED in industries.ts.
// Re-run: npx tsx scripts/validate-playbook.ts "Austin, TX"
import type { HedgeIdea, Industry, MarketQuery, RejectedIdea } from "./industries";
import { parametricEnabled } from "../../markets/proxies";

const V = (liveExample: string, ask: number, at = "2026-11-19T21:00:00Z") => ({ at, liveExample, ask });

const PARAM = (perils: MarketQuery["perils"], describe: string): MarketQuery => ({
  venues: ["hedgehog"], perils, series: ["HEDGEHOG"], location: "profile-city", hurtWhen: "event", strike: { targetAsk: 0.1 }, maxDays: 45, describe,
});
const FLOOD = PARAM(["flood"], "Hedgehog parametric: nearest NWS river gauge at or above flood stage in the window (USGS data), YES");
const SMOKE = PARAM(["smoke"], "Hedgehog parametric: the owner's city US AQI above 150 on any day in the window, YES");
const HAIL = PARAM(["hail"], "Hedgehog parametric: hail >= 1 inch reported within 25 miles (NOAA SPC), YES");
const FIRE = PARAM(["wildfire"], "Hedgehog parametric: new wildfire >= 100 acres within 30 miles (NIFC), YES");

// proxies (real markets, weaker link)
const RAIN_MONTH_SERIES = ["KXRAINAUSM", "KXRAINATLM", "KXRAINBOSM", "KXRAINCHIM", "KXRAINDALM", "KXRAINDCM", "KXRAINDENM", "KXRAINHOUM", "KXRAINLAXM",
  "KXRAINMIAM", "KXRAINMINM", "KXRAINNOLAM", "KXRAINNYCM", "KXRAINOKCM", "KXRAINPHXM", "KXRAINSATXM", "KXRAINSEAM", "KXRAINSFOM", "KXRAINSTLM"];
const WET_MONTH_PROXY: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: RAIN_MONTH_SERIES, location: "profile-city", hurtWhen: "above", strike: { targetAsk: 0.2 }, maxDays: 45,
  describe: "Proxy: Kalshi monthly rainfall in the owner's city, YES on 'Above N inches' (a very wet month)",
};
const DRY_MONTH_PROXY: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: RAIN_MONTH_SERIES, location: "profile-city", hurtWhen: "below", strike: { targetAsk: 0.3 }, maxDays: 45,
  describe: "Proxy: Kalshi monthly rainfall in the owner's city, NO on 'Above N inches' (a dry month)",
};
const TORNADO_PROXY: MarketQuery = {
  venues: ["kalshi"], perils: ["storm"], series: ["KXTORNADO"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.15 }, maxDays: 45,
  describe: "Proxy: Kalshi US tornado count this month, YES on 'Above N' (an active severe-storm month)",
};

export const PARAMETRIC_INDUSTRIES: Industry[] = [
  { id: "campground", name: "Campgrounds, RV parks & river outfitters", keywords: ["campground", "rv park", "camping", "glamping", "cabins?", "river outfitter", "tubing", "canoe", "riverside", "creekside"] },
];

const HEDGEHOG_IDEAS: HedgeIdea[] = [ // Hedgehog parametric contracts: only with HEDGEHOG_PARAMETRIC=1
  // flood
  { id: "riverside-flood", industry: "bar-restaurant", keywords: ["river", "creek", "riverside", "waterfront", "lakeside", "bayou", "on the water"],
    title: "The creek floods the patio", problem: "A riverside restaurant closes (and cleans up) when the creek leaves its banks.",
    causalStory: "When the nearest river gauge passes NWS flood stage, waterfront seating and parking flood; the cover pays on that gauge reading.",
    peril: "flood", marketQuery: FLOOD, side: "yes", correlation: "strong", lossShareOfDay: 2,
    basisRisk: "One gauge, not your door: your spot can flood from a side creek while the gauge stays below flood stage (or the reverse).",
    evidence: [{ claim: "Almost 40% of small businesses never reopen after a disaster (FEMA / Ready.gov).", source: "https://www.ready.gov/business" }],
    validated: V("hedgehog:flood:08159000:20261119-20261218", 0.09) },
  { id: "campground-flood", industry: "campground", keywords: ["river", "creek", "flood", "campsites?", "low water"],
    title: "Flood closes the campground", problem: "Riverside campgrounds evacuate and refund bookings when the river rises.",
    causalStory: "Closures follow the river stage; the cover pays when the gauge reaches flood stage in the window.",
    peril: "flood", marketQuery: FLOOD, side: "yes", correlation: "strong", lossShareOfDay: 3,
    basisRisk: "The gauge may be miles away; flash floods on a small creek can miss it.",
    evidence: [{ claim: "Flooding is the most common and costly natural disaster in the US (NWS).", source: "https://www.weather.gov/safety/flood" }],
    validated: V("hedgehog:flood:08159000:20261119-20261218", 0.09) },
  // air quality
  { id: "outdoor-venue-smoke", industry: "outdoor-events", keywords: ["outdoor", "festival", "concert", "smoke", "air"],
    title: "Smoke or smog cancels the outdoor event", problem: "At AQI above 150 people stay home and events get called off.",
    causalStory: "Attendance and cancellations follow the city's AQI; the cover pays if it goes above 150 on any day.",
    peril: "smoke", marketQuery: SMOKE, side: "yes", correlation: "strong", lossShareOfDay: 0.6,
    basisRisk: "City-wide modelled AQI, not your venue's sensor; a short spike can trigger it on a day you weren't open.",
    evidence: [{ claim: "AQI 151+ is 'Unhealthy': everyone should reduce prolonged outdoor exertion (EPA AirNow).", source: "https://www.airnow.gov/aqi/aqi-basics/" }],
    validated: V("hedgehog:aqi:austin-tx:20261119-20261218", 0.09) },
  { id: "tour-operator-smoke", industry: "tourism", keywords: ["tours?", "kayak", "paddle", "bike", "hiking", "outdoor"],
    title: "Bad air cancels tours", problem: "Outdoor tours refund bookings on smoky or smoggy days.",
    causalStory: "Tour cancellations follow the AQI; the cover pays if it tops 150 on any day in the window.",
    peril: "smoke", marketQuery: SMOKE, side: "yes", correlation: "medium", lossShareOfDay: 0.5,
    basisRisk: "City AQI may differ from the trail or the lake.",
    evidence: [{ claim: "AQI 151+ is 'Unhealthy' for everyone (EPA AirNow).", source: "https://www.airnow.gov/aqi/aqi-basics/" }],
    validated: V("hedgehog:aqi:austin-tx:20261119-20261218", 0.09) },
  { id: "landscaper-smoke", industry: "landscaping", keywords: ["crew", "outdoor", "lawn", "smoke"],
    title: "Smoke days stop outdoor crews", problem: "Crews can't work full days in heavy smoke; payroll still runs.",
    causalStory: "Above AQI 150 employers must protect or pull outdoor workers (California rule); the cover pays on that AQI.",
    peril: "smoke", marketQuery: SMOKE, side: "yes", correlation: "medium", lossShareOfDay: 0.5,
    basisRisk: "Texas has no AQI work rule; you decide when to stop. Modelled city AQI, not the job site.",
    evidence: [{ claim: "California requires wildfire-smoke protections for outdoor workers when AQI for PM2.5 is 151 or more (Title 8 §5141.1).", source: "https://www.dir.ca.gov/title8/5141_1.html" }],
    validated: V("hedgehog:aqi:austin-tx:20261119-20261218", 0.09) },
  // hail
  { id: "auto-dealer-hail", industry: "auto", keywords: ["dealer", "lot", "inventory", "used cars?", "hail"],
    title: "Hail dents the lot", problem: "A hailstorm dents every car on the lot: deductibles, repair time and markdowns.",
    causalStory: "Lot damage follows hail of 1 inch or more nearby; the cover pays on NOAA's hail reports within 25 miles.",
    peril: "hail", marketQuery: HAIL, side: "yes", correlation: "strong", lossShareOfDay: 3,
    basisRisk: "A report within 25 miles is not a hit on your lot: it can pay when you were missed, or miss a storm nobody reported.",
    evidence: [{ claim: "Hail causes about $1B in US crop and property damage a year; vehicles are among the most hit (Insurance Information Institute).", source: "https://www.iii.org/fact-statistic/facts-statistics-hail" }],
    validated: V("hedgehog:hail:austin-tx:25:20261119-20261218", 0.04) },
  { id: "nursery-hail", industry: "farm-nursery", keywords: ["nursery", "greenhouse", "plants", "garden center", "crop", "hail"],
    title: "Hail shreds plants and greenhouses", problem: "One hailstorm can strip outdoor stock and break greenhouse panels.",
    causalStory: "Damage follows 1-inch-plus hail nearby; the cover pays on NOAA hail reports within 25 miles.",
    peril: "hail", marketQuery: HAIL, side: "yes", correlation: "medium", lossShareOfDay: 2,
    basisRisk: "Reports are point sightings; hail swaths are narrow.",
    evidence: [{ claim: "Hail damages crops and property across the US every year (Insurance Information Institute).", source: "https://www.iii.org/fact-statistic/facts-statistics-hail" }],
    validated: V("hedgehog:hail:austin-tx:25:20261119-20261218", 0.04) },
  { id: "car-wash-hail", industry: "car-wash", keywords: ["car wash", "canopy", "hail"],
    title: "Hailstorm shuts the car wash", problem: "Hail damages canopies and signs and closes the bays for repairs.",
    causalStory: "Big hail nearby means repairs and closed bays; the cover pays on NOAA hail reports within 25 miles.",
    peril: "hail", marketQuery: HAIL, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "Loose link: after a storm, dirty cars can bring business back. Keep it small.",
    evidence: [{ claim: "Hail facts and damage (Insurance Information Institute).", source: "https://www.iii.org/fact-statistic/facts-statistics-hail" }],
    validated: V("hedgehog:hail:austin-tx:25:20261119-20261218", 0.04) },
  // wildfire
  { id: "vineyard-wildfire", industry: "farm-nursery", keywords: ["vineyard", "winery", "grapes", "smoke taint"],
    title: "Wildfire nearby: smoke taint and closed tasting room", problem: "A nearby fire taints grapes and empties the tasting room.",
    causalStory: "Smoke exposure and closures follow fires within ~30 miles; the cover pays when NIFC logs a 100-acre fire that close.",
    peril: "wildfire", marketQuery: FIRE, side: "yes", correlation: "medium", lossShareOfDay: 2,
    basisRisk: "Wind decides where the smoke goes; a fire 25 miles downwind may not reach you.",
    evidence: [{ claim: "Smoke exposure can taint grapes and wine (Australian Wine Research Institute).", source: "https://www.awri.com.au/industry_support/winemaking_resources/smoke-taint/" }],
    validated: V("hedgehog:wildfire:austin-tx:30:20261119-20261218", 0.04) },
  { id: "ranch-wildfire", industry: "farm-nursery", keywords: ["ranch", "cattle", "hay", "pasture", "fence"],
    title: "Grass fire burns pasture and fence", problem: "A grass fire burns hay, pasture and fence line; cattle need moving and feed.",
    causalStory: "Losses follow fires that start close by; the cover pays when NIFC logs a 100-acre fire within 30 miles.",
    peril: "wildfire", marketQuery: FIRE, side: "yes", correlation: "medium", lossShareOfDay: 3,
    basisRisk: "Pays on any big fire within 30 miles, burned or not; small fires on your own land don't count.",
    evidence: [{ claim: "US wildfire counts and acres burned (NIFC).", source: "https://www.nifc.gov/fire-information/statistics" }],
    validated: V("hedgehog:wildfire:austin-tx:30:20261119-20261218", 0.04) },
  { id: "event-wildfire", industry: "outdoor-events", keywords: ["festival", "outdoor", "wedding", "ranch venue", "fire"],
    title: "Nearby wildfire cancels the event", problem: "Burn bans, road closures and smoke cancel outdoor events near a fire.",
    causalStory: "Cancellations follow nearby fires; the cover pays when NIFC logs a 100-acre fire within 30 miles.",
    peril: "wildfire", marketQuery: FIRE, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "A fire 30 miles away often doesn't stop an event. Keep it small.",
    evidence: [{ claim: "US wildfire counts and acres burned (NIFC).", source: "https://www.nifc.gov/fire-information/statistics" }],
    validated: V("hedgehog:wildfire:austin-tx:30:20261119-20261218", 0.04) },
];

const NAPA_DRY_FIRE: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: ["KXRAINNAPAM"], titleRe: "through march", location: "national", cities: ["napa", "sonoma", "yountville", "st. helena"], hurtWhen: "below",
  strike: { targetAsk: 0.3 }, maxDays: 140,
  describe: "Proxy: Kalshi Napa Nov-Mar season rainfall, NO on 'Above N inches' (a dry season, when fires spread)",
};

/** Real-market proxies (Kalshi), honest basis risk. Always on. */
const PROXY_IDEAS: HedgeIdea[] = [
  { id: "riverside-flood-wet-month", industry: "bar-restaurant", keywords: ["river", "creek", "riverside", "waterfront", "lakeside", "bayou", "on the water", "flood"],
    title: "Proxy: a very wet month floods the patio", problem: "A riverside restaurant closes (and cleans up) when the creek leaves its banks, and that happens in very wet months.",
    causalStory: "No exchange lists a flood or river-stage market for your creek. Heavy monthly rain is what raises it; Kalshi pays YES when the city's monthly rain tops N inches.",
    peril: "flood", marketQuery: WET_MONTH_PROXY, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "Big basis risk: a wet month without a flood still pays, and one cloudburst upstream can flood you in a dry month. Keep it small.",
    evidence: [{ claim: "Flooding is the most common and costly natural disaster in the US, driven by heavy rain (NWS).", source: "https://www.weather.gov/safety/flood" }],
    validated: V("kalshi:KXRAINAUSM-26NOV-5", 0.20, "2026-11-19T22:00:00Z") },
  { id: "nursery-hail-proxy", industry: "farm-nursery", keywords: ["nursery", "greenhouse", "plants", "garden center", "crop", "hail"],
    title: "Proxy: an active severe-storm month", problem: "One hailstorm can strip outdoor stock and break greenhouse panels; hail comes with severe-storm outbreaks.",
    causalStory: "No exchange lists hail. A busy US tornado month means more severe storms, the same storms that drop hail; Kalshi pays YES above N tornadoes.",
    peril: "hail", marketQuery: TORNADO_PROXY, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "National count: storms elsewhere can pay it while your stock is fine, and one local hailstorm won't move it.",
    evidence: [{ claim: "Hail and tornadoes come from severe thunderstorms (NOAA SPC).", source: "https://www.spc.noaa.gov/faq/" }],
    validated: V("kalshi:KXTORNADO-26NOV-150", 0.09, "2026-11-19T22:00:00Z") },
  { id: "vineyard-wildfire-dry-season", industry: "farm-nursery", keywords: ["vineyard", "winery", "grapes", "smoke taint", "wildfire", "fire"],
    title: "Proxy: a dry season raises fire risk", problem: "A nearby fire taints grapes and empties the tasting room; fires spread after dry seasons.",
    causalStory: "No exchange lists wildfire or acres burned. A dry Nov-Mar leaves dry fuel; NO on Napa's 'Above N inches' pays when the season comes in dry.",
    peril: "wildfire", marketQuery: NAPA_DRY_FIRE, side: "no", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "Big basis risk: pays on a dry winter, not on a fire; most dry seasons bring no fire near you.",
    evidence: [{ claim: "Fire danger rises with dry fuels (NIFC).", source: "https://www.nifc.gov/fire-information/statistics" }],
    validated: V("kalshi:KXRAINNAPAM-01NOV26-31MAR27-T10", 0.23, "2026-11-19T22:00:00Z") },
  { id: "flood-proxy-wet-month", industry: "campground", keywords: ["river", "creek", "flood", "rain"],
    title: "Proxy: a very wet month", problem: "Floods come with very wet months; a rain market is a cheaper, looser hedge.",
    causalStory: "Heavy monthly rain raises the odds of a flood; Kalshi pays YES when the city's monthly rain tops N inches.",
    peril: "flood", marketQuery: WET_MONTH_PROXY, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "Big basis risk: a wet month without a flood still pays, and one cloudburst upstream can flood you in a dry month.",
    evidence: [{ claim: "Flooding is driven by heavy rain (NWS).", source: "https://www.weather.gov/safety/flood" }],
    validated: V("kalshi:KXRAINAUSM-26NOV-6", 0.11) },
  { id: "wildfire-proxy-dry-month", industry: "farm-nursery", keywords: ["ranch", "pasture", "hay", "dry", "drought"],
    title: "Proxy: a dry month", problem: "Grass fires follow dry spells; a rain market can pay in the dry months that raise fire risk.",
    causalStory: "Low monthly rain dries fuel; Kalshi NO on 'Above N inches' pays when the month comes in dry.",
    peril: "wildfire", marketQuery: DRY_MONTH_PROXY, side: "no", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "Big basis risk: most dry months have no fire near you; pays on dryness, not on a fire.",
    evidence: [{ claim: "Fire danger rises with dry fuels (NIFC).", source: "https://www.nifc.gov/fire-information/statistics" }],
    validated: V("kalshi:KXRAINAUSM-26NOV-4", 0.29) },
  { id: "hail-proxy-tornadoes", industry: "auto", keywords: ["dealer", "lot", "hail", "storm"],
    title: "Proxy: an active severe-storm month", problem: "Hail and tornadoes come from the same storms; a US tornado-count market is a loose hedge.",
    causalStory: "A busy tornado month means more severe storms nationally; Kalshi pays YES above N tornadoes.",
    peril: "hail", marketQuery: TORNADO_PROXY, side: "yes", correlation: "weak", lossShareOfDay: 1,
    basisRisk: "National count: storms elsewhere can pay it while your lot is fine, and one local hailstorm won't move it.",
    evidence: [{ claim: "Hail and tornadoes come from severe thunderstorms (NOAA SPC).", source: "https://www.spc.noaa.gov/faq/" }],
    validated: V("kalshi:KXTORNADO-26NOV-50", 0.16) },
];

export const PARAMETRIC_PLAYBOOK: HedgeIdea[] = parametricEnabled() ? [...HEDGEHOG_IDEAS, ...PROXY_IDEAS] : PROXY_IDEAS;

/** Real markets only (default): risks with no usable market go on the watchlist with a plain reason. */
const NO_REAL_MARKET: RejectedIdea[] = [
  { id: "outdoor-venue-smoke", industry: "outdoor-events", title: "Smoke or smog cancels the outdoor event", status: "not-live-now",
    reason: "No exchange lists air quality, and no wildfire or smoke market is live to stand in for it.",
    retryWhen: "Kalshi relists its city AQI series (KXAQICITY, no open events on 2026-11-19) or Polymarket lists a US smoke/AQI market." },
  { id: "tour-operator-smoke", industry: "tourism", title: "Bad air cancels tours", status: "not-live-now",
    reason: "No exchange lists air quality; a rain or heat market would not track smoky days.",
    retryWhen: "A venue lists city air quality (Kalshi KXAQICITY)." },
  { id: "landscaper-smoke", industry: "landscaping", title: "Smoke days stop outdoor crews", status: "not-live-now",
    reason: "No exchange lists air quality or smoke days.",
    retryWhen: "A venue lists city air quality (Kalshi KXAQICITY)." },
  { id: "campground-flood-gauge", industry: "campground", title: "River gauge at flood stage closes the campground", status: "not-live-now",
    reason: "No river-stage market for most rivers: Polymarket lists only a few gauges (St. Johns River at Cocoa, FL). The wet-month rain proxy covers it loosely.",
    retryWhen: "A venue lists the owner's river gauge (Polymarket 'Highest <river> level' events)." },
  { id: "car-wash-hail", industry: "car-wash", title: "Hailstorm shuts the car wash", status: "not-live-now",
    reason: "No hail market, and the tornado-count proxy is too loose here: after a storm, dirty cars bring business back." },
  { id: "event-wildfire", industry: "outdoor-events", title: "Nearby wildfire cancels the event", status: "not-live-now",
    reason: "No wildfire or acres-burned market is live; a dry-month rain market is too loose for a one-day event.",
    retryWhen: "A venue lists wildfire / acres-burned markets (none on Gemini, Kalshi or Polymarket on 2026-11-19)." },
];

export const PARAMETRIC_REJECTED: RejectedIdea[] = [
  ...(parametricEnabled() ? [] : NO_REAL_MARKET),
  { id: "roofer-hail", industry: "construction", title: "Hail cover for roofers", status: "invalid",
    reason: "Natural hedge: hailstorms bring months of roof-replacement work. The roofer benefits; don't sell hail cover (only a hail hit on their own yard/trucks is a loss)." },
];
