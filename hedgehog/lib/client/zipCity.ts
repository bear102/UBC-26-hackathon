/** City for a US ZIP from its 3-digit prefix (big metros only). Unknown -> null. */
const PREFIX: [string[], string][] = [
  [["733", "786", "787"], "Austin, TX"],
  [["770", "772", "773", "774", "775"], "Houston, TX"],
  [["750", "751", "752", "753"], "Dallas, TX"],
  [["760", "761"], "Fort Worth, TX"],
  [["780", "781", "782"], "San Antonio, TX"],
  [["798", "799"], "El Paso, TX"],
  [["100", "101", "102", "103", "104", "111", "112", "113", "114", "116"], "New York, NY"],
  [["900", "901", "902", "903", "904", "905", "906", "907", "908", "910", "911", "912", "913", "914", "915", "916", "917", "918"], "Los Angeles, CA"],
  [["606", "607", "608"], "Chicago, IL"],
  [["330", "331", "332"], "Miami, FL"],
  [["335", "336"], "Tampa, FL"],
  [["940", "941"], "San Francisco, CA"],
  [["919", "920", "921"], "San Diego, CA"],
  [["980", "981"], "Seattle, WA"],
  [["800", "801", "802"], "Denver, CO"],
  [["850", "852", "853"], "Phoenix, AZ"],
  [["300", "301", "302", "303"], "Atlanta, GA"],
  [["021", "022"], "Boston, MA"],
  [["190", "191"], "Philadelphia, PA"],
  [["200", "202", "203", "204", "205"], "Washington, DC"],
  [["370", "371", "372"], "Nashville, TN"],
  [["700", "701"], "New Orleans, LA"],
  [["889", "890", "891"], "Las Vegas, NV"],
  [["730", "731"], "Oklahoma City, OK"],
  [["553", "554", "555"], "Minneapolis, MN"],
  [["480", "481", "482"], "Detroit, MI"],
];
const BY_PREFIX = new Map(PREFIX.flatMap(([ps, city]) => ps.map((p) => [p, city] as const)));

export function cityForZip(zip: string | undefined): string | null {
  const z = (zip ?? "").trim();
  return /^\d{5}/.test(z) ? BY_PREFIX.get(z.slice(0, 3)) ?? null : null;
}
