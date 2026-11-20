# Pebbles Community

Pebbles Community is the version of Pebbles for anyone in the US. Nothing personal is built in. There are no one else's keys, store or bank. You set it up for your own state, pay, stores and banks, and everything stays on your own phone and computer.

It installs as its own app ("Pebbles Community") next to any other copy and keeps its own data. Its update button only installs newer **Community** files.

## Download

Open the [Releases page](https://github.com/gunnarsonxx/Pebbles/releases) and pick the newest build. Download only the files with **Community** in the name:

| Device | File |
| --- | --- |
| Android phone | `Pebbles-Community.apk` |
| Windows computer | `Pebbles-Community-Setup.exe` |

- **Android:** open the APK. If asked, allow installing from your browser or Files app.
- **Windows:** run the installer. If SmartScreen appears, choose *More info → Run anyway*. The app isn't code-signed.

`Pebbles.apk` and `Pebbles-Setup.exe` are the owner's personal build. Please don't use them.

## First run (about 5 minutes)

The setup asks for:

1. **Your name**, for greetings.
2. **Your pay:** your hourly rate, how often you're paid, and your schedule (overnight shifts work too).
3. **Your state, city and ZIP.**
   - Federal taxes, Social Security and Medicare are figured exactly.
   - Colorado is modeled in detail. Every other state starts with an estimate.
4. **A savings goal**, if you'd like one.

Then upload a **pay stub** on the Paycheck tab. You can upload several at once. Pebbles reads them right on your device and does the following:

- Sets your real deductions (401(k), insurance and so on).
- Replaces the state tax estimate with the rate your stub actually shows.
- Records each paycheck.

## Optional connections (all free)

Pebbles works without any of these. Each one fills in more on its own. In the app, go to **Settings → Connections**: a checklist at the top shows what's set up. Every key stays only on your devices.

### Gas prices: EIA (2 minutes)
1. Go to **eia.gov/opendata** and choose **Register**.
2. Enter your name and email. The key arrives by email within a minute.
3. Paste it into **Settings → Connections → Prices & Updates → EIA API Key**.

You'll get weekly regular-gas prices for your state, or your region if EIA doesn't publish your state. Without a key, Pebbles uses the monthly U.S. average.

### Bank connections: Plaid (10 minutes)
Pebbles uses this to see purchases, paychecks and balances automatically.
1. Sign up at **dashboard.plaid.com**. When asked, describe it as a personal budgeting app for yourself.
2. Choose the free **Trial** plan, which covers up to 10 bank logins, and turn on **Transactions**.
3. Under **Developers → Keys**, copy your **client_id** and your **Production** secret.
4. Paste both into **Settings → Connections → Bank Connections**.
5. Go to **Budget → Accounts → Connect a Bank** and sign in. Repeat for each bank or savings account.

Don't want to connect a bank? You can import CSV statements from your bank's website instead.

### Grocery prices: Kroger (5 minutes)
This gives live prices and weekly sales at Kroger-family stores: Kroger, King Soopers, Ralphs, Fry's, Smith's, Fred Meyer, Harris Teeter, QFC, Dillons, Mariano's, Pick 'n Save and others.
1. Create a free account at **developer.kroger.com**.
2. Register an app: choose **Production** and the **Product** scope.
3. Paste its client ID and secret into **Settings → Connections → Grocery Prices**.
4. Enter your ZIP, tap **Find Stores Near Me**, and check the stores you use.

Shop somewhere else? Skip this. Scanning receipts teaches Pebbles what you pay at any store.

### Gas station prices: Google Places (10 minutes, optional)
This shows today's prices at stations near you. Google's monthly free credit covers normal use.
1. Go to **console.cloud.google.com**, create a project, and enable **Places API (New)**.
2. Create an API key. Recommended: restrict it to **Places API (New)**.
3. Paste it into **Settings → Connections → Gas Stations**.

Without it, station locations still come from OpenStreetMap. You can also screenshot Google Maps' gas list and let Pebbles read the prices.

### Phone + computer
Install both apps. To pair them, open **Settings → Sync** on the computer, then scan the code with your phone. They sync over your home Wi-Fi, encrypted end to end. No cloud account is involved.

## Making it yours

You can tailor every one of these in Settings:

- **Budget:** savings aim, bills mode (same amount every check or just what's due), and emergency fund size.
- **Household:** people, food plan, car MPG and miles.
- **Taxes:** W-4 details, extra withholding, and your own state rate.
- **Pay:** holidays your job pays extra for, overtime rules, and DailyPay (if your job offers it).
- **Look:** theme and colors.
