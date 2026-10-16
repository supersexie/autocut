# Autocut website

The landing page that sends people to the App Store. One file (`index.html`) plus `media/`; no build step.

**Run it locally:** `python3 -m http.server 4321 --directory site` → http://localhost:4321

**Before it goes live**, edit the three settings at the top of the `<script>` in `index.html`:
- `APP_STORE_URL`: the app's App Store link (until then, the buttons say "coming soon").
- `LEGAL_BASE`: the API server's address (it hosts `/privacy` and `/terms`).
- `SUPPORT_EMAIL`: shows a Support link in the footer.

Also uncomment the `apple-itunes-app` meta tag in `<head>` and put in the App Store id: Safari on iPhone then
shows Apple's own "Get / Open" banner.

**Hosting:** any static host. Cloudflare Pages (you already use Cloudflare): Workers & Pages → Create →
Pages → upload the `site` folder (or connect the GitHub repo with build output directory `site`), then add
your domain.

**Before release:** the demo videos (`media/raw.mp4`, `media/edited.mp4`) and the screenshots show another
creator. Get his permission or swap in your own (same file names). Add App Store ratings or reviews only once
they're real.
