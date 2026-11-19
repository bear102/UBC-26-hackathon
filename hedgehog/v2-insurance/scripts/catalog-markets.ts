// Regenerates lib/markets/catalog.json: a catalog of market TYPES (series / families, not contracts)
// listed on Gemini Predictions, Kalshi and Polymarket, each tagged with small-business hedge relevance.
//
// Run:   npx tsx scripts/catalog-markets.ts [--refresh] [--cache DIR] [--out lib/markets/catalog.json]
// Read-only public APIs, no keys, no orders. Raw responses are cached in --cache (default
// $CATALOG_CACHE or <os tmp>/hedgehog-catalog); pass --refresh to re-download.
// Business relevance comes from the hand-curated RULES table below (regex over series ticker + title);
// edit RULES to re-score, then re-run (no network needed when the cache is warm).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const arg = (k: string, d: string) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const REFRESH = args.includes("--refresh");
const CACHE = arg("--cache", process.env.CATALOG_CACHE || join(tmpdir(), "hedgehog-catalog"));
const OUT = arg("--out", "lib/markets/catalog.json");
const GEMINI = "https://api.gemini.com/v1/prediction-markets";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const POLY = "https://gamma-api.polymarket.com";

// ---------------------------------------------------------------- HTTP (polite: serial, 429 backoff)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string): Promise<T> {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "hedgehog-catalog/0.1" }, signal: AbortSignal.timeout(30_000) }).catch((e) => e as Error);
    if (r instanceof Error) { await sleep(1000 * 2 ** i); continue; }
    if (r.status === 429 || r.status >= 500) { const ra = Number(r.headers.get("retry-after")); await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** i); continue; }
    if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
    return (await r.json()) as T;
  }
  throw new Error(`GET ${url} failed after retries`);
}
async function cachedFile<T>(name: string, f: () => Promise<T>): Promise<T> {
  const p = join(CACHE, name);
  if (!REFRESH && existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as T;
  console.error(`fetching ${name} ...`);
  const v = await f();
  writeFileSync(p, JSON.stringify(v));
  return v;
}

// ---------------------------------------------------------------- raw shapes (trimmed)

interface GContract { label: string; ticker: string; source?: string; strike?: { type?: string; value?: string }; prices?: { bestBid?: string | null; bestAsk?: string | null } }
interface GEvent { title: string; ticker: string; category: string; series?: string | null; subcategory?: unknown; tags?: string[]; status: string; startTime?: string | null; expiryDate?: string; volume?: string; contracts: GContract[] }
interface KSeries { ticker: string; title: string; category: string; tags?: string[] | null; frequency: string; settlement_sources?: { name: string; url?: string }[] | null }
interface KMarket { ticker: string; yes_sub_title?: string; yes_bid_dollars?: string; yes_ask_dollars?: string; volume_fp?: string; volume_24h_fp?: string; open_interest_fp?: string; close_time?: string; strike_type?: string; floor_strike?: number; cap_strike?: number }
interface KEvent { event_ticker: string; series_ticker: string; title: string; sub_title?: string; category?: string; markets?: KMarket[] }
interface PTag { id: string; label: string; slug: string }
interface PMarket { question?: string; outcomePrices?: string; volumeNum?: number; liquidityNum?: number; endDate?: string }
interface PEvent { id: string; slug: string; title: string; endDate?: string; startDate?: string; volume?: number; liquidity?: number; volume24hr?: number; resolutionSource?: string; tags?: PTag[]; series?: { slug?: string; title?: string; recurrence?: string }[] | null; markets?: PMarket[] }

async function fetchGemini(status: "active" | "settled"): Promise<GEvent[]> {
  // The unfiltered listing is truncated (~1000), so page each category separately (settled: newest 1000 per category).
  const { categories } = await getJson<{ categories: string[] }>(`${GEMINI}/categories`);
  const seen = new Map<string, GEvent>();
  for (const cat of categories) for (const e of await fetchGeminiCat(status, cat)) seen.set(e.ticker, e);
  return [...seen.values()];
}
async function fetchGeminiCat(status: string, cat: string): Promise<GEvent[]> {
  const out: GEvent[] = [];
  for (let off = 0; off < 3000; off += 100) {
    const r = await getJson<{ data: GEvent[]; pagination?: { total?: number } }>(`${GEMINI}/events?status=${status}&category=${encodeURIComponent(cat)}&limit=100&offset=${off}`);
    out.push(...r.data.map((e) => ({ title: e.title, ticker: e.ticker, category: e.category, series: e.series, subcategory: e.subcategory, tags: e.tags, status: e.status, startTime: e.startTime, expiryDate: e.expiryDate, volume: e.volume,
      contracts: e.contracts.map((c) => ({ label: c.label, ticker: c.ticker, source: c.source, strike: c.strike, prices: { bestBid: c.prices?.bestBid, bestAsk: c.prices?.bestAsk } })) })));
    if (r.data.length < 100 || (r.pagination?.total !== undefined && off + 100 >= r.pagination.total)) break;
    await sleep(150);
  }
  return out;
}
async function fetchKalshiEvents(): Promise<KEvent[]> {
  const out: KEvent[] = [];
  let cursor = "";
  for (let page = 0; page < 400; page++) {
    const r = await getJson<{ events: KEvent[]; cursor?: string }>(`${KALSHI}/events?status=open&limit=200&with_nested_markets=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...r.events.map((e) => ({ event_ticker: e.event_ticker, series_ticker: e.series_ticker, title: e.title, sub_title: e.sub_title, category: e.category,
      markets: (e.markets ?? []).map((m) => ({ ticker: m.ticker, yes_sub_title: m.yes_sub_title, yes_bid_dollars: m.yes_bid_dollars, yes_ask_dollars: m.yes_ask_dollars, volume_fp: m.volume_fp, volume_24h_fp: m.volume_24h_fp, open_interest_fp: m.open_interest_fp, close_time: m.close_time, strike_type: m.strike_type, floor_strike: m.floor_strike, cap_strike: m.cap_strike })) })));
    cursor = r.cursor ?? "";
    if (!cursor || !r.events.length) break;
    await sleep(120);
  }
  return out;
}
async function fetchPolyEvents(): Promise<PEvent[]> {
  // Gamma caps offset paging at ~2000; the keyset endpoint walks all ~19k open events.
  const out: PEvent[] = [];
  let cursor = "";
  for (let page = 0; page < 400; page++) {
    const r = await getJson<{ events: PEvent[]; next_cursor?: string }>(`${POLY}/events/keyset?active=true&closed=false&limit=100${cursor ? `&after_cursor=${encodeURIComponent(cursor)}` : ""}`);
    out.push(...r.events.map((e) => ({ id: e.id, slug: e.slug, title: e.title, endDate: e.endDate, startDate: e.startDate, volume: Number(e.volume ?? 0), liquidity: Number(e.liquidity ?? 0), volume24hr: Number(e.volume24hr ?? 0), resolutionSource: e.resolutionSource,
      tags: (e.tags ?? []).map((t) => ({ id: t.id, label: t.label, slug: t.slug })), series: (e.series ?? []).map((s) => ({ slug: s.slug, title: s.title, recurrence: s.recurrence })),
      markets: (e.markets ?? []).slice(0, 3).map((m) => ({ question: m.question, outcomePrices: m.outcomePrices, volumeNum: m.volumeNum, liquidityNum: m.liquidityNum, endDate: m.endDate })) })));
    cursor = r.next_cursor ?? "";
    if (!cursor || !r.events.length) break;
    await sleep(150);
  }
  return out;
}

export async function fetchAll() {
  mkdirSync(CACHE, { recursive: true });
  const gActive = await cachedFile("gemini-active.json", () => fetchGemini("active"));
  const gSettled = await cachedFile("gemini-settled.json", () => fetchGemini("settled"));
  const kSeries = await cachedFile("kalshi-series.json", async () => (await getJson<{ series: KSeries[] }>(`${KALSHI}/series`)).series.map((s) => ({ ticker: s.ticker, title: s.title, category: s.category, tags: s.tags, frequency: s.frequency, settlement_sources: (s.settlement_sources ?? []).map((x) => ({ name: x.name })) })));
  const kEvents = await cachedFile("kalshi-events-open.json", fetchKalshiEvents);
  const pEvents = await cachedFile("poly-events-open.json", fetchPolyEvents);
  return { gActive, gSettled, kSeries, kEvents, pEvents };
}


// ---------------------------------------------------------------- business-relevance themes (first match wins)

type Rel = "high" | "medium" | "low" | "none";
interface Theme {
  id: string; label: string; peril: string; relevance: Rel; kind: "direct" | "proxy" | "none"; geo: string;
  businesses: string; story: string; re?: RegExp; ids?: RegExp; cats?: RegExp; detail?: boolean;
}
const SPORTS = /^sports$/i;
const T = (t: Omit<Theme, "detail"> & { detail?: boolean }): Theme => ({ ...t, detail: t.detail ?? (t.relevance === "high" || t.relevance === "medium") });
// `ids` = case-sensitive test on the series id / ticker / slug; `re` = case-insensitive test on title, tags and id.
export const THEMES: Theme[] = [
  // ---- sports (category-gated so "Super Bowl ads" etc. don't land here)
  T({ id: "sports_game_us", label: "US team game winner (moneyline)", peril: "game", relevance: "high", kind: "direct", geo: "city (team)", cats: SPORTS,
    ids: /^(KX)?(NBA|NFL|NCAAF|NCAAMB|NCAAWB|NHL|MLB|MLS|WNBA|NWSL|AHL|USL|NCAAH|NCAAFBOWL)GAME$|^(NBA|NFL|NCAAF|NCAAM|NCAAW|NHL|MLB|MLS|WNBA)-games-moneyline$|^(nba|nfl|cfb|nhl|mlb|mls|wnba|ahl|nwsl)-20\d\d$|^ncaa-cbb$|^cwbb$|^uslc$/,
    businesses: "sports bars, restaurants/bars near arenas & campuses, team-merch shops, parking lots, pedicabs/rideshare drivers, promo-running retailers",
    story: "Direct: a home loss (or a game that doesn't happen) cuts post-game crowds and celebration spending; a shop running a 'free X if we win' promo is short the win. Buy the side that pays when revenue is bad (opponent wins) or the side that funds the promo." }),
  T({ id: "sports_futures", label: "Season futures: wins, playoffs, titles, awards", peril: "game", relevance: "medium", kind: "proxy", geo: "city (team)", cats: SPORTS, detail: false,
    ids: /WINS|PLAYOFF|CHAMP|DIVISION|CONF|MVP|SEED|ROY|COY|POY|HEISMAN|^KXSB$|FINALS|WORLDSERIES|STANLEY|MARMAD|TOURN|QUALIF|BESTRECORD|CITYCHAMPS|COACH|DRAFT|^(AFC|NFC|CFB)/,
    re: /\bwins\b|playoff|champion|division winner|conference|\bMVP\b|\bseed\b|Heisman|Super Bowl|\bFinals\b|World Series|Stanley Cup|March Madness|qualif|best (regular season )?record|coach|draft|of the year/i,
    businesses: "stadium-district bars/restaurants/hotels (extra home playoff dates), merch shops, local TV/radio ad sellers, promo-running brands ('free tacos if the Spurs make the playoffs')",
    story: "Proxy: deep playoff runs add home dates and foot traffic; missing the playoffs removes them. Also funds season-long promos with a known worst case." }),
  T({ id: "sports_props", label: "Game lines & props (totals, spreads, quarters, players)", peril: "game", relevance: "low", kind: "proxy", geo: "city (team)", cats: SPORTS,
    ids: /-games-(lines|props)$|TOTAL|SPREAD|1H|2H|1Q|2Q|3Q|4Q|PLAYER|PTS|REB|AST|TD|PASS|RUSH|REC|GOAL|SCORE|PROP|BTTS|CORNER|FIRST|HR|KS$|HIT/,
    re: /points|spread|total|player|props?\b|touchdown|goals?\b|corners|first to|anytime/i,
    businesses: "bars/restaurants funding score-based promos ('half-price wings if 30+ points')",
    story: "Promo funding only: a totals/score line pays when the promo is triggered. Not a revenue-loss hedge." }),
  T({ id: "sports_other", label: "Other sports (intl soccer, tennis, golf, MMA, esports, cricket, motorsport)", peril: "game", relevance: "low", kind: "proxy", geo: "global", cats: SPORTS,
    re: /./, businesses: "ex-pat/soccer pubs (EPL, Liga MX, UCL nights), golf-tournament host towns, fight-night bars",
    story: "Mostly irrelevant; a Liga MX or Premier League pub can treat its team's match like a local game." }),
  // ---- weather
  T({ id: "ski_season", label: "Ski resort opening dates & resort snowfall", peril: "snow", relevance: "high", kind: "direct", geo: "resort town",
    re: /winter season|Mountain Opening|Resort Opening|Resort Closing|Mountain Closing|Ski (Area|Resort)|skier visits|snowfall total by|Big Sky|Aspen|Snowbird|Steamboat|Mt\. Bachelor|Jackson Hole|Stowe|Stratton|Heavenly|Northstar|Sierra-at-Tahoe|Alyeska|Deer Valley|Sugarbush|Snowbasin|Beaver Creek|Keystone|Mammoth|Park City|Big Bear|Bald Mountain|Killington|Breckenridge|Winter Park|Whistler|Copper Mountain|\bAlta\b/i,
    businesses: "ski/snowboard rental & tune shops, ski-town restaurants, bars, lodging, ski schools, shuttle operators",
    story: "Direct: a late opening or thin early-season snowfall wipes out the Thanksgiving-Christmas peak. Buy 'opens after <date>' or 'snowfall below X'." }),
  T({ id: "snow_city", label: "City snowfall (monthly totals, snow-day counts, white Christmas)", peril: "snow", relevance: "high", kind: "direct", geo: "city",
    ids: /SNOW(?!FLAKE)|SNO[A-Z]?$/, re: /\bsnow(fall|storms?|days?)?\b(?![- ]kpi)|white christmas/i,
    businesses: "restaurants & retail (snow-day closures), daycare, delivery/couriers, salons, gyms; plow/snow-removal contractors and hardware stores (hedge the opposite: a snowless winter)",
    story: "Direct: heavy snow closes storefronts and kills foot traffic; plow operators lose contract income in a dry winter. Monthly 'snow above X in' markets settle on NWS station totals." }),
  T({ id: "hurricane", label: "Hurricanes & named storms (counts, landfall by city/state)", peril: "hurricane", relevance: "high", kind: "direct", geo: "coastal region / city",
    ids: /^(KX)?HUR|TROPSTOR|NAMEDSTORM/, re: /hurricane|tropical storm|named storm|cyclone/i,
    businesses: "coastal restaurants, hotels & short-term rentals, marinas, charter fishing, beach retail, event venues in FL/TX/LA/Carolinas/Gulf",
    story: "Direct: a landfall near you means evacuation, closures and cancelled bookings. City/state landfall markets ('hurricane hits Tampa/Texas coast') are the closest thing to parametric storm cover." }),
  T({ id: "temp_high_daily", label: "Daily high temperature by city", peril: "heat", relevance: "high", kind: "direct", geo: "city",
    ids: /^(KX)?HIGH(T|NY|CHI|MIA|LAX|AUS|DEN|PHIL|US|NYD|TEMP)|HIG$|^WXHIGH|DVHIG|MAXTEMP|CITIESWEATHER/, re: /highest temperature|daily high|max(imum)? (daily )?temp|high temp|daily-weather|highest-temperature|Death Valley/i,
    businesses: "patio bars & restaurants, food trucks, outdoor markets/events, ice-cream & shaved-ice stands (hedge cool days), landscapers & roofers (lost heat days), golf courses",
    story: "Direct: extreme heat (or an unseasonably cold day for cold-treat sellers) cuts outdoor traffic. Binary 'high >= X' settles on the NWS station reading for that day." }),
  T({ id: "temp_low_daily", label: "Daily low temperature / freeze by city", peril: "cold", relevance: "high", kind: "direct", geo: "city",
    ids: /LOWT|YEARLO|MONTHLOW|^(KX)?LOW(NYC|CHI|MIA|LAX|AUS|DEN|PHIL)$/, re: /lowest temperature|low temp|minimum temp|freeze|lowest-temperature|annual low/i,
    businesses: "plant nurseries & farms (frost), outdoor dining, food trucks, car washes, event rentals; plumbers/HVAC benefit (hedge mild winters)",
    story: "Direct: a hard freeze kills nursery stock and empties patios. 'Low <= 32F' is a parametric frost cover." }),
  T({ id: "temp_period", label: "Weekly/monthly average temperature, degree days", peril: "heat", relevance: "medium", kind: "direct", geo: "city",
    ids: /AVGT|HEATA|WEEKHT|^KXHDD|^KXCDD|HMONTH|TEMPMON|MICHTEMP|HOLIDAYT|TEMP(NYC|LA|CHI)|TXURI/, re: /average (weekly |monthly )?temp|weekly high|degree days|hottest month|monthly (minimum|low) temp|temperature (increase|average)|hourly directional/i,
    businesses: "HVAC contractors, utilities-cost-heavy shops (bakeries, laundromats, greenhouses), seasonal apparel retailers, propane/heating-oil dealers",
    story: "Direct: a warm winter (few heating degree days) hurts heating-fuel dealers and coat sellers; a hot month raises cooling bills. Settles on a period average, so it hedges a season not a day." }),
  T({ id: "rain_period", label: "Monthly / multi-day rainfall totals by city", peril: "rain", relevance: "high", kind: "direct", geo: "city",
    ids: /RAIN[A-Z]*M$|RAINS(LAX|NYC|BOS)|RAINGTF|PRECPERIOD|RAINNAPAM|monthly-precipitation/, re: /rainfall|rainstorm|precipitation|how much will it rain|rain in .* in (January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i,
    businesses: "landscapers, painters, roofers & builders (lost workdays), golf courses, outdoor venues, car washes; farms/vineyards (drought side: hedge too little rain)",
    story: "Direct: a wet month means rained-out workdays and empty patios; a dry one hurts growers. 'Rain above X inches in <month>' settles on the NWS/Weather Company station total." }),
  T({ id: "rain_daily", label: "Daily / weekend / holiday rain by city", peril: "rain", relevance: "high", kind: "direct", geo: "city",
    ids: /^(KX)?RAIN/, re: /\brain\b|\brains\b/i,
    businesses: "patio bars, outdoor events & weddings, food trucks, farmers markets, amusement parks, bike/kayak rentals, car washes",
    story: "Direct: rain on your one big day (Saturday market, festival, Thanksgiving) is the classic parametric event cover." }),
  T({ id: "severe_storm", label: "Tornado counts, natural-disaster declarations", peril: "storm", relevance: "medium", kind: "direct", geo: "city / national",
    ids: /TORNADO|^(KX)?EMERGENCY(?!.*(ELECTION|NATL|FRANCE))[A-Z]{2,5}$|^(KX)?FEMA|HEATWARNING/, re: /tornado|natural disaster|heat warning|\bhail\b/i,
    businesses: "Plains/Southeast retailers & farms, mobile-home parks, outdoor venues; roofers & restoration firms benefit",
    story: "Direct (city 'natural disaster hits X' markets) or proxy (national tornado counts) for storm-driven closures." }),
  T({ id: "quake_volcano", label: "Earthquakes, volcanoes, tsunami", peril: "quake", relevance: "medium", kind: "direct", geo: "region",
    ids: /QUAKE|^(KX)?TSUNAMI|ERUPT|VEI\d|KILAUEA|ETNA|SPURR/, re: /earthquake|volcan|eruption/i,
    businesses: "California/Pacific NW/Hawaii businesses with uninsured interruption risk, Big Island tourism (Kilauea)",
    story: "Direct but low-probability/catastrophic: a cheap YES on 'M8+ in California' is a tail hedge for business interruption." }),
  T({ id: "water_drought", label: "Water levels & drought (Lake Mead/Powell, Mississippi)", peril: "drought", relevance: "medium", kind: "proxy", geo: "region",
    ids: /^(KX)?MEAD|CORIVER|DROUGHT|GROUNDWATER/, re: /Lake Mead|Lake Powell|drought|Mississippi (river )?level|lowest Mississippi|groundwater|water level/i,
    businesses: "Lake Mead/Powell marinas & boat rentals, Mississippi barge/grain shippers, farms, golf courses facing watering limits",
    story: "Proxy: low water shuts boat ramps and raises barge freight; drought means irrigation cuts." }),
  T({ id: "air_quality", label: "Air quality (AQI)", peril: "smoke", relevance: "high", kind: "direct", geo: "city",
    ids: /AQI/, re: /\bAQI\b|air quality|wildfire smoke/i,
    businesses: "outdoor dining, tour operators, youth sports camps, gyms with outdoor classes",
    story: "Direct: smoke days (AQI > 150) cancel outdoor activity. Kalshi has listed city AQI markets (KXAQICITY); none open right now." }),
  T({ id: "climate_macro", label: "Climate & ENSO (El Niño, hottest year, sea ice, CO2)", peril: "other", relevance: "low", kind: "proxy", geo: "global",
    ids: /RONI|ELNINO|LANINA|GTEMP|HOTYEAR|WARMING|ARCTIC|ARTIC|CO2|CLIMATE|ECLIPSE|FLARE|METEOR/, re: /El Ni|La Ni|hottest year|hottest years|global warming|sea ice|\bCO2\b|climate goal|eclipse|solar flare|meteor/i,
    businesses: "seasonal planners (El Niño = wetter Gulf/South winter, warmer North)",
    story: "Weak seasonal proxy; mostly not a business hedge." }),
  // ---- energy, food, inputs
  T({ id: "natural_gas", label: "Natural gas price", peril: "natgas", relevance: "medium", kind: "direct", geo: "national",
    ids: /NGAS|NATGAS|natgas|MARCELLUS|PAGAS/, re: /natural gas/i,
    businesses: "restaurants & bakeries (gas ranges/ovens), greenhouses, laundromats & dry cleaners, heating-cost-heavy shops",
    story: "Direct cost proxy for gas utility bills (Henry Hub feeds retail tariffs with a lag)." }),
  T({ id: "gasoline", label: "Retail gasoline price (AAA national & state)", peril: "gas", relevance: "high", kind: "direct", geo: "national / state",
    ids: /AAAGAS|^GAS[A-Z]*$|TRUFGAS|GASTAX|USGASCPI/, re: /\bgas prices?\b|gasoline|gas tax|\bgas hit\b/i,
    businesses: "delivery & courier services, rideshare/taxi drivers, food trucks, landscapers, mobile groomers, plumbers/HVAC/electrician fleets, lawn care",
    story: "Direct cost hedge: YES on 'AAA average above $X' pays when fuel costs spike. State markets exist for TX, CA, FL, NY, NJ." }),
  T({ id: "diesel", label: "Diesel price", peril: "diesel", relevance: "high", kind: "direct", geo: "national",
    ids: /DIESEL/, re: /diesel/i,
    businesses: "truckers & freight brokers, farms, construction contractors, moving companies, food distributors, fishing boats",
    story: "Direct cost hedge on the fuel that runs commercial vehicles; settles on EIA/AAA diesel averages." }),
  T({ id: "electricity", label: "Electricity price / grid stress (ERCOT, PJM, MISO, CPI electricity)", peril: "power", relevance: "high", kind: "direct", geo: "grid region / state",
    ids: /ERCOT|PJM|MISO|POWERKWH|RESPOWER|UTILITY|CPIELEC|ILNUCLEAR/, re: /electricity|power price|kWh|peak (electricity )?demand|capacity emergency|electric (price|bill)/i,
    businesses: "restaurants & bars (refrigeration, kitchens), laundromats, ice makers, cold storage, small manufacturers, crypto/AI micro-datacenters, greenhouses",
    story: "Direct: real-time power price or grid-emergency spikes (Texas summer) drive bills; ERCOT peak demand is also a heat proxy." }),
  T({ id: "crude_oil", label: "Crude oil (WTI, Brent) & oil chokepoints", peril: "oil", relevance: "medium", kind: "proxy", geo: "global",
    ids: /WTI|BRENT|OILRIGS|^KXBARRELS$|TXOIL|NDKOIL|OKOIL|AKCRUDE|HORMUZ|wti-|crude/, re: /\bWTI\b|\bBrent\b|crude|oil price|Hormuz|Bab el-Mandeb|OPEC|oil rigs|oil production|oil tanker|refinery|Kharg/i,
    businesses: "anything fuel- or plastics-heavy: delivery fleets, airlines-exposed travel agencies, plastics/packaging buyers",
    story: "Proxy: crude leads gasoline/diesel by ~2 weeks; Hormuz/Red Sea markets are tail hedges for an oil shock." }),
  T({ id: "food_prices", label: "Food & grocery prices (eggs, beef, wings, coffee, FAO index, menu prices)", peril: "food", relevance: "high", kind: "direct", geo: "national",
    ids: /EGGS?$|EGGPRICE|^KXEGG|TRUFEGG|BEEF|CHICKEN|FAOFPI|GROCERYCPI|COFFEE|COCOA|SUGAR|TRUFBFST|CHICKSAND|CHIPBURRITO|WHEAT|HOTDOG|McMUFF|MCDS/, re: /\beggs?\b|beef|chicken|chicken wings?|wing prices?|FAO Food|food price|grocery (prices|inflation)|coffee|cocoa|sugar\b|breakfast commodity|McMuffin|burrito|sandwich|hot ?dog|wheat/i,
    businesses: "restaurants, bakeries, cafes, diners, wing bars, food trucks, caterers, grocery/convenience stores",
    story: "Direct input-cost hedge: YES on 'egg/beef/wing price above X' pays when the menu margin gets squeezed." }),
  T({ id: "ag_production", label: "Farm & fishery output (corn yield, milk, cattle, lobster, maple, cotton)", peril: "ag", relevance: "medium", kind: "direct", geo: "state",
    ids: /CORN|SOY|CATTLE|MILK|MAPLE|LOBSTER|QUAHOG|SALMON|CATFISH|BROILER|COTTON|FERT|ETHANOL|FARMLAND|SCREWWORM|BOURBON|HARVEST|COF$|TACONITE|WASDE/, re: /\bcorn\b|soybean|cattle|milk production|maple|lobster|quahog|salmon|catfish|broiler|cotton|crop yield|fertilizer|ethanol|farmland|bourbon|timber/i,
    businesses: "farms & ranches, co-ops, farm-supply stores, seafood restaurants/markets (lobster, salmon), maple producers, distilleries",
    story: "Direct for producers (low yield/landings), proxy for buyers (scarcity = higher input prices)." }),
  T({ id: "metals_materials", label: "Metals & materials (gold, silver, copper, aluminum, lumber, paper)", peril: "materials", relevance: "medium", kind: "direct", geo: "global",
    ids: /GOLD|SILVER|COPPER|^XAU|^XAG|ALMWP|LUMBER|PAPER|APTROT|gold-|silver-/, re: /\bgold\b(?! medal)|\bsilver\b|copper|aluminum|lumber|paper price|tungsten|steel/i,
    businesses: "jewelers (gold/silver), electricians & HVAC (copper), craft brewers/canners (aluminum premium), builders (lumber), print shops (paper index)",
    story: "Direct input-cost hedge: YES on 'gold above X' offsets a jeweler's restocking cost; 'aluminum Midwest premium above X' offsets can costs." }),
  T({ id: "freight_trade_flows", label: "Shipping & ports (container volume, freight index)", peril: "freight", relevance: "medium", kind: "proxy", geo: "port / global",
    ids: /TEU|SCFI|PORTLA/, re: /container volume|containerized|port of|freight|shipping|Panama Canal|Suez/i,
    businesses: "importers, e-commerce sellers, furniture/appliance retailers, customs brokers, port-adjacent trucking",
    story: "Proxy: freight-rate spikes raise landed cost; port volume falls signal slower local logistics work." }),
  // ---- policy
  T({ id: "tariffs_trade", label: "Tariffs & trade deals", peril: "tariff", relevance: "high", kind: "direct", geo: "national / country pair",
    ids: /TARIFF|TRADEDEAL|TRADEDEFICIT|^KX232|CIT301|USDEAL|IMPORTS/, re: /tariff|trade deal|trade deficit|Section 232|Section 301|de minimis|USMCA|imports from|duty rate/i,
    businesses: "importers & retailers of imported goods (apparel, electronics, furniture), auto-repair (parts), craft brewers (aluminum), restaurants buying imported produce/wine, Canadian/Mexican cross-border shops",
    story: "Direct: YES on 'US tariff rate on China/Canada above X' pays exactly when landed costs jump." }),
  T({ id: "min_wage_labor", label: "Minimum wage & labor rules", peril: "wage", relevance: "high", kind: "direct", geo: "city / state",
    ids: /MINWAGE|WAGE/, re: /minimum wage|overtime rule|\bwages?\b/i,
    businesses: "restaurants, retail, childcare, cleaning services, home-care agencies (wage-heavy cost base)",
    story: "Direct: 'state/city raises minimum wage to X' resolves YES when payroll costs rise." }),
  T({ id: "shutdown_fiscal", label: "Government shutdown & federal funding", peril: "shutdown", relevance: "high", kind: "direct", geo: "national (DC area, gov towns)",
    ids: /SHUT|DCEIL|GOVTFUND|DHSFUND|FEDEMPLOYEES|GOVTCUTS|GOVTSPEND/, re: /shutdown|shut down|debt ceiling|government funding|be funded|federal employees|government spending/i,
    businesses: "businesses near federal workforces (DC, military bases), national-park gateway towns, government contractors, SBA-loan applicants",
    story: "Direct: a shutdown halts federal paychecks, closes parks, freezes SBA lending. 'Shutdown by <date>' / 'shutdown length > X days' pay exactly then." }),
  T({ id: "cannabis", label: "Cannabis legalization & banking", peril: "regulation", relevance: "high", kind: "direct", geo: "state / national",
    ids: /MARIJUANA|CANNABIS|280E|SAFEBANK|WEED/, re: /marijuana|cannabis|\bweed\b|280E|SAFE Banking|psilocybin|\bhemp\b|\bTHC\b/i,
    businesses: "dispensaries, hemp/THC-drink shops, grow suppliers, smoke shops",
    story: "Direct: rescheduling/280E relief changes the tax bill; a state legalization creates competition (hedge with YES) or opportunity." }),
  T({ id: "tax_policy", label: "Tax policy (tips, gas tax, property & corporate tax, IRS)", peril: "tax", relevance: "medium", kind: "direct", geo: "national / city",
    ids: /(?<!ROBO)TAX|^KXIRS|IRSCOLLECT|SSCOLA/, re: /\btax(es)?\b|\bIRS\b|cost-of-living adjustment|stimulus|tariff dividend|\$\d,?\d{3} dividend/i,
    businesses: "restaurants (tip taxation), landlords (property tax), fuel retailers (gas tax holiday), NYC businesses (Mamdani tax plans)",
    story: "Direct where a tax change hits the P&L; stimulus/tariff-dividend checks are a demand proxy for retail." }),
  T({ id: "regulation_local", label: "Local/state rules & ordinances (rent freeze, bans, moratoria, permits)", peril: "regulation", relevance: "medium", kind: "direct", geo: "city / state",
    ids: /^KXNYC|MAMDANI|MORATORIUM/, re: /Mamdani|rent (freeze|control)|moratorium|\bban(s|ned)?\b|ordinance|legaliz|zoning|data center|congestion pricing|sports betting|sanctuary|raw milk|municipal grocery/i,
    businesses: "landlords & property managers (rent freeze), NYC retailers, businesses in states debating data-center/sports-betting/raw-milk rules",
    story: "Direct: buy YES on the rule that would hurt you (e.g. 'rent freeze enacted')." }),
  T({ id: "immigration", label: "Immigration enforcement & visas", peril: "labor", relevance: "medium", kind: "proxy", geo: "national / city",
    ids: /DEPORT|IMMIGR|^KXICE|^KXH1B|VISA/, re: /deport|immigra|\bICE\b|\bvisas?\b|H-1B|border crossing|asylum|green card/,
    businesses: "construction, agriculture, landscaping, restaurants & hotels relying on immigrant labor",
    story: "Proxy for labor-supply shocks." }),
  // ---- macro & demand
  T({ id: "mortgage_rates", label: "Mortgage rates & Treasury yields", peril: "rates", relevance: "high", kind: "direct", geo: "national",
    ids: /MORT|FM30YMTG|UST\d|^KXFRM|^FRM|YRDIR|NOTE10Y/, re: /mortgage|treasury yield|10-year|30-year (treasury|yield)|5-year treasury/i,
    businesses: "realtors, mortgage brokers, home builders & remodelers, movers, title companies, furniture & home-improvement stores",
    story: "Direct demand hedge: transactions dry up when the 30-yr rate rises; YES on 'rate above X' pays when deal flow falls." }),
  T({ id: "fed_rates", label: "Fed / central-bank rate decisions", peril: "fed", relevance: "medium", kind: "direct", geo: "national",
    ids: /FEDDECISION|^KXFED$|^KXFED(HIKE|CUT|MEET|COMBO|FUNDSYEAR|CHGCOUNT|END|DISSENT)|^FED(\d|$|JAN|MAR|APR)|EFFR|RATECUT|RATEHIKE|LARGECUT|EMERCUTS|ZERORATE|FOMC|CBDECISION|^KXCBD|CANCUTS|CANOREOY|CREDITC|BALANCESHEET|fomc|fed-|bank-of|reserve-bank|ecb-|central-bank/, re: /fed decision|fed funds|rate cut|rate hike|\bFOMC\b|emergency (rate|meeting)|central bank|Bank of (Canada|England|Japan|Korea|Israel|Mexico)|\bECB\b|\bSOFR\b|Fed rate/i,
    businesses: "any business with a variable-rate loan, SBA 7(a) loan or line of credit; equipment lessors",
    story: "Direct: SBA 7(a) loans float on Prime (Fed funds + 3%); YES on 'no cut'/'hike' offsets higher interest." }),
  T({ id: "housing", label: "Housing (permits, starts, home prices, rents, home sales)", peril: "housing", relevance: "high", kind: "direct", geo: "national / state / city",
    ids: /PERMITS|HPI|HOMEPRICE|HOUSTART|EHSALES|NHSALES|ASKRENT|RENTS|CONDO|HOME$|TRUFHOU/, re: /housing units|home prices?|house price|housing starts|building permits|asking rent|\brents?\b|home sales|condo price|housing inflation/i,
    businesses: "contractors & trades, realtors, landlords, building-supply yards, interior designers, cleaners/movers",
    story: "Direct: fewer permits/sales = fewer jobs for trades; state-level permit markets (CA, CO, VT, CT) map to local builders." }),
  T({ id: "travel_tourism", label: "Travel & tourism (TSA throughput, airport passengers, visitors, hotels, cruises, parks)", peril: "travel", relevance: "high", kind: "proxy", geo: "national / state / city",
    ids: /TSA|ORDPAX|PASSENGERS|VISITS$|VISITORS?|VISITORCOUNT|^KXNVVISIT$|HOTEL|CANUSTRIPS|FLIGHT|ORDDLY|SUBWAY|NJONTIME|^KX(UAL|AAL|LUV|ALK|CCL)A?$/, re: /\bTSA\b|airport|passengers|\bvisitors\b(?! to the)|visitor (arrivals|volume|spending)|hotel|cruise|national park|recreation visits|load factor|seats flown|trips to the U\.?S|ridership|on-time performance/i,
    businesses: "hotels/B&Bs, tour operators, souvenir shops, airport shuttles & parking, restaurants in tourist districts (Orlando, Las Vegas, Hawaii, Florida, national-park gateways)",
    story: "Proxy with local resolution: 'Florida/Nevada/Hawaii visitors below X', 'Orlando hotel demand up?', 'Canadian trips to US down 20%' track exactly the crowds a tourist-town shop sells to." }),
  T({ id: "consumer_spend", label: "Consumer spend & traffic (card spend, foot traffic, POS, retail sales, sentiment)", peril: "demand", relevance: "high", kind: "proxy", geo: "national (by brand/sector)",
    ids: /CC$|CCD$|(?<!LE)FTD?$|(?<!INX|NASDAQ100|CAC40|FTSE|NIFTY|KOSPI|DAX|NIKKEI)POS$|APP$|ARRAY$|ADS$|TTS$|RETAIL|UMICH|CYBERMON|CONSUMER|TRUFCCI/, re: /credit card spend|foot traffic|point of sale|app downloads|ad spend|TikTok Shop|retail sales|consumer (sentiment|confidence)|Cyber Monday|holiday season|Black Friday/i,
    businesses: "restaurants (Chick-fil-A/Olive Garden/Chipotle/LongHorn spend), coffee shops (coffee-chain traffic array), discount & sporting-goods retail (Dollar General, Academy, Dick's), beauty (Sephora), energy-drink/soda distributors",
    story: "Sector proxy: Carbon Arc card-spend / foot-traffic markets on big chains move with the same local demand a small competitor sees. Buy 'below X' to hedge a sector slowdown." }),
  T({ id: "jobs_labor", label: "Jobs, unemployment, jobless claims, state/industry employment", peril: "jobs", relevance: "medium", kind: "proxy", geo: "national / state / industry",
    ids: /U3|UNEMP|JOBLESS|CLAIMS|PAYROLL|EMP$|JOBS$|LAYOFF|LFP|^KXUE$|YOUTHUN/, re: /unemploy|jobless|payrolls?|jobs (added|numbers)|employment|layoffs?|labor force/i,
    businesses: "discretionary retail & restaurants (demand), staffing agencies, businesses in one-industry towns (aerospace in WA, autos in MI, semis in AZ/OR)",
    story: "Proxy: rising local unemployment cuts discretionary spend; state-industry employment markets track company-town demand." }),
  T({ id: "gdp_recession", label: "GDP & recession", peril: "recession", relevance: "medium", kind: "proxy", geo: "national / global",
    ids: /GDP|RECESS|NBER|ECONPATH|USLEI|NFPROD|PSAVERT|BANKRUPTCY|DEFAULT|CREDITRATING/, re: /\bGDP\b|recession|economic boom|state of the economy|Leading Economic|productivity|saving rate|go bankrupt|credit rating/i,
    businesses: "discretionary businesses: restaurants, salons, gyms, boutiques, travel agencies, event planners",
    story: "Proxy tail hedge: 'recession in 2027' pays in the scenario where discretionary revenue falls." }),
  T({ id: "cpi_inflation", label: "Inflation (CPI, PCE, Truflation, category CPIs)", peril: "cpi", relevance: "medium", kind: "proxy", geo: "national",
    ids: /CPI|^KXPCE|PCECORE|TRUF|PPI$|^KXPPI|INFL/, re: /\bCPI\b|inflation|\bPCE\b|Truflation/i,
    businesses: "fixed-price sellers (contractors with bids, subscription businesses), restaurants (menu pricing lag)",
    story: "Proxy: high inflation squeezes fixed-price margins. Category CPIs (used cars, electricity, groceries) are tighter." }),
  T({ id: "fx", label: "FX & dollar index", peril: "fx", relevance: "medium", kind: "direct", geo: "country pair",
    ids: /^KXUSD|DXY|USDX|EURUSD|USDJPY|GBPUSD|USDCAD|USDMXN/, re: /USD\/|dollar index|\bDXY\b|peso|\byen\b|exchange rate|de-dollar/i,
    businesses: "importers/exporters, border-town retailers (Canadian/Mexican shoppers), tourism businesses reliant on foreign visitors",
    story: "Direct: a strong dollar keeps foreign tourists home and cheapens imports." }),
  T({ id: "equity_index", label: "Equity indices (S&P 500, Nasdaq) & largest company", peril: "markets", relevance: "low", kind: "proxy", geo: "national",
    ids: /^KXINX|NASDAQ|^SPX|^NDX|NDQ|CIRCUIT|^KXDOW/, re: /S&P|Nasdaq|\bDow\b|stock market|circuit ?breaker|largest company|\bVIX\b/i,
    businesses: "luxury retail, wealth-sensitive services (boat dealers, high-end restaurants) via the wealth effect",
    story: "Weak proxy for affluent-customer spending." }),
  T({ id: "health_outbreak", label: "Disease outbreaks (measles, H5N1, pandemics, dengue, screwworm)", peril: "health", relevance: "medium", kind: "proxy", geo: "national / state",
    ids: /MEASLES|OUTBREAK|H5N1|EBOLA|DENGUE|POLIO|MPOX|PLAGUE|CYCLO|TBCOUNT|COVID|VACCINE|HANTA/, re: /measles|\bflu\b|covid|pandemic|outbreak|H5N1|bird flu|ebola|dengue|West Nile|hantavirus|polio|mpox|plague|vaccine/i,
    businesses: "event venues & tour operators (pandemic), poultry farms & egg buyers (H5N1), Florida tourism (dengue), daycare",
    story: "Proxy: outbreaks trigger closures or supply shocks (bird flu -> egg prices)." }),
  T({ id: "gpu_ai_costs", label: "GPU rental & AI token prices", peril: "compute", relevance: "medium", kind: "direct", geo: "global",
    ids: /^KX(RTX|B200|H100|H200|A100)|^GPU_|^TOKEN_|OPUS4|GPT55|GBT55|GEMINI35|rental-price/, re: /GPU|H100|H200|B200|token price|compute index|rental price/i,
    businesses: "small AI/SaaS startups, render farms, agencies reselling AI services",
    story: "Direct cost hedge on compute: YES on 'H100 hourly above $X' pays when inference costs rise." }),
  T({ id: "box_office_media", label: "Box office, film slate, streaming & music charts", peril: "media", relevance: "medium", kind: "proxy", geo: "national",
    ids: /SLATECOUNT|BOXOFFICE|box-office|opening-weekend|movie-delay|^KXRT|^RT[A-Z]|^KXMC|NETFLIX|SPOTIFY|BBCHART|^KX1(SONG|ALBUM)|^KX10SONG|TOPSONG|TOPALBUM|TOPARTIST|YTVIEWS|rotten-tomatoes|first-week-album/, re: /box office|opening (weekend|week)|domestic gross|highest grossing|wide (film )?release|Rotten Tomatoes|Metacritic|Netflix|Spotify|Billboard|streams|viewership/i,
    businesses: "independent movie theaters (opening weekend, wide-release count), cinema-adjacent restaurants, record stores/music venues",
    story: "Proxy: a weak tentpole opening or a thin release slate means empty seats and concessions." }),
  T({ id: "live_events", label: "Concerts, tours, festivals, Broadway, halftime", peril: "events", relevance: "medium", kind: "proxy", geo: "city",
    ids: /TOUR|COACHELLA|BWAY|SETLIST|PERFORMSUPERBOWL|ROLEAT/, re: /concert|\btour\b|festival|Coachella|headline|halftime|Broadway|attendance|setlist|\bresidency\b/i,
    businesses: "venues, hotels/bars/restaurants near festivals & theaters, merch printers",
    story: "Proxy: 'Broadway attendance', 'Coachella headliner', 'tour cancellations' track local event-driven traffic." }),
  T({ id: "company_kpi", label: "Company KPIs, IPOs, M&A, CEOs", peril: "other", relevance: "low", kind: "proxy", geo: "national",
    ids: /^KX[A-Z]{2,6}A$|KPI|IPO|CEO|ACQ|MERGE/, re: /\bKPI\b|deliveries|\bIPO\b|\bCEO\b|acquir|merger|earnings|subscribers|restaurant count|same.?restaurant|comparable sales|take a stake|net worth|trillionaire|billionaire/i,
    businesses: "suppliers/franchisees of the named company (e.g. a Chipotle or Starbucks franchise neighbour, Boeing supplier)",
    story: "Mostly speculation; some chain KPIs (Chipotle store count, Wendy's same-store sales) are sector proxies." }),
  T({ id: "crypto", label: "Crypto prices", peril: "crypto", relevance: "low", kind: "proxy", geo: "global",
    ids: /BTC|ETH|SOL|XRP|DOGE|HYPE|ZEC|BNB|bitcoin|ethereum|solana|up-or-down|crypto/, re: /bitcoin|ether(eum)?\b|solana|\bcrypto|stablecoin|\bUSDT\b|\bBTC\b|\bETH\b|\bXRP\b/i,
    businesses: "merchants holding crypto receipts or treasury",
    story: "Hedge crypto treasury drawdowns; otherwise not a business risk." }),
  T({ id: "elections_politics", label: "Elections, appointments & politics", peril: "other", relevance: "low", kind: "proxy", geo: "national / state / global",
    re: /elect|winner|nominee|primary|\bseats?\b|senate|\bhouse\b|governor|president|mayor|\bparty\b|speaker|cabinet|confirm|resign|impeach|approval|\bvote|SCOTUS|Supreme Court|Trump|attorney general|secretary|minister|congress|bill\b|\blaw\b/i,
    businesses: "regulated businesses whose rules depend on who wins (cannabis, gaming, energy), government contractors",
    story: "Indirect: elections change regulation; specific policy markets above are tighter hedges." }),
  T({ id: "geopolitics", label: "Geopolitics & conflict", peril: "other", relevance: "low", kind: "proxy", geo: "global",
    re: /\bwar\b|ceasefire|invade|invasion|military|strike|Iran|Russia|Ukraine|China|Taiwan|Israel|Gaza|NATO|nuclear|Houthi|Venezuela|Cuba|Greenland|sanction/i,
    businesses: "importers exposed to specific countries",
    story: "Mostly not a small-business hedge; oil-chokepoint markets are covered under crude_oil." }),
  T({ id: "mentions_culture", label: "Mentions, awards, celebrity & novelty", peril: "other", relevance: "none", kind: "none", geo: "n/a",
    re: /./, businesses: "-", story: "Not a business risk." }),
];
const themeById = new Map(THEMES.map((t) => [t.id, t]));
export function classify(id: string, title: string, category: string, extra = ""): Theme {
  if (/^mentions$/i.test(category)) return themeById.get("mentions_culture")!;
  for (const t of THEMES) {
    if (t.cats && !t.cats.test(category)) continue;
    if (!t.cats && SPORTS.test(category)) continue; // sports-category series only match sports themes
    if (t.ids?.test(id) || (t.re && (t.re.test(title) || t.re.test(extra) || (/[a-z]/.test(id) && t.re.test(id))))) return t; // re on slugs only, not tickers
  }
  return themeById.get("mentions_culture")!;
}

// ---------------------------------------------------------------- what Hedgehog indexes today (read from source, no imports)

function indexedToday() {
  const read = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };
  const kalshi = new Set([...read("lib/markets/dflow.ts").matchAll(/series:\s*"([A-Z0-9]+)"/g)].map((m) => m[1]));
  const polyTags = new Set([...read("lib/markets/polymarket.ts").matchAll(/tagId:\s*(\d+)/g)].map((m) => m[1]));
  return { kalshi, polyTags };
}

// ---------------------------------------------------------------- catalog records

type Indexed = "yes" | "partial" | "read-only" | "no";
export interface MarketType {
  id?: string; venue: "gemini" | "kalshi" | "polymarket"; category: string; theme: string; relevance: Rel;
  series: string; title: string; frequency: string; geography?: string; locations?: string[];
  settlement?: string; example?: { event: string; contract?: string; label?: string; url?: string };
  live: { events: number; contracts: number; settled?: number }; volumeUsd?: number; volume24hUsd?: number; openInterest?: number;
  medianYesAsk?: number; strikes?: string[]; nextExpiry?: string; indexed: Indexed;
  members?: number; memberSeries?: string[];
}

const CAP: Record<Rel, number> = { high: 12, medium: 6, low: 0, none: 0 }; // detailed records per (venue, theme); the rest roll up
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const median = (xs: number[]) => { if (!xs.length) return undefined; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 100) / 100; };
const round = (x: number) => Math.round(x);
const uniq = <T,>(xs: T[]) => [...new Set(xs)];
function locFromTitle(t: string): string | undefined {
  const m = t.match(/\b(?:in|at)\s+((?:[A-Z][\w.'’-]*\s?){1,4}?)(?:\s+(?:on|in|this|for|during|by|from|get|be|at|today|tomorrow)\b|\s*[?,(]|\s*$)/);
  const x = m?.[1]?.trim();
  if (!x || /^(The|US|U\.S\.|America|United States|Q\d|January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d)\b/.test(x)) return undefined;
  return x;
}
function cadence(dates: (string | undefined | null)[]): string {
  const ts = uniq(dates.filter(Boolean).map((d) => Date.parse(d as string)).filter(Number.isFinite)).sort((a, b) => a - b);
  if (ts.length < 2) return "one_off";
  const gaps = ts.slice(1).map((t, i) => t - ts[i]); const g = median(gaps)! / 3600_000;
  return g <= 0.1 ? "5min" : g <= 0.3 ? "15min" : g <= 1.5 ? "hourly" : g <= 30 ? "daily" : g <= 24 * 9 ? "weekly" : g <= 24 * 40 ? "monthly" : "periodic";
}
const daysUntil = (iso?: string) => (iso ? Math.round((Date.parse(iso) - Date.now()) / 864e5) : undefined);

interface Rollup { venue: MarketType["venue"]; theme: Theme; category: Set<string>; series: { id: string; title: string; vol: number; live: number }[]; events: number; contracts: number; vol: number; indexed: Set<Indexed> }

function build(d: Awaited<ReturnType<typeof fetchAll>>) {
  const idx = indexedToday();
  const types: MarketType[] = [];
  const rollups = new Map<string, Rollup>();
  const addRoll = (venue: MarketType["venue"], th: Theme, cat: string, s: { id: string; title: string; vol: number; live: number }, events: number, contracts: number, ix: Indexed) => {
    const k = `${venue}:${th.id}`;
    const r = rollups.get(k) ?? { venue, theme: th, category: new Set(), series: [], events: 0, contracts: 0, vol: 0, indexed: new Set() };
    r.category.add(cat); r.series.push(s); r.events += events; r.contracts += contracts; r.vol += s.vol; r.indexed.add(ix); rollups.set(k, r);
  };
  const detailed = new Map<string, MarketType[]>();
  const push = (t: MarketType, th: Theme) => {
    // compact: geography lives on the theme unless it adds locations; trim long strings
    if (t.settlement) t.settlement = t.settlement.slice(0, 80);
    if (t.nextExpiry) t.nextExpiry = t.nextExpiry.slice(0, 10);
    if (t.strikes) t.strikes = t.strikes.slice(0, 3).map((x) => x.slice(0, 32));
    if (t.example?.label && t.strikes?.length) delete t.example.label;
    delete t.openInterest; delete t.volume24hUsd; delete (t as Partial<MarketType>).id; // venue + series is the key
    const k = `${t.venue}:${th.id}`; (detailed.get(k) ?? detailed.set(k, []).get(k)!).push(t);
  };

  // ---- Kalshi: one type per series
  const agg = new Map<string, { ev: KEvent[]; mk: number; vol: number; v24: number; oi: number; asks: number[]; strikes: string[]; locs: string[]; next?: string }>();
  for (const e of d.kEvents) {
    const a = agg.get(e.series_ticker) ?? { ev: [], mk: 0, vol: 0, v24: 0, oi: 0, asks: [], strikes: [], locs: [] };
    a.ev.push(e);
    for (const m of e.markets ?? []) {
      a.mk++; a.vol += num(m.volume_fp); a.v24 += num(m.volume_24h_fp); a.oi += num(m.open_interest_fp);
      const ask = num(m.yes_ask_dollars); if (ask > 0.02 && ask < 0.98) a.asks.push(ask);
      if (m.yes_sub_title && a.strikes.length < 6 && !a.strikes.includes(m.yes_sub_title)) a.strikes.push(m.yes_sub_title);
      if (m.yes_sub_title && a.locs.length < 60 && !a.locs.includes(m.yes_sub_title)) a.locs.push(m.yes_sub_title);
      if (m.close_time && (!a.next || m.close_time < a.next)) a.next = m.close_time;
    }
    agg.set(e.series_ticker, a);
  }
  const kCounts: Record<string, { series: number; liveSeries: number; events: number; contracts: number; volumeUsd: number }> = {};
  for (const s of d.kSeries) {
    const a = agg.get(s.ticker);
    const c = (kCounts[s.category] ??= { series: 0, liveSeries: 0, events: 0, contracts: 0, volumeUsd: 0 });
    c.series++; if (a) { c.liveSeries++; c.events += a.ev.length; c.contracts += a.mk; c.volumeUsd += a.vol; }
    const th = classify(s.ticker, s.title, s.category, a?.ev[0]?.title ?? "");
    const recurring = /daily|weekly|monthly|hourly|annual|quarterly|fifteen_min|custom/.test(s.frequency);
    if (!a && !(recurring && th.relevance === "high")) continue; // dead one-offs (and dormant non-high series): counted only
    const ix: Indexed = idx.kalshi.has(s.ticker) ? "yes" : "no";
    const ev0 = a?.ev[0]; const mk0 = ev0?.markets?.[0];
    if (!th.detail || !a) { addRoll("kalshi", th, s.category, { id: s.ticker, title: s.title, vol: round(a?.vol ?? 0), live: a?.ev.length ?? 0 }, a?.ev.length ?? 0, a?.mk ?? 0, ix); continue; }
    const multiCity = /where will it|cities|by city/i.test(`${s.title} ${ev0?.title ?? ""}`);
    push({
      id: `kalshi:${s.ticker}`, venue: "kalshi", category: s.category, theme: th.id, relevance: th.relevance, series: s.ticker,
      title: (ev0?.title ?? s.title).slice(0, 110), frequency: s.frequency,
      locations: multiCity && a ? a.locs.slice(0, 50) : (locFromTitle(ev0?.title ?? s.title) ? [locFromTitle(ev0?.title ?? s.title)!] : undefined),
      settlement: (s.settlement_sources ?? []).map((x) => x.name?.trim()).filter(Boolean).slice(0, 2).join("; ") || undefined,
      example: ev0 ? { event: ev0.event_ticker, contract: mk0?.ticker, label: mk0?.yes_sub_title } : undefined,
      live: { events: a?.ev.length ?? 0, contracts: a?.mk ?? 0 }, volumeUsd: a ? round(a.vol) : undefined, volume24hUsd: a ? round(a.v24) : undefined, openInterest: a ? round(a.oi) : undefined,
      medianYesAsk: median(a?.asks ?? []), strikes: multiCity ? undefined : a?.strikes.slice(0, 4), nextExpiry: a?.next, indexed: ix,
    }, th);
  }

  // ---- Gemini: group events into series (sports games split by line type)
  const gGroups = new Map<string, { cat: string; events: GEvent[]; active: number; settled: number }>();
  const gKey = (e: GEvent) => {
    const g = e.ticker.match(/^([A-Z0-9]+)-\d{10}-.*?-([A-Z0-9]+)$/);
    if (e.category === "Sports" && g) return `${g[1]}-games-${g[2] === "M" ? "moneyline" : /^(T|S|REGT|REGS|1QT|1QS|2QT|2QS|3QT|3QS|4QT|4QS|1HT|1HS|2HT|2HS)$/.test(g[2]) ? "lines" : "props"}`;
    if (e.category === "Sports") return e.ticker.replace(/\d+/g, "").replace(/(ARI|ATL|BAL|BUF|CAR|CHI|CIN|CLE|DAL|DEN|DET|GB|HOU|IND|JAC|KC|LAC|LAR|LV|MIA|MIN|NE|NO|NYG|NYJ|PHI|PIT|SEA|SF|TB|TEN|WAS)WINS$/, "TEAMWINS").replace(/-.*$/, "");
    return (typeof e.series === "string" && e.series) || e.ticker.replace(/[\d_].*$/, "") || e.ticker;
  };
  for (const [list, st] of [[d.gActive, "active"], [d.gSettled, "settled"]] as const) for (const e of list) {
    const k = gKey(e); const g = gGroups.get(k) ?? { cat: e.category, events: [], active: 0, settled: 0 };
    g.events.push(e); if (st === "active") g.active++; else g.settled++; gGroups.set(k, g);
  }
  const gCounts: Record<string, { types: number; liveTypes: number; activeEvents: number; settledEvents: number; volumeUsd: number }> = {};
  for (const [k, g] of gGroups) {
    const act = g.events.filter((e) => e.status !== "settled" && e.status !== "resolved" && g.active).slice(0, g.active);
    const vol = g.events.reduce((s, e) => s + num(e.volume), 0);
    const c = (gCounts[g.cat] ??= { types: 0, liveTypes: 0, activeEvents: 0, settledEvents: 0, volumeUsd: 0 });
    c.types++; if (g.active) c.liveTypes++; c.activeEvents += g.active; c.settledEvents += g.settled; c.volumeUsd += vol;
    const e0 = act[0] ?? g.events[0];
    const th = classify(k, e0.title, g.cat);
    const ix: Indexed = g.cat === "Weather" || g.cat === "Crypto" ? "yes" : g.cat === "Sports" ? (k.endsWith("-moneyline") ? "yes" : "no") : g.cat === "Commodities" ? (/WTI|BRENT/.test(k) ? "yes" : "partial") : "no";
    const contracts = act.reduce((s, e) => s + e.contracts.length, 0);
    if (!th.detail) { addRoll("gemini", th, g.cat, { id: k, title: e0.title, vol: round(vol), live: g.active }, g.active, contracts, ix); continue; }
    const asks = act.flatMap((e) => e.contracts.map((c) => num(c.prices?.bestAsk))).filter((x) => x > 0.02 && x < 0.98);
    const locs = uniq(g.events.map((e) => locFromTitle(e.title)).filter((x): x is string => !!x));
    const c0 = e0.contracts[0];
    push({
      id: `gemini:${k}`, venue: "gemini", category: g.cat, theme: th.id, relevance: th.relevance, series: k, title: e0.title,
      frequency: cadence(g.events.map((e) => e.expiryDate)), locations: locs.length ? locs.slice(0, 80) : undefined,
      settlement: uniq(g.events.flatMap((e) => e.contracts.map((c) => c.source)).filter((x): x is string => !!x)).slice(0, 2).join("; ") || (g.cat === "Weather" ? "NWS station (per contract rules)" : undefined),
      example: { event: e0.ticker, contract: c0 ? `GEMI-${e0.ticker}-${c0.ticker}` : undefined, label: c0?.label },
      live: { events: g.active, contracts, settled: g.settled }, volumeUsd: round(vol), medianYesAsk: median(asks),
      strikes: e0.contracts.slice(0, 4).map((c) => c.label), nextExpiry: act.map((e) => e.expiryDate).filter(Boolean).sort()[0], indexed: ix,
    }, th);
  }

  // ---- Polymarket: group by series slug, else by theme
  const PRIMARY = ["Sports", "Crypto", "Weather", "Economy", "Finance", "Business", "Tech", "Science", "Movies", "Culture", "Geopolitics", "Politics", "Elections", "World"];
  const pCat = (e: PEvent) => { const labels = e.tags?.map((t) => t.label) ?? []; return PRIMARY.find((p) => labels.includes(p)) ?? labels[0] ?? "Other"; };
  const pCounts: Record<string, { events: number; volumeUsd: number; series: number }> = {};
  const pGroups = new Map<string, { cat: string; th: Theme; events: PEvent[]; series?: { slug?: string; title?: string; recurrence?: string } }>();
  const seenSeries = new Set<string>();
  for (const e of d.pEvents) {
    const cat = pCat(e); const c = (pCounts[cat] ??= { events: 0, volumeUsd: 0, series: 0 }); c.events++; c.volumeUsd += num(e.volume);
    const s = e.series?.[0];
    if (s?.slug && !seenSeries.has(`${cat}:${s.slug}`)) { seenSeries.add(`${cat}:${s.slug}`); c.series++; }
    const th = classify(s?.slug ?? e.slug, `${s?.title ?? ""} ${e.title}`, cat);
    const k = s?.slug ? `series:${s.slug}` : `theme:${th.id}:${cat}`;
    const g = pGroups.get(k) ?? { cat, th, events: [], series: s }; g.events.push(e); pGroups.set(k, g);
  }
  for (const [k, g] of pGroups) {
    const th = g.th; const vol = g.events.reduce((s, e) => s + num(e.volume), 0);
    const ix: Indexed = g.events.some((e) => e.tags?.some((t) => idx.polyTags.has(String(t.id)))) ? "read-only" : "no";
    const top = [...g.events].sort((a, b) => num(b.volume) - num(a.volume));
    const contracts = g.events.reduce((s, e) => s + (e.markets?.length ?? 0), 0);
    const id = g.series?.slug ?? k;
    if (!th.detail) { addRoll("polymarket", th, g.cat, { id, title: top[0].title, vol: round(vol), live: g.events.length }, g.events.length, contracts, ix); continue; }
    const e0 = top[0];
    const prices = top.flatMap((e) => (e.markets ?? []).map((m) => { try { return num(JSON.parse(m.outcomePrices ?? "[]")[0]); } catch { return 0; } })).filter((x) => x > 0.02 && x < 0.98);
    push({
      id: `polymarket:${id}`, venue: "polymarket", category: g.cat, theme: th.id, relevance: th.relevance, series: id,
      title: g.series?.slug ? (g.series.title || e0.title) : top.slice(0, 4).map((e) => e.title).join(" | ").slice(0, 160),
      frequency: g.series?.recurrence ?? (g.series?.slug ? cadence(g.events.map((e) => e.endDate)) : "one_off (mixed)"),
      locations: ((l) => (l.length ? l.slice(0, 30) : undefined))(uniq(g.events.map((e) => locFromTitle(e.title)).filter((x): x is string => !!x))),
      settlement: e0.resolutionSource || undefined, example: { event: e0.slug, label: e0.markets?.[0]?.question },
      live: { events: g.events.length, contracts }, volumeUsd: round(vol), volume24hUsd: round(g.events.reduce((s, e) => s + num(e.volume24hr), 0)),
      medianYesAsk: median(prices), nextExpiry: g.events.map((e) => e.endDate).filter(Boolean).sort()[0], indexed: ix,
    }, th);
  }

  // ---- cap detailed records per (venue, theme); overflow joins the rollup
  for (const [k, list] of detailed) {
    list.sort((a, b) => (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0) || b.live.events - a.live.events);
    const cap = CAP[list[0].relevance];
    types.push(...list.slice(0, cap));
    for (const t of list.slice(cap)) addRoll(t.venue, themeById.get(t.theme)!, t.category, { id: t.series, title: t.title, vol: t.volumeUsd ?? 0, live: t.live.events }, t.live.events, t.live.contracts, t.indexed);
    void k;
  }
  for (const r of rollups.values()) {
    const s = r.series.sort((a, b) => b.vol - a.vol || b.live - a.live);
    types.push({
      venue: r.venue, category: [...r.category].slice(0, 6).join(", "), theme: r.theme.id, relevance: r.theme.relevance,
      series: `family:${r.theme.id}`, title: `${r.theme.label} — e.g. ${s.slice(0, 3).map((x) => x.title).join(" | ")}`.slice(0, 300),
      frequency: "mixed", live: { events: r.events, contracts: r.contracts }, volumeUsd: round(r.vol),
      indexed: r.indexed.size === 1 ? [...r.indexed][0] : r.indexed.has("no") ? "partial" : [...r.indexed][0],
      members: s.length, memberSeries: s.slice(0, { high: 80, medium: 60, low: 15, none: 8 }[r.theme.relevance]).map((x) => x.id),
    });
  }

  // ---- theme summary + cross-venue map
  const themes = THEMES.map((t) => {
    const ts = types.filter((x) => x.theme === t.id);
    const venues: Record<string, { types: number; liveEvents: number; volumeUsd: number; indexed: Indexed[] }> = {};
    for (const x of ts) {
      const v = (venues[x.venue] ??= { types: 0, liveEvents: 0, volumeUsd: 0, indexed: [] });
      v.types += x.members ?? 1; v.liveEvents += x.live.events; v.volumeUsd += x.volumeUsd ?? 0; if (!v.indexed.includes(x.indexed)) v.indexed.push(x.indexed);
    }
    return { id: t.id, label: t.label, suggestedPeril: t.peril, relevance: t.relevance, kind: t.kind, geography: t.geo, businesses: t.businesses, story: t.story, venues };
  });
  const relOrder: Record<Rel, number> = { high: 0, medium: 1, low: 2, none: 3 };
  types.sort((a, b) => relOrder[a.relevance] - relOrder[b.relevance] || a.theme.localeCompare(b.theme) || (b.volumeUsd ?? 0) - (a.volumeUsd ?? 0));
  return {
    generatedAt: new Date().toISOString(),
    sources: { gemini: `${GEMINI}/events (per category, active + settled)`, kalshi: `${KALSHI}/series + /events?status=open&with_nested_markets=true`, polymarket: `${POLY}/events/keyset?active=true&closed=false` },
    notes: "Market TYPES, not contracts. volumeUsd = lifetime traded volume summed over currently listed events (Gemini: incl. recently settled). medianYesAsk = median YES ask over contracts priced 2-98c. indexed = whether Hedgehog's lib/markets pulls it today ('read-only' = Polymarket context lines).",
    counts: { gemini: gCounts, kalshi: kCounts, polymarket: pCounts },
    themes, types,
  };
}

async function main() {
  const d = await fetchAll();
  const cat = build(d);
  const json = JSON.stringify(cat);
  writeFileSync(OUT, json + "\n");
  process.stdout.on("error", () => process.exit(0));
  console.log(`wrote ${OUT}: ${cat.types.length} types, ${(json.length / 1024).toFixed(0)} KB`);
  for (const t of cat.themes) {
    const v = Object.entries(t.venues).map(([k, x]) => `${k}:${x.types}t/${x.liveEvents}ev/$${(x.volumeUsd / 1e3).toFixed(0)}k/${x.indexed.join("|")}`).join("  ");
    console.log(`${t.relevance.padEnd(6)} ${t.id.padEnd(22)} ${v}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
