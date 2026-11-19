# Pebbles

A calm, earthy money tracker and paycheck planner, for your Android phone and your Windows computer.

- **Know what payday brings.** Pebbles starts from your normal two weeks (e.g. 80 h × base rate), adjusts for any day at a different rate, missed days, PTO, extra shifts and overtime, then takes out federal, Social Security, Medicare, Colorado and local taxes to show your take-home.
- **See where money goes.** Import bank statements (CSV, QFX/OFX or PDF). Every transaction is sorted into a category, and each month shows money in, money out, and where it went.
- **A plan for every paycheck.** Each check is split into **Bills**, **Essentials** (groceries, gas, basics), **Savings**, and **For you**, with a "safe to spend per day" number.
- **Save for real things.** Make goals (a ring, a car, a down payment), add a photo, and watch your pile of pebbles grow. 1 pebble = $1 saved, with gemstone milestones at 25/50/75/100%.
- **Prices and tax changes.** Pebbles downloads grocery inflation, staple prices and gas prices, plus updated tax tables, and adjusts your essentials so you're always covered.
- **Field notes.** Plain-language tips from your own spending: subscriptions, eating out vs groceries, fees, coffee runs, three-paycheck months, the "no tax on overtime" refund, and more.
- **Private sync.** Your phone syncs with your computer over your home Wi-Fi only. Nothing goes to a cloud service, and every sync message is encrypted end to end.

---

## Install

Every push to this repository builds both apps on GitHub. Open the repository's **Releases** page (right side of the repo home page) and pick the newest **Pebbles build**.

### Windows computer

1. Download **`Pebbles-Setup.exe`** and run it.
2. Windows SmartScreen may say "Windows protected your PC" because the app isn't code-signed. Click **More info → Run anyway**.
3. The first time your phone connects, Windows may ask whether Pebbles can use **private networks**. Click **Allow**.

Closing the window keeps Pebbles running in the system tray so your phone can sync any time the PC is on. You can turn that off, or turn on "Start Pebbles with Windows", in **Settings → Phone sync**.

### Android phone

1. On your phone, open the Releases page and download **`Pebbles.apk`**.
2. Open the downloaded file. Android will ask to allow installs from your browser or Files app. Allow it, then tap **Install**.
3. Later builds install right over the old one; your data stays.

---

## First-time setup

1. **Set up the computer first.** Open Pebbles on Windows and walk through the short setup: your pay, taxes, home & car, and a first savings goal.
2. **Pair your phone.** On the computer go to **Settings → Phone sync → Pair a phone**. Then either:
   - point your phone's camera at the QR code (it opens Pebbles and pairs automatically), or
   - on the phone tap **"I already set up Pebbles on my computer"** (or **Settings → Sync**) and type the address and 6-digit code.
3. That's it. Whenever both devices are on the same Wi-Fi they stay in sync. Away from home, the phone works normally and catches up when you're back.

---

## Using Pebbles

### Paycheck

- The calendar shows your two-week pay period. **Tap a day** to change it:
  - **Worked**: change hours or pick a different **pay rate** (add rates like "Lead shift" or "Training" under *Pay rates*). You can split a day across two rates, and mark a worked holiday.
  - **Missed**: an unpaid day.
  - **PTO / Sick / Holiday**: paid leave at your base rate.
- The breakdown shows exactly how the estimate was built: base pay → each adjustment → overtime → gross → every tax and deduction → take-home.
- On payday tap **I got paid**, enter what actually landed, and Pebbles splits it and drops the savings into your goals. After a couple of paychecks it learns any gap between its estimate and your real deposits (e.g. a deduction it doesn't know about) and corrects future estimates.

### Spending

- **Import**: download statements from your bank's website or app (look for *Download transactions* or *Export*). CSV or QFX are the most accurate; PDFs work too, but check the preview. Re-importing the same file never creates duplicates.
- Tap any transaction to change its category. Pebbles can remember that choice for the same store in the future. Mark transfers between your own accounts as "Don't count this".

### Savings

- Create goals with a photo, a target, an optional date and a priority. Mark one as your **Bedrock fund** (emergency fund); Pebbles fills it first.
- Each payday, savings are shared out automatically: emergency fund first, then goals with dates (so you hit them on time), then by priority. You can also add or take out pebbles by hand.

### Plan

- **Paycheck plan**: drag the savings slider to choose more pebbles or more spending money for this check.
- **Bills**: add your monthly bills, or tap **+ Bill** on anything Pebbles found repeating in your statements.
- **Essentials**: groceries (your real average, never below the USDA Thrifty plan for your household), gas (miles ÷ mpg × current price), and other basics.
- **Prices near you**: gas, grocery inflation and staple prices. Add a free [EIA API key](https://www.eia.gov/opendata/register.php) in *Settings → Prices* for weekly **Colorado** gas prices; otherwise the U.S. average is used.
- **Field notes**: suggestions to save more, habits to keep or quit, and places to cut back.

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

### Tax table updates

Tax rules live in [`data/tax-rules.json`](data/tax-rules.json). The apps check that file on the **`main`** branch once a day and switch to newer tables automatically (Settings → Taxes shows the version). When rules change, edit the file, bump `version`, and merge to `main`. Note: the 2027 Colorado withholding allowance is provisional until the state publishes the final 2027 DR 1098.

---

## Privacy & security

- All data lives on your phone and your computer. There is no Pebbles server or account.
- Phone ↔ computer sync happens only on your local network. Pairing uses an ECDH key exchange authenticated by the 6-digit code, and every sync payload is encrypted with AES-256-GCM.
- The computer keeps a daily backup (the last 14 days) in its data folder (*Settings → Backup → Open data folder*). You can also save or restore a backup file by hand.
- The only internet requests are for public price data (BLS, EIA) and the tax-table file on GitHub.
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
