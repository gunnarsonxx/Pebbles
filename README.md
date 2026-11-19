# Pebbles

A calm, earthy money tracker and paycheck planner, for your Android phone and your Windows computer.

- **Know what payday brings.** Pebbles starts from your normal two weeks (e.g. 80 h × base rate), adjusts for any day at a different rate, missed days, PTO, extra shifts and overtime, then takes out federal, Social Security, Medicare, Colorado and local taxes to show your take-home.
- **See where money goes.** Import bank statements (CSV, QFX/OFX or PDF). Every transaction is sorted into a category, and each month shows money in, money out, and where it went.
- **A plan for every paycheck.** Each check is split into **Bills**, **Essentials** (groceries, gas, basics), **Savings**, and **For you**, with a "safe to spend per day" number.
- **Save for real things.** Make goals (a ring, a car, a down payment), add a photo, and watch your pile of pebbles grow. 1 pebble = $1 saved, with gemstone milestones at 25/50/75/100%.
- **Prices and tax changes.** Pebbles downloads grocery inflation, staple prices and gas prices, plus updated tax tables, and adjusts your essentials so you're always covered.
- **Field notes.** Plain-language tips from your own spending: subscriptions, eating out vs groceries, fees, coffee runs, three-paycheck months, the "no tax on overtime" refund, and more.
- **Autopilot.** On payday Pebbles tells you exactly what to move ("Move $280 to Marcus") and checks it off when it sees the transfer in your bank. Everything else is figured out for you.
- **Bank connections.** Link your checking account and Marcus through Plaid (free Trial plan) so transactions, your paycheck deposit and your savings balance arrive on their own.
- **Receipts & pay stubs.** Snap grocery receipts and upload pay stubs. They're read right on your device; anything unclear is highlighted for you to fix.
- **Grocery smarts.** Learns your usual needs-only trip, spots the extras, checks King Soopers prices and sales on what you buy, and figures your grocery budget with sales tax.
- **Marcus interest.** Projects monthly interest on your high-yield savings and adds the real interest to your goals.
- **Private sync.** Your phone syncs with your computer over your home Wi-Fi only. Nothing goes to a cloud service, and every sync message is encrypted end to end.
- **Retirement & FIRE (Grow tab).** Your FI number, when you could be financially independent, Coast/Lean/Fat FI, the savings-rate table, which account to fund next, and this week's top posts from r/financialindependence.
- **Overnight shifts.** Shifts that cross midnight count their hours on the day they're worked (e.g. 9:30p–6a = 2.5 h + 5.5 h), across work weeks and pay periods.
- **One-tap updates**, a **light / dark** toggle (moon or sun at the top), and **color themes** (5 backgrounds × 7 accents) in Settings.

---

## Install

Every push to this repository builds both apps on GitHub. Open the repository's **Releases** page (right side of the repo home page) and pick the newest **Pebbles build**.

### Windows computer

1. Download **`Pebbles-Setup.exe`** and run it.
2. Windows SmartScreen may say "Windows protected your PC" because the app isn't code-signed. Click **More info → Run anyway**.
3. The first time your phone connects, Windows may ask whether Pebbles can use **private networks**. Click **Allow**.

Closing the window keeps Pebbles running in the system tray so your phone can sync any time the PC is on. You can turn that off, or turn on "Start Pebbles with Windows", in **Settings → Sync & devices**.

### Android phone

1. On your phone, open the Releases page and download **`Pebbles.apk`**.
2. Open the downloaded file. Android will ask to allow installs from your browser or Files app. Allow it, then tap **Install**.
3. Later builds install right over the old one; your data stays.

### Updating

Pebbles checks for new versions once a day. When one is ready you'll see **"A new version of Pebbles is ready · Update"** on Home (or tap **Settings → Updates & backup → Check for updates**).
- **Windows:** downloads, verifies and installs it, then reopens Pebbles.
- **Android:** downloads it and opens Android's installer. The first time, Android asks you to allow Pebbles to install updates: turn on **Allow from this source**, come back, and tap Update again.

---

## First-time setup

Set up on whichever device you have handy; you can pair the other one any time later.

- **Phone first, computer later:** set up Pebbles on your phone and use it normally. When you install the Windows program, tap **"I already set up Pebbles on my phone"** on its welcome screen, then **Pair a phone**. On the phone go to **Settings → Sync & devices** and enter the address and 6-digit code (or point the phone's camera at the QR code). Everything from your phone appears on the computer in seconds.
- **Computer first:** set up on Windows, then on the phone tap **"I already set up Pebbles on my computer"** and pair the same way.

Whenever both devices are on the same Wi-Fi they stay in sync. Away from home, the phone works normally and catches up when you're back.

### Connecting your banks (optional, recommended)

Pebbles connects to banks through **Plaid**, which many banking apps use. Plaid's **Trial plan is free** for up to 10 bank logins. One-time setup, about five minutes:

1. Sign up at **dashboard.plaid.com** (free). Describe it as a personal budgeting app for yourself.
2. Pick the free **Trial** plan when offered, and make sure **Transactions** is enabled.
3. In **Developers → Keys**, copy your **client_id** and **Production secret** into Pebbles: **Settings → Connections**.
4. Go to **Budget → Accounts → Connect a bank**, sign in to your checking bank, then repeat for **Marcus**.

Transactions and balances refresh a few times a day. **Settings → Connections** shows a ✓ or ✗ for Plaid, Kroger, gas and grocery prices, and updates, with a Test button. If a bank sign-in finishes but the bank doesn't appear, tap **Refresh** on Budget → Accounts: Pebbles picks up any sign-in from the last 6 hours, and the **Connection status** list there shows each step. Pebbles makes your Marcus account the home for your savings goals automatically. Add its APY under **Budget → Accounts → (Marcus)** so it can project your monthly interest.

### King Soopers prices (optional)

Create a free account at **developer.kroger.com**, register an app with the **Product** scope, then enter its client ID and secret in **Settings → Connections**, tap **Find stores near me**, and tick every King Soopers you shop at. Walmart doesn't share prices with apps, so Walmart prices come from your own Walmart receipts.

---

## Using Pebbles

Five tabs: **Home**, **Pay**, **Budget**, **Groceries** and **Savings**. Settings is the gear at the top, split into categories.

### Pay

- **Your shifts**: the button at the top of the calendar sets day or **overnight** shifts (start and end time, break, the nights a shift starts). Hours count on the calendar day they're worked, so a Saturday-night shift on the last day of a pay period puts 2.5 h on this check and 5.5 h on the next. Calling off a shift takes off exactly those hours.
- **Tap a day** to change it: worked (other hours, other times, other rates, split across rates), missed, PTO, sick or a paid holiday. **Reset** clears the period's changes after asking, and can be undone.
- **Holidays**: the 11 federal holidays are built in (plus optional Christmas Eve, New Year's Eve, the day after Thanksgiving and Easter). Hours worked on one pay your holiday rate (1.5× by default) automatically. Choose in Settings → Pay & schedule whether it's the hours on that date or whole shifts that start on it.
- **Pay stubs**: upload a PDF, photo or screenshot. Pebbles reads table-style stubs (it removes the grid lines and rebuilds each row), checks the taxes add up to the stub's totals, copies your deductions and matches future estimates to your real checks.

### Budget

- **Plan**: each check splits into **bills**, **your money** (groceries, gas and basics, plus what's yours to enjoy) and **savings**. Drag the slider for more pebbles or more spending money.
- **Spending**: import statements or connect banks. **What you bought** breaks your receipts down by kind: gas, nicotine, snacks, drinks, groceries, so a Circle K stop isn't just "Circle K".
- **Accounts**: connected banks, balances, and which account holds your goals.

### Groceries

- **List**: fills itself from pantry items that are low or out (and ones you usually rebuy about now), plus anything you add. Shows what the **next trip** will cost with tax, using King Soopers prices or what you last paid. Tick items off in the store.
- **Pantry**: type a quick list (`eggs 12`, `rice 5 lb`, `milk`, `coffee low`). Count things, measure things, or just mark them Full / Half / Low / Out. Receipts restock what they match.
- **Receipts**: any store, gas stations included. Pebbles learns your prices and your real monthly grocery spending from all your trips, small or big, and that number goes straight into your budget.
- **Gas**: stations near home and near you. Prices come from your gas receipts and prices you tap in; add a Google Maps key (Settings → Connections) for live posted prices. Pebbles tells you whether a cheaper station is worth the drive, and your gas budget uses the price you actually pay.

### Savings

- **Goals**: a photo, a target, an optional date and a priority. Your **Bedrock fund** (emergency fund) fills first.
- **Marcus is the source of truth**: your goals always add up to the Marcus balance. Each deposit is split the way that paycheck's plan split it (say $53 to the ring and $212 to Bedrock), interest is shared across goals, money that was already there is spread out, and **Adjust split** lets you set it exactly.
- **Retirement**: one answer first (when you could retire, and how far along you are), your single next step, then details you can open: every step in order, different ways to retire, how savings rate changes things, and investing basics.

### Look

Settings → Appearance: five backgrounds and twelve gemstone accents, light or dark. **Alexandrite** is teal in light mode and raspberry in dark mode, like the real stone in daylight and lamplight.

---

## How the numbers are figured

| Piece | Method |
|---|---|
| Federal income tax | IRS Publication 15-T percentage method for 2020+ W-4s (annualized, standard deduction built in, W-4 steps 2–4 supported) |
| Social Security / Medicare | 6.2% up to the wage base ($184,500 in 2026, $192,300 in 2027) / 1.45% (+0.9% over $200k) |
| Colorado income tax | DR 1098 method. 2026: 4.4% flat after the $5,500 allowance ($11,000 married filing jointly), or your DR 0004 amount. 2027: the new graduated rates from **Amendment 87** (approved Nov 3, 2026): 3.7% to $25k, 4.2% to $100k, 4.4% to $500k, then higher |
| Colorado FAMLI | Employee share of the paid-leave premium: 0.44% (2026), 0.43% (2027) |
| Local taxes | Colorado Springs / El Paso County have none. Denver, Aurora, Greenwood Village and Sheridan occupational privilege taxes are available in Settings |
| Overtime | Over 40 h/week or 12 h/day (Colorado), at 1.5× the week's blended rate (the legal "regular rate"). Paid leave doesn't count toward overtime |
| Groceries | USDA Food Plans (Cost of Food at Home), adjusted for household size and BLS food-at-home inflation |
| Gas | U.S. EIA weekly Colorado regular gasoline (with a key), otherwise BLS U.S. average |

These are estimates of withholding, not tax advice. Your employer's payroll system may round differently by a few cents.

### Tax table and guideline updates

Budget guidelines live in [`data/guidelines.json`](data/guidelines.json) and update the same way as tax tables.

Tax rules live in [`data/tax-rules.json`](data/tax-rules.json). The apps check that file on the **`main`** branch once a day (falling back to the build branch until it's merged) and switch to newer tables automatically (Settings → Taxes & deductions shows the version). When rules change, edit the file, bump `version`, and merge to `main`. Note: the 2027 Colorado withholding allowance is provisional until the state publishes the final 2027 DR 1098.

---

## Privacy & security

- All data lives on your phone and your computer. There is no Pebbles server or account.
- Phone ↔ computer sync happens only on your local network. Pairing uses an ECDH key exchange authenticated by the 6-digit code, and every sync payload is encrypted with AES-256-GCM.
- The computer keeps a daily backup (the last 14 days) in its data folder (*Settings → Updates & backup → Open data folder*). You can also save or restore a backup file by hand.
- Receipts and pay stubs are read on your device (the text reader ships inside the app); images are never uploaded.
- Internet requests: public price data (BLS, EIA), tax tables / guidelines / updates from this GitHub repo, and, only if you set them up, Plaid (your banks) and Kroger (store prices). Plaid and Kroger keys and bank access tokens are stored on your phone and computer only.
- The built-in EIA key is public in this repo. It only reads public gas-price data.
- The Android APK is signed with a key stored in this repo (`android/app/pebbles-sideload.keystore`). That keeps updates installing over each other without losing data, which is fine for a personal, side-loaded app. Don't reuse it for an app store release.

---

## Development

```bash
npm install
npm run dev            # web version at http://localhost:5173
npm test               # unit tests (tax engine, pay, parsers, planner, sync hub)
npm run typecheck
npm run desktop:start  # run the Windows/desktop app locally
npm run desktop:dist   # build the Windows installer (on Windows)
npm run android:sync   # copy the web build into the Android project
```

Project layout:

- `src/core`: plain TypeScript logic (taxes, pay periods, overtime, statement parsing, categories, budget planner, insights, sync protocol)
- `src/ui`: React screens and components
- `src/data`: local database (IndexedDB) and the sync client
- `desktop`: Electron main process and the LAN sync hub
- `android`: Capacitor Android project
- `data/tax-rules.json`: tax tables, updated over the air
