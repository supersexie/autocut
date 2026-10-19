# Autocut: setting up payments

A step-by-step guide for whoever connects payments. Everything in the app and server is already built
and switched off. You create the products, put the keys in the right places, test, and switch it on.
You don't need to change any code.

**Rules:** keys and secrets go only into Railway variables or `app/eas.json` as described below. Never
in chat, email or the repo, except the RevenueCat *public* key, which is meant to be public. Ask the owner
before pushing to `main`, because that redeploys the live server.

---

## How it works (2 minutes)

Autocut sells three plans, each monthly or yearly, at the same prices as CutAI (in India: ₹1,999 / ₹4,999 /
₹9,900 a month and ₹14,900 / ₹39,900 / ₹69,900 a year; set those by hand for India in App Store Connect):

| Plan | Monthly | Yearly | What it includes |
|---|---|---|---|
| Starter | $19.99 | $149.99 ($12.50/mo) | 100 edits a month |
| Pro | $49.99 | $399.99 ($33.33/mo) | 300 edits, Overlap audio, Scheduled batch edits |
| Ultimate | $99.99 | $699.99 ($58.33/mo) | Unlimited edits, Overlap audio, Scheduled batch edits |

People can pay two ways, as Apple's rules allow:

- **Apple in-app purchase**, everywhere, through **RevenueCat** (it talks to the App Store for us).
- **Whop**, a web checkout, **only on the US App Store** and shown **next to** Apple's, never instead of it.
  (Apple guideline 3.1.1: subscription apps must offer in-app purchase; outside links are allowed on the US
  storefront only. Apple may start charging a fee on those links after the Epic v. Apple case.)

Either way, the payment provider tells our server (a **webhook**), and the server records the plan on the
person's account where they can't change it. The app then shows the plan. If someone has both, the better
active plan counts.

```
Phone ──buys──▶ Apple ──▶ RevenueCat ──webhook──▶ our server ──▶ plan on the account
Phone ──opens─▶ Whop checkout ─────────webhook──▶ our server ──▶ plan on the account
```

Where things live:
- **Railway** (the server): project **captivating-prosperity**, environment **production**, service
  **autocut**. All server settings below go there, under **Variables**.
- **`app/eas.json`** (the app's build settings): the app-side settings, under `build.production.env`.

---

## Part 1: Apple (App Store Connect)

You need access to the Apple Developer account and App Store Connect for Autocut
(bundle ID `com.rishavvashisht.autocut`).

1. **Agreements first.** App Store Connect → **Business** (Agreements, Tax and Banking): accept the **Paid
   Apps** agreement and fill in banking and tax. In-app purchases don't work until this is done.
   Consider the **App Store Small Business Program** (15% commission instead of 30% under $1M a year).
2. **Create the subscriptions.** App Store Connect → the Autocut app → **Monetization → Subscriptions**:
   - Create one **subscription group**, e.g. `Autocut`.
   - Inside it, six subscriptions. Use these **product IDs** exactly (the plan and period must be in the ID):

     | Product ID | Duration | US price |
     |---|---|---|
     | `autocut.starter.monthly` | 1 month | $19.99 |
     | `autocut.starter.yearly` | 1 year | $149.99 |
     | `autocut.pro.monthly` | 1 month | $49.99 |
     | `autocut.pro.yearly` | 1 year | $399.99 |
     | `autocut.ultimate.monthly` | 1 month | $99.99 |
     | `autocut.ultimate.yearly` | 1 year | $699.99 |

   - Apple only offers fixed price points. All six prices above are Apple price points. The app shows Apple's own price
     in each country automatically, so that's fine. If you want the web (Whop) prices to match exactly, tell
     the developer the final Apple prices so `app/src/lib/plans.ts` can be updated.
   - Order the plans in the group from Ultimate (highest) to Starter, so Apple treats moving up as an upgrade.
   - Each subscription needs a display name, description and a review screenshot (any screenshot of the plan screen).
3. **Sandbox tester** for testing later: **Users and Access → Sandbox → Test Accounts** → add one (use a
   **United States** storefront if you also want to see the Whop option).

---

## Part 2: RevenueCat (connects the app to Apple)

1. Sign up at [revenuecat.com](https://www.revenuecat.com) → **Create project** `Autocut`.
2. **Add app → App Store**. Bundle ID `com.rishavvashisht.autocut`. Follow its prompts to connect App Store
   Connect (it asks for an **In-App Purchase key** and an **App Store Connect API key**, both created in
   App Store Connect → Users and Access → Integrations).
3. **Products**: import the six products from App Store Connect.
4. **Entitlements** (Product catalog → Entitlements). Create exactly these three, and attach products:
   - `starter`: `autocut.starter.monthly`, `autocut.starter.yearly`
   - `pro`: `autocut.pro.monthly`, `autocut.pro.yearly`
   - `ultimate`: `autocut.ultimate.monthly`, `autocut.ultimate.yearly`
5. **Offering** (Product catalog → Offerings). Use the one called `default` (make it **current**) with six
   packages. Use **custom package identifiers**, named exactly:
   `starter_monthly`, `starter_yearly`, `pro_monthly`, `pro_yearly`, `ultimate_monthly`, `ultimate_yearly`,
   each with its matching product.
6. **Webhook** (Integrations → **Webhooks** → Add):
   - **URL:** `https://autocut-production-88f1.up.railway.app/webhooks/revenuecat`
   - **Authorization header value:** make up a long random string (e.g. from a password generator).
   - Environment: both production and sandbox.
   - In Railway → **autocut** → Variables, add `REVENUECAT_WEBHOOK_AUTH` = that same string.
7. **Public API key**: Project settings → **API keys** → the **App Store** public key (starts `appl_`).
   It goes in the app (Part 4). This one is meant to be public.

The app uses each person's account id as their RevenueCat user id, so purchases land on the right account.

---

## Part 3: Whop (web checkout, US only)

1. Sign up at [whop.com](https://whop.com) as a seller and create the business **Autocut**. Set up
   **payouts** (your bank details) in Whop.
2. Create a product **Autocut** with six **recurring** plans in USD:

   | Plan | Price | Period |
   |---|---|---|
   | Starter monthly | $19.99 | Monthly |
   | Starter yearly | $149.99 | Yearly |
   | Pro monthly | $49.99 | Monthly |
   | Pro yearly | $399.99 | Yearly |
   | Ultimate monthly | $99.99 | Monthly |
   | Ultimate yearly | $699.99 | Yearly |

3. Note each plan's ID (starts `plan_`, shown in the plan's settings or checkout link). In Railway →
   **autocut** → Variables, add **one** variable listing all six (no spaces; the names on the left exactly as written):
   ```
   WHOP_PLANS=starter-monthly=plan_AAA,starter-yearly=plan_BBB,pro-monthly=plan_CCC,pro-yearly=plan_DDD,ultimate-monthly=plan_EEE,ultimate-yearly=plan_FFF
   ```
4. **API key**: Whop → **Developer** → API keys → create one that can create checkout configurations
   (`checkout_configuration:create`). Railway → **autocut** → add `WHOP_API_KEY`.
5. **Webhook**: Whop → **Developer** → **Webhooks** → Create:
   - **URL:** `https://autocut-production-88f1.up.railway.app/webhooks/whop`
   - **API version:** v1
   - **Events:** `membership.activated`, `membership.deactivated`, `membership.updated`
     (or `membership_went_valid` / `membership_went_invalid` if that's how Whop lists them)
   - Whop shows a secret starting `ws_` **once**. Railway → **autocut** → add `WHOP_WEBHOOK_SECRET`.
6. Optional: `WHOP_REDIRECT_URL` (where Whop sends buyers afterwards; default `autocut://plan`, which
   reopens the app) and, in the app, `EXPO_PUBLIC_WHOP_MANAGE_URL` (where "Manage subscription" sends Whop
   customers; default `https://whop.com/hub`).

---

## Part 4: Switch it on

1. **App** (`app/eas.json` → `build` → `production` → `env`, and the same under `preview` for test builds), add:
   ```json
   "EXPO_PUBLIC_PAYMENTS": "1",
   "EXPO_PUBLIC_REVENUECAT_IOS_KEY": "appl_…"
   ```
   Then make a new build (`npx eas-cli@latest build --platform ios --profile production`). Apple
   purchases only work in real builds (TestFlight or App Store), never in Expo Go.
2. **Server** (Railway → **autocut** → Variables), only once the tests below pass:
   ```
   PAYMENTS_REQUIRED=1
   ```
   Until this is set, people who haven't paid keep the plan they picked (the free beta). After it's set, an
   account without a paid plan can't start edits and is asked to choose one.

Turn both on together. With the app on and the server off, people could keep using Autocut free; with the
server on and the app off, people couldn't buy.

---

## Part 5: Test (on a TestFlight build)

**Apple:**
1. On the iPhone: Settings → App Store → **Sandbox Account** → sign in with the sandbox tester.
2. Open Autocut → new account (or **Your plan → Change plan**) → choose a plan → **Subscribe**.
3. Check:
   - RevenueCat → **Customers**: the purchase appears (sandbox).
   - Railway → **autocut** → logs: `[billing] apple on pro for 1a2b3c4d`.
   - The app: **Settings → Your plan** shows the plan.
4. **Restore purchases** (Your plan): delete and reinstall the app, sign in, tap Restore → the plan comes back.
5. Change plan (e.g. Pro → Ultimate) → the logs show the new plan.
6. Sandbox subscriptions renew every few minutes and stop after a few renewals; the logs show
   `[billing] apple off …` when it ends, and the plan goes away.

**Whop** (needs a US App Store account, e.g. the US sandbox tester):
1. Choose a plan → **Pay on the web with Whop** → pay (use a real card and refund yourself in Whop, or a
   100% discount code you create in Whop).
2. You come back to the app. Check:
   - Railway logs: `[billing] whop on …`.
   - The app shows the plan.
3. If the logs show nothing, check the webhook's delivery log in Whop. Whop doesn't document every field it
   sends, so on the first real purchase confirm it includes the buyer's metadata (`user_id`) and the plan id;
   if not, the developer adjusts `whopChange()` in `src/billing.js`.

**Limits:** on Starter, the 101st edit in a month is refused, and Schedule is locked.

---

## Cancelling and refunds

- Bought in the app: people cancel in iPhone Settings → Apple ID → Subscriptions (or **Your plan →
  Manage subscription**). Apple handles refunds.
- Bought on the web: people cancel in their Whop account (Manage subscription → "On the web"). Refund
  requests come to you; refund in Whop.
- Either way they keep the plan until the end of the period they paid for, then the webhook removes it.

---

## If something doesn't work

| What you see | Likely cause |
|---|---|
| "Buying a plan works in the Autocut app from the App Store" | It's Expo Go or a build without `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, and the phone isn't on the US store |
| "That plan isn't available in the App Store yet" | The offering isn't `default`/current, a package identifier isn't exactly `pro_monthly` etc., or the products aren't approved / the Paid Apps agreement isn't active |
| Paid, but the plan doesn't show | Webhook not reaching the server: check the URL, and that `REVENUECAT_WEBHOOK_AUTH` matches exactly (401 in RevenueCat's webhook log means it doesn't) |
| Whop button never shows | Not a US App Store account, or `EXPO_PUBLIC_WHOP=0` |
| "Paying on the web isn't set up yet" | `WHOP_API_KEY` or `WHOP_PLANS` missing, or a plan name typo in `WHOP_PLANS` |
| Whop webhook shows 401 | `WHOP_WEBHOOK_SECRET` wrong (paste it exactly, including `ws_`) |

The server's code for all of this is `src/billing.js` (webhooks and plan rules) and `src/auth.js` (`planOf`);
the app's is `app/src/lib/billing.ts` and `app/src/components/PlanPicker.tsx`.
