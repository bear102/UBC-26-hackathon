// Team → home city, so the /markets city filter can show a city's games ("Cleveland" → Cavaliers, Browns, Guardians…).
// Venues name teams three ways: ticker abbreviations (CLE, LAC, SAS), city labels ("Cleveland", "Los Angeles C"),
// and nicknames ("Cavaliers"). Abbreviations are league-scoped (LAC = Clippers in NBA, Chargers in NFL).
import type { MarketContract } from "../types";
import { gameInfo } from "./compare";

const ABBR: Record<string, Record<string, string>> = {
  NBA: {
    ATL: "Atlanta", BOS: "Boston", BKN: "New York City", BRK: "New York City", CHA: "Charlotte", CHO: "Charlotte", CHI: "Chicago",
    CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit", GSW: "San Francisco", GS: "San Francisco", HOU: "Houston",
    IND: "Indianapolis", LAC: "Los Angeles", LAL: "Los Angeles", MEM: "Memphis", MIA: "Miami", MIL: "Milwaukee",
    MIN: "Minneapolis", NOP: "New Orleans", NO: "New Orleans", NYK: "New York City", NY: "New York City", OKC: "Oklahoma City",
    ORL: "Orlando", PHI: "Philadelphia", PHX: "Phoenix", PHO: "Phoenix", POR: "Portland", SAC: "Sacramento", SAS: "San Antonio",
    SA: "San Antonio", TOR: "Toronto", UTA: "Salt Lake City", UTAH: "Salt Lake City", WAS: "Washington DC", WSH: "Washington DC",
  },
  NFL: {
    ARI: "Phoenix", ATL: "Atlanta", BAL: "Baltimore", BUF: "Buffalo", CAR: "Charlotte", CHI: "Chicago", CIN: "Cincinnati",
    CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit", GB: "Green Bay", HOU: "Houston", IND: "Indianapolis",
    JAX: "Jacksonville", JAC: "Jacksonville", KC: "Kansas City", LV: "Las Vegas", LAC: "Los Angeles", LAR: "Los Angeles",
    LA: "Los Angeles", MIA: "Miami", MIN: "Minneapolis", NE: "Boston", NO: "New Orleans", NYG: "New York City",
    NYJ: "New York City", PHI: "Philadelphia", PIT: "Pittsburgh", SF: "San Francisco", SEA: "Seattle", TB: "Tampa",
    TEN: "Nashville", WAS: "Washington DC", WSH: "Washington DC",
  },
  NHL: {
    ANA: "Anaheim", BOS: "Boston", BUF: "Buffalo", CGY: "Calgary", CAR: "Raleigh", CHI: "Chicago", COL: "Denver",
    CBJ: "Columbus", DAL: "Dallas", DET: "Detroit", EDM: "Edmonton", FLA: "Miami", LAK: "Los Angeles", LA: "Los Angeles",
    MIN: "Minneapolis", MTL: "Montreal", NSH: "Nashville", NJD: "Newark", NJ: "Newark", NYI: "New York City",
    NYR: "New York City", OTT: "Ottawa", PHI: "Philadelphia", PIT: "Pittsburgh", SJS: "San Jose", SJ: "San Jose",
    SEA: "Seattle", STL: "St. Louis", TBL: "Tampa", TB: "Tampa", TOR: "Toronto", UTA: "Salt Lake City", VAN: "Vancouver",
    VGK: "Las Vegas", WSH: "Washington DC", WPG: "Winnipeg",
  },
  MLB: {
    ARI: "Phoenix", ATL: "Atlanta", BAL: "Baltimore", BOS: "Boston", CHC: "Chicago", CWS: "Chicago", CHW: "Chicago",
    CIN: "Cincinnati", CLE: "Cleveland", COL: "Denver", DET: "Detroit", HOU: "Houston", KC: "Kansas City", LAA: "Anaheim",
    LAD: "Los Angeles", MIA: "Miami", MIL: "Milwaukee", MIN: "Minneapolis", NYM: "New York City", NYY: "New York City",
    OAK: "Sacramento", ATH: "Sacramento", PHI: "Philadelphia", PIT: "Pittsburgh", SD: "San Diego", SF: "San Francisco",
    SEA: "Seattle", STL: "St. Louis", TB: "Tampa", TEX: "Dallas", TOR: "Toronto", WSH: "Washington DC",
  },
};

/** Names and nicknames (any league) → city. Matched as whole words, longest first. */
const NAMES: Record<string, string> = {
  // NBA
  hawks: "Atlanta", celtics: "Boston", nets: "New York City", hornets: "Charlotte", bulls: "Chicago", cavaliers: "Cleveland",
  cavs: "Cleveland", mavericks: "Dallas", mavs: "Dallas", nuggets: "Denver", pistons: "Detroit", warriors: "San Francisco",
  "golden state": "San Francisco", rockets: "Houston", pacers: "Indianapolis", clippers: "Los Angeles", lakers: "Los Angeles",
  grizzlies: "Memphis", heat: "Miami", bucks: "Milwaukee", timberwolves: "Minneapolis", pelicans: "New Orleans",
  knicks: "New York City", thunder: "Oklahoma City", magic: "Orlando", "76ers": "Philadelphia", sixers: "Philadelphia",
  suns: "Phoenix", "trail blazers": "Portland", blazers: "Portland", kings: "Sacramento", spurs: "San Antonio",
  raptors: "Toronto", jazz: "Salt Lake City", wizards: "Washington DC",
  // NFL
  cardinals: "Phoenix", falcons: "Atlanta", ravens: "Baltimore", bills: "Buffalo", panthers: "Charlotte", bears: "Chicago",
  bengals: "Cincinnati", browns: "Cleveland", cowboys: "Dallas", broncos: "Denver", lions: "Detroit", packers: "Green Bay",
  texans: "Houston", colts: "Indianapolis", jaguars: "Jacksonville", chiefs: "Kansas City", raiders: "Las Vegas",
  chargers: "Los Angeles", rams: "Los Angeles", dolphins: "Miami", vikings: "Minneapolis", patriots: "Boston",
  saints: "New Orleans", giants: "New York City", jets: "New York City", eagles: "Philadelphia", steelers: "Pittsburgh",
  "49ers": "San Francisco", niners: "San Francisco", seahawks: "Seattle", buccaneers: "Tampa", bucs: "Tampa",
  titans: "Nashville", commanders: "Washington DC",
  // NHL
  ducks: "Anaheim", bruins: "Boston", sabres: "Buffalo", flames: "Calgary", hurricanes: "Raleigh", blackhawks: "Chicago",
  avalanche: "Denver", "blue jackets": "Columbus", stars: "Dallas", "red wings": "Detroit", oilers: "Edmonton",
  wild: "Minneapolis", canadiens: "Montreal", predators: "Nashville", devils: "Newark", islanders: "New York City",
  rangers: "New York City", senators: "Ottawa", flyers: "Philadelphia", penguins: "Pittsburgh", sharks: "San Jose",
  kraken: "Seattle", blues: "St. Louis", lightning: "Tampa", "maple leafs": "Toronto", canucks: "Vancouver",
  "golden knights": "Las Vegas", capitals: "Washington DC", jets_nhl: "Winnipeg",
  // MLB
  diamondbacks: "Phoenix", braves: "Atlanta", orioles: "Baltimore", "red sox": "Boston", cubs: "Chicago", "white sox": "Chicago",
  reds: "Cincinnati", guardians: "Cleveland", rockies: "Denver", tigers: "Detroit", astros: "Houston", royals: "Kansas City",
  angels: "Anaheim", dodgers: "Los Angeles", marlins: "Miami", brewers: "Milwaukee", twins: "Minneapolis", mets: "New York City",
  yankees: "New York City", athletics: "Sacramento", phillies: "Philadelphia", pirates: "Pittsburgh", padres: "San Diego",
  mariners: "Seattle", rays: "Tampa", "blue jays": "Toronto", nationals: "Washington DC",
  // MLS + college (Texas-heavy for the Austin demo)
  "austin fc": "Austin", longhorns: "Austin", "texas a&m": "College Station", aggies: "College Station", tcu: "Fort Worth",
  "horned frogs": "Fort Worth", baylor: "Waco", "texas tech": "Lubbock", "red raiders": "Lubbock", smu: "Dallas",
  rice: "Houston", "houston cougars": "Houston", utsa: "San Antonio", "north texas": "Denton", "ohio state": "Columbus",
  michigan: "Ann Arbor", georgia: "Athens", alabama: "Tuscaloosa", "notre dame": "South Bend", oregon: "Eugene", usc: "Los Angeles", ucla: "Los Angeles",
  // City labels venues use for pro teams
  "san antonio": "San Antonio", "los angeles": "Los Angeles", "new york": "New York City", "new orleans": "New Orleans",
  "oklahoma city": "Oklahoma City", "kansas city": "Kansas City", "las vegas": "Las Vegas", "san francisco": "San Francisco",
  "tampa bay": "Tampa", "green bay": "Green Bay", "salt lake": "Salt Lake City", "st. louis": "St. Louis",
  "new england": "Boston", "golden state warriors": "San Francisco", vegas: "Las Vegas",
};
/** State-style labels pro venues use for teams ("Indiana" = Pacers). College has same-named schools, so pro leagues only. */
const PRO_STATES: Record<string, string> = {
  utah: "Salt Lake City", washington: "Washington DC", arizona: "Phoenix", carolina: "Charlotte", minnesota: "Minneapolis",
  tennessee: "Nashville", indiana: "Indianapolis", florida: "Miami", colorado: "Denver",
};
// Plain city names that are also team labels (Gemini/Kalshi): matched as-is.
const CITY_WORDS = ["Atlanta", "Boston", "Brooklyn", "Charlotte", "Chicago", "Cleveland", "Dallas", "Denver", "Detroit", "Houston",
  "Indianapolis", "Memphis", "Miami", "Milwaukee", "Minneapolis", "Orlando", "Philadelphia", "Phoenix", "Portland", "Sacramento",
  "Toronto", "Baltimore", "Buffalo", "Cincinnati", "Jacksonville", "Pittsburgh", "Seattle", "Nashville", "Anaheim", "Calgary",
  "Columbus", "Edmonton", "Montreal", "Ottawa", "Vancouver", "Winnipeg", "San Diego", "San Jose", "Austin", "Raleigh"];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (k: string) => new RegExp(`\\b${esc(k)}\\b(?! state)`, "i"); // "Indiana State", "Ohio State" are schools, not the city/state team
const NAME_RES: [RegExp, string][] = [
  ...Object.entries(NAMES).map(([k, v]) => [new RegExp(`\\b${esc(k.replace(/_nhl$/, ""))}\\b`, "i"), v] as [RegExp, string]),
  ...CITY_WORDS.map((c) => [wordRe(c), c === "Brooklyn" ? "New York City" : c] as [RegExp, string]),
];
const PRO_RES: [RegExp, string][] = Object.entries(PRO_STATES).map(([k, v]) => [wordRe(k), v]);
/** Schools whose names contain a city but aren't in it. */
const NOT_CITY = /stephen f\.? austin|austin peay|miami \(oh\)|miami ohio/gi;

const leagueKey = (l?: string) => {
  const u = (l ?? "").toUpperCase();
  if (u.startsWith("NBA")) return "NBA"; if (u.startsWith("NFL")) return "NFL"; if (u.startsWith("NHL")) return "NHL"; if (u.startsWith("MLB")) return "MLB";
  return u;
};

/** Home cities of the teams in a game contract (both sides when known). */
export function teamCities(c: MarketContract): string[] {
  if (c.peril !== "game") return [];
  const g = gameInfo(c);
  const out = new Set<string>();
  const abbr = ABBR[leagueKey(g.league)];
  for (const a of g.pair ?? []) { const city = abbr?.[a.toUpperCase()]; if (city) out.add(city); }
  const text = [c.label, c.eventTitle, ...g.names, ...g.oppNames].join(" | ").replace(NOT_CITY, " ");
  const pro = ["NBA", "NFL", "NHL", "MLB"].includes(leagueKey(g.league));
  for (const [re, city] of [...NAME_RES, ...(pro ? PRO_RES : [])]) if (re.test(text)) out.add(city);
  // Season futures list every team; they belong to no single city.
  return out.size <= 2 ? [...out] : [];
}
