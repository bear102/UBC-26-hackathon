// Three Austin demo businesses (DESIGN §7). Fictional names; numbers sized from typical
// Austin small-business economics. `fallbackRisks` is the hand-written risk map used when every
// LLM provider fails, so the demo always produces a quote.
import type { BusinessProfile, Risk } from "../types";

export type Preset = BusinessProfile & { tagline: string; fallbackRisks: Risk[] };
export type PublicPreset = Omit<Preset, "fallbackRisks">;

export const PRESETS: Preset[] = [
  {
    id: "rainey-patio-bar",
    presetId: "rainey-patio-bar",
    name: "The Prickly Porch (Rainey St)",
    tagline: "Patio bar in a Rainey St bungalow. Lives and dies by the weather and game nights.",
    description:
      "We're a patio bar in an old bungalow on Rainey Street, about 80% of our seats are outside. " +
      "Thursday to Sunday nights and Spurs/Texans game nights are our money makers. A scorching afternoon, " +
      "a rainy Friday, or the Spurs losing a home game and everyone going home early kills the night.",
    city: "Austin, TX",
    zip: "78701",
    avgDailyRevenueUsd: 4200, // ~$1.5M/yr; Fri/Sat nights run ~$6-7k, Mon-Wed ~$2.5k
    busyDays: ["Thu", "Fri", "Sat", "Sun"],
    monthlyBudgetUsd: 300,
    fallbackRisks: [
      {
        id: "r1", peril: "rain", title: "Rain on a Friday or Saturday night",
        trigger: "Measurable rain in Austin on a Fri/Sat", location: "Austin", window: "next 7 days",
        lossUsd: 2700,
        lossReasoning: "80% of seats are outdoors. A wet Saturday (~$6,500 normal) runs ~40% of normal: about $3,900 lost; averaged with a lighter Friday hit, ~$2,700 per rainy busy night.",
        confidence: 0.75,
      },
      {
        id: "r2", peril: "game", title: "Spurs lose on a home-game night",
        trigger: "San Antonio Spurs lose their next game", location: "San Antonio", window: "next 7 days",
        lossUsd: 900,
        lossReasoning: "Game nights draw ~$5,000. A win keeps the crowd for post-game rounds; a loss empties the patio ~90 min early, costing ~18% of the night (~$900).",
        confidence: 0.6,
      },
      {
        id: "r3", peril: "game", title: "Texans lose the Sunday game",
        trigger: "Houston Texans lose their next game", location: "Houston", window: "next 7 days",
        lossUsd: 600,
        lossReasoning: "Sunday watch parties bring ~$4,000. After a loss, tabs close early and the evening crowd thins: ~15% (~$600).",
        confidence: 0.55,
      },
      {
        id: "r4", peril: "heat", title: "Unseasonable heat on a weekend afternoon",
        trigger: "Austin daily high >= 88°F on a Sat/Sun", location: "Austin", window: "next 7 days",
        lossUsd: 750,
        lossReasoning: "Afternoon patio trade (~40% of a $6,000 weekend day) drops ~30% when it is hot in the sun: about $720-750.",
        confidence: 0.45,
      },
    ],
  },
  {
    id: "east-austin-food-truck",
    presetId: "east-austin-food-truck",
    name: "Birria Bros (East Austin food truck)",
    tagline: "Birria taco truck on E Cesar Chavez. Rain means no line; heat means short lines.",
    description:
      "I run a birria taco truck in an East Austin trailer park lot on Cesar Chavez. No indoor seating at all. " +
      "When it rains nobody comes out, and on really hot days the lunch line disappears. Weekends are most of my money.",
    city: "Austin, TX",
    zip: "78702",
    avgDailyRevenueUsd: 1400, // ~$40k/month; Sat ~$2.2k, weekdays ~$1k
    busyDays: ["Fri", "Sat", "Sun"],
    monthlyBudgetUsd: 120,
    fallbackRisks: [
      {
        id: "r1", peril: "rain", title: "Rainy weekend day",
        trigger: "Measurable rain in Austin on a Fri-Sun", location: "Austin", window: "next 7 days",
        lossUsd: 1300,
        lossReasoning: "Outdoor-only seating: a rainy Saturday (~$2,200 normal) does ~40% of normal, so ~$1,300 lost. Food prepped for the day is partly wasted too.",
        confidence: 0.75,
      },
      {
        id: "r2", peril: "heat", title: "Extreme heat at lunch",
        trigger: "Austin daily high >= 90°F", location: "Austin", window: "next 7 days",
        lossUsd: 420,
        lossReasoning: "Lunch is ~55% of a $1,400 day; hot days cut the lunch line ~50%, so ~$385-420 lost.",
        confidence: 0.5,
      },
      {
        id: "r3", peril: "cold", title: "Cold snap keeps people home",
        trigger: "Austin daily high below 55°F", location: "Austin", window: "next 7 days",
        lossUsd: 350,
        lossReasoning: "Cold, windy evenings cut walk-up traffic ~25% on a $1,400 day (~$350).",
        confidence: 0.4,
      },
    ],
  },
  {
    id: "austin-catering-delivery",
    presetId: "austin-catering-delivery",
    name: "Hill Country Table Catering",
    tagline: "Corporate catering with 4 delivery vans. Fuel and food costs eat the margin.",
    description:
      "We cater corporate lunches and events around Austin with four delivery vans doing about 3,000 miles a week. " +
      "Fixed-price contracts mean when fuel or food costs spike we eat it. We also carry a $150k line of credit for equipment.",
    city: "Austin, TX",
    zip: "78745",
    avgDailyRevenueUsd: 3000, // ~$90k/month; fuel ~1,300 gal/month; food cost ~33% of revenue
    busyDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    monthlyBudgetUsd: 200,
    fallbackRisks: [
      {
        id: "r1", peril: "oil", title: "Crude oil spike pushes up diesel and gas",
        trigger: "WTI crude settles above recent range this week", location: "US", window: "next 7 days",
        lossUsd: 260,
        lossReasoning: "~1,300 gal/month of fuel. A $5/bbl WTI jump adds ~$0.12-0.20/gal at the pump within weeks: ~$200-260/month on fixed-price contracts.",
        confidence: 0.55,
      },
      {
        id: "r2", peril: "gas", title: "US gas price jump",
        trigger: "US average regular gas price rises above this week's threshold", location: "US", window: "next 7 days",
        lossUsd: 390,
        lossReasoning: "A $0.30/gal rise on ~1,300 gal/month is ~$390/month that cannot be passed through on existing contracts.",
        confidence: 0.5,
      },
      {
        id: "r3", peril: "cpi", title: "Hot food inflation print",
        trigger: "Next CPI release above consensus", location: "US", window: "next CPI release",
        lossUsd: 600,
        lossReasoning: "Food cost is ~33% of $90k/month (~$30k). An extra 2% in wholesale food prices on fixed menus is ~$600/month.",
        confidence: 0.4,
      },
      {
        id: "r4", peril: "fed", title: "Fed holds rates higher for longer",
        trigger: "No Fed rate cut at the next FOMC meeting", location: "US", window: "next FOMC meeting",
        lossUsd: 60,
        lossReasoning: "On a $150k variable line of credit a 0.25% cut that doesn't come costs ~$31/month; ~$60 over the next two months.",
        confidence: 0.35,
      },
    ],
  },
];

export function getPreset(id: string | undefined | null): Preset | undefined {
  return id ? PRESETS.find((p) => p.id === id) : undefined;
}

export function publicPresets(): PublicPreset[] {
  return PRESETS.map(({ fallbackRisks: _f, ...rest }) => rest);
}
