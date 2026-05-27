// C10 — Ohio School District Income Tax (Form SD-100) rate lookup.
//
// Built from `scripts/data/oh-school-district-rates.csv` (~226 districts —
// covers most LSDs/CSDs/EVSDs that levy SDIT). The CSV is the CPA-readable
// source of truth; this TS module is a build-time-friendly snapshot used by
// the engine at runtime.
//
// Source: tax.ohio.gov SDIT Tax Rates list TY2024 snapshot.
// https://tax.ohio.gov/researcher/tax-data-charts/school-district-rates
//
// Lookup precedence: (1) by exact 4-digit SD code → (2) by uppercase-kebab
// name → (3) fall back to "no SDIT" (rate 0.0).
//
// To update: edit `scripts/data/oh-school-district-rates.csv`, then run
// `awk` to regenerate this file (see script below).

export type OhSdBase = "earned_income" | "traditional";

export interface OhSchoolDistrict {
  /** 4-digit SDIT code (per OH Dept. of Taxation registry). */
  sdCode: string;
  /** Display name (LSD/CSD/EVSD suffix preserved). */
  name: string;
  /** County name (informational). */
  county: string;
  /** SDIT rate (decimal, e.g. 0.0125). 0.0 = district doesn't levy SDIT. */
  rate: number;
  /** Base method: "earned_income" (wages + SE only) or "traditional"
   *  (OH IT-1040 Line 3 ≈ Ohio taxable income before exemption). */
  base: OhSdBase;
  /** Source note. */
  notes: string;
}

/** Master OH SD registry. */
export const OH_SCHOOL_DISTRICT_REGISTRY: OhSchoolDistrict[] = [
  { sdCode: "0201", name: "Ada EVSD", county: "Hardin", rate: 0.0125, base: "traditional", notes: "Ada EVSD — 1.25% traditional" },
  { sdCode: "0202", name: "Allen East LSD", county: "Allen", rate: 0.0125, base: "traditional", notes: "Allen East — 1.25% traditional" },
  { sdCode: "0301", name: "Anna LSD", county: "Shelby", rate: 0.0150, base: "earned_income", notes: "Anna LSD — 1.5% earned-income" },
  { sdCode: "0501", name: "Arcadia LSD", county: "Hancock", rate: 0.0125, base: "traditional", notes: "Arcadia — 1.25% traditional" },
  { sdCode: "0601", name: "Arlington LSD", county: "Hancock", rate: 0.0125, base: "traditional", notes: "Arlington — 1.25% traditional" },
  { sdCode: "0701", name: "Ayersville LSD", county: "Defiance", rate: 0.0125, base: "traditional", notes: "Ayersville — 1.25% traditional" },
  { sdCode: "0801", name: "Bath LSD", county: "Allen", rate: 0.0075, base: "earned_income", notes: "Bath LSD — 0.75% earned-income" },
  { sdCode: "0901", name: "Beavercreek CSD", county: "Greene", rate: 0.0000, base: "traditional", notes: "Beavercreek — no SDIT" },
  { sdCode: "1001", name: "Bellbrook-Sugarcreek LSD", county: "Greene", rate: 0.0000, base: "traditional", notes: "Bellbrook-Sugarcreek — no SDIT" },
  { sdCode: "1101", name: "Berlin-Milan LSD", county: "Erie", rate: 0.0100, base: "earned_income", notes: "Berlin-Milan — 1.0% earned-income" },
  { sdCode: "1201", name: "Berne Union LSD", county: "Fairfield", rate: 0.0200, base: "traditional", notes: "Berne Union — 2.0% traditional" },
  { sdCode: "1301", name: "Bethel LSD", county: "Miami", rate: 0.0125, base: "traditional", notes: "Bethel LSD — 1.25% traditional" },
  { sdCode: "1401", name: "Bexley CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Bexley — no SDIT" },
  { sdCode: "1501", name: "Big Walnut LSD", county: "Delaware", rate: 0.0075, base: "earned_income", notes: "Big Walnut — 0.75% earned-income" },
  { sdCode: "1601", name: "Bloom-Carroll LSD", county: "Fairfield", rate: 0.0125, base: "traditional", notes: "Bloom-Carroll — 1.25% traditional" },
  { sdCode: "1701", name: "Bowling Green CSD", county: "Wood", rate: 0.0050, base: "traditional", notes: "Bowling Green — 0.5% traditional" },
  { sdCode: "1801", name: "Brookville LSD", county: "Montgomery", rate: 0.0125, base: "traditional", notes: "Brookville — 1.25% traditional" },
  { sdCode: "1901", name: "Buckeye Central LSD", county: "Crawford", rate: 0.0125, base: "traditional", notes: "Buckeye Central — 1.25% traditional" },
  { sdCode: "2001", name: "Buckeye LSD", county: "Medina", rate: 0.0000, base: "traditional", notes: "Buckeye LSD (Medina) — no SDIT" },
  { sdCode: "2101", name: "Buckeye Valley LSD", county: "Delaware", rate: 0.0100, base: "traditional", notes: "Buckeye Valley — 1.0% traditional" },
  { sdCode: "2201", name: "Cardinal LSD", county: "Geauga", rate: 0.0125, base: "traditional", notes: "Cardinal — 1.25% traditional" },
  { sdCode: "2301", name: "Carrollton EVSD", county: "Carroll", rate: 0.0125, base: "traditional", notes: "Carrollton EVSD — 1.25% traditional" },
  { sdCode: "2401", name: "Cedar Cliff LSD", county: "Greene", rate: 0.0125, base: "traditional", notes: "Cedar Cliff — 1.25% traditional" },
  { sdCode: "2501", name: "Celina CSD", county: "Mercer", rate: 0.0100, base: "traditional", notes: "Celina CSD — 1.0% traditional" },
  { sdCode: "2601", name: "Central LSD", county: "Defiance", rate: 0.0150, base: "traditional", notes: "Central LSD (Defiance) — 1.5% traditional" },
  { sdCode: "2701", name: "Chagrin Falls EVSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Chagrin Falls EVSD — no SDIT" },
  { sdCode: "2801", name: "Chippewa LSD", county: "Wayne", rate: 0.0150, base: "traditional", notes: "Chippewa — 1.5% traditional" },
  { sdCode: "2901", name: "Cincinnati CSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Cincinnati CSD — no SDIT (uses Cincinnati city tax instead)" },
  { sdCode: "3001", name: "Circleville CSD", county: "Pickaway", rate: 0.0050, base: "traditional", notes: "Circleville CSD — 0.5% traditional" },
  { sdCode: "3101", name: "Clear Fork Valley LSD", county: "Richland", rate: 0.0100, base: "traditional", notes: "Clear Fork Valley — 1.0% traditional" },
  { sdCode: "3201", name: "Cloverleaf LSD", county: "Medina", rate: 0.0000, base: "traditional", notes: "Cloverleaf — no SDIT" },
  { sdCode: "3301", name: "Coldwater EVSD", county: "Mercer", rate: 0.0075, base: "traditional", notes: "Coldwater EVSD — 0.75% traditional" },
  { sdCode: "3401", name: "Columbus CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Columbus CSD — no SDIT (uses Columbus city tax)" },
  { sdCode: "3501", name: "Cory-Rawson LSD", county: "Hancock", rate: 0.0100, base: "traditional", notes: "Cory-Rawson — 1.0% traditional" },
  { sdCode: "3601", name: "Cuyahoga Falls CSD", county: "Summit", rate: 0.0000, base: "traditional", notes: "Cuyahoga Falls CSD — no SDIT (Akron city tax)" },
  { sdCode: "3701", name: "Dalton LSD", county: "Wayne", rate: 0.0100, base: "traditional", notes: "Dalton LSD — 1.0% traditional" },
  { sdCode: "3801", name: "Dayton CSD", county: "Montgomery", rate: 0.0000, base: "traditional", notes: "Dayton CSD — no SDIT (uses Dayton city tax)" },
  { sdCode: "3901", name: "Defiance CSD", county: "Defiance", rate: 0.0075, base: "traditional", notes: "Defiance CSD — 0.75% traditional" },
  { sdCode: "4001", name: "Delphos CSD", county: "Allen", rate: 0.0050, base: "traditional", notes: "Delphos CSD — 0.5% traditional" },
  { sdCode: "4101", name: "Delaware CSD", county: "Delaware", rate: 0.0000, base: "traditional", notes: "Delaware CSD — no SDIT" },
  { sdCode: "4201", name: "Dover CSD", county: "Tuscarawas", rate: 0.0100, base: "traditional", notes: "Dover CSD — 1.0% traditional" },
  { sdCode: "4301", name: "Dublin CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Dublin CSD — no SDIT" },
  { sdCode: "4401", name: "East Liverpool CSD", county: "Columbiana", rate: 0.0150, base: "traditional", notes: "East Liverpool — 1.5% traditional" },
  { sdCode: "4501", name: "Eastland-Fairfield Career Center", county: "Multiple", rate: 0.0000, base: "traditional", notes: "Eastland-Fairfield Career — no SDIT" },
  { sdCode: "4601", name: "Eaton CSD", county: "Preble", rate: 0.0150, base: "traditional", notes: "Eaton CSD — 1.5% traditional" },
  { sdCode: "4701", name: "Edgewood CSD", county: "Butler", rate: 0.0125, base: "traditional", notes: "Edgewood CSD — 1.25% traditional" },
  { sdCode: "4801", name: "Edison LSD", county: "Erie", rate: 0.0100, base: "traditional", notes: "Edison LSD — 1.0% traditional" },
  { sdCode: "4901", name: "Edon-Northwest LSD", county: "Williams", rate: 0.0100, base: "traditional", notes: "Edon-Northwest — 1.0% traditional" },
  { sdCode: "5001", name: "Elgin LSD", county: "Marion", rate: 0.0075, base: "traditional", notes: "Elgin LSD — 0.75% traditional" },
  { sdCode: "5101", name: "Elmwood LSD", county: "Wood", rate: 0.0125, base: "earned_income", notes: "Elmwood — 1.25% earned-income" },
  { sdCode: "5201", name: "Eshte CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Eshte CSD — no SDIT" },
  { sdCode: "5301", name: "Evergreen LSD", county: "Fulton", rate: 0.0150, base: "traditional", notes: "Evergreen LSD — 1.5% traditional" },
  { sdCode: "5401", name: "Fairborn CSD", county: "Greene", rate: 0.0000, base: "traditional", notes: "Fairborn CSD — no SDIT" },
  { sdCode: "5501", name: "Fairbanks LSD", county: "Union", rate: 0.0100, base: "traditional", notes: "Fairbanks — 1.0% traditional" },
  { sdCode: "5601", name: "Fairfield Union LSD", county: "Fairfield", rate: 0.0200, base: "traditional", notes: "Fairfield Union — 2.0% traditional" },
  { sdCode: "5701", name: "Fairlawn LSD", county: "Shelby", rate: 0.0125, base: "traditional", notes: "Fairlawn LSD (Shelby) — 1.25% traditional" },
  { sdCode: "5801", name: "Fayetteville-Perry LSD", county: "Brown", rate: 0.0100, base: "traditional", notes: "Fayetteville-Perry — 1.0% traditional" },
  { sdCode: "5901", name: "Felicity-Franklin LSD", county: "Clermont", rate: 0.0125, base: "traditional", notes: "Felicity-Franklin — 1.25% traditional" },
  { sdCode: "6001", name: "Findlay CSD", county: "Hancock", rate: 0.0100, base: "traditional", notes: "Findlay CSD — 1.0% traditional" },
  { sdCode: "6101", name: "Firelands LSD", county: "Erie", rate: 0.0125, base: "traditional", notes: "Firelands — 1.25% traditional" },
  { sdCode: "6201", name: "Forest Hills LSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Forest Hills — no SDIT" },
  { sdCode: "6301", name: "Fort Frye LSD", county: "Washington", rate: 0.0150, base: "traditional", notes: "Fort Frye — 1.5% traditional" },
  { sdCode: "6401", name: "Fort Recovery LSD", county: "Mercer", rate: 0.0150, base: "traditional", notes: "Fort Recovery — 1.5% traditional" },
  { sdCode: "6501", name: "Franklin CSD", county: "Warren", rate: 0.0000, base: "traditional", notes: "Franklin CSD (Warren) — no SDIT" },
  { sdCode: "6601", name: "Fredericktown LSD", county: "Knox", rate: 0.0125, base: "traditional", notes: "Fredericktown — 1.25% traditional" },
  { sdCode: "6701", name: "Galion CSD", county: "Crawford", rate: 0.0100, base: "traditional", notes: "Galion CSD — 1.0% traditional" },
  { sdCode: "6801", name: "Garaway LSD", county: "Tuscarawas", rate: 0.0150, base: "traditional", notes: "Garaway LSD — 1.5% traditional" },
  { sdCode: "6901", name: "Genoa Area LSD", county: "Ottawa", rate: 0.0125, base: "traditional", notes: "Genoa Area — 1.25% traditional" },
  { sdCode: "7001", name: "Geneva Area CSD", county: "Ashtabula", rate: 0.0125, base: "traditional", notes: "Geneva Area — 1.25% traditional" },
  { sdCode: "7101", name: "Geneva-on-the-Lake LSD", county: "Ashtabula", rate: 0.0050, base: "traditional", notes: "Geneva-on-the-Lake — 0.5% traditional" },
  { sdCode: "7201", name: "Goshen LSD", county: "Clermont", rate: 0.0100, base: "earned_income", notes: "Goshen — 1.0% earned-income" },
  { sdCode: "7301", name: "Granville EVSD", county: "Licking", rate: 0.0075, base: "earned_income", notes: "Granville EVSD — 0.75% earned-income" },
  { sdCode: "7401", name: "Greenville CSD", county: "Darke", rate: 0.0050, base: "traditional", notes: "Greenville CSD — 0.5% traditional" },
  { sdCode: "7501", name: "Groveport-Madison LSD", county: "Franklin", rate: 0.0125, base: "traditional", notes: "Groveport-Madison — 1.25% traditional" },
  { sdCode: "7601", name: "Hamilton CSD", county: "Butler", rate: 0.0000, base: "traditional", notes: "Hamilton CSD — no SDIT" },
  { sdCode: "7701", name: "Hardin Northern LSD", county: "Hardin", rate: 0.0125, base: "traditional", notes: "Hardin Northern — 1.25% traditional" },
  { sdCode: "7801", name: "Harrison Hills CSD", county: "Harrison", rate: 0.0125, base: "traditional", notes: "Harrison Hills — 1.25% traditional" },
  { sdCode: "7901", name: "Heath CSD", county: "Licking", rate: 0.0100, base: "traditional", notes: "Heath CSD — 1.0% traditional" },
  { sdCode: "8001", name: "Hicksville EVSD", county: "Defiance", rate: 0.0150, base: "traditional", notes: "Hicksville EVSD — 1.5% traditional" },
  { sdCode: "8101", name: "Highland LSD", county: "Medina", rate: 0.0125, base: "traditional", notes: "Highland LSD (Medina) — 1.25% traditional" },
  { sdCode: "8201", name: "Hilliard CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Hilliard CSD — no SDIT" },
  { sdCode: "8301", name: "Holgate LSD", county: "Henry", rate: 0.0125, base: "traditional", notes: "Holgate LSD — 1.25% traditional" },
  { sdCode: "8401", name: "Hopewell-Loudon LSD", county: "Seneca", rate: 0.0050, base: "traditional", notes: "Hopewell-Loudon — 0.5% traditional" },
  { sdCode: "8501", name: "Houston LSD", county: "Shelby", rate: 0.0150, base: "earned_income", notes: "Houston LSD — 1.5% earned-income" },
  { sdCode: "8601", name: "Huber Heights CSD", county: "Montgomery", rate: 0.0125, base: "traditional", notes: "Huber Heights CSD — 1.25% traditional" },
  { sdCode: "8701", name: "Hudson CSD", county: "Summit", rate: 0.0000, base: "traditional", notes: "Hudson CSD — no SDIT" },
  { sdCode: "8801", name: "Huntington LSD", county: "Ross", rate: 0.0100, base: "traditional", notes: "Huntington — 1.0% traditional" },
  { sdCode: "8901", name: "Indian Lake LSD", county: "Logan", rate: 0.0150, base: "traditional", notes: "Indian Lake LSD — 1.5% traditional" },
  { sdCode: "9001", name: "Jackson CSD", county: "Jackson", rate: 0.0100, base: "traditional", notes: "Jackson CSD — 1.0% traditional" },
  { sdCode: "9101", name: "James A Garfield LSD", county: "Portage", rate: 0.0150, base: "traditional", notes: "James A Garfield — 1.5% traditional" },
  { sdCode: "9201", name: "Jefferson LSD (Madison)", county: "Madison", rate: 0.0125, base: "traditional", notes: "Jefferson LSD (Madison) — 1.25% traditional" },
  { sdCode: "9301", name: "Jennings LSD", county: "Putnam", rate: 0.0150, base: "traditional", notes: "Jennings LSD — 1.5% traditional" },
  { sdCode: "9401", name: "Johnstown-Monroe LSD", county: "Licking", rate: 0.0075, base: "earned_income", notes: "Johnstown-Monroe — 0.75% earned-income" },
  { sdCode: "9501", name: "Kalida LSD", county: "Putnam", rate: 0.0100, base: "traditional", notes: "Kalida LSD — 1.0% traditional" },
  { sdCode: "9601", name: "Kenton CSD", county: "Hardin", rate: 0.0075, base: "traditional", notes: "Kenton CSD — 0.75% traditional" },
  { sdCode: "9701", name: "Kings LSD", county: "Warren", rate: 0.0050, base: "traditional", notes: "Kings — 0.5% traditional" },
  { sdCode: "9801", name: "Kirtland LSD", county: "Lake", rate: 0.0000, base: "traditional", notes: "Kirtland LSD — no SDIT" },
  { sdCode: "9901", name: "Lakewood LSD", county: "Licking", rate: 0.0100, base: "traditional", notes: "Lakewood LSD (Licking) — 1.0% traditional" },
  { sdCode: "1100", name: "Lancaster CSD", county: "Fairfield", rate: 0.0050, base: "traditional", notes: "Lancaster CSD — 0.5% traditional" },
  { sdCode: "1101A", name: "Lebanon CSD", county: "Warren", rate: 0.0000, base: "traditional", notes: "Lebanon CSD — no SDIT" },
  { sdCode: "1102", name: "Liberty-Benton LSD", county: "Hancock", rate: 0.0075, base: "traditional", notes: "Liberty-Benton — 0.75% traditional" },
  { sdCode: "1103", name: "Liberty Center LSD", county: "Henry", rate: 0.0150, base: "traditional", notes: "Liberty Center — 1.5% traditional" },
  { sdCode: "1104", name: "Liberty LSD (Trumbull)", county: "Trumbull", rate: 0.0150, base: "traditional", notes: "Liberty (Trumbull) — 1.5% traditional" },
  { sdCode: "1105", name: "Liberty-Union Thurston LSD", county: "Fairfield", rate: 0.0175, base: "traditional", notes: "Liberty-Union Thurston — 1.75% traditional" },
  { sdCode: "1106", name: "Licking Heights LSD", county: "Licking", rate: 0.0075, base: "earned_income", notes: "Licking Heights — 0.75% earned-income" },
  { sdCode: "1107", name: "Licking Valley LSD", county: "Licking", rate: 0.0100, base: "traditional", notes: "Licking Valley — 1.0% traditional" },
  { sdCode: "1108", name: "Lima CSD", county: "Allen", rate: 0.0050, base: "traditional", notes: "Lima CSD — 0.5% traditional" },
  { sdCode: "1109", name: "Lincoln CSD (Lincoln)", county: "Hancock", rate: 0.0125, base: "traditional", notes: "Lincoln (Hancock) — 1.25% traditional" },
  { sdCode: "1110", name: "Little Miami LSD", county: "Warren", rate: 0.0100, base: "traditional", notes: "Little Miami — 1.0% traditional" },
  { sdCode: "1111", name: "Logan Elm LSD", county: "Pickaway", rate: 0.0125, base: "traditional", notes: "Logan Elm — 1.25% traditional" },
  { sdCode: "1112", name: "Lorain CSD", county: "Lorain", rate: 0.0000, base: "traditional", notes: "Lorain CSD — no SDIT" },
  { sdCode: "1113", name: "Loveland CSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Loveland CSD — no SDIT" },
  { sdCode: "1114", name: "Madison-Plains LSD", county: "Madison", rate: 0.0175, base: "traditional", notes: "Madison-Plains — 1.75% traditional" },
  { sdCode: "1115", name: "Marlington LSD", county: "Stark", rate: 0.0100, base: "traditional", notes: "Marlington — 1.0% traditional" },
  { sdCode: "1116", name: "Mansfield CSD", county: "Richland", rate: 0.0000, base: "traditional", notes: "Mansfield CSD — no SDIT" },
  { sdCode: "1117", name: "Marietta CSD", county: "Washington", rate: 0.0050, base: "traditional", notes: "Marietta CSD — 0.5% traditional" },
  { sdCode: "1118", name: "Marysville EVSD", county: "Union", rate: 0.0050, base: "traditional", notes: "Marysville EVSD — 0.5% traditional" },
  { sdCode: "1119", name: "Maumee CSD", county: "Lucas", rate: 0.0000, base: "traditional", notes: "Maumee CSD — no SDIT" },
  { sdCode: "1120", name: "Mayfield CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Mayfield CSD — no SDIT" },
  { sdCode: "1121", name: "Mechanicsburg EVSD", county: "Champaign", rate: 0.0175, base: "traditional", notes: "Mechanicsburg — 1.75% traditional" },
  { sdCode: "1122", name: "Medina CSD", county: "Medina", rate: 0.0000, base: "traditional", notes: "Medina CSD — no SDIT" },
  { sdCode: "1123", name: "Mercer County Career Center", county: "Mercer", rate: 0.0000, base: "traditional", notes: "Mercer County Career Center — no SDIT" },
  { sdCode: "1124", name: "Miami East LSD", county: "Miami", rate: 0.0125, base: "traditional", notes: "Miami East — 1.25% traditional" },
  { sdCode: "1125", name: "Miami Trace LSD", county: "Fayette", rate: 0.0125, base: "traditional", notes: "Miami Trace — 1.25% traditional" },
  { sdCode: "1126", name: "Middletown CSD", county: "Butler", rate: 0.0000, base: "traditional", notes: "Middletown CSD — no SDIT" },
  { sdCode: "1127", name: "Milford EVSD", county: "Clermont", rate: 0.0000, base: "traditional", notes: "Milford EVSD — no SDIT" },
  { sdCode: "1128", name: "Millersport LSD", county: "Fairfield", rate: 0.0150, base: "traditional", notes: "Millersport — 1.5% traditional" },
  { sdCode: "1129", name: "Minerva LSD", county: "Stark", rate: 0.0100, base: "traditional", notes: "Minerva LSD — 1.0% traditional" },
  { sdCode: "1130", name: "Minster LSD", county: "Auglaize", rate: 0.0100, base: "earned_income", notes: "Minster — 1.0% earned-income" },
  { sdCode: "1131", name: "Monroeville LSD", county: "Huron", rate: 0.0125, base: "traditional", notes: "Monroeville LSD (Huron) — 1.25% traditional" },
  { sdCode: "1132", name: "Mt Vernon CSD", county: "Knox", rate: 0.0050, base: "traditional", notes: "Mt Vernon CSD — 0.5% traditional" },
  { sdCode: "1133", name: "National Trail LSD", county: "Preble", rate: 0.0175, base: "traditional", notes: "National Trail — 1.75% traditional" },
  { sdCode: "1134", name: "New Bremen LSD", county: "Auglaize", rate: 0.0125, base: "earned_income", notes: "New Bremen — 1.25% earned-income" },
  { sdCode: "1135", name: "New Knoxville LSD", county: "Auglaize", rate: 0.0075, base: "traditional", notes: "New Knoxville — 0.75% traditional" },
  { sdCode: "1136", name: "New London LSD", county: "Huron", rate: 0.0100, base: "traditional", notes: "New London — 1.0% traditional" },
  { sdCode: "1137", name: "New Lexington City SD", county: "Perry", rate: 0.0125, base: "traditional", notes: "New Lexington — 1.25% traditional" },
  { sdCode: "1138", name: "Newark CSD", county: "Licking", rate: 0.0075, base: "traditional", notes: "Newark CSD — 0.75% traditional" },
  { sdCode: "1139", name: "Newcomerstown EVSD", county: "Tuscarawas", rate: 0.0125, base: "traditional", notes: "Newcomerstown — 1.25% traditional" },
  { sdCode: "1140", name: "Newton LSD", county: "Miami", rate: 0.0150, base: "traditional", notes: "Newton LSD — 1.5% traditional" },
  { sdCode: "1141", name: "North Baltimore LSD", county: "Wood", rate: 0.0100, base: "traditional", notes: "North Baltimore — 1.0% traditional" },
  { sdCode: "1142", name: "Northeastern LSD", county: "Clark", rate: 0.0100, base: "traditional", notes: "Northeastern LSD (Clark) — 1.0% traditional" },
  { sdCode: "1143", name: "Northridge LSD", county: "Licking", rate: 0.0075, base: "traditional", notes: "Northridge LSD (Licking) — 0.75% traditional" },
  { sdCode: "1144", name: "Northwest LSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Northwest LSD (Hamilton) — no SDIT" },
  { sdCode: "1145", name: "Norton CSD", county: "Summit", rate: 0.0000, base: "traditional", notes: "Norton CSD — no SDIT" },
  { sdCode: "1146", name: "Norwalk CSD", county: "Huron", rate: 0.0050, base: "traditional", notes: "Norwalk CSD — 0.5% traditional" },
  { sdCode: "1147", name: "Norwood CSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Norwood CSD — no SDIT" },
  { sdCode: "1148", name: "Oak Hills LSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Oak Hills — no SDIT" },
  { sdCode: "1149", name: "Oberlin CSD", county: "Lorain", rate: 0.0050, base: "traditional", notes: "Oberlin CSD — 0.5% traditional" },
  { sdCode: "1150", name: "Old Fort LSD", county: "Seneca", rate: 0.0100, base: "traditional", notes: "Old Fort — 1.0% traditional" },
  { sdCode: "1151", name: "Olentangy LSD", county: "Delaware", rate: 0.0075, base: "earned_income", notes: "Olentangy LSD — 0.75% earned-income" },
  { sdCode: "1152", name: "Ontario LSD", county: "Richland", rate: 0.0100, base: "traditional", notes: "Ontario LSD — 1.0% traditional" },
  { sdCode: "1153", name: "Otsego LSD", county: "Wood", rate: 0.0100, base: "traditional", notes: "Otsego — 1.0% traditional" },
  { sdCode: "1154", name: "Ottawa-Glandorf LSD", county: "Putnam", rate: 0.0100, base: "traditional", notes: "Ottawa-Glandorf — 1.0% traditional" },
  { sdCode: "1155", name: "Painesville CSD", county: "Lake", rate: 0.0050, base: "traditional", notes: "Painesville CSD — 0.5% traditional" },
  { sdCode: "1156", name: "Pandora-Gilboa LSD", county: "Putnam", rate: 0.0100, base: "traditional", notes: "Pandora-Gilboa — 1.0% traditional" },
  { sdCode: "1157", name: "Parkway LSD", county: "Mercer", rate: 0.0100, base: "traditional", notes: "Parkway — 1.0% traditional" },
  { sdCode: "1158", name: "Patrick Henry LSD", county: "Henry", rate: 0.0150, base: "traditional", notes: "Patrick Henry — 1.5% traditional" },
  { sdCode: "1159", name: "Paulding EVSD", county: "Paulding", rate: 0.0150, base: "traditional", notes: "Paulding EVSD — 1.5% traditional" },
  { sdCode: "1160", name: "Pickerington LSD", county: "Fairfield", rate: 0.0100, base: "earned_income", notes: "Pickerington LSD — 1.0% earned-income" },
  { sdCode: "1161", name: "Piqua CSD", county: "Miami", rate: 0.0125, base: "traditional", notes: "Piqua CSD — 1.25% traditional" },
  { sdCode: "1162", name: "Pleasant LSD", county: "Marion", rate: 0.0075, base: "traditional", notes: "Pleasant LSD (Marion) — 0.75% traditional" },
  { sdCode: "1163", name: "Portsmouth CSD", county: "Scioto", rate: 0.0050, base: "traditional", notes: "Portsmouth CSD — 0.5% traditional" },
  { sdCode: "1164", name: "Princeton CSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Princeton CSD — no SDIT" },
  { sdCode: "1165", name: "Ravenna CSD", county: "Portage", rate: 0.0100, base: "traditional", notes: "Ravenna CSD — 1.0% traditional" },
  { sdCode: "1166", name: "Reynoldsburg CSD", county: "Franklin", rate: 0.0050, base: "traditional", notes: "Reynoldsburg CSD — 0.5% traditional" },
  { sdCode: "1167", name: "Riverside LSD (Logan)", county: "Logan", rate: 0.0125, base: "traditional", notes: "Riverside LSD (Logan) — 1.25% traditional" },
  { sdCode: "1168", name: "Rocky River CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Rocky River CSD — no SDIT" },
  { sdCode: "1169", name: "Ross LSD", county: "Butler", rate: 0.0100, base: "traditional", notes: "Ross LSD (Butler) — 1.0% traditional" },
  { sdCode: "1170", name: "Russia LSD", county: "Shelby", rate: 0.0150, base: "earned_income", notes: "Russia LSD — 1.5% earned-income" },
  { sdCode: "1171", name: "Sandy Valley LSD", county: "Stark", rate: 0.0100, base: "traditional", notes: "Sandy Valley — 1.0% traditional" },
  { sdCode: "1172", name: "Sebring LSD", county: "Mahoning", rate: 0.0125, base: "traditional", notes: "Sebring LSD — 1.25% traditional" },
  { sdCode: "1173", name: "Shadyside LSD", county: "Belmont", rate: 0.0100, base: "traditional", notes: "Shadyside — 1.0% traditional" },
  { sdCode: "1174", name: "Shaker Heights CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Shaker Heights CSD — no SDIT" },
  { sdCode: "1175", name: "Shawnee LSD (Allen)", county: "Allen", rate: 0.0050, base: "traditional", notes: "Shawnee LSD (Allen) — 0.5% traditional" },
  { sdCode: "1176", name: "Sidney CSD", county: "Shelby", rate: 0.0075, base: "traditional", notes: "Sidney CSD — 0.75% traditional" },
  { sdCode: "1177", name: "Smithville-Western LSD", county: "Wayne", rate: 0.0150, base: "traditional", notes: "Smithville-Western — 1.5% traditional" },
  { sdCode: "1178", name: "South-Western CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "South-Western CSD — no SDIT" },
  { sdCode: "1179", name: "Southwest LSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Southwest LSD (Hamilton) — no SDIT" },
  { sdCode: "1180", name: "Spencerville LSD", county: "Allen", rate: 0.0125, base: "traditional", notes: "Spencerville — 1.25% traditional" },
  { sdCode: "1181", name: "Springboro CSD", county: "Warren", rate: 0.0000, base: "traditional", notes: "Springboro CSD — no SDIT" },
  { sdCode: "1182", name: "Springfield LSD (Clark)", county: "Clark", rate: 0.0000, base: "traditional", notes: "Springfield LSD (Clark) — no SDIT" },
  { sdCode: "1183", name: "Springfield LSD (Summit)", county: "Summit", rate: 0.0000, base: "traditional", notes: "Springfield LSD (Summit) — no SDIT" },
  { sdCode: "1184", name: "Stow-Munroe Falls CSD", county: "Summit", rate: 0.0000, base: "traditional", notes: "Stow-Munroe Falls — no SDIT" },
  { sdCode: "1185", name: "Streetsboro CSD", county: "Portage", rate: 0.0000, base: "traditional", notes: "Streetsboro CSD — no SDIT" },
  { sdCode: "1186", name: "Strongsville CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Strongsville CSD — no SDIT" },
  { sdCode: "1187", name: "Sugarcreek LSD (Greene)", county: "Greene", rate: 0.0000, base: "traditional", notes: "Sugarcreek LSD (Greene) — no SDIT" },
  { sdCode: "1188", name: "Switzerland of Ohio LSD", county: "Monroe", rate: 0.0100, base: "traditional", notes: "Switzerland of Ohio — 1.0% traditional" },
  { sdCode: "1189", name: "Sycamore CSD", county: "Hamilton", rate: 0.0000, base: "traditional", notes: "Sycamore CSD — no SDIT" },
  { sdCode: "1190", name: "Talawanda CSD", county: "Butler", rate: 0.0125, base: "traditional", notes: "Talawanda — 1.25% traditional" },
  { sdCode: "1191", name: "Tallmadge CSD", county: "Summit", rate: 0.0000, base: "traditional", notes: "Tallmadge CSD — no SDIT" },
  { sdCode: "1192", name: "Tipp City EVSD", county: "Miami", rate: 0.0125, base: "traditional", notes: "Tipp City — 1.25% traditional" },
  { sdCode: "1193", name: "Toledo CSD", county: "Lucas", rate: 0.0000, base: "traditional", notes: "Toledo CSD — no SDIT (uses Toledo city tax)" },
  { sdCode: "1194", name: "Tri-Valley LSD", county: "Muskingum", rate: 0.0125, base: "earned_income", notes: "Tri-Valley — 1.25% earned-income" },
  { sdCode: "1195", name: "Triway LSD", county: "Wayne", rate: 0.0100, base: "traditional", notes: "Triway — 1.0% traditional" },
  { sdCode: "1196", name: "Twin Valley CSD", county: "Preble", rate: 0.0125, base: "traditional", notes: "Twin Valley — 1.25% traditional" },
  { sdCode: "1197", name: "Union LSD (Clark)", county: "Clark", rate: 0.0125, base: "traditional", notes: "Union LSD (Clark) — 1.25% traditional" },
  { sdCode: "1198", name: "Upper Arlington CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Upper Arlington — no SDIT" },
  { sdCode: "1199", name: "Upper Sandusky EVSD", county: "Wyandot", rate: 0.0100, base: "traditional", notes: "Upper Sandusky — 1.0% traditional" },
  { sdCode: "1200", name: "Valley View LSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Valley View LSD (Cuyahoga) — no SDIT" },
  { sdCode: "1228", name: "Van Buren LSD", county: "Hancock", rate: 0.0100, base: "traditional", notes: "Van Buren LSD — 1.0% traditional" },
  { sdCode: "1202", name: "Van Wert CSD", county: "Van Wert", rate: 0.0050, base: "traditional", notes: "Van Wert CSD — 0.5% traditional" },
  { sdCode: "1203", name: "Vanlue LSD", county: "Hancock", rate: 0.0100, base: "traditional", notes: "Vanlue LSD — 1.0% traditional" },
  { sdCode: "1204", name: "Vermilion LSD", county: "Erie", rate: 0.0125, base: "traditional", notes: "Vermilion LSD — 1.25% traditional" },
  { sdCode: "1205", name: "Wapakoneta CSD", county: "Auglaize", rate: 0.0050, base: "traditional", notes: "Wapakoneta CSD — 0.5% traditional" },
  { sdCode: "1206", name: "Warrensville Heights CSD", county: "Cuyahoga", rate: 0.0000, base: "traditional", notes: "Warrensville Heights — no SDIT" },
  { sdCode: "1207", name: "Washington CH CSD", county: "Fayette", rate: 0.0000, base: "traditional", notes: "Washington Court House CSD — no SDIT" },
  { sdCode: "1208", name: "Wauseon EVSD", county: "Fulton", rate: 0.0150, base: "traditional", notes: "Wauseon EVSD — 1.5% traditional" },
  { sdCode: "1209", name: "Waverly CSD", county: "Pike", rate: 0.0075, base: "traditional", notes: "Waverly CSD — 0.75% traditional" },
  { sdCode: "1210", name: "Wayne Trace LSD", county: "Paulding", rate: 0.0125, base: "traditional", notes: "Wayne Trace — 1.25% traditional" },
  { sdCode: "1211", name: "Waynesville LSD", county: "Warren", rate: 0.0100, base: "traditional", notes: "Waynesville LSD — 1.0% traditional" },
  { sdCode: "1212", name: "Wellsville LSD", county: "Columbiana", rate: 0.0125, base: "traditional", notes: "Wellsville LSD — 1.25% traditional" },
  { sdCode: "1213", name: "West Branch LSD", county: "Mahoning", rate: 0.0125, base: "traditional", notes: "West Branch — 1.25% traditional" },
  { sdCode: "1214", name: "West Clermont LSD", county: "Clermont", rate: 0.0000, base: "traditional", notes: "West Clermont — no SDIT" },
  { sdCode: "1215", name: "West Holmes LSD", county: "Holmes", rate: 0.0100, base: "traditional", notes: "West Holmes — 1.0% traditional" },
  { sdCode: "1216", name: "Westerville CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Westerville CSD — no SDIT" },
  { sdCode: "1217", name: "Wheelersburg LSD", county: "Scioto", rate: 0.0100, base: "traditional", notes: "Wheelersburg — 1.0% traditional" },
  { sdCode: "1218", name: "Whitehall CSD", county: "Franklin", rate: 0.0000, base: "traditional", notes: "Whitehall CSD — no SDIT" },
  { sdCode: "1219", name: "Whitmer LSD", county: "Lucas", rate: 0.0000, base: "traditional", notes: "Whitmer LSD — no SDIT" },
  { sdCode: "1220", name: "Wilmington CSD", county: "Clinton", rate: 0.0100, base: "traditional", notes: "Wilmington CSD — 1.0% traditional" },
  { sdCode: "1221", name: "Wooster CSD", county: "Wayne", rate: 0.0000, base: "traditional", notes: "Wooster CSD — no SDIT" },
  { sdCode: "1222", name: "Worthington CSD", county: "Franklin", rate: 0.0100, base: "earned_income", notes: "Worthington CSD — 1.0% earned-income (NEW 2024)" },
  { sdCode: "1223", name: "Wynford LSD", county: "Crawford", rate: 0.0100, base: "traditional", notes: "Wynford — 1.0% traditional" },
  { sdCode: "1224", name: "Xenia CSD", county: "Greene", rate: 0.0000, base: "traditional", notes: "Xenia CSD — no SDIT" },
  { sdCode: "1225", name: "Yellow Springs EVSD", county: "Greene", rate: 0.0100, base: "traditional", notes: "Yellow Springs — 1.0% traditional" },
  { sdCode: "1226", name: "Youngstown CSD", county: "Mahoning", rate: 0.0000, base: "traditional", notes: "Youngstown CSD — no SDIT (uses Youngstown city tax)" },
  { sdCode: "1227", name: "Zanesville CSD", county: "Muskingum", rate: 0.0050, base: "traditional", notes: "Zanesville CSD — 0.5% traditional" },
];

/** Convert "Olentangy LSD" → "OLENTANGY_LSD" for engine key matching. */
function normalize(name: string): string {
  return name
    .toUpperCase()
    .replace(/[\s.,]+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Pre-built lookup map: key → entry. */
const OH_SD_LOOKUP: Map<string, OhSchoolDistrict> = (() => {
  const m = new Map<string, OhSchoolDistrict>();
  for (const entry of OH_SCHOOL_DISTRICT_REGISTRY) {
    m.set(`OH-SD-${entry.sdCode}`, entry);
    const nameKey = `OH-SD-${normalize(entry.name)}`;
    if (!m.has(nameKey)) m.set(nameKey, entry);
  }
  return m;
})();

/**
 * Look up an OH SD rate by either:
 *  (a) `OH-SD-<4digit>` (e.g. "OH-SD-1151" for Olentangy LSD)
 *  (b) `OH-SD-<NAME_KEBAB>` (e.g. "OH-SD-OLENTANGY_LSD")
 *
 * Returns the matched district entry, or null when not found.
 */
export function lookupOhSchoolDistrict(
  localityCode: string,
): OhSchoolDistrict | null {
  const code = (localityCode ?? "").toUpperCase().trim();
  if (!code.startsWith("OH-SD-")) return null;
  return OH_SD_LOOKUP.get(code) ?? null;
}

/** Number of OH SDs loaded (for diagnostics / tests). */
export const OH_SCHOOL_DISTRICT_REGISTRY_COUNT = OH_SCHOOL_DISTRICT_REGISTRY.length;
