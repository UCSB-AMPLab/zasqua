#!/usr/bin/env node
/**
 * Generate Country Names
 *
 * This script writes `themes/base/data/countries.yaml`, the list of
 * every country in ISO 3166-1 with its name in each language the engine
 * ships (English and Spanish). The place page shows a place's country
 * from its three-letter ISO code (`COL`, `DEU`), and takes the name
 * in the site's language from this file.
 *
 * It is run by hand when the list needs refreshing, not as part of a
 * build: `node scripts/generate-country-names.js`. The names come from
 * the Unicode CLDR data that ships inside Node, through
 * `Intl.DisplayNames`, so the output depends on the Node version that
 * ran it; the file header records that version and its CLDR and ICU
 * versions. The English names use the `en-US` locale and the Spanish
 * names `es-CO`.
 *
 * `Intl.DisplayNames` takes two-letter region codes, so the script holds
 * the table from three-letter (alpha-3) to two-letter (alpha-2) codes
 * for the 249 officially assigned ISO 3166-1 codes. The table was read
 * from ICU (`uloc_getISO3Country`), restricted to the codes listed in
 * the tz database's `iso3166.tab` (ISO 3166-1 as of ISO/TC 46 N1127,
 * 2024-02-29), which leaves out ICU's extra region codes such as XK.
 *
 * A site that defines `place.countries.<ALPHA3>` in its i18n bundle
 * overrides the name in this file; the place template checks the bundle
 * first.
 *
 * @version v1.6.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ALPHA3_TO_ALPHA2 = {
  ABW: 'AW', AFG: 'AF', AGO: 'AO', AIA: 'AI', ALA: 'AX', ALB: 'AL', AND: 'AD', ARE: 'AE',
  ARG: 'AR', ARM: 'AM', ASM: 'AS', ATA: 'AQ', ATF: 'TF', ATG: 'AG', AUS: 'AU', AUT: 'AT',
  AZE: 'AZ', BDI: 'BI', BEL: 'BE', BEN: 'BJ', BES: 'BQ', BFA: 'BF', BGD: 'BD', BGR: 'BG',
  BHR: 'BH', BHS: 'BS', BIH: 'BA', BLM: 'BL', BLR: 'BY', BLZ: 'BZ', BMU: 'BM', BOL: 'BO',
  BRA: 'BR', BRB: 'BB', BRN: 'BN', BTN: 'BT', BVT: 'BV', BWA: 'BW', CAF: 'CF', CAN: 'CA',
  CCK: 'CC', CHE: 'CH', CHL: 'CL', CHN: 'CN', CIV: 'CI', CMR: 'CM', COD: 'CD', COG: 'CG',
  COK: 'CK', COL: 'CO', COM: 'KM', CPV: 'CV', CRI: 'CR', CUB: 'CU', CUW: 'CW', CXR: 'CX',
  CYM: 'KY', CYP: 'CY', CZE: 'CZ', DEU: 'DE', DJI: 'DJ', DMA: 'DM', DNK: 'DK', DOM: 'DO',
  DZA: 'DZ', ECU: 'EC', EGY: 'EG', ERI: 'ER', ESH: 'EH', ESP: 'ES', EST: 'EE', ETH: 'ET',
  FIN: 'FI', FJI: 'FJ', FLK: 'FK', FRA: 'FR', FRO: 'FO', FSM: 'FM', GAB: 'GA', GBR: 'GB',
  GEO: 'GE', GGY: 'GG', GHA: 'GH', GIB: 'GI', GIN: 'GN', GLP: 'GP', GMB: 'GM', GNB: 'GW',
  GNQ: 'GQ', GRC: 'GR', GRD: 'GD', GRL: 'GL', GTM: 'GT', GUF: 'GF', GUM: 'GU', GUY: 'GY',
  HKG: 'HK', HMD: 'HM', HND: 'HN', HRV: 'HR', HTI: 'HT', HUN: 'HU', IDN: 'ID', IMN: 'IM',
  IND: 'IN', IOT: 'IO', IRL: 'IE', IRN: 'IR', IRQ: 'IQ', ISL: 'IS', ISR: 'IL', ITA: 'IT',
  JAM: 'JM', JEY: 'JE', JOR: 'JO', JPN: 'JP', KAZ: 'KZ', KEN: 'KE', KGZ: 'KG', KHM: 'KH',
  KIR: 'KI', KNA: 'KN', KOR: 'KR', KWT: 'KW', LAO: 'LA', LBN: 'LB', LBR: 'LR', LBY: 'LY',
  LCA: 'LC', LIE: 'LI', LKA: 'LK', LSO: 'LS', LTU: 'LT', LUX: 'LU', LVA: 'LV', MAC: 'MO',
  MAF: 'MF', MAR: 'MA', MCO: 'MC', MDA: 'MD', MDG: 'MG', MDV: 'MV', MEX: 'MX', MHL: 'MH',
  MKD: 'MK', MLI: 'ML', MLT: 'MT', MMR: 'MM', MNE: 'ME', MNG: 'MN', MNP: 'MP', MOZ: 'MZ',
  MRT: 'MR', MSR: 'MS', MTQ: 'MQ', MUS: 'MU', MWI: 'MW', MYS: 'MY', MYT: 'YT', NAM: 'NA',
  NCL: 'NC', NER: 'NE', NFK: 'NF', NGA: 'NG', NIC: 'NI', NIU: 'NU', NLD: 'NL', NOR: 'NO',
  NPL: 'NP', NRU: 'NR', NZL: 'NZ', OMN: 'OM', PAK: 'PK', PAN: 'PA', PCN: 'PN', PER: 'PE',
  PHL: 'PH', PLW: 'PW', PNG: 'PG', POL: 'PL', PRI: 'PR', PRK: 'KP', PRT: 'PT', PRY: 'PY',
  PSE: 'PS', PYF: 'PF', QAT: 'QA', REU: 'RE', ROU: 'RO', RUS: 'RU', RWA: 'RW', SAU: 'SA',
  SDN: 'SD', SEN: 'SN', SGP: 'SG', SGS: 'GS', SHN: 'SH', SJM: 'SJ', SLB: 'SB', SLE: 'SL',
  SLV: 'SV', SMR: 'SM', SOM: 'SO', SPM: 'PM', SRB: 'RS', SSD: 'SS', STP: 'ST', SUR: 'SR',
  SVK: 'SK', SVN: 'SI', SWE: 'SE', SWZ: 'SZ', SXM: 'SX', SYC: 'SC', SYR: 'SY', TCA: 'TC',
  TCD: 'TD', TGO: 'TG', THA: 'TH', TJK: 'TJ', TKL: 'TK', TKM: 'TM', TLS: 'TL', TON: 'TO',
  TTO: 'TT', TUN: 'TN', TUR: 'TR', TUV: 'TV', TWN: 'TW', TZA: 'TZ', UGA: 'UG', UKR: 'UA',
  UMI: 'UM', URY: 'UY', USA: 'US', UZB: 'UZ', VAT: 'VA', VCT: 'VC', VEN: 'VE', VGB: 'VG',
  VIR: 'VI', VNM: 'VN', VUT: 'VU', WLF: 'WF', WSM: 'WS', YEM: 'YE', ZAF: 'ZA', ZMB: 'ZM',
  ZWE: 'ZW',
};

const LANGUAGES = { en: 'en-US', es: 'es-CO' };

/**
 * Returns { ALPHA3: { alpha2, en, es } } sorted by alpha-3 code.
 */
function buildCountries() {
  const namers = Object.fromEntries(
    Object.entries(LANGUAGES).map(([key, locale]) => [key, new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' })])
  );
  const out = {};
  for (const alpha3 of Object.keys(ALPHA3_TO_ALPHA2).sort()) {
    const alpha2 = ALPHA3_TO_ALPHA2[alpha3];
    const entry = { alpha2 };
    for (const [key, namer] of Object.entries(namers)) {
      const name = namer.of(alpha2);
      if (!name) throw new Error(`no ${key} name for ${alpha3} (${alpha2})`);
      entry[key] = name;
    }
    out[alpha3] = entry;
  }
  return out;
}

function renderYaml(countries) {
  const v = process.versions;
  const lines = [
    '# Country names — ISO 3166-1',
    '#',
    '# Every officially assigned ISO 3166-1 country, keyed by its alpha-3 code,',
    '# with the alpha-2 code and the name in each language the engine ships.',
    '# The place page (layouts/lugar/single.html) reads it to show a place\'s',
    '# country in the site\'s language; a place.countries.<ALPHA3> key in the',
    '# site\'s i18n bundle takes precedence over the name here.',
    '#',
    '# Generated by scripts/generate-country-names.js; do not edit by hand.',
    `# Names: Unicode CLDR ${v.cldr} via Intl.DisplayNames (Node ${v.node}, ICU ${v.icu}),`,
    `# locales ${Object.entries(LANGUAGES).map(([k, l]) => `${k}=${l}`).join(', ')}.`,
    '#',
    '# Version: v1.6.0',
    '',
  ];
  for (const [alpha3, entry] of Object.entries(countries)) {
    lines.push(`${alpha3}:`);
    // Quoted, because YAML 1.1 parsers read a bare NO (Norway) as false.
    lines.push(`  alpha2: ${JSON.stringify(entry.alpha2)}`);
    for (const key of Object.keys(LANGUAGES)) {
      lines.push(`  ${key}: ${JSON.stringify(entry[key])}`);
    }
  }
  lines.push('');
  lines.push('# Version: v1.6.0');
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const target = path.join(__dirname, '..', 'themes', 'base', 'data', 'countries.yaml');
  fs.writeFileSync(target, renderYaml(buildCountries()));
  console.log(`[generate-country-names] wrote ${path.relative(process.cwd(), target)}`);
}

module.exports = { ALPHA3_TO_ALPHA2, LANGUAGES, buildCountries, renderYaml };

// Version: v1.6.0
