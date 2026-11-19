// Industry hedge playbook: real small-business problems -> prediction-market hedges that exist in Hedgehog's
// live universe (lib/markets listMarkets(): Gemini + Kalshi, Polymarket read-only).
//
// Every entry in PLAYBOOK was checked on 2026-11-19 against the live market list:
//  (a) the market exists with a quote, (b) the side that pays is the side where the business is hurt,
//  (c) the causal link fits in one sentence, (d) basis risk is written down, (e) the protective side was
//  offered at <= $0.85 with some depth, (f) it settles inside a window the owner cares about, and
//  (g) we checked whether the business actually BENEFITS from the event (natural hedge).
// Ideas that failed any check live in REJECTED with the reason (pitch/README material).
// Re-run the live checks with `npx tsx scripts/validate-playbook.ts`.
import type { Peril, VenueId } from "../../types";

/** When is the business hurt? Decides which side of a contract pays. */
export type HurtWhen =
  | "above"       // the measured value is HIGH (fuel, metals, rates, CPI, warm days)
  | "below"       // the measured value is LOW (cold highs, crypto drawdown)
  | "event"       // a named outcome happens (rain in the city, "Hike 25bps")
  | "team-loses"   // the owner's team loses (YES on the opponent)
  | "team-misses"; // the owner's team falls short of a season stage (NO on its playoffs / round / conference / "N+ wins" future)

export interface MarketQuery {
  venues: VenueId[];
  perils: Peril[];
  /** Series codes: Gemini series (WXHIGH, BRENT, NGAS, XAU...) or Kalshi series tickers (KXRAINWKND...). */
  series?: string[];
  /** Case-insensitive regex on the event title (e.g. "price on [A-Z]" drops intraday crypto ticks). */
  titleRe?: string;
  /** Case-insensitive regex the contract label must match (e.g. "^Hike" for Fed hikes). */
  labelRe?: string;
  /** profile-city: weather at the owner's city; national: US-wide series; team: games of teams named in the description. */
  location: "profile-city" | "national" | "team";
  /** Only for businesses in these cities (normalized, lower case): regional markets (ERCOT = Texas, Lake Mead = Las Vegas area).
   *  scripts/validate-playbook.ts validates the idea as a business in cities[0]. */
  cities?: string[];
  hurtWhen: HurtWhen;
  /** Strike rule: absolute bounds on the label's number, and the protective-side price we aim for. */
  strike?: { min?: number; max?: number; targetAsk?: number };
  /** Only contracts expiring within this many days (default 45). */
  maxDays?: number;
  /** ...and at least this many hours away (default 6: a contract settling this afternoon is not insurance). */
  minHours?: number;
  /** Human summary of the query (also passed to the AI as `marketQuery`). */
  describe: string;
}

export interface Evidence { claim: string; source: string }

export interface HedgeIdea {
  id: string;
  industry: string;            // Industry.id
  /** Extra keywords that make this idea relevant beyond the industry match (e.g. "van", "copper"). */
  keywords: string[];
  title: string;               // owner-facing, short
  problem: string;             // the real business problem
  causalStory: string;         // one sentence: market -> P&L
  peril: Peril;
  marketQuery: MarketQuery;
  /** Side on the canonical contract form ("X or above" for hurtWhen=above, "X or below" for below, the named outcome for event). */
  side: "yes" | "no";
  correlation: "strong" | "medium" | "weak";
  basisRisk: string;
  naturalHedgeNote?: string;
  /** Rough loss per trigger as a share of a normal day's revenue (sizing hint for the AI). */
  lossShareOfDay?: number;
  evidence: Evidence[];
  validated: { at: string; liveExample?: string; ask?: number };
}

export interface RejectedIdea {
  id: string;
  industry: string;
  title: string;
  status: "invalid" | "not-live-now" | "future-source";
  reason: string;
  /** For not-live-now / future-source: what would make it valid. */
  retryWhen?: string;
  marketQuery?: MarketQuery;
}

export interface Industry {
  id: string;
  name: string;
  /** Regexes (case-insensitive) matched against the business name + description. */
  keywords: string[];
  /** Things this industry benefits from: don't hedge them (or hedge the opposite tail). */
  naturalHedges?: { peril: Peril; note: string }[];
}

// ---------- industries ----------

export const INDUSTRIES: Industry[] = [
  { id: "bar-restaurant", name: "Bars & restaurants (patio / dine-in)", keywords: ["\\bbar\\b", "pub", "tavern", "brewery", "taproom", "restaurant", "bistro", "diner", "patio", "beer garden", "cocktail", "\\bgrill\\b", "eatery", "kitchen", "pizzeria", "cantina", "winery", "ice cream", "dessert"],
    naturalHedges: [{ peril: "rain", note: "If a big share of sales is delivery, rainy days partly pay you back (delivery orders rise); size rain cover to the dine-in/patio share only." }] },
  { id: "food-truck", name: "Food trucks & trailers", keywords: ["food truck", "taco truck", "\\btruck\\b.*(taco|food|bbq|burger|birria)", "trailer park", "food trailer", "street food", "walk-up"],
    naturalHedges: [{ peril: "cold", note: "Hot food (birria, ramen, soup) sells better on cool days; only a freezing, windy snap hurts." }] },
  { id: "coffee-shop", name: "Coffee shops, bakeries & cafes", keywords: ["coffee", "cafe", "café", "espresso", "bakery", "donut", "bagel", "tea shop", "boba", "juice bar"],
    naturalHedges: [{ peril: "cold", note: "Cool mornings sell hot drinks; don't buy cold-day cover." }] },
  { id: "outdoor-events", name: "Outdoor events, venues & ticketing", keywords: ["festival", "outdoor (event|venue|concert|market)", "concert", "amphitheater", "wedding venue", "event venue", "farmers market", "fair\\b", "ticket", "tailgate", "pop-up", "outdoor events?", "rodeo", "race\\b"] },
  { id: "landscaping", name: "Landscaping, lawn care & tree service", keywords: ["landscap", "lawn", "mowing", "yard", "tree service", "irrigation", "hardscape", "gardening service", "sod"],
    naturalHedges: [{ peril: "rain", note: "Rain grows grass: a wet week loses billable days now but fills the schedule two weeks later. Hedge long wet spells, not single showers." }] },
  { id: "construction", name: "Construction, roofing & electrical contractors", keywords: ["construction", "contractor", "roof", "builder", "remodel", "electrician", "electrical", "wiring", "concrete", "framing", "general contractor", "solar install"] },
  { id: "hvac-plumbing", name: "HVAC & plumbing", keywords: ["hvac", "plumb", "air condition", "\\ba/c\\b", "heating", "furnace", "pipe", "water heater", "refrigeration"],
    naturalHedges: [{ peril: "cold", note: "Freezes and cold snaps mean burst pipes and no-heat calls: emergency demand you profit from. Don't hedge cold." },
                    { peril: "heat", note: "Heat waves fill the A/C repair schedule. Don't hedge heat." }] },
  { id: "delivery", name: "Delivery, couriers, rideshare & trucking", keywords: ["deliver", "courier", "rideshare", "uber", "lyft", "doordash", "instacart", "\\bvans?\\b", "fleet", "trucking", "box trucks?", "delivery trucks?", "\\bsemis?\\b", "logistics", "moving company", "movers", "\\bmiles?\\b", "freight", "dispatch", "catering"],
    naturalHedges: [{ peril: "rain", note: "Rainy days lift delivery orders (people stay in); rain is a natural hedge, don't buy rain cover." }] },
  { id: "farm-nursery", name: "Farms, ranches, greenhouses & nurseries", keywords: ["farm", "ranch", "nursery", "greenhouse", "grower", "orchard", "crop", "cattle", "plants", "garden center", "\\bhay\\b", "vineyard"] },
  { id: "retail-apparel", name: "Seasonal retail & apparel", keywords: ["boutique", "apparel", "clothing", "outerwear", "coats?", "jackets?", "boots", "retail", "store", "shop\\b", "gift shop", "sporting goods"],
    naturalHedges: [{ peril: "cold", note: "Cold snaps sell coats, boots and heaters; they help a winter-stocked store." }] },
  { id: "tourism", name: "Tourism, hotels, short-term rentals & tours", keywords: ["hotel", "motel", "inn\\b", "airbnb", "vrbo", "short-term rental", "vacation rental", "\\btours?\\b", "kayak", "boat rental", "paddle", "beach", "tourist", "bed and breakfast", "b&b", "lake", "marina", "houseboat", "boat slip"] },
  { id: "sports-bar-merch", name: "Sports bars, watch parties & team merch", keywords: ["sports bar", "watch part", "game nights?", "game-day", "merch", "jerseys?", "fan shop", "spurs", "rockets", "mavericks", "mavs", "texans", "cowboys", "longhorns", "austin fc"] },
  { id: "auto", name: "Auto dealers & repair shops", keywords: ["dealer", "dealership", "used cars?", "car lot", "auto (repair|shop|body)", "mechanic", "\\btires?\\b", "floor ?plan", "car sales"],
    naturalHedges: [{ peril: "cold", note: "Cold snaps kill batteries and tires: more repair tickets for a shop. Don't hedge cold." }] },
  { id: "crypto-merchant", name: "Crypto-accepting merchants", keywords: ["crypto", "bitcoin", "\\bbtc\\b", "solana", "\\bsol\\b", "ethereum", "\\beth\\b", "web3", "stablecoin", "usdc", "nft"] },
  { id: "jeweler", name: "Jewelers, metalsmiths & pawn", keywords: ["jewel", "gold", "silver", "metalsmith", "goldsmith", "engagement ring", "pawn", "bullion", "coin shop"],
    naturalHedges: [{ peril: "metals", note: "If you BUY scrap gold/silver from customers (pawn, we-buy-gold), a metal rally lifts your inventory value: hedge only net short exposure (fixed-price quotes not yet bought)." }] },
  { id: "real-estate", name: "Real estate agents & mortgage brokers", keywords: ["mortgage", "realtor", "real estate", "broker", "loan officer", "refinanc", "title company", "home sales", "property management"] },
  { id: "laundromat", name: "Laundromats & dry cleaners", keywords: ["laundromat", "laundry", "dry clean", "wash and fold", "wash-and-fold", "coin.?op"] },
  { id: "car-wash", name: "Car washes & mobile detailing", keywords: ["car ?wash", "detailing", "detailer", "auto spa"] },
  { id: "golf-recreation", name: "Golf, driving ranges & outdoor recreation", keywords: ["golf", "driving range", "mini golf", "putt", "disc golf", "zip ?line", "climbing park", "water park", "amusement", "trail rides?", "horseback"] },
  { id: "ski-town", name: "Ski shops, rentals & ski-town businesses", keywords: ["\\bski", "snowboard", "lift tickets?", "ski rental", "ski shop", "resort town", "big sky", "park city", "mammoth", "tahoe", "aspen", "vail"] },
  { id: "propane-heating", name: "Propane, heating oil & firewood dealers", keywords: ["propane", "heating oil", "fuel oil", "firewood", "heating fuel", "pellet", "chimney"] },
  { id: "gov-contractor", name: "Federal contractors & DC-area businesses", keywords: ["federal contract", "government contract", "federal (agency|agencies|employees|workers)", "\\bgsa\\b", "defense contractor", "government shutdown", "federal customers?"] },
  { id: "borrower", name: "Any business with a variable-rate loan", keywords: ["line of credit", "credit line", "\\bloc\\b", "sba", "variable.?rate", "\\bloan\\b", "debt", "financ", "\\blease", "prime rate", "floor ?plan"] },
];

// ---------- shared market queries ----------

const V = (liveExample: string, ask: number, at = "2026-11-19T09:30:00Z") => ({ at, liveExample, ask });

const RAIN_DAY: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: ["KXRAINWKND", "KXRAIN", "KXRAINDAUS", "KXRAINTHANKSGIVING"], location: "profile-city", hurtWhen: "event",
  strike: { targetAsk: 0.3 }, maxDays: 10,
  describe: "Kalshi 'Will it rain in <city>' (weekend / daily / Thanksgiving), the owner's city, YES",
};
const WET_MONTH: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: ["KXRAINAUSM", "KXRAINATLM", "KXRAINBOSM", "KXRAINCHIM", "KXRAINCLLM", "KXRAINDALM", "KXRAINDCM", "KXRAINDENM", "KXRAINDTWM",
    "KXRAINEWRM", "KXRAINHOUM", "KXRAININDM", "KXRAINLAXM", "KXRAINLEXM", "KXRAINLVM", "KXRAINMIAM", "KXRAINMINM", "KXRAINMKEM", "KXRAINNOLAM", "KXRAINNYCM",
    "KXRAINOKCM", "KXRAINPHILM", "KXRAINPHXM", "KXRAINPVDM", "KXRAINSATXM", "KXRAINSEAM", "KXRAINSFOM", "KXRAINSGFM", "KXRAINSTLM", "KXRAINTPAM", "KXRAINTTNM", "KXRAINWPBM"],
  location: "profile-city", hurtWhen: "above",
  strike: { targetAsk: 0.3 }, maxDays: 45,
  describe: "Kalshi monthly rainfall total in the owner's city (32 US cities), YES on 'Above N inches'",
};
const COLD_HIGH: MarketQuery = {
  venues: ["gemini", "kalshi"], perils: ["cold", "heat"], series: ["WXHIGH", "KXHIGHAUS", "KXHIGHTDAL", "KXHIGHTHOU", "KXHIGHNY", "KXHIGHCHI", "KXHIGHMIA", "KXHIGHLAX", "KXHIGHDEN",
    "KXHIGHPHIL", "KXHIGHTATL", "KXHIGHTBOS", "KXHIGHTDC", "KXHIGHTEWR", "KXHIGHTLV", "KXHIGHTMIN", "KXHIGHTNOLA", "KXHIGHTOKC", "KXHIGHTPHX", "KXHIGHTSAN", "KXHIGHTSATX", "KXHIGHTSDF", "KXHIGHTSEA", "KXHIGHTSFO"],
  titleRe: "highest temperature", location: "profile-city", hurtWhen: "below", strike: { targetAsk: 0.15 }, maxDays: 7,
  describe: "Daily high in the owner's city (Gemini WXHIGH, Kalshi KXHIGH*), YES on the 'X°F or below' tail",
};
const WARM_HIGH: MarketQuery = { ...COLD_HIGH, hurtWhen: "above", describe: "Daily high in the owner's city, YES on the 'X°F or above' tail (unseasonable warmth)" };
const GAS_WEEK: MarketQuery = {
  venues: ["kalshi"], perils: ["gas"], series: ["KXAAAGASW", "KXAAAGASM"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.3 }, maxDays: 14,
  describe: "Kalshi AAA US average gas price (weekly / month-end), YES on 'Above $X'",
};
const BRENT_UP: MarketQuery = {
  venues: ["gemini", "kalshi"], perils: ["oil"], series: ["BRENT", "WTI", "KXWTI", "KXWTIW"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.25 }, maxDays: 14,
  describe: "Brent / WTI crude settle (Gemini daily + month-end, Kalshi), YES on '$X or above'",
};
const NGAS_UP: MarketQuery = {
  venues: ["gemini"], perils: ["natgas"], series: ["NGAS"], titleRe: "natural gas", location: "national", hurtWhen: "above", strike: { targetAsk: 0.3 }, maxDays: 14,
  describe: "Gemini Henry Hub natural gas settle (daily + month-end), YES on '$X or above'",
};
const COPPER_UP: MarketQuery = {
  venues: ["gemini"], perils: ["metals"], series: ["COPPER"], titleRe: "copper", location: "national", hurtWhen: "above", strike: { targetAsk: 0.25 }, maxDays: 14,
  describe: "Gemini copper settle (daily + month-end), YES on '$X or above'",
};
const FED_HIKE: MarketQuery = {
  venues: ["gemini", "kalshi"], perils: ["fed"], series: ["FED", "KXFEDDECISION"], labelRe: "^hike", location: "national", hurtWhen: "event", strike: { targetAsk: 0.4 }, maxDays: 75,
  describe: "Fed decision in <month>? (Gemini FED first, Kalshi KXFEDDECISION), YES on 'Hike 25bps' / 'Hike >25bps' (next two meetings)",
};
const CPI_HOT: MarketQuery = {
  venues: ["kalshi"], perils: ["cpi"], series: ["KXCPI", "KXCPIYOY"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.2 }, maxDays: 60,
  describe: "Kalshi CPI MoM / YoY print, YES on 'Above X%' (hot print)",
};

// Winter / power / water / fuel queries (Kalshi via DFlow on Solana; added 2026-11-19 with the venue expansion)
const TX = ["austin", "dallas", "houston", "san antonio", "fort worth", "el paso", "college station", "waco", "round rock", "plano", "corpus christi"];
const SNOW_CITIES = ["chicago", "new york", "boston", "denver", "philadelphia", "detroit", "minneapolis", "washington", "seattle", "milwaukee", "pittsburgh", "trenton"];
const DIESEL_UP: MarketQuery = {
  venues: ["kalshi"], perils: ["gas"], series: ["KXDIESELW"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.3 }, maxDays: 14,
  describe: "Kalshi weekly US on-highway diesel (EIA), YES on 'Above $X'",
};
const SNOW_MONTH: MarketQuery = {
  venues: ["kalshi"], perils: ["snow"], series: ["KXBOSSNOWM", "KXCHISNOWM", "KXDCSNOWM", "KXDENSNOWM", "KXDETSNOWM", "KXMKESNOWM", "KXMSPSNOWM", "KXNYCSNOWM", "KXPHILSNOWM", "KXPITSNOWM", "KXSEASNOWM", "KXTTNSNOWM"],
  location: "profile-city", cities: SNOW_CITIES, hurtWhen: "above", strike: { targetAsk: 0.35 }, maxDays: 45,
  describe: "Kalshi 'Snow in <city> in Dec?' monthly snowfall, the owner's city, YES on 'Above N inches'",
};
const SKI_LOW_SNOW: MarketQuery = {
  venues: ["kalshi"], perils: ["snow"], series: ["KXTSNOWFALLBIGSKYM", "KXPARKCSNOW", "KXMAMMOTHSNOW"], location: "profile-city", cities: ["park city", "big sky", "mammoth lakes"],
  hurtWhen: "below", strike: { targetAsk: 0.4 }, maxDays: 45,
  describe: "Kalshi resort snowfall (Big Sky December, Park City / Mammoth season-to-date by Dec 24), NO on 'Above N inches' (pays on a thin snow year)",
};
const ERCOT_UP: MarketQuery = {
  venues: ["kalshi"], perils: ["power"], series: ["KXERCOTNORTHW", "KXERCOTNORTHM"], location: "national", cities: TX, hurtWhen: "above",
  strike: { targetAsk: 0.3 }, maxDays: 45,
  describe: "Kalshi ERCOT North Hub average real-time price (weekly / monthly, $/MWh), YES on 'Above $X/MWh'",
};
const MEAD_LOW: MarketQuery = {
  venues: ["kalshi"], perils: ["water"], series: ["KXMEAD"], location: "national", cities: ["las vegas", "henderson", "boulder city", "lake mead"], hurtWhen: "below",
  strike: { targetAsk: 0.45 }, maxDays: 60,
  describe: "Kalshi Lake Mead end-of-month elevation, NO on 'Above X ft' (pays when the lake ends lower)",
};
const HDD_WARM: MarketQuery = {
  venues: ["kalshi"], perils: ["cold"], series: ["KXHDDCVG"], location: "national", cities: ["cincinnati", "covington", "dayton"], hurtWhen: "below",
  strike: { targetAsk: 0.25 }, maxDays: 50,
  describe: "Kalshi Cincinnati cumulative heating degree days Oct-Dec, YES on 'Below N' (a mild early winter)",
};
const NAPA_DRY: MarketQuery = {
  venues: ["kalshi"], perils: ["rain"], series: ["KXRAINNAPAM"], titleRe: "through march", location: "national", cities: ["napa", "sonoma", "yountville", "st. helena"], hurtWhen: "below",
  strike: { targetAsk: 0.5 }, maxDays: 140,
  describe: "Kalshi Napa Nov-Mar season rainfall, NO on 'Above N inches' (pays on a dry winter)",
};

// Long-dated queries (2026-11-19 long-horizon loop): season futures, month / year-end fuel, the year's mortgage-rate high.
const SEASON_FUTURES = ["NBAF", "NBAPLAYOFFS", "NFLPLAYOFF", "NFLAFCSOUTH", "NFLNFCEAST", "NFLHOUWINS", "NFLDALWINS", "NHLPLAYOFFS", "NHLWCF", "CFBPLAYOFF",
  "KXNBAPLAYOFF", "KXNBAWEST", "KXNBAWCFQUAL", "KXNFLPLAYOFF", "KXNFLPLAYOFFHOST", "KXNFLNFCEAST", "KXNFLAFCSOUTH", "KXNHLPLAYOFF", "KXNHLWEST", "KXNCAAFPLAYOFF"];
const TEAM_SEASON: MarketQuery = {
  venues: ["gemini", "kalshi"], perils: ["game"], series: SEASON_FUTURES, location: "team", hurtWhen: "team-misses", strike: { targetAsk: 0.35 }, maxDays: 240,
  describe: "Season futures for the team(s) named in the description (playoffs / conference finals / conference / wins ladder / College Football Playoff), NO on the team",
};
const DIESEL_LONG: MarketQuery = {
  venues: ["kalshi"], perils: ["gas"], series: ["KXDIESELYE", "KXDIESELMON"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.25 }, maxDays: 60,
  describe: "Kalshi US diesel at month end / year end (EIA), YES on 'Above $X'",
};
const MORTGAGE_HIGH: MarketQuery = {
  venues: ["kalshi"], perils: ["fed"], series: ["KXMORTGAGERATE"], location: "national", hurtWhen: "above", strike: { targetAsk: 0.2 }, maxDays: 120,
  describe: "Kalshi 'How high will the 30-year mortgage rate get' this year, YES on 'Above X%'",
};
const SHUTDOWN: MarketQuery = {
  venues: ["kalshi"], perils: ["other"], series: ["KXGOVTSHUTDOWN"], location: "national", hurtWhen: "event", strike: { targetAsk: 0.3 }, maxDays: 60,
  describe: "Kalshi 'Government shutdown on <funding deadline>?', YES",
};

// ---------- validated playbook ----------

export const PLAYBOOK: HedgeIdea[] = [
  // bars & restaurants
  { id: "bar-rain-night", industry: "bar-restaurant", keywords: ["patio", "outdoor", "rooftop", "beer garden"],
    title: "Rain empties the patio", problem: "Outdoor seats earn nothing on a rainy night and walk-in traffic drops.",
    causalStory: "Measurable rain in the city on a busy night cuts patio covers directly; the market settles on the same city's rain gauge.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "strong", lossShareOfDay: 0.35,
    basisRisk: "Settles on the official station (Camp Mabry for Austin) for the whole day/weekend; a morning shower that clears by 6pm still pays, a cloudburst at your block that misses the gauge doesn't.",
    naturalHedgeNote: "Delivery-heavy kitchens get some of it back as delivery orders on rainy days.",
    evidence: [{ claim: "Foot traffic fell 7.4% on medium/heavy-rain days, up to 11% in winter (Foursquare x AccuWeather).", source: "https://location.foursquare.com/?p=8611" },
               { claim: "~75% of surveyed restaurant owners say weather swings cost them at least 10% of sales (BlueSky survey, self-reported).", source: "https://www.qsrmagazine.com/exclusives/battling-back-against-winter" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },
  { id: "bar-cold-front", industry: "bar-restaurant", keywords: ["patio", "outdoor", "rooftop", "beer garden", "ice cream", "frozen"],
    title: "Cold front keeps the patio crowd home", problem: "A November front can drop the high 20°F overnight; heaters save only part of an outdoor crowd.",
    causalStory: "Patio and frozen-treat demand falls with the daily high; the market pays when the city's high lands in its cold tail.",
    peril: "cold", marketQuery: COLD_HIGH, side: "yes", correlation: "medium", lossShareOfDay: 0.15,
    basisRisk: "Daily HIGH at the airport station, not the evening temperature on your patio; a mild afternoon that turns cold at 8pm doesn't pay.",
    naturalHedgeNote: "Mild 70s evenings help a patio: hedge only the cold tail, never 'below normal'.",
    evidence: [{ claim: "Weather sensitivity of restaurant sales peaks in Nov-Dec at >5% nationally, twice the summer level (Planalytics).", source: "https://www.planalytics.com/?p=11419" },
               { claim: "Ice cream shops and bakeries saw ~13% fewer visits on bad-weather days.", source: "https://location.foursquare.com/?p=8611" }],
    validated: V("gemini:GEMI-WXHIGH-AUS-2611200459-LO69", 0.04) },
  { id: "restaurant-food-inflation", industry: "bar-restaurant", keywords: ["menu", "food cost", "ingredients", "catering", "fixed-price"],
    title: "Hot inflation print outruns menu prices", problem: "Menus and catering contracts are repriced a few times a year; food and supply costs move monthly.",
    causalStory: "A hot CPI month means suppliers' prices rose faster than your menu; the CPI market pays on the hot print.",
    peril: "cpi", marketQuery: CPI_HOT, side: "yes", correlation: "weak", lossShareOfDay: 0.05,
    basisRisk: "Headline CPI is not your food basket (beef, eggs and produce swing far more than the index).",
    evidence: [{ claim: "Restaurants run on thin margins with food ~30% of sales; menu prices lag cost spikes (Hedgehog preset assumption, catering contracts are fixed-price).", source: "https://nrn.com/finance/how-restaurant-operators-can-make-sense-fluctuating-energy-costs" }],
    validated: V("kalshi:KXCPI-26DEC-T0.3", 0.13) },

  // food trucks
  { id: "truck-rain-day", industry: "food-truck", keywords: ["no indoor", "walk-up", "line", "lot", "trailer"],
    title: "Rain wipes out the walk-up line", problem: "A truck with no seating sells almost nothing in the rain; weekends are most of the money.",
    causalStory: "Walk-up demand goes to near zero when it rains; the city rain market pays on the same day/weekend.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "strong", lossShareOfDay: 0.5,
    basisRisk: "Station rain, not your lot; light drizzle counts as rain for the market while some customers still come.",
    naturalHedgeNote: "If you sell through delivery apps, rainy-day app orders offset part of the walk-up loss.",
    evidence: [{ claim: "Heavy rain cut restaurant foot traffic up to 11% on average, far more for venues without cover; QSRs least affected only because of drive-thrus.", source: "https://location.foursquare.com/?p=8611" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },

  // coffee
  { id: "coffee-rain-walkins", industry: "coffee-shop", keywords: ["walk-in", "foot traffic", "commuter", "patio"],
    title: "Rainy mornings cut walk-ins", problem: "Treat and coffee stops are discretionary; people skip the detour in the rain.",
    causalStory: "Treat-oriented stops lose more visits than any other food category on rainy days; the city rain market pays the same day.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "medium", lossShareOfDay: 0.12,
    basisRisk: "Whole-day station rain; a 6am shower hurts more than a 6pm one but both settle the same.",
    naturalHedgeNote: "Cold, grey mornings sell hot drinks; only rain itself is the risk, not the cold.",
    evidence: [{ claim: "Ice cream shops and bakeries saw ~13% fewer visits on heavy-rain days.", source: "https://location.foursquare.com/?p=8611" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },

  // outdoor events
  { id: "event-rain-day", industry: "outdoor-events", keywords: ["outdoor", "festival", "market", "concert", "wedding", "tailgate"],
    title: "Rain on event day", problem: "Walk-up ticket sales and vendor fees collapse when it rains, even if the event goes on; standard event cover excludes weather.",
    causalStory: "Rain on the event day in the event city cuts attendance and gate sales; the market settles on the same city and day/weekend.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "strong", lossShareOfDay: 0.4,
    basisRisk: "The station may be miles from the venue; any measurable rain pays, even if the event window stays dry.",
    evidence: [{ claim: "Extreme weather drove an 86.5% rise in event disruptions 2023-2024, outdoor festivals hit hardest (Tokio Marine HCC).", source: "https://www.tmhcc.com/en-us/news-and-articles/thought-leadership/ensuring-event-continuity-amid-uncertainty" },
               { claim: "Adverse weather is excluded from standard event cancellation policies for outdoor events.", source: "https://tysers.codexdigital.com.au/?p=10521" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },
  { id: "event-cold-day", industry: "outdoor-events", keywords: ["outdoor", "festival", "market", "concert"],
    title: "Cold snap on event day", problem: "Late-fall outdoor events lose walk-ups when the day turns cold.",
    causalStory: "Attendance at outdoor events falls with the temperature; the daily-high cold tail pays on the same day.",
    peril: "cold", marketQuery: COLD_HIGH, side: "yes", correlation: "medium", lossShareOfDay: 0.2,
    basisRisk: "Daily high, not the evening temperature; presold tickets are not lost.",
    evidence: [{ claim: "Weather sensitivity of consumer spending peaks in Nov-Dec (Planalytics).", source: "https://www.planalytics.com/?p=11419" }],
    validated: V("gemini:GEMI-WXHIGH-AUS-2611200459-LO69", 0.04) },

  // landscaping
  { id: "landscape-wet-month", industry: "landscaping", keywords: ["crew", "mow", "route", "install"],
    title: "A soaked month kills billable crew days", problem: "Crews get paid either way; a month with several rainouts loses days that can't all be made up.",
    causalStory: "Monthly rainfall above normal means more rained-out crew days; the city monthly rain-total market pays on the total.",
    peril: "rain", marketQuery: WET_MONTH, side: "yes", correlation: "medium", lossShareOfDay: 1,
    basisRisk: "Inches, not rain-days: one 3-inch storm counts the same as five rainy days. Only Austin has a monthly total market in our index today.",
    naturalHedgeNote: "Rain grows grass; part of the lost work comes back as extra mowing two weeks later.",
    evidence: [{ claim: "Outdoor construction loses meaningful productive hours to weather; contractors carry weather days in schedules.", source: "https://www.frbsf.org/research-and-insights/publications/economic-letter/2024/05/impact-of-us-labor-productivity-losses-from-extreme-heat/" }],
    validated: V("kalshi:KXRAINAUSM-26NOV-5", 0.35) },
  { id: "landscape-rain-day", industry: "landscaping", keywords: ["weekend", "crew", "mow"],
    title: "Rainout on a scheduled crew day", problem: "A rained-out route day costs the crew's wages with no billing.",
    causalStory: "Rain in the city on a scheduled day stops mowing and installs; the daily/weekend rain market pays.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "medium", lossShareOfDay: 0.6,
    basisRisk: "Station rain; light rain may still allow some work.",
    naturalHedgeNote: "Rain grows grass; hedge only the crew cost of a lost day.",
    evidence: [{ claim: "Weather-driven lost work hours are concentrated in outdoor trades (Lancet Countdown / construction studies).", source: "https://link.springer.com/doi/10.1186/s12889-024-20744-x" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },
  { id: "landscape-fuel", industry: "landscaping", keywords: ["mower", "truck", "trailer", "equipment", "gas"],
    title: "Pump prices raise the cost of every route", problem: "Mowers, blowers and crew trucks burn gasoline; route prices are fixed by contract.",
    causalStory: "Fuel is bought weekly at the pump while customer prices are set per season; the AAA weekly gas market pays when pump prices jump.",
    peril: "gas", marketQuery: GAS_WEEK, side: "yes", correlation: "medium", lossShareOfDay: 0.04,
    basisRisk: "National AAA average vs your local pump; Texas usually trades below the national average.",
    evidence: [{ claim: "Fuel's share of gig-driver pay hit a 4-year high in the Q1 2026 spike (Gridwise) - the same pump-price pass-through hits any route business.", source: "https://gridwise.io/analytics/how-rising-fuel-prices-are-impacting-the-gig-mobility-industry" }],
    validated: V("kalshi:KXAAAGASW-26NOV23-3.6400", 0.37) },

  // construction
  { id: "electrician-copper", industry: "construction", keywords: ["electric", "wire", "wiring", "copper", "fixed-price", "bid"],
    title: "Copper spikes between bid and buy", problem: "Fixed-price bids sit 60-90 days before wire is bought; a copper rally eats the margin.",
    causalStory: "Building wire is priced off exchange copper; the copper market pays when copper settles above the strike.",
    peril: "metals", marketQuery: COPPER_UP, side: "yes", correlation: "strong", lossShareOfDay: 0.3,
    basisRisk: "Wire distributors lag the exchange by weeks and add their own spread; hedge the copper share of open bids only.",
    evidence: [{ claim: "Most commercial bids assume only 60-90 days of price stability; a ~30% wire jump can wipe out the margin on a fixed-price bid.", source: "https://www.copperweld.com/blog/copperweld-building-wires-impact-on-cost-stability" },
               { claim: "Copper hit records in 2026 as construction cost pressures built (ConstructConnect).", source: "https://news.constructconnect.com/copper-prices-hit-record-as-cost-pressures-build" }],
    validated: V("gemini:GEMI-COPPER2611302200-HI6", 0.24) },
  { id: "roofer-wet-month", industry: "construction", keywords: ["roof", "concrete", "exterior", "framing", "paint"],
    title: "Wet month stalls exterior jobs", problem: "Roofing, concrete and exterior paint can't proceed in rain; crews idle and jobs slip.",
    causalStory: "Above-normal monthly rainfall means more weather days on exterior jobs; the monthly rain-total market pays.",
    peril: "rain", marketQuery: WET_MONTH, side: "yes", correlation: "medium", lossShareOfDay: 1,
    basisRisk: "Total inches, not number of lost days; Austin-only monthly market today.",
    naturalHedgeNote: "Storms with hail are the opposite for roofers: they create replacement demand. This hedge is only for idle crew days.",
    evidence: [{ claim: "Contractors pad bids and carry weather days because outdoor productivity drops in bad weather.", source: "https://abccarolinas.org/construction-material-prices-2026-how-carolinas-contractors-can-protect-bids-and-margins/" }],
    validated: V("kalshi:KXRAINAUSM-26NOV-5", 0.35) },
  { id: "builder-rate-hike", industry: "construction", keywords: ["builder", "spec home", "construction loan", "remodel", "new home"],
    title: "Fed hike chills new projects", problem: "Construction loans float over prime, and buyers/homeowners delay projects when rates rise.",
    causalStory: "Prime moves with the Fed within days, repricing construction loans and buyers' financing; the Fed-decision market pays on a hike.",
    peril: "fed", marketQuery: FED_HIKE, side: "yes", correlation: "medium",
    basisRisk: "Project demand also depends on long rates and local housing; a hike that is already expected moves little.",
    evidence: [{ claim: "Prime follows the fed funds rate within days; variable SBA/construction loans reprice with it.", source: "https://www.nerdwallet.com/blog/small-business/sba-loan-rates/" }],
    validated: V("kalshi:KXFEDDECISION-27JAN-H25", 0.59) },
  { id: "construction-diesel", industry: "construction", keywords: ["equipment", "excavat", "diesel", "skid steer", "haul"],
    title: "Crude spike lifts equipment diesel", problem: "Excavators, generators and haul trucks run on diesel priced off crude.",
    causalStory: "Diesel is refined from crude and tracks Brent within weeks; the crude market pays when it settles above the strike.",
    peril: "oil", marketQuery: BRENT_UP, side: "yes", correlation: "medium", lossShareOfDay: 0.05,
    basisRisk: "Diesel crack spreads move independently of crude (diesel was ~$6.29/gal in Nov 2026 per EIA).",
    evidence: [{ claim: "Diesel averaged $6.29/gal (EIA, early Nov 2026), pushing fleet fuel cost per mile well above ATRI's 2025 average.", source: "https://www.fleetowner.com/emissions-efficiency/article/55417694/trucking-by-the-numbers-2026-the-price-of-operating-a-fleet" }],
    validated: V("gemini:GEMI-BRENT2611202200-HI93", 0.23) },

  // HVAC / plumbing
  { id: "plumber-copper", industry: "hvac-plumbing", keywords: ["pipe", "line set", "copper", "repipe", "install", "fixed-price"],
    title: "Copper pipe and line-set costs jump", problem: "Repipes and A/C installs are quoted fixed-price; copper tube and line sets reprice with copper.",
    causalStory: "Copper tube is priced off exchange copper; the copper market pays when copper settles above the strike.",
    peril: "metals", marketQuery: COPPER_UP, side: "yes", correlation: "strong", lossShareOfDay: 0.2,
    basisRisk: "Supply-house prices lag; PEX substitutes on some jobs.",
    naturalHedgeNote: "Freezes (burst pipes) and heat waves (A/C calls) bring emergency work: don't hedge weather.",
    evidence: [{ claim: "Copper price lag is a named estimating risk for trades; drops don't pass through to products quickly (ACHR News).", source: "https://www.achrnews.com/articles/166665-copper-prices-just-fell-sharply-but-dont-call-it-relief-just-yet" }],
    validated: V("gemini:GEMI-COPPER2611302200-HI6", 0.24) },

  // delivery
  { id: "delivery-gas", industry: "delivery", keywords: ["car", "rideshare", "uber", "lyft", "doordash", "courier", "mile", "gas"],
    title: "Pump-price spike eats delivery pay", problem: "Gig pay per trip is fixed while fuel cost per mile isn't; surcharges are per trip, not per mile.",
    causalStory: "Every mile costs more when the AAA average rises; the weekly gas market pays when it settles above the strike.",
    peril: "gas", marketQuery: GAS_WEEK, side: "yes", correlation: "strong", lossShareOfDay: 0.05,
    basisRisk: "National average vs your local pump; weekly settle vs daily fill-ups.",
    naturalHedgeNote: "Rainy days raise delivery demand: don't buy rain cover.",
    evidence: [{ claim: "Delivery drivers' fuel cost rose from 11.2¢ to 15.6¢ per dollar earned in four weeks (Gridwise 2026 Gas Report).", source: "https://gridwise.io/analytics/how-rising-fuel-prices-are-impacting-the-gig-mobility-industry" },
               { claim: "90% of drivers said Uber's per-trip gas surcharge was not enough (Coworker.org 2026).", source: "https://home.coworker.org/gig-work-gas-prices/" }],
    validated: V("kalshi:KXAAAGASW-26NOV23-3.6400", 0.37) },
  { id: "delivery-diesel-brent", industry: "delivery", keywords: ["van", "truck", "fleet", "diesel", "freight", "catering"],
    title: "Diesel spike via Brent crude", problem: "Vans and box trucks burn diesel; customer rates are fixed by contract.",
    causalStory: "US diesel prices off Brent within ~2 weeks; the Brent market pays when it settles above the strike.",
    peril: "oil", marketQuery: BRENT_UP, side: "yes", correlation: "medium", lossShareOfDay: 0.08,
    basisRisk: "Diesel crack spread can widen without crude moving (it did in 2026).",
    naturalHedgeNote: "Rainy days raise delivery demand: don't buy rain cover.",
    evidence: [{ claim: "Fuel is ~21% of for-hire trucking cost per mile (ATRI 2025: $0.48 of $2.34).", source: "https://www.supplychain247.com/article/truck-operating-costs-record-2025-atri/us" }],
    validated: V("gemini:GEMI-BRENT2611202200-HI93", 0.23) },

  // farms / nurseries
  { id: "farm-diesel", industry: "farm-nursery", keywords: ["tractor", "diesel", "haul", "ranch", "hay"],
    title: "Diesel for tractors and hauling", problem: "Tractors, irrigation pumps and cattle hauling run on diesel.",
    causalStory: "Farm diesel tracks crude; the Brent/WTI market pays when crude settles above the strike.",
    peril: "oil", marketQuery: BRENT_UP, side: "yes", correlation: "medium", lossShareOfDay: 0.05,
    basisRisk: "Off-road diesel crack spread and local delivery premium.",
    evidence: [{ claim: "Diesel averaged $6.29/gal in early Nov 2026 (EIA via FleetOwner).", source: "https://www.fleetowner.com/emissions-efficiency/article/55417694/trucking-by-the-numbers-2026-the-price-of-operating-a-fleet" }],
    validated: V("gemini:GEMI-BRENT2611202200-HI93", 0.23) },

  // seasonal retail
  { id: "retail-gas-squeeze", industry: "retail-apparel", keywords: ["discretionary", "gift", "suburb", "boutique"],
    title: "Pump prices squeeze discretionary spend", problem: "Shoppers who drive in spend less on extras when gas jumps.",
    causalStory: "Gas comes out of the same household budget as discretionary shopping; the AAA gas market pays on a jump.",
    peril: "gas", marketQuery: GAS_WEEK, side: "yes", correlation: "weak", lossShareOfDay: 0.03,
    basisRisk: "Macro and slow; your sales move with many other things.",
    evidence: [{ claim: "Drivers cut hours and spending when gas spiked (Rideshare Guy / Coworker surveys) - household fuel budgets crowd out extras.", source: "https://therideshareguy.com/the-hidden-pay-cut-what-rideshare-drivers-can-do-about-high-oil-prices/" }],
    validated: V("kalshi:KXAAAGASW-26NOV23-3.6400", 0.37) },

  // tourism
  { id: "tourism-weekend-rain", industry: "tourism", keywords: ["tour", "kayak", "boat", "paddle", "beach", "lake", "rental", "walking"],
    title: "Rainy weekend cancels tours and rentals", problem: "Tours, boat and kayak rentals refund or no-show when it rains; weekends are the money.",
    causalStory: "Weekend rain in the city cancels outdoor bookings; the weekend rain market pays on the same city and weekend.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "medium", lossShareOfDay: 0.4,
    basisRisk: "Any measurable rain at the station pays; a sunny afternoon after a morning shower still settles YES.",
    naturalHedgeNote: "Hotels and indoor attractions may gain from rainy days; this is for outdoor operators.",
    evidence: [{ claim: "Weather-driven event/outing disruptions rose 86.5% 2023-2024 (Tokio Marine HCC).", source: "https://www.tmhcc.com/en-us/news-and-articles/thought-leadership/ensuring-event-continuity-amid-uncertainty" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },

  // sports bars & merch
  { id: "sports-team-loses", industry: "sports-bar-merch", keywords: ["spurs", "rockets", "mavericks", "texans", "cowboys", "longhorns", "game", "merch", "watch"],
    title: "Our team loses (crowd leaves early / merch stalls)", problem: "Wins keep the watch-party crowd and sell jerseys; a loss sends people home and kills merch demand.",
    causalStory: "Post-game spend and merch sales swing with the result; YES on the opponent pays exactly when your team loses.",
    peril: "game", marketQuery: { venues: ["gemini", "kalshi"], perils: ["game"], location: "team", hurtWhen: "team-loses", strike: { targetAsk: 0.4 }, maxDays: 10, describe: "Moneyline for games of the team(s) named in the description: YES on the opponent" },
    side: "yes", correlation: "medium", lossShareOfDay: 0.2,
    basisRisk: "The crowd for the game itself is already in the bar; only the post-game/merch part is at risk. Draws (MLS) pay neither side.",
    naturalHedgeNote: "Wins already pay you: never buy your own team's win side.",
    evidence: [{ claim: "Womply data on ~42k bars: playoff excitement added almost 12% to bar revenue, depending on the game.", source: "https://sbj.net/stories/sports-bars-glory-in-blues-stanley-cup-run,64132" },
               { claim: "Indianapolis bar ran 4-5x normal sales during the Pacers' playoff run.", source: "https://frontofficesports.com/article/how-the-pacers-and-caitlin-clark-boosted-one-bars-bottom-line/" }],
    validated: V("kalshi:KXNFLGAME-26NOV19INDHOU-IND", 0.16) },

  // auto
  { id: "dealer-floorplan-hike", industry: "auto", keywords: ["floor plan", "floorplan", "inventory", "lot", "used cars", "dealer"],
    title: "Fed hike raises floor-plan interest", problem: "Independent dealers finance inventory on floor-plan lines at 7-10% that float with prime; buyers shop by monthly payment.",
    causalStory: "Prime (and floor-plan rates) move with the Fed within days; the Fed-decision market pays on a hike.",
    peril: "fed", marketQuery: FED_HIKE, side: "yes", correlation: "strong", lossShareOfDay: 0.1,
    basisRisk: "Small per-meeting dollars unless the line is large; an expected hike is already priced in at ~60¢.",
    evidence: [{ claim: "Floor-plan rates for independent dealers now commonly run 7-10%; 70-80% of independents use a floor plan (Crestmont, lender data).", source: "https://www.crestmontcapital.com/blog/used-car-dealership-financing-statistics-2026" },
               { claim: "Used-car loans averaged 11.19% in Q2 2026 (Experian); buyers shop by monthly payment.", source: "https://www.experian.com/blogs/ask-experian/auto-loan-rates-financing/" }],
    validated: V("kalshi:KXFEDDECISION-27JAN-H25", 0.59) },

  // crypto merchants
  { id: "crypto-btc-drawdown", industry: "crypto-merchant", keywords: ["bitcoin", "btc", "crypto", "treasury", "hold"],
    title: "BTC drawdown hits crypto-paid sales and held coins", problem: "Crypto-rich customers spend less after a drop, and coins held as revenue lose value.",
    causalStory: "Merchant crypto volume fell with BTC in 2018; NO on 'BTC $X or above' pays when BTC settles below the strike.",
    peril: "crypto", marketQuery: { venues: ["gemini"], perils: ["crypto"], series: ["BTC"], titleRe: "btc price on [a-z]", location: "national", hurtWhen: "below", strike: { targetAsk: 0.3 }, maxDays: 30, describe: "Gemini 'BTC price on <month-end>': NO on '$X or above' (pays if BTC ends below X)" },
    side: "no", correlation: "medium", lossShareOfDay: 0.2,
    basisRisk: "BitPay reports volume rising regardless of price; only hedge the coins you actually hold plus the crypto share of sales.",
    evidence: [{ claim: "BTC received by the 17 largest merchant processors fell from $411M (Sep 2017) to $60M (May 2018) as price fell >50% (Chainalysis).", source: "https://cointelegraph.com/news/report-use-of-bitcoin-in-commerce-hit-low-in-may-after-peaking-at-411-mln-last-year" },
               { claim: "~40% of BitPay merchants keep some or all settlement in BTC - their revenue is directly price-exposed.", source: "https://www.americanbanker.com/payments/articles/bitcoins-use-in-commerce-keeps-falling-even-as-volatility-eases" }],
    validated: V("gemini:GEMI-BTC2611302200-HI62500", 0.40) },
  { id: "crypto-sol-drawdown", industry: "crypto-merchant", keywords: ["solana", "sol", "solana pay", "phantom", "usdc"],
    title: "SOL drawdown for Solana-paid merchants", problem: "Solana-native customers and SOL held as revenue lose value in a drawdown.",
    causalStory: "NO on 'SOL $X or above' at month-end pays when SOL settles below the strike.",
    peril: "crypto", marketQuery: { venues: ["gemini"], perils: ["crypto"], series: ["SOL"], titleRe: "sol price on [a-z]", location: "national", hurtWhen: "below", strike: { targetAsk: 0.3 }, maxDays: 30, describe: "Gemini 'SOL price on <month-end>': NO on '$X or above'" },
    side: "no", correlation: "medium", lossShareOfDay: 0.2,
    basisRisk: "If you settle in USDC immediately, only the demand effect remains (weak).",
    evidence: [{ claim: "Merchant crypto payment volume tracked the 2018 price drawdown (Chainalysis).", source: "https://cointelegraph.com/news/report-use-of-bitcoin-in-commerce-hit-low-in-may-after-peaking-at-411-mln-last-year" }],
    validated: V("gemini:GEMI-SOL2611302200-HI70", 0.34) },

  // jewelers
  { id: "jeweler-gold", industry: "jeweler", keywords: ["gold", "ring", "custom", "quote", "bench"],
    title: "Gold spikes after a custom quote", problem: "Custom pieces are quoted weeks before metal is bought; jewelers say volatility, not the level, is what hurts.",
    causalStory: "Casting gold is priced off spot; the gold market pays when gold settles above the strike.",
    peril: "metals", marketQuery: { venues: ["gemini"], perils: ["metals"], series: ["XAU"], titleRe: "gold price", location: "national", hurtWhen: "above", strike: { targetAsk: 0.25 }, maxDays: 14, describe: "Gemini gold settle (daily + month-end), YES on '$X or above'" },
    side: "yes", correlation: "strong", lossShareOfDay: 0.3,
    basisRisk: "Size to the open (quoted, unbought) ounces only; mill/refiner premiums vary.",
    naturalHedgeNote: "Gold you already hold (or buy as scrap) gains in a rally: hedge only the net short quotes.",
    evidence: [{ claim: "Jewelers cap quote validity to two weeks because gold moves so much; higher metal cost is 'eating into our margin'.", source: "https://www.broomead.com.au/business/australian-jewellers-forced-to-cap-quotes-as-insane-gold-price-crushes-margins-c-21564613" },
               { claim: "Independents are the retailers most hurt by record gold (JCK).", source: "https://jckonline.com/?p=31114" }],
    validated: V("gemini:GEMI-XAU2611302200-HI3850", 0.25) },
  { id: "jeweler-silver", industry: "jeweler", keywords: ["silver", "sterling", "silversmith"],
    title: "Silver spikes after a quote", problem: "Sterling pieces are priced off silver, which has been more volatile than gold.",
    causalStory: "Sterling stock is priced off spot silver; the silver market pays when silver settles above the strike.",
    peril: "metals", marketQuery: { venues: ["gemini"], perils: ["metals"], series: ["XAG"], titleRe: "silver price", location: "national", hurtWhen: "above", strike: { targetAsk: 0.25 }, maxDays: 14, describe: "Gemini silver settle (daily + month-end), YES on '$X or above'" },
    side: "yes", correlation: "strong", lossShareOfDay: 0.2,
    basisRisk: "Fabrication premiums; size to open silver quotes.",
    naturalHedgeNote: "Silver inventory you hold gains in a rally.",
    evidence: [{ claim: "'The Silver Surge Is Giving Jewelers a New Headache' (Barron's).", source: "https://www.itiger.com/hans/news/2595873758" }],
    validated: V("gemini:GEMI-XAG2611302200-HI48D5", 0.25) },

  // real estate
  { id: "mortgage-rate-hike", industry: "real-estate", keywords: ["mortgage", "refinanc", "loan officer", "broker", "closings"],
    title: "Rate hike shrinks refi and purchase volume", problem: "Broker commissions follow application volume, which falls when rates climb.",
    causalStory: "A Fed hike pushes rates up and applications down; the Fed-decision market pays on a hike.",
    peril: "fed", marketQuery: FED_HIKE, side: "yes", correlation: "medium", lossShareOfDay: 0.3,
    basisRisk: "Mortgage rates follow the 10-year Treasury more than the Fed; an expected hike may already be in mortgage rates.",
    evidence: [{ claim: "MBA: rising rates pushed borrowers out of refinance; total applications fell 5.3% in one October 2026 week.", source: "https://www.mortgagenewsdaily.com/news/10232026-mortgage-applications-mba" },
               { claim: "Refi demand hit its lowest since 2025 as the 30-yr rate climbed (MBA data).", source: "https://www.mpamag.com/us/mortgage-industry/market-updates/mortgage-application-volume-falls-as-refi-demand-hits-2025-low/592666" }],
    validated: V("kalshi:KXFEDDECISION-27JAN-H25", 0.59) },
  { id: "mortgage-hot-cpi", industry: "real-estate", keywords: ["mortgage", "refinanc", "rates"],
    title: "Hot CPI print pushes rates up", problem: "A hot inflation print lifts Treasury yields and mortgage quotes the same day.",
    causalStory: "Mortgage rates key off the 10-year yield, which jumps on hot CPI; the CPI market pays on the hot print.",
    peril: "cpi", marketQuery: CPI_HOT, side: "yes", correlation: "weak", lossShareOfDay: 0.1,
    basisRisk: "One print rarely moves annual volume much; best as a small tail.",
    evidence: [{ claim: "Mortgage applications slid as rates hit a one-year high on oil-driven inflation fears (MPA).", source: "https://www.mpamag.com/us/mortgage-industry/market-updates/oil-prices-push-mortgage-rates-to-one-year-high-applications-slide/584181" }],
    validated: V("kalshi:KXCPI-26DEC-T0.3", 0.13) },

  // laundromat

  // car wash
  { id: "carwash-rain", industry: "car-wash", keywords: ["wash", "tunnel", "self-serve", "detail"],
    title: "Rainy weekend, empty wash bays", problem: "Volume goes to near zero on rainy days (and on days rain is forecast).",
    causalStory: "Nobody washes a car in the rain; the city rain market pays on the same day/weekend.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "strong", lossShareOfDay: 0.7,
    basisRisk: "A forecast of rain that never comes also kills volume but doesn't pay.",
    naturalHedgeNote: "The sunny day after a storm often brings a spike in volume, recovering part of the loss.",
    evidence: [{ claim: "Operators report volume 'almost zero on rainy days' and down when rain is forecast for the next day.", source: "https://www.carwashforum.com/threads/rainy-days-capture-rate.9327" },
               { claim: "DFW car washes hurt by the wettest fall on record (Dallas News).", source: "https://www.dallasnews.com/news/weather/2018/10/18/rain-means-no-sun-means-go-wettest-fall-record-hurts-businesses-across-dallas-fort-worth" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },
  { id: "carwash-cold", industry: "car-wash", keywords: ["wash", "tunnel", "self-serve"],
    title: "Cold snap freezes wash volume", problem: "Cold days cut volume and very cold days close bays outright.",
    causalStory: "Wash volume falls with the temperature; the daily-high cold tail pays on the same day.",
    peril: "cold", marketQuery: COLD_HIGH, side: "yes", correlation: "medium", lossShareOfDay: 0.4,
    basisRisk: "Daily high; a cold morning that warms up still loses the morning.",
    evidence: [{ claim: "Cold weather affects carwashes; some close for days in freezing weather (Professional Carwashing & Detailing).", source: "https://www.carwash.com/cold-weather-affects-carwashes/" }],
    validated: V("gemini:GEMI-WXHIGH-AUS-2611200459-LO69", 0.04) },

  // golf
  { id: "golf-rain", industry: "golf-recreation", keywords: ["golf", "tee time", "range", "rounds"],
    title: "Rain wipes out tee times", problem: "Rounds and range buckets disappear on rainy days; even the threat of rain keeps golfers away.",
    causalStory: "Rounds played fall with rainfall; the city rain market pays on the same day/weekend.",
    peril: "rain", marketQuery: RAIN_DAY, side: "yes", correlation: "strong", lossShareOfDay: 0.6,
    basisRisk: "Station rain; evening-only showers still pay while the morning rounds were played.",
    evidence: [{ claim: "Golf Datatech/NGF rule of thumb: +1 inch of rain YoY ≈ -2.2% rounds played; a rain-soaked June-July cut one course's rounds 50%.", source: "https://www.ibj.com/articles/54154-rounds-played-revenue-plummet-at-flooded-central-indiana-golf-courses" }],
    validated: V("kalshi:KXRAINWKND-26NOV21-AUS", 0.35) },

  // any borrower
  { id: "borrower-fed-hike", industry: "borrower", keywords: ["line of credit", "credit line", "sba", "variable", "loan"],
    title: "Fed hike on a variable-rate loan or credit line", problem: "SBA 7(a) loans and credit lines float over prime; a hike raises the payment at the next reset.",
    causalStory: "Prime moves 1:1 with the Fed within days; the Fed-decision market pays on a hike.",
    peril: "fed", marketQuery: FED_HIKE, side: "yes", correlation: "strong", lossShareOfDay: 0.02,
    basisRisk: "Exact pass-through, but small dollars: +0.25% on $100k is ~$21/month. 'Hike >25bps' is the cheap tail.",
    evidence: [{ claim: "Most variable 7(a) loans are prime + spread; prime follows the Fed within days (NerdWallet).", source: "https://www.nerdwallet.com/blog/small-business/sba-loan-rates/" },
               { claim: "A $100k 7(a) loan moving 8.0% -> 8.25% adds ~$13/month (SmartBiz illustration).", source: "https://smartbizloans.com/blog/interest-rate-increase-what-does-it-mean-for-your-business" }],
    validated: V("kalshi:KXFEDDECISION-27JAN-H25", 0.59) },

  // ---- winter, power, water & diesel (Kalshi via DFlow on Solana; Gemini lists none of these) ----
  { id: "delivery-diesel", industry: "delivery", keywords: ["diesel", "box truck", "semi", "trucking", "freight", "fleet", "reefer"],
    title: "Diesel spike on a fixed-rate route", problem: "Fleets quote routes and contracts weeks ahead; diesel is bought daily at the pump.",
    causalStory: "Weekly EIA diesel is the price fleets actually pay (minus a local spread); the market pays when the weekly average prints above the strike.",
    peril: "gas", marketQuery: DIESEL_UP, side: "yes", correlation: "strong", lossShareOfDay: 0.08,
    basisRisk: "US average on-highway diesel, not your fuel card; fuel surcharges recover part of a spike after a lag.",
    evidence: [{ claim: "Fuel is ~20-25% of trucking operating cost per mile (ATRI 2024 operational costs).", source: "https://truckingresearch.org/2024/07/an-analysis-of-the-operational-costs-of-trucking-2024-update/" }],
    validated: V("kalshi:KXDIESELW-26NOV23-T5.84", 0.21) },
  { id: "farm-diesel-weekly", industry: "farm-nursery", keywords: ["tractor", "diesel", "harvest", "equipment", "irrigation pump"],
    title: "Diesel spike for tractors and pumps", problem: "Field work and irrigation pumps burn diesel; crop prices don't move with fuel.",
    causalStory: "Farm diesel tracks the EIA weekly average; the weekly diesel market pays above the strike.",
    peril: "gas", marketQuery: DIESEL_UP, side: "yes", correlation: "medium", lossShareOfDay: 0.05,
    basisRisk: "Off-road (dyed) diesel trades below on-highway by the road tax, but moves with it.",
    evidence: [{ claim: "Fuel and oil are a top-5 variable cost for US row crops (USDA ERS cost and returns).", source: "https://www.ers.usda.gov/data-products/commodity-costs-and-returns" }],
    validated: V("kalshi:KXDIESELW-26NOV23-T5.84", 0.21) },
  { id: "tx-power-restaurant", industry: "bar-restaurant", keywords: ["kitchen", "walk-in", "cooler", "freezer", "electric", "texas", "austin"],
    title: "ERCOT power-price spike hits the electric bill", problem: "Texas businesses on index or variable-rate electricity eat wholesale spikes (Winter Storm Uri: $9,000/MWh).",
    causalStory: "Variable-rate Texas power bills pass through the ERCOT real-time price; the North Hub price market pays when the weekly/monthly average prints above the strike.",
    peril: "power", marketQuery: ERCOT_UP, side: "yes", correlation: "weak", lossShareOfDay: 0.05,
    basisRisk: "North Hub (Dallas) average, not your load zone or your retail plan; a fixed-rate plan has no exposure at all. On 2026-11-19 only November/this-week strikes near the current price were offered (72¢): real Uri-style tail cover needs the Dec/Jan listings.",
    evidence: [{ claim: "Real-time ERCOT prices hit the $9,000/MWh cap for ~4 days in Feb 2021 (Uri); index-plan customers got bills in the thousands.", source: "https://www.eia.gov/todayinenergy/detail.php?id=47876" }],
    validated: V("kalshi:KXERCOTNORTHM-01NOV26-T35", 0.72) },
  { id: "tx-power-laundromat", industry: "laundromat", keywords: ["dryer", "washer", "electric", "texas", "austin"],
    title: "ERCOT power-price spike on dryer-heavy bills", problem: "Washers, dryers and water heaters make power a top-3 cost; prices are posted on the machines.",
    causalStory: "A variable-rate electricity plan passes the ERCOT price through; the market pays above the strike.",
    peril: "power", marketQuery: ERCOT_UP, side: "yes", correlation: "weak", lossShareOfDay: 0.08,
    basisRisk: "Hub price vs your retail rate; gas dryers are exposed to natural gas instead. Strikes offered today sit near the current price (72¢), so it's expensive cover until winter months list.",
    evidence: [{ claim: "Utilities are typically 15-25% of laundromat revenue (Coin Laundry Association).", source: "https://coinlaundry.org/" }],
    validated: V("kalshi:KXERCOTNORTHM-01NOV26-T35", 0.72) },
  { id: "snow-restaurant", industry: "bar-restaurant", keywords: ["dine-in", "walk-in", "downtown", "chicago", "new york", "boston", "denver", "minneapolis"],
    title: "Snowy December keeps diners home", problem: "Snowstorms cancel reservations and close streets in December, the biggest month for holiday parties.",
    causalStory: "Monthly snowfall above the strike means several snow days; the city's December snowfall market pays on the total.",
    peril: "snow", marketQuery: SNOW_MONTH, side: "yes", correlation: "medium", lossShareOfDay: 0.6,
    basisRisk: "Inches at the official station for the whole month: one big storm and five light dustings settle the same.",
    naturalHedgeNote: "Delivery-heavy kitchens get some orders back on snow days.",
    evidence: [{ claim: "Snow cut restaurant foot traffic more than any other weather type in Foursquare x AccuWeather data.", source: "https://location.foursquare.com/?p=8611" }],
    validated: V("kalshi:KXCHISNOWM-26DEC-8", 0.30) },
  { id: "snow-retail", industry: "retail-apparel", keywords: ["store", "boutique", "holiday", "foot traffic", "chicago", "new york", "boston"],
    title: "Snowed-out holiday shopping days", problem: "December is up to a third of a small retailer's year; snow days push shoppers online.",
    causalStory: "Heavy December snowfall in the city removes in-store shopping days; the snowfall market pays above the strike.",
    peril: "snow", marketQuery: SNOW_MONTH, side: "yes", correlation: "weak", lossShareOfDay: 0.5,
    basisRisk: "Monthly inches, not weekend storms; a snowy weekday hurts less than a snowy Saturday.",
    naturalHedgeNote: "Boots, coats and shovels sell better when it snows: winter-stocked stores should hedge only the closure days.",
    evidence: [{ claim: "Weather sensitivity of consumer spending peaks in Nov-Dec (Planalytics).", source: "https://www.planalytics.com/?p=11419" }],
    validated: V("kalshi:KXCHISNOWM-26DEC-8", 0.30) },
  { id: "ski-low-snow", industry: "ski-town", keywords: ["ski", "rental", "lift", "lodging", "shuttle", "lessons"],
    title: "Thin snow year empties the ski town", problem: "Rental shops, ski schools and ski-town bars live on December-January visits; a slow start means cancelled trips.",
    causalStory: "Resort snowfall drives skier visits; NO on 'Above N inches' pays when the resort's snow total comes in low.",
    peril: "snow", marketQuery: SKI_LOW_SNOW, side: "no", correlation: "strong", lossShareOfDay: 0.4,
    basisRisk: "Snowfall at the resort's report, not base depth or snowmaking; a cold dry December with good snowmaking still pays.",
    evidence: [{ claim: "Low-snow seasons cost US ski areas ~$1B and 17,400 jobs vs good years (Protect Our Winters / REMI).", source: "https://protectourwinters.org/climate-report/" }],
    validated: V("kalshi:KXPARKCSNOW-24DEC26-GT30", 0.57) },
  { id: "marina-lake-mead", industry: "tourism", keywords: ["marina", "houseboat", "boat", "lake mead", "las vegas", "slip"],
    title: "Lake Mead drops and closes launch ramps", problem: "Low water closes ramps and slips at Lake Mead marinas (2022: several marinas relocated or closed).",
    causalStory: "Ramp closures follow the lake elevation; NO on 'Above X ft' pays when the month-end elevation comes in lower.",
    peril: "water", marketQuery: MEAD_LOW, side: "no", correlation: "strong", lossShareOfDay: 0.3,
    basisRisk: "Month-end Bureau of Reclamation elevation, not your ramp's usable depth; one month is a small slice of a multi-year drought.",
    evidence: [{ claim: "At ~1,040 ft in 2022 the NPS closed multiple Lake Mead launch ramps and Callville Bay relocated.", source: "https://www.nps.gov/lake/learn/news/" }],
    validated: V("kalshi:KXMEAD-26DEC-A1035", 0.46) },
  { id: "propane-mild-winter", industry: "propane-heating", keywords: ["propane", "heating oil", "delivery", "gallons", "winter"],
    title: "Mild early winter cuts heating-fuel gallons", problem: "Propane and heating-oil dealers sell by the gallon; a warm Q4 means fewer fills while trucks and staff are fixed.",
    causalStory: "Gallons sold track heating degree days; YES on 'Below N HDD' pays when the season is mild.",
    peril: "cold", marketQuery: HDD_WARM, side: "yes", correlation: "strong", lossShareOfDay: 0.5,
    basisRisk: "Cincinnati (CVG) only: strong for Ohio Valley dealers, partial for anyone else.",
    evidence: [{ claim: "Heating degree days are the standard driver of residential propane and heating-oil demand (EIA winter fuels outlook).", source: "https://www.eia.gov/outlooks/steo/special/winter/" }],
    validated: V("kalshi:KXHDDCVG-KCVG-01OCT26-31DEC26-T1250", 0.50) },
  { id: "hvac-mild-winter", industry: "hvac-plumbing", keywords: ["heating", "furnace", "no-heat", "service calls", "cincinnati"],
    title: "Mild early winter means fewer no-heat calls", problem: "Furnace repair demand comes from cold spells; a warm Q4 leaves techs idle.",
    causalStory: "Service-call volume tracks heating degree days; the Cincinnati HDD market pays in a mild Q4.",
    peril: "cold", marketQuery: HDD_WARM, side: "yes", correlation: "medium", lossShareOfDay: 0.3,
    basisRisk: "One city's degree days; only Ohio Valley shops get a tight fit.",
    naturalHedgeNote: "Cold snaps are your busy season: never buy cold cover.",
    evidence: [{ claim: "Heating degree days are the standard driver of heating demand (EIA).", source: "https://www.eia.gov/energyexplained/units-and-calculators/degree-days.php" }],
    validated: V("kalshi:KXHDDCVG-KCVG-01OCT26-31DEC26-T1250", 0.50) },
  { id: "vineyard-dry-winter", industry: "farm-nursery", keywords: ["vineyard", "winery", "grapes", "napa", "sonoma", "orchard"],
    title: "Dry winter in Napa", problem: "Winter rain refills soils and ponds; a dry season means bought water and lower yields next vintage.",
    causalStory: "Nov-Mar rainfall sets the season's soil moisture; NO on 'Above N inches' pays when the season comes in dry.",
    peril: "rain", marketQuery: NAPA_DRY, side: "no", correlation: "medium", lossShareOfDay: 0.5,
    basisRisk: "One gauge in Napa for the whole season; groundwater and reservoir allocations matter too.",
    evidence: [{ claim: "California's 2012-16 drought cost agriculture ~$2.7B in 2015 alone (UC Davis).", source: "https://watershed.ucdavis.edu/files/biblio/Final_Drought%20Report_08182015_Full_Report_WithAppendices.pdf" }],
    validated: V("kalshi:KXRAINNAPAM-01NOV26-31MAR27-T10", 0.23) },

  // ---- long horizon (season futures, year-end fuel, the year's rate high, funding deadlines); validated on .data/eval/markets-v3.json ----
  { id: "sports-playoff-run-miss", industry: "sports-bar-merch", keywords: ["playoff", "deep run", "postseason", "season", "watch part", "spurs", "texans", "cowboys", "rockets", "mavericks", "stars"],
    title: "Our team's season ends early (no playoff nights)", problem: "A playoff run is weeks of packed game nights; missing the playoffs or an early exit means a dead spring (or January).",
    causalStory: "Playoff home games and watch parties only happen while the team is alive; NO on the team's playoffs / conference-finals / wins future pays exactly when the run doesn't happen.",
    peril: "game", marketQuery: TEAM_SEASON, side: "no", correlation: "strong", lossShareOfDay: 3,
    basisRisk: "Pays on the team's result, not your nights: a run that ends on a road game, or a hot regular season, still moves revenue the market doesn't see.",
    naturalHedgeNote: "A deep run already pays you: never buy your own team's YES side for revenue cover.",
    evidence: [{ claim: "Womply data on ~42k bars: playoff excitement added almost 12% to bar revenue, depending on the game.", source: "https://sbj.net/stories/sports-bars-glory-in-blues-stanley-cup-run,64132" },
               { claim: "Indianapolis bar ran 4-5x normal sales during the Pacers' playoff run.", source: "https://frontofficesports.com/article/how-the-pacers-and-caitlin-clark-boosted-one-bars-bottom-line/" }],
    validated: V("kalshi:KXNBAWEST-27-SAS", 0.66, "2026-11-19T20:26:53Z") },
  { id: "fleet-diesel-month", industry: "delivery", keywords: ["diesel", "box truck", "fleet", "freight", "fixed-rate", "contracts", "reprice", "next year"],
    title: "Diesel stays high into year end", problem: "Fixed-rate contracts can't be repriced until next year; every month of high diesel comes out of margin.",
    causalStory: "Diesel at month end / year end (EIA) sets what the fleet pays through the contract term; YES above the strike pays when it stays high.",
    peril: "gas", marketQuery: DIESEL_LONG, side: "yes", correlation: "strong", lossShareOfDay: 0.25,
    basisRisk: "One print (the month-end / Dec 31 EIA average), not the fuel bought all month; your local spread to the US average can move.",
    evidence: [{ claim: "Fuel is ~20-25% of trucking operating cost per mile (ATRI 2024 operational costs).", source: "https://truckingresearch.org/2024/07/an-analysis-of-the-operational-costs-of-trucking-2024-update/" }],
    validated: V("kalshi:KXDIESELYE-26DEC31-T6.20", 0.17, "2026-11-19T20:26:53Z") },
  { id: "broker-rate-path", industry: "real-estate", keywords: ["mortgage", "rates", "refi", "refinanc", "broker", "loan officer"],
    title: "Mortgage rates spike before year end", problem: "Broker volume dies when the 30-year rate jumps; one Fed meeting is a narrow proxy for the whole rate path.",
    causalStory: "The year's highest 30-year rate (Freddie Mac PMMS) is the rate path itself; YES above the strike pays if rates spike before Dec 31.",
    peril: "fed", marketQuery: MORTGAGE_HIGH, side: "yes", correlation: "strong", lossShareOfDay: 2,
    basisRisk: "A weekly survey high, not your pipeline: a brief spike pays even if volume recovers within weeks.",
    evidence: [{ claim: "MBA: rising rates pushed borrowers out of refinance; total applications fell 5.3% in one October 2026 week.", source: "https://www.mortgagenewsdaily.com/news/10232026-mortgage-applications-mba" }],
    validated: V("kalshi:KXMORTGAGERATE-26DEC-T7.6", 0.16, "2026-11-19T20:26:53Z") },
  { id: "dc-shutdown", industry: "gov-contractor", keywords: ["federal", "government", "agency", "contract", "dc"],
    title: "Government shutdown stops federal work", problem: "A shutdown pauses federal contracts and invoices; staff still get paid.",
    causalStory: "A lapse in appropriations on the funding deadline stops work orders; YES on 'shutdown on <date>' pays when it happens.",
    peril: "other", marketQuery: SHUTDOWN, side: "yes", correlation: "strong", lossShareOfDay: 3,
    basisRisk: "Pays on the shutdown starting, not on how long it lasts; back pay may later cover part of the loss.",
    evidence: [{ claim: "CBO: the 2018-19 shutdown cost the economy ~$11B, $3B of it permanently lost.", source: "https://www.cbo.gov/publication/54937" }],
    validated: V("kalshi:KXGOVTSHUTDOWN-26DEC12", 0.3, "2026-11-19T20:26:53Z") },
];

// ---------- rejected (with reasons) ----------

export const REJECTED: RejectedIdea[] = [
  { id: "truck-propane-via-crude", industry: "food-truck", title: "Propane via WTI crude", status: "invalid",
    reason: "Wrong proxy: EIA shows propane decoupled from crude after 2011 and now tracks natural gas more (7x more propane comes from gas processing). Use natural gas instead." },
  { id: "farm-fertilizer-natgas", industry: "farm-nursery", title: "Fertilizer cost via natural gas", status: "invalid",
    reason: "Weak link + wrong timing: Texas A&M found gas explained only ~15% of the anhydrous ammonia run-up, and fertilizer is bought pre-plant (spring), not at a Nov 30 settle." },
  { id: "hvac-mild-season", industry: "hvac-plumbing", title: "Mild season = fewer HVAC calls", status: "invalid",
    reason: "Timing mismatch: demand depends on a whole season of extremes; daily-high contracts can't express 'no heat wave all summer'. Natural hedge note kept instead." },
  { id: "plumber-cold", industry: "hvac-plumbing", title: "Cold snap insurance for plumbers", status: "invalid",
    reason: "Natural hedge: freezes create burst-pipe emergency work. The plumber benefits; don't sell cold cover." },
  { id: "delivery-rain", industry: "delivery", title: "Rain cover for delivery businesses", status: "invalid",
    reason: "Natural hedge: rain raises delivery orders (BJ's: 'rain is good for delivery'). Wrong direction." },
  { id: "tourism-airfare-oil", industry: "tourism", title: "Oil spike -> airfares -> fewer fly-in tourists", status: "invalid",
    reason: "Too long a chain with a months-long lag; a Nov 30 crude settle says little about bookings this season." },
  { id: "gym-anything", industry: "gyms", title: "Gym membership churn", status: "invalid",
    reason: "No market with a one-sentence causal link: memberships are monthly contracts; bad weather if anything pushes people indoors." },
  { id: "apparel-warm-spell", industry: "retail-apparel", title: "Warm spell leaves winter stock on the rack", status: "not-live-now",
    reason: "Real problem (Planalytics: a warm Nov-Dec cost specialty apparel ~$421-500M, outerwear -10%), but on 2026-11-19 the Austin warm tail ('78°F or above') was offered at 1¢: venues list strikes around the forecast, so a warm-tail hedge only exists when a warm spell is in the forecast window.",
    retryWhen: "When the WXHIGH/KXHIGH warm tail in the owner's city trades between 2¢ and 85¢", marketQuery: WARM_HIGH },
  { id: "restaurant-kitchen-gas", industry: "bar-restaurant", title: "Natural gas spike lifts the kitchen energy bill", status: "not-live-now",
    reason: "Real exposure, but Gemini natural gas (the only NG market we index) showed indicative prices with EMPTY order books on 2026-11-19 (0 contracts at the ask on every strike; one 0.76-lot offer at $4). Not buyable insurance today.",
    retryWhen: "When Gemini NGAS books show depth >= 5 at the ask, or once Kalshi natural gas (KXNGASW) reopens and is indexed", marketQuery: NGAS_UP },
  { id: "truck-propane", industry: "food-truck", title: "Propane cost spike", status: "not-live-now",
    reason: "Real exposure, but Gemini natural gas (the only NG market we index) showed indicative prices with EMPTY order books on 2026-11-19 (0 contracts at the ask on every strike; one 0.76-lot offer at $4). Not buyable insurance today.",
    retryWhen: "When Gemini NGAS books show depth >= 5 at the ask, or once Kalshi natural gas (KXNGASW) reopens and is indexed", marketQuery: NGAS_UP },
  { id: "greenhouse-heating-gas", industry: "farm-nursery", title: "Natural gas spike raises greenhouse heating", status: "not-live-now",
    reason: "Real exposure, but Gemini natural gas (the only NG market we index) showed indicative prices with EMPTY order books on 2026-11-19 (0 contracts at the ask on every strike; one 0.76-lot offer at $4). Not buyable insurance today.",
    retryWhen: "When Gemini NGAS books show depth >= 5 at the ask, or once Kalshi natural gas (KXNGASW) reopens and is indexed", marketQuery: NGAS_UP },
  { id: "laundromat-gas", industry: "laundromat", title: "Natural gas spike hits dryer and water-heater bills", status: "not-live-now",
    reason: "Real exposure, but Gemini natural gas (the only NG market we index) showed indicative prices with EMPTY order books on 2026-11-19 (0 contracts at the ask on every strike; one 0.76-lot offer at $4). Not buyable insurance today.",
    retryWhen: "When Gemini NGAS books show depth >= 5 at the ask, or once Kalshi natural gas (KXNGASW) reopens and is indexed", marketQuery: NGAS_UP },
  { id: "restaurant-heat-november", industry: "bar-restaurant", title: "Extreme heat on the patio (>=98°F)", status: "not-live-now",
    reason: "Seasonal: no Austin daily-high contract near 95-100°F is listed in November.", retryWhen: "May-September, when WXHIGH/KXHIGHAUS list 95°F+ strikes",
    marketQuery: { ...WARM_HIGH, strike: { min: 95 } } },
  { id: "construction-heat-stoppage", industry: "construction", title: "Heat stoppage days for outdoor crews (>=100°F)", status: "not-live-now",
    reason: "Seasonal: no 100°F strikes in November. Evidence is strong (construction ~60% of heat-lost labor hours; Lancet Countdown).", retryWhen: "June-September",
    marketQuery: { ...WARM_HIGH, strike: { min: 99 } } },
  { id: "pool-cool-summer", industry: "pool-services", title: "Cool summer cuts pool openings/service", status: "not-live-now",
    reason: "Seasonal (pools closing in November) and daily markets only cover single days.", retryWhen: "May-August, using daily-high cold tail on weekends" },
  { id: "nursery-hard-freeze", industry: "farm-nursery", title: "Hard freeze kills nursery stock (<=32°F low)", status: "not-live-now",
    reason: "Kalshi lists Austin daily LOW strikes only around the forecast (44°F or below today); no freeze strike is quoted until a front is forecast. Uri cost Texas ag >$600M.",
    retryWhen: "When a front is forecast and KXLOWTAUS lists <=32°F strikes",
    marketQuery: { venues: ["kalshi"], perils: ["cold"], series: ["KXLOWTAUS"], location: "profile-city", hurtWhen: "below", strike: { max: 33 }, maxDays: 7, describe: "Kalshi Austin daily low, YES on 'X° or below' with X <= 33" } },
  { id: "fed-hike-december", industry: "borrower", title: "Fed hike in December", status: "invalid",
    reason: "Price: 'Hike 25bps' in Dec is 92¢ (> 85¢) - it's nearly certain, so it's not insurance. Use Jan/Mar meetings or the 'Hike >25bps' tail." },
  { id: "restaurant-ground-beef", industry: "bar-restaurant", title: "Ground beef hits $7+ (Polymarket)", status: "invalid",
    reason: "Read-only venue and YES ask 86¢ (> 85¢)." },
  { id: "bakery-eggs", industry: "coffee-shop", title: "Egg prices spike for bakeries", status: "future-source",
    reason: "Only Polymarket 'Dozen eggs price in November' (read-only, month nearly over). Kalshi KXEGGS (monthly egg CPI) is live but not indexed.",
    retryWhen: "Index Kalshi KXEGGS / KXEGGPRICEM (peril cpi)" },
  { id: "coffee-bean-price", industry: "coffee-shop", title: "Coffee bean price spike", status: "future-source",
    reason: "Kalshi KXCOFFEEM/KXCOFFEEH exist but have no open markets today; Gemini has no coffee." , retryWhen: "When Kalshi reopens coffee monthly markets" },
  { id: "tourism-tsa", industry: "tourism", title: "Weak travel week (TSA throughput)", status: "future-source",
    reason: "Kalshi KXTSAW (weekly TSA screenings) is live but not indexed; a direct demand proxy for airport-area hotels and rentals.", retryWhen: "Index KXTSAW" },
  { id: "realestate-home-sales", industry: "real-estate", title: "Weak new-home sales print", status: "future-source",
    reason: "Kalshi KXNHSALES (new home sales, ~12k volume) is live but not indexed; a closer proxy than the Fed for agents.", retryWhen: "Index KXNHSALES" },
  { id: "restaurant-fastfood-traffic", industry: "bar-restaurant", title: "Restaurant traffic index (McDonald's foot traffic / fast-food spend)", status: "future-source",
    reason: "Kalshi KXMCDFT / KXFASTARRAY are live but thin; industry-wide demand proxies.", retryWhen: "Index if depth improves" },
];

// Hedgehog parametric cover ideas (flood, air quality, hail, wildfire) + honest market proxies: ./parametric.ts
import { PARAMETRIC_INDUSTRIES, PARAMETRIC_PLAYBOOK, PARAMETRIC_REJECTED } from "./parametric";
INDUSTRIES.push(...PARAMETRIC_INDUSTRIES);
PLAYBOOK.push(...PARAMETRIC_PLAYBOOK);
REJECTED.push(...PARAMETRIC_REJECTED);
