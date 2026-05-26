// Frontend mirror of engine LOCAL_TAX_DATA (artifacts/api-server/src/lib/taxCalculator.ts).
// Used for: (a) ClientForm locality dropdown, grouped by parent state;
// (b) ClientDetail display label for the local tax line.
//
// Engine remains the source of truth — when adding a locality, update
// LOCAL_TAX_DATA in taxCalculator.ts AND this file's LOCALITY_OPTIONS.
// CPAs must verify rates against the published current-year tax table
// before filing — rates change annually for many jurisdictions.

export interface LocalityOption {
  code: string;
  label: string;
}

export const LOCALITY_OPTIONS: Record<string, LocalityOption[]> = {
  NY: [{ code: "NYC", label: "New York City (NYC PIT)" }],
  MD: [
    { code: "MD-ALLEGANY",       label: "Allegany County" },
    { code: "MD-ANNE_ARUNDEL",   label: "Anne Arundel County" },
    { code: "MD-BALTIMORE_CITY", label: "Baltimore City" },
    { code: "MD-BALTIMORE_CO",   label: "Baltimore County" },
    { code: "MD-CALVERT",        label: "Calvert County" },
    { code: "MD-CAROLINE",       label: "Caroline County" },
    { code: "MD-CARROLL",        label: "Carroll County" },
    { code: "MD-CECIL",          label: "Cecil County" },
    { code: "MD-CHARLES",        label: "Charles County" },
    { code: "MD-DORCHESTER",     label: "Dorchester County" },
    { code: "MD-FREDERICK",      label: "Frederick County" },
    { code: "MD-GARRETT",        label: "Garrett County" },
    { code: "MD-HARFORD",        label: "Harford County" },
    { code: "MD-HOWARD",         label: "Howard County" },
    { code: "MD-KENT",           label: "Kent County" },
    { code: "MD-MONTGOMERY",     label: "Montgomery County" },
    { code: "MD-PRINCE_GEORGES", label: "Prince George's County" },
    { code: "MD-QUEEN_ANNES",    label: "Queen Anne's County" },
    { code: "MD-ST_MARYS",       label: "St. Mary's County" },
    { code: "MD-SOMERSET",       label: "Somerset County" },
    { code: "MD-TALBOT",         label: "Talbot County" },
    { code: "MD-WASHINGTON",     label: "Washington County" },
    { code: "MD-WICOMICO",       label: "Wicomico County" },
    { code: "MD-WORCESTER",      label: "Worcester County" },
  ],
  OH: [
    { code: "OH-AKRON",      label: "Akron" },
    { code: "OH-CANTON",     label: "Canton" },
    { code: "OH-CINCINNATI", label: "Cincinnati" },
    { code: "OH-CLEVELAND",  label: "Cleveland" },
    { code: "OH-COLUMBUS",   label: "Columbus" },
    { code: "OH-DAYTON",     label: "Dayton" },
    { code: "OH-LAKEWOOD",   label: "Lakewood" },
    { code: "OH-PARMA",      label: "Parma" },
    { code: "OH-TOLEDO",     label: "Toledo" },
    { code: "OH-YOUNGSTOWN", label: "Youngstown" },
  ],
  IN: [
    { code: "IN-ALLEN",       label: "Allen County" },
    { code: "IN-ELKHART",     label: "Elkhart County" },
    { code: "IN-HAMILTON",    label: "Hamilton County" },
    { code: "IN-LAKE",        label: "Lake County" },
    { code: "IN-MARION",      label: "Marion County" },
    { code: "IN-MONROE",      label: "Monroe County" },
    { code: "IN-PORTER",      label: "Porter County" },
    { code: "IN-ST_JOSEPH",   label: "St. Joseph County" },
    { code: "IN-TIPPECANOE",  label: "Tippecanoe County" },
    { code: "IN-VANDERBURGH", label: "Vanderburgh County" },
  ],
};

const FLAT_CODE_TO_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(LOCALITY_OPTIONS).flat().map((o) => [o.code, o.label]),
);

/** Pretty label for a locality code, e.g. "NYC" → "New York City",
 *  "MD-MONTGOMERY" → "Montgomery County, MD". Falls back to the raw code
 *  for unknown values. */
export function localityLabel(code: string | null | undefined): string {
  if (!code) return "";
  const pretty = FLAT_CODE_TO_LABEL[code];
  if (!pretty) return code;
  // NYC is its own jurisdiction string — no state suffix.
  if (code === "NYC") return "New York City";
  // For MD-*, OH-*, IN-* append the state abbreviation for clarity.
  const dash = code.indexOf("-");
  if (dash > 0) {
    const state = code.slice(0, dash);
    // Skip suffix if label already contains it (defensive).
    if (pretty.endsWith(", " + state)) return pretty;
    return `${pretty}, ${state}`;
  }
  return pretty;
}
