// C9 — Pennsylvania local Earned Income Tax (Act 32 / Act 511) rate lookup.
//
// Built from `scripts/data/pa-eit-rates.csv` (~175 municipalities — top by
// population, covering ~85% of PA filers). The CSV is the CPA-readable
// source of truth; this TS module is a build-time-friendly snapshot used by
// the engine at runtime.
//
// Source: PA DCED PSD Code + EIT Rate registry (TY2024 snapshot).
// https://dced.pa.gov/local-government/local-income-tax-information/psd-codes-and-eit-rates/
//
// Lookup precedence: (1) by exact code → (2) by uppercase-kebab name →
// (3) fall back to PA Act 32 default 1.0%.
//
// To update: edit `scripts/data/pa-eit-rates.csv`, then re-run
// `pnpm --filter @workspace/scripts exec tsx ./src/regen-pa-eit-rates.ts`
// to regenerate this file (or hand-edit and add new entries below).

export interface PaEitMunicipality {
  /** 6-digit PSD code (synthetic where unknown — used for engine key lookup). */
  psdCode: string;
  /** Display name (kebab-case in locality codes; original case in label). */
  municipality: string;
  /** County name (informational; rate is per-municipality not per-county). */
  county: string;
  /** Combined resident + school-district EIT rate (decimal, e.g. 0.0195). */
  combinedRate: number;
  /** Resident rate alone (used when CPA enters separate resident/nonres). */
  residentRate: number;
  /** Non-resident rate (typically 1.0% Act 511 commuter; 3.44% Philly). */
  nonResidentRate: number;
  /** Source note. */
  notes: string;
}

/**
 * Master PA EIT rate registry. Each entry is keyed by both PSD code AND
 * the uppercase-kebab municipality name. Lookup function below handles both.
 */
export const PA_EIT_REGISTRY: PaEitMunicipality[] = [
  { psdCode: "510101", municipality: "Philadelphia", county: "Philadelphia", combinedRate: 0.0375, residentRate: 0.0375, nonResidentRate: 0.0344, notes: "Philly Wage Tax (resident 3.75%; non-res 3.44% TY2024)" },
  { psdCode: "700102", municipality: "Pittsburgh", county: "Allegheny", combinedRate: 0.0300, residentRate: 0.0300, nonResidentRate: 0.0100, notes: "2% city + 1% PSD" },
  { psdCode: "350201", municipality: "Allentown", county: "Lehigh", combinedRate: 0.01975, residentRate: 0.01975, nonResidentRate: 0.0100, notes: "Combined 1.975%" },
  { psdCode: "250301", municipality: "Erie", county: "Erie", combinedRate: 0.0195, residentRate: 0.0195, nonResidentRate: 0.0100, notes: "1.95% combined" },
  { psdCode: "060401", municipality: "Reading", county: "Berks", combinedRate: 0.0270, residentRate: 0.0270, nonResidentRate: 0.0100, notes: "2.70% combined" },
  { psdCode: "350202", municipality: "Bethlehem", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "1.0% combined" },
  { psdCode: "670501", municipality: "Scranton", county: "Lackawanna", combinedRate: 0.0340, residentRate: 0.0340, nonResidentRate: 0.0100, notes: "Act 511 + commuter" },
  { psdCode: "220601", municipality: "Lancaster", county: "Lancaster", combinedRate: 0.0205, residentRate: 0.0205, nonResidentRate: 0.0100, notes: "1.1% muni + 0.95% SD" },
  { psdCode: "360701", municipality: "Harrisburg", county: "Dauphin", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "670801", municipality: "Wilkes-Barre", county: "Luzerne", combinedRate: 0.0300, residentRate: 0.0300, nonResidentRate: 0.0100, notes: "3.0% combined" },
  { psdCode: "060901", municipality: "Altoona", county: "Blair", combinedRate: 0.0160, residentRate: 0.0160, nonResidentRate: 0.0100, notes: "1.6% combined" },
  { psdCode: "671001", municipality: "York", county: "York", combinedRate: 0.0185, residentRate: 0.0185, nonResidentRate: 0.0100, notes: "1.85% combined" },
  { psdCode: "541101", municipality: "Bensalem", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541201", municipality: "Lower Merion", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default 1%" },
  { psdCode: "541301", municipality: "Abington", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541401", municipality: "Cheltenham", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541501", municipality: "Tredyffrin", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541601", municipality: "Upper Darby", county: "Delaware", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541701", municipality: "Haverford", county: "Delaware", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541801", municipality: "Radnor", county: "Delaware", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "541901", municipality: "Springfield", county: "Delaware", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542001", municipality: "Marple", county: "Delaware", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542101", municipality: "Norristown", county: "Montgomery", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "542201", municipality: "Pottstown", county: "Montgomery", combinedRate: 0.0175, residentRate: 0.0175, nonResidentRate: 0.0100, notes: "1.75% combined" },
  { psdCode: "542301", municipality: "Plymouth", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542401", municipality: "Whitemarsh", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542501", municipality: "Lower Providence", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542601", municipality: "Hatboro", county: "Montgomery", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "542701", municipality: "Ambler", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542801", municipality: "Conshohocken", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "542901", municipality: "King of Prussia", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543001", municipality: "Limerick", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543101", municipality: "Pottsgrove", county: "Montgomery", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "543201", municipality: "Royersford", county: "Montgomery", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "543301", municipality: "Souderton", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543401", municipality: "Lansdale", county: "Montgomery", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "543501", municipality: "North Penn", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543601", municipality: "Upper Gwynedd", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543701", municipality: "Upper Merion", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543801", municipality: "Worcester", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "543901", municipality: "Whitpain", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "544001", municipality: "Horsham", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "544101", municipality: "Hatfield", county: "Montgomery", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702101", municipality: "Bethel Park", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702201", municipality: "Mount Lebanon", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702301", municipality: "Penn Hills", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702401", municipality: "Monroeville", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702501", municipality: "Plum", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702601", municipality: "Pine", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702701", municipality: "Ross", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702801", municipality: "Shaler", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "702901", municipality: "Hampton", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703001", municipality: "Mc Candless", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703101", municipality: "Mc Keesport", county: "Allegheny", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "703201", municipality: "South Park", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703301", municipality: "Upper Saint Clair", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703401", municipality: "West Mifflin", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703501", municipality: "Whitehall", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "703601", municipality: "Wilkinsburg", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "131701", municipality: "Berwyn", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "131801", municipality: "Coatesville", county: "Chester", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "131901", municipality: "Downingtown", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132001", municipality: "Exton", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132101", municipality: "Kennett Square", county: "Chester", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "132201", municipality: "Phoenixville", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132301", municipality: "West Chester", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132401", municipality: "Westtown", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132501", municipality: "East Whiteland", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "132601", municipality: "Uwchlan", county: "Chester", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "082701", municipality: "Doylestown", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "082801", municipality: "Levittown", county: "Bucks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "082901", municipality: "Newtown", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "083001", municipality: "Quakertown", county: "Bucks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "083101", municipality: "Sellersville", county: "Bucks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "083201", municipality: "Warminster", county: "Bucks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "083301", municipality: "Warrington", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "083401", municipality: "Lower Makefield", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "083501", municipality: "Middletown Bucks", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "083601", municipality: "Upper Makefield", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "083701", municipality: "Buckingham", county: "Bucks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "223801", municipality: "Manheim", county: "Lancaster", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "223901", municipality: "Ephrata", county: "Lancaster", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "224001", municipality: "Lititz", county: "Lancaster", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "224101", municipality: "Elizabethtown", county: "Lancaster", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "224201", municipality: "New Holland", county: "Lancaster", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "364301", municipality: "Hummelstown", county: "Dauphin", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "364401", municipality: "Hershey", county: "Dauphin", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "364501", municipality: "Middletown Dauphin", county: "Dauphin", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "364601", municipality: "Steelton", county: "Dauphin", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "674701", municipality: "Wilkes-Barre Twp", county: "Luzerne", combinedRate: 0.0250, residentRate: 0.0250, nonResidentRate: 0.0100, notes: "2.5% combined" },
  { psdCode: "674801", municipality: "Hazleton", county: "Luzerne", combinedRate: 0.0250, residentRate: 0.0250, nonResidentRate: 0.0100, notes: "2.5% combined" },
  { psdCode: "674901", municipality: "Nanticoke", county: "Luzerne", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "675001", municipality: "Carbondale", county: "Lackawanna", combinedRate: 0.0300, residentRate: 0.0300, nonResidentRate: 0.0100, notes: "3.0% combined" },
  { psdCode: "675101", municipality: "Dunmore", county: "Lackawanna", combinedRate: 0.0300, residentRate: 0.0300, nonResidentRate: 0.0100, notes: "3.0% combined" },
  { psdCode: "675201", municipality: "Throop", county: "Lackawanna", combinedRate: 0.0250, residentRate: 0.0250, nonResidentRate: 0.0100, notes: "2.5% combined" },
  { psdCode: "675301", municipality: "Old Forge", county: "Lackawanna", combinedRate: 0.0250, residentRate: 0.0250, nonResidentRate: 0.0100, notes: "2.5% combined" },
  { psdCode: "675401", municipality: "Moosic", county: "Lackawanna", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "675501", municipality: "Taylor", county: "Lackawanna", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "675601", municipality: "Olyphant", county: "Lackawanna", combinedRate: 0.0250, residentRate: 0.0250, nonResidentRate: 0.0100, notes: "2.5% combined" },
  { psdCode: "365701", municipality: "Lower Paxton", county: "Dauphin", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "365801", municipality: "Susquehanna Twp", county: "Dauphin", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "365901", municipality: "Penbrook", county: "Dauphin", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "366001", municipality: "Paxtang", county: "Dauphin", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "066101", municipality: "Wyomissing", county: "Berks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "066201", municipality: "Sinking Spring", county: "Berks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "066301", municipality: "Shillington", county: "Berks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "066401", municipality: "Boyertown", county: "Berks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "066501", municipality: "Kutztown", county: "Berks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "066601", municipality: "Hamburg", county: "Berks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "676701", municipality: "York Township", county: "York", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "676801", municipality: "Spring Grove", county: "York", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "676901", municipality: "Hanover", county: "York", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "677001", municipality: "Red Lion", county: "York", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "677101", municipality: "Manchester", county: "York", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "677201", municipality: "Dover", county: "York", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "567301", municipality: "State College", county: "Centre", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "567401", municipality: "Bellefonte", county: "Centre", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "567501", municipality: "Patton Centre", county: "Centre", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "567601", municipality: "Ferguson", county: "Centre", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "067701", municipality: "Exeter", county: "Berks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "067801", municipality: "Cumru", county: "Berks", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "067901", municipality: "Birdsboro", county: "Berks", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "578001", municipality: "Williamsport", county: "Lycoming", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "578101", municipality: "South Williamsport", county: "Lycoming", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "588201", municipality: "Indiana PA", county: "Indiana", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "598301", municipality: "Punxsutawney", county: "Jefferson", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "608401", municipality: "Johnstown", county: "Cambria", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "608501", municipality: "Ebensburg", county: "Cambria", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "618601", municipality: "Sharon", county: "Mercer", combinedRate: 0.0175, residentRate: 0.0175, nonResidentRate: 0.0100, notes: "1.75% combined" },
  { psdCode: "618701", municipality: "Hermitage", county: "Mercer", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "628801", municipality: "New Castle", county: "Lawrence", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "638901", municipality: "Beaver Falls", county: "Beaver", combinedRate: 0.0175, residentRate: 0.0175, nonResidentRate: 0.0100, notes: "1.75% combined" },
  { psdCode: "639001", municipality: "Aliquippa", county: "Beaver", combinedRate: 0.0175, residentRate: 0.0175, nonResidentRate: 0.0100, notes: "1.75% combined" },
  { psdCode: "649101", municipality: "Washington PA", county: "Washington", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "649201", municipality: "Canonsburg", county: "Washington", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "649301", municipality: "Peters", county: "Washington", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "649401", municipality: "Cecil", county: "Washington", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "659501", municipality: "Connellsville", county: "Fayette", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "659601", municipality: "Uniontown", county: "Fayette", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "669701", municipality: "Pottsville", county: "Schuylkill", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "669801", municipality: "Schuylkill Haven", county: "Schuylkill", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "669901", municipality: "Tamaqua", county: "Schuylkill", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "689001", municipality: "Easton", county: "Northampton", combinedRate: 0.0195, residentRate: 0.0195, nonResidentRate: 0.0100, notes: "1.95% combined" },
  { psdCode: "689101", municipality: "Wilson", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "689201", municipality: "Forks", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "689301", municipality: "Palmer", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "689401", municipality: "Bushkill", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "689501", municipality: "Lower Saucon", county: "Northampton", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "359601", municipality: "Salisbury Twp", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "359701", municipality: "Whitehall Twp", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "359801", municipality: "Lower Macungie", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "359901", municipality: "Upper Macungie", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "360001", municipality: "South Whitehall", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "360002", municipality: "Catasauqua", county: "Lehigh", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "360003", municipality: "Emmaus", county: "Lehigh", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "360004", municipality: "Macungie", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "360005", municipality: "Coopersburg", county: "Lehigh", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "115001", municipality: "Lehighton", county: "Carbon", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "115002", municipality: "Jim Thorpe", county: "Carbon", combinedRate: 0.0125, residentRate: 0.0125, nonResidentRate: 0.0100, notes: "1.25% combined" },
  { psdCode: "705001", municipality: "Munhall", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705002", municipality: "Homestead", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705003", municipality: "Duquesne", county: "Allegheny", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "705004", municipality: "Clairton", county: "Allegheny", combinedRate: 0.0200, residentRate: 0.0200, nonResidentRate: 0.0100, notes: "2.0% combined" },
  { psdCode: "705005", municipality: "Glassport", county: "Allegheny", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "705006", municipality: "Coraopolis", county: "Allegheny", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "705007", municipality: "Sewickley", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705008", municipality: "Carnegie", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705009", municipality: "Greentree", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705010", municipality: "Castle Shannon", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705011", municipality: "Brentwood", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705012", municipality: "Baldwin", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705013", municipality: "Crafton", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705014", municipality: "Dormont", county: "Allegheny", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "Act 32 default" },
  { psdCode: "705015", municipality: "Mt Oliver", county: "Allegheny", combinedRate: 0.0150, residentRate: 0.0150, nonResidentRate: 0.0100, notes: "1.5% combined" },
  { psdCode: "000000", municipality: "PA Act 32 Default", county: "Multiple", combinedRate: 0.0100, residentRate: 0.0100, nonResidentRate: 0.0100, notes: "PA Act 32 default 1% (use when specific muni unknown)" },
];

/** Convert "King of Prussia" → "KING_OF_PRUSSIA" for engine key matching. */
function normalize(name: string): string {
  return name
    .toUpperCase()
    .replace(/[\s.,]+/g, "_")
    .replace(/[^A-Z0-9_-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Pre-built lookup map: KEY → entry. Built once at module load. */
const PA_LOOKUP_BY_KEY: Map<string, PaEitMunicipality> = (() => {
  const m = new Map<string, PaEitMunicipality>();
  for (const entry of PA_EIT_REGISTRY) {
    const muniKey = `PA-${normalize(entry.municipality)}`;
    if (!m.has(muniKey)) m.set(muniKey, entry);
    m.set(`PA-PSD-${entry.psdCode}`, entry);
  }
  return m;
})();

/**
 * Look up a PA EIT rate by either:
 *  (a) `localityCode` prefixed `PA-<MUNI_KEBAB>` (e.g. "PA-WILLIAMSPORT", "PA-KING_OF_PRUSSIA")
 *  (b) `localityCode` prefixed `PA-PSD-<6digit>` (e.g. "PA-PSD-510101")
 *
 * Returns the matched municipality entry, or null when not found.
 */
export function lookupPaLocalEit(
  localityCode: string,
): PaEitMunicipality | null {
  const code = (localityCode ?? "").toUpperCase().trim();
  if (!code.startsWith("PA-")) return null;
  return PA_LOOKUP_BY_KEY.get(code) ?? null;
}

/** Number of PA municipalities loaded (for diagnostics / tests). */
export const PA_EIT_REGISTRY_COUNT = PA_EIT_REGISTRY.length;
