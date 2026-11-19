import type { CategoryRule, GemName } from './types';
import { cleanMerchant } from './statements';

export type CategoryGroup = 'income' | 'bills' | 'essentials' | 'personal' | 'savings' | 'transfer';

export interface Category {
  id: string;
  name: string;
  group: CategoryGroup;
  color: string; // css variable name suffix
  icon: string; // lucide icon name (mapped in UI)
}

export const CATEGORIES: Category[] = [
  { id: 'paycheck', name: 'Paycheck', group: 'income', color: 'moss', icon: 'briefcase' },
  { id: 'income_other', name: 'Other income', group: 'income', color: 'moss', icon: 'plus-circle' },
  { id: 'refund', name: 'Refunds', group: 'income', color: 'moss', icon: 'rotate-ccw' },

  { id: 'housing', name: 'Rent & mortgage', group: 'bills', color: 'slate', icon: 'home' },
  { id: 'utilities', name: 'Utilities', group: 'bills', color: 'slate', icon: 'zap' },
  { id: 'phone_internet', name: 'Phone & internet', group: 'bills', color: 'slate', icon: 'wifi' },
  { id: 'insurance', name: 'Insurance', group: 'bills', color: 'slate', icon: 'shield' },
  { id: 'loans', name: 'Loans & debt', group: 'bills', color: 'slate', icon: 'landmark' },
  { id: 'subscriptions', name: 'Subscriptions', group: 'bills', color: 'slate', icon: 'repeat' },
  { id: 'childcare', name: 'Childcare & school', group: 'bills', color: 'slate', icon: 'baby' },

  { id: 'groceries', name: 'Groceries', group: 'essentials', color: 'sand', icon: 'shopping-basket' },
  { id: 'gas', name: 'Gas & fuel', group: 'essentials', color: 'sand', icon: 'fuel' },
  { id: 'transport', name: 'Car & transit', group: 'essentials', color: 'sand', icon: 'car' },
  { id: 'health', name: 'Health & pharmacy', group: 'essentials', color: 'sand', icon: 'heart-pulse' },
  { id: 'household', name: 'Household & care', group: 'essentials', color: 'sand', icon: 'spray-can' },
  { id: 'pets', name: 'Pets', group: 'essentials', color: 'sand', icon: 'paw-print' },

  { id: 'dining', name: 'Dining & coffee', group: 'personal', color: 'clay', icon: 'coffee' },
  { id: 'delivery', name: 'Food delivery', group: 'personal', color: 'clay', icon: 'bike' },
  { id: 'shopping', name: 'Shopping', group: 'personal', color: 'clay', icon: 'shopping-bag' },
  { id: 'entertainment', name: 'Fun & entertainment', group: 'personal', color: 'clay', icon: 'ticket' },
  { id: 'travel', name: 'Travel', group: 'personal', color: 'clay', icon: 'plane' },
  { id: 'gifts', name: 'Gifts & giving', group: 'personal', color: 'clay', icon: 'gift' },
  { id: 'p2p', name: 'Sent to people', group: 'personal', color: 'clay', icon: 'send' },
  { id: 'cash', name: 'Cash & ATM', group: 'personal', color: 'clay', icon: 'banknote' },
  { id: 'fees', name: 'Bank fees', group: 'personal', color: 'clay', icon: 'alert-triangle' },
  { id: 'uncategorized', name: 'Uncategorized', group: 'personal', color: 'stone', icon: 'circle-dashed' },

  { id: 'savings', name: 'Moved to savings', group: 'savings', color: 'jade', icon: 'piggy-bank' },
  { id: 'transfer', name: 'Transfers', group: 'transfer', color: 'stone', icon: 'arrow-left-right' },
  { id: 'cc_payment', name: 'Card payments', group: 'transfer', color: 'stone', icon: 'credit-card' },
];

export const CATEGORY_BY_ID: Record<string, Category> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

export function categoryOf(id: string): Category {
  return CATEGORY_BY_ID[id] ?? CATEGORY_BY_ID.uncategorized;
}

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  income: 'Income',
  bills: 'Bills',
  essentials: 'Essentials',
  personal: 'Wants & everyday',
  savings: 'Savings',
  transfer: 'Transfers',
};

export const GEMS: { id: GemName; name: string; color: string; meaning: string }[] = [
  { id: 'quartz', name: 'Quartz', color: '#D9D2C5', meaning: 'clarity' },
  { id: 'amethyst', name: 'Amethyst', color: '#8E77B5', meaning: 'calm' },
  { id: 'citrine', name: 'Citrine', color: '#D9A441', meaning: 'abundance' },
  { id: 'jade', name: 'Jade', color: '#4E9A7F', meaning: 'balance' },
  { id: 'sapphire', name: 'Sapphire', color: '#3F6FA8', meaning: 'wisdom' },
  { id: 'garnet', name: 'Garnet', color: '#9E3B3B', meaning: 'commitment' },
  { id: 'topaz', name: 'Topaz', color: '#5FA9C9', meaning: 'clarity of purpose' },
  { id: 'obsidian', name: 'Obsidian', color: '#3A3836', meaning: 'protection' },
  { id: 'agate', name: 'Agate', color: '#B9784F', meaning: 'stability' },
  { id: 'emerald', name: 'Emerald', color: '#2F8A5B', meaning: 'growth' },
];

export const GEM_BY_ID = Object.fromEntries(GEMS.map((g) => [g.id, g])) as Record<GemName, (typeof GEMS)[number]>;

// Keyword rules. Order matters: the first match wins. Patterns match the
// upper-cased description. `sign` restricts a rule to money in (+) or out (-).
type KW = [RegExp, string, ('+' | '-')?];

const KEYWORDS: KW[] = [
  // transfers & card payments first so they don't count as spending
  [/PAYMENT\s*-?\s*THANK YOU|AUTOPAY PAYMENT|CREDIT CA?RD (E?PAYMENT|PMT)|CRCARDPMT|EPAYMENT|E-PAYMENT|CARDMEMBER SERV|CAPITAL ONE.*(PMT|PYMT|MOBILE PMT)|DISCOVER.*(PMT|PAYMENT)|AMEX.*(PMT|PAYMENT)|CITI.*(PMT|PAYMENT)|CHASE CREDIT CRD|BARCLAYCARD|SYNCHRONY.*PMT/, 'cc_payment'],
  [/MARCUS|GOLDMAN SACHS|GS BANK|ALLY BANK.*TRANSFER|CAPITAL ONE 360.*TRANSFER|AMERICAN EXPRESS NATIONAL BANK.*SAV/, 'savings', '-'],
  [/TRANSFER TO (SAV|SHARE)|TO SAVINGS|TRANSFER TO SHARE|XFER TO SAV|ONLINE TRANSFER TO SAV|AUTOMATIC SAVINGS|ROUND ?UP|SAVE AS YOU GO|KEEP THE CHANGE/, 'savings', '-'],
  [/ONLINE TRANSFER|INTERNET TRANSFER|MOBILE TRANSFER|TRANSFER (TO|FROM)|XFER|FUNDS TRANSFER|SHARE TRANSFER|INTERNAL TRANSFER|BOOK TRANSFER/, 'transfer'],

  // income
  [/PAYROLL|DIR DEP|DIRECT DEP|DIRECTDEP|DIRECT DEPOSIT|SALARY|PAYCHECK|\bADP\b|PAYCHEX|GUSTO|PAYLOCITY|PAYCOM|WORKDAY|INTUIT PAYROLL|UKG|DFAS/, 'paycheck', '+'],
  [/IRS TREAS|TAX REF|STATE OF COLORADO.*REF|CO DEPT REV|REFUND|RETURN CREDIT|REVERSAL/, 'refund', '+'],
  [/INTEREST (PAID|EARNED|PAYMENT)|DIVIDEND|CASHBACK|CASH BACK REWARD/, 'income_other', '+'],

  // fuel before grocery chains that also sell gas
  [/KING SOOPERS FUEL|KING SOOPER.*FUEL|KS FUEL|COSTCO GAS|SAMS ?CLUB.*FUEL|SAFEWAY FUEL|WALMART.*FUEL|MURPHY|SHELL|CONOCO|PHILLIPS 66|KUM ?& ?GO|LOAF ?N ?JUG|MAVERIK|7-ELEVEN|7 ELEVEN|CIRCLE K|SINCLAIR|EXXON|MOBIL|CHEVRON|VALERO|TEXACO|BP#|\bBP\b|ARCO|CENEX|LOVE'?S|PILOT|FLYING J|QUIKTRIP|QT \d|CASEY'?S|SPEEDWAY|MARATHON|GAS STATION|FUEL/, 'gas', '-'],

  // groceries
  [/KING SOOPERS|SAFEWAY|ALBERTSONS|SPROUTS|WHOLE ?FOODS|WHOLEFDS|ALDI|TRADER JOE|NATURAL GROCERS|COSTCO|SAMS ?CLUB|SAM'S CLUB|WAL-?MART|WM SUPERCENTER|WALMART|SMITH'?S|KROGER|CITY MARKET|SPROUTS|H-?E-?B|PUBLIX|WINCO|GROCERY|SUPERMARKET|MARKET ?BASKET|FOOD ?LION|SAVE ?A ?LOT|SPROUTS FARMERS|INSTACART|AMAZON FRESH|GROCERY OUTLET|PLATTE|FOOD 4 LESS/, 'groceries', '-'],

  // utilities & phone/internet
  [/COLORADO SPRINGS UTIL|CSU\b|SPRINGS UTILITIES|XCEL|BLACK HILLS ENERGY|ATMOS|WATER|SEWER|ELECTRIC|GAS CO|ENERGY|WASTE MANAGEMENT|WASTE CONNECTIONS|BESTWAY|TRASH|UTILIT/, 'utilities', '-'],
  [/T-?MOBILE|VERIZON|AT&T|ATT\*|\bATT\b|SPRINT|CRICKET|MINT MOBILE|VISIBLE|METRO ?BY|BOOST MOBILE|COMCAST|XFINITY|CENTURYLINK|QUANTUM FIBER|LUMEN|SPECTRUM|STARLINK|GOOGLE FI|US MOBILE|TELLO/, 'phone_internet', '-'],

  // subscriptions
  [/NETFLIX|SPOTIFY|HULU|DISNEY ?(PLUS|\+)|DISNEYPLUS|MAX\.COM|HBO|PARAMOUNT|PEACOCK|APPLE\.COM\/BILL|APPLE ?MUSIC|ICLOUD|YOUTUBE ?(PREMIUM|TV)|GOOGLE ?\*?(STORAGE|ONE|PLAY)|AMAZON PRIME|PRIME VIDEO|AMZN DIGITAL|AUDIBLE|KINDLE UNLTD|XBOX|PLAYSTATION|PSN|NINTENDO|STEAM ?GAMES|TWITCH|PATREON|SIRIUS|PELOTON|PLANET FITNESS|CRUNCH FIT|24 HOUR FIT|ANYTIME FITNESS|GYM|OPENAI|CHATGPT|ANTHROPIC|CLAUDE\.AI|ADOBE|MICROSOFT ?365|DROPBOX|CANVA|DUOLINGO|CRUNCHYROLL|ESPN|SLING|FUBO|PHILO|NOOM|CALM\.COM|HEADSPACE/, 'subscriptions', '-'],

  // housing, insurance, loans
  [/RENT\b|RENTPAYMENT|APARTMENT|APTS|PROPERTY MGMT|PROPERTY MANAGEMENT|PROP MGMT|MORTGAGE|ROCKET MORTGAGE|MR\.? COOPER|LOANCARE|HOA\b|HOMEOWNERS ASSOC|BILT|ZILLOW RENT|APPFOLIO|RENTCAFE|BUILDIUM|YARDI/, 'housing', '-'],
  [/GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|USAA (P&C|INS)|FARMERS INS|LIBERTY MUTUAL|NATIONWIDE|AMERICAN FAMILY|AMFAM|LEMONADE|INSURANCE|INS PREM/, 'insurance', '-'],
  [/AUTO LOAN|CAR PAYMENT|AUTO PAY.*LOAN|LOAN PAYMENT|LOAN PMT|NAVIENT|NELNET|MOHELA|AIDVANTAGE|EDFINANCIAL|SALLIE MAE|SOFI LOAN|UPSTART|LENDINGCLUB|AFFIRM|KLARNA|AFTERPAY|SEZZLE|ALLY.*(PMT|PAYMENT)|TOYOTA FIN|HONDA FIN|FORD CREDIT|GM FINANCIAL|CARMAX AUTO|WESTLAKE|SANTANDER CONS/, 'loans', '-'],

  // delivery before dining
  [/DOORDASH|DD ?DOORDASH|UBER ?EATS|UBEREATS|GRUBHUB|POSTMATES|SEAMLESS|GOPUFF/, 'delivery', '-'],
  [/MCDONALD|STARBUCKS|DUTCH BROS|CHICK-?FIL-?A|TACO BELL|SUBWAY|CHIPOTLE|WENDY'?S|BURGER KING|SONIC|CULVER|RAISING CANE|PANERA|DOMINO|PIZZA|PAPA JOHN|LITTLE CAESAR|JIMMY JOHN|JERSEY MIKE|FIREHOUSE|QDOBA|PANDA EXPRESS|KFC|POPEYES|ARBY|DAIRY QUEEN|IN-N-OUT|FIVE GUYS|WHATABURGER|CARL'?S JR|JACK IN THE BOX|DEL TACO|WINGSTOP|BUFFALO WILD|APPLEBEE|CHILI'?S|OLIVE GARDEN|TEXAS ROADHOUSE|IHOP|DENNY|CRACKER BARREL|RED ROBIN|OUTBACK|COLD STONE|CRUMBL|DUNKIN|SCOOTERS|PEET'?S|CARIBOU|COFFEE|CAFE|ESPRESSO|BAKERY|RESTAURANT|GRILL|DINER|BISTRO|TAQUERIA|BBQ|BREWING|BREWERY|TAVERN|PUB\b|BAR & |SUSHI|RAMEN|PHO\b|THAI|\bTST\*|TOAST\b|EATERY|KITCHEN/, 'dining', '-'],

  // transport
  [/UBER(?! ?EATS)|LYFT|PARKING|PARKMOBILE|E-?470|EXPRESSTOLL|TOLL|DMV|MOTOR VEHICLE|JIFFY LUBE|VALVOLINE|AUTOZONE|O'?REILLY|NAPA|ADVANCE AUTO|DISCOUNT TIRE|BIG O TIRE|LES SCHWAB|FIRESTONE|MIDAS|MEINEKE|CAR WASH|AUTO REPAIR|MOUNTAIN METRO|RTD\b|AMTRAK|GREYHOUND/, 'transport', '-'],

  // health
  [/CVS|WALGREENS|RITE AID|PHARMACY|RX\b|MEDICAL|DENTAL|DENTIST|ORTHO|VISION|OPTOMETR|HOSPITAL|CLINIC|URGENT CARE|UCHEALTH|PENROSE|CENTURA|INTERMOUNTAIN|KAISER|LABCORP|QUEST DIAG|DOCTOR|PHYSICIAN|THERAPY|HEALTH/, 'health', '-'],

  // pets
  [/PETSMART|PETCO|CHEWY|VET\b|VETERINAR|ANIMAL HOSP|BANFIELD|PET SUPPLIES/, 'pets', '-'],

  // household
  [/HOME DEPOT|LOWE'?S|ACE HARDWARE|DOLLAR TREE|DOLLAR GENERAL|FAMILY DOLLAR|BED BATH|ULTA|SALLY BEAUTY|GREAT CLIPS|SUPERCUTS|SPORT CLIPS|BARBER|SALON|LAUNDR|CLEANERS|IKEA|WAYFAIR|HOMEGOODS|BATH & BODY/, 'household', '-'],

  // fees & cash
  [/OVERDRAFT|NSF|INSUFFICIENT|SERVICE CHARGE|MONTHLY FEE|MAINTENANCE FEE|ATM FEE|FOREIGN TRANSACTION FEE|LATE FEE|RETURNED ITEM|PAPER STATEMENT FEE|\bFEE\b/, 'fees', '-'],
  [/ATM WITHDRAWAL|ATM W\/D|ATM CASH|CASH WITHDRAWAL|WITHDRAWAL AT ATM|\bATM\b/, 'cash', '-'],

  // people
  [/VENMO|ZELLE|CASH APP|CASHAPP|SQUARE CASH|PAYPAL|APPLE CASH|GOOGLE PAY SEND/, 'p2p'],

  // entertainment & travel & shopping
  [/AMC|REGAL|CINEMARK|ALAMO DRAFTHOUSE|HARKINS|FANDANGO|TICKETMASTER|STUBHUB|SEATGEEK|EVENTBRITE|DAVE & BUSTER|TOPGOLF|BOWL|GOLF|SKI|VAIL|EPIC PASS|IKON|STEAMPOWERED|EPIC GAMES|GAMESTOP|BREWERY|CONCERT|MUSEUM|ZOO|PIKES PEAK|GARDEN OF THE GODS|CHEYENNE MOUNTAIN|THEATER|THEATRE/, 'entertainment', '-'],
  [/AIRLINE|UNITED AIR|DELTA AIR|SOUTHWEST|FRONTIER AIR|AMERICAN AIR|ALASKA AIR|SPIRIT AIR|JETBLUE|EXPEDIA|BOOKING\.COM|AIRBNB|VRBO|HOTEL|MARRIOTT|HILTON|HYATT|HOLIDAY INN|HAMPTON|BEST WESTERN|LA QUINTA|MOTEL|HERTZ|ENTERPRISE RENT|AVIS|BUDGET RENT|NATIONAL CAR|TURO/, 'travel', '-'],
  [/AMAZON|AMZN|TARGET|BEST BUY|KOHL|MACY|NORDSTROM|ROSS|TJ ?MAXX|MARSHALLS|OLD NAVY|GAP\b|H&M|ZARA|SHEIN|TEMU|ETSY|EBAY|NIKE|ADIDAS|DICK'?S SPORTING|SCHEELS|REI\b|BASS PRO|CABELA|MICHAELS|HOBBY LOBBY|JOANN|BARNES|APPLE STORE|APPLE\.COM(?!\/BILL)|MICROSOFT STORE|SEPHORA|WALGREENS PHOTO|THRIFT|GOODWILL|ARC THRIFT|SAVERS|BURLINGTON|FIVE BELOW|BIG LOTS|PARTY CITY|SHOP|STORE|BOUTIQUE|OUTLET/, 'shopping', '-'],
  [/DONATION|CHURCH|TITHE|CHARITY|GOFUNDME|RED CROSS|UNITED WAY|SALVATION ARMY|1-800-FLOWERS|FTD|HALLMARK/, 'gifts', '-'],
];

export function categorize(description: string, amount: number, userRules: CategoryRule[] = []): string {
  const up = description.toUpperCase();
  // user rules: longest pattern first so specific rules beat broad ones
  if (userRules.length) {
    const merchant = cleanMerchant(description).toUpperCase();
    const sorted = [...userRules].sort((a, b) => b.pattern.length - a.pattern.length);
    for (const r of sorted) {
      const p = r.pattern.toUpperCase();
      if (p && (up.includes(p) || merchant === p)) return r.category;
    }
  }
  for (const [re, cat, sign] of KEYWORDS) {
    if (sign === '+' && amount < 0) continue;
    if (sign === '-' && amount > 0) continue;
    if (re.test(up)) return cat;
  }
  return amount > 0 ? 'income_other' : 'uncategorized';
}

export function isExcludedCategory(cat: string): boolean {
  return categoryOf(cat).group === 'transfer';
}
