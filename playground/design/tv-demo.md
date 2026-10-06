# The TV demo

Channel 4, **20 October 2026**. The owner runs it live. Decision D44: a 2-minute scripted demo in English and Persian, which works with the network off, and a recorded backup video.

The slot length was not given. This script is **2 minutes**. Section 2 has a 1-minute cut. Section 3 has an optional 20-second beat.

> Not in this demo: Shamsine. A form that reacts to a Minab rule belongs to Shamsine's own TV plan (D44).

---

## 1. Before you go on air

1. Open **`https://minab-lang.org/?demo=tv`** (the card in section 6 has the exact URLs).
2. Wait for the green toast: **"Demo ready. Everything is loaded. It works offline now."** It appears after about 5 to 10 seconds. Until you see it, do not start.
3. Turn the network **off** (Wi-Fi off, or airplane mode). The demo does not need it.
4. **Never reload the page** and never type a URL after this point. A page load needs the network. If the page breaks, use the backup video (section 5).

What `?demo=tv` does:

| It does | Why |
|---|---|
| Makes the text 150% and the editor font larger | A TV screen is read from far away |
| Uses the dark theme (it also saves "dark" as the site's theme in this browser) | Best contrast on a TV |
| Loads the editor, the language engine, PostgreSQL (the WebAssembly database) and every page of the script at once | Nothing loads during the live part |
| Shows the "Demo ready" toast, and sets `data-demo-ready="true"` on the page | You know when it is safe |

The flag is kept for the tab, so clicking around the site keeps the big text. To turn it off, close the tab, or open the site in a new tab without the flag. After the show, set the theme back with the sun/moon button if you want the light theme.

There is no separate high-contrast theme. The dark theme is the high-contrast choice for the TV. A new theme would be a design change (not in W5).

---

## 2. The script (2 minutes)

You start on the **landing page**. "Click" means click with the mouse. Pages inside the site change without a page load, so there is no waiting.

Say it in the **language of the column** (the owner runs both languages: English first, and the Persian beats in Persian). Keep each line short.

| Time | You click or type | The audience sees | You say (English) | You say (Persian) |
|---|---|---|---|---|
| **0:00–0:15** | Nothing. The landing page is open. | The headline and the hero demo (a query, with the SQL it compiles to) | "This is Minab. One small language for two jobs: asking questions of your data, and checking the data before you save it." | «این میناب است؛ یک زبان کوچک برای دو کار: پرسیدن از داده، و اعتبارسنجی داده پیش از ذخیره.» |
| **0:15–0:30** | Click the **Rule** tab in the hero box | A rule, and a green **Passes** with the SQL it needs | "A rule is the same language. And it tells you the exact SQL that it needs." | «یک قانون هم با همین زبان نوشته می‌شود، و می‌گوید دقیقاً چه SQL لازم دارد.» |
| **0:30–1:00** | Click **Examples** (top bar), then the card **No double bookings**. The **Execution** tab is open. Hover the highlighted statement. Click the **Result** tab. Click the chip **Overlaps bkg-12**. Then click **Free slot**. | The booking rule. One highlighted part of the source, and the one SQL statement it became. **Fails**, then **Passes** | "This rule checks a booking. Only this part needs the database. It becomes one SQL statement. The rest is answered in memory. Try a booking that overlaps: it fails. A free slot: it passes. This is a real PostgreSQL, and it runs in this browser." | «این قانون یک رزرو را بررسی می‌کند. فقط همین بخش به پایگاه‌داده نیاز دارد و یک دستور SQL می‌شود. بقیه در حافظه جواب می‌گیرد. رزرو هم‌پوشان: رد می‌شود. زمان آزاد: قبول می‌شود. این یک PostgreSQL واقعی است، داخل همین مرورگر.» |
| **1:00–1:15** | Click in the editor. Press **Ctrl+A** (Cmd+A on a Mac). Type `0.1 + 0.2` | **DECIMAL · exact 0.3** | "Money must be exact. Nought point one plus nought point two is exactly nought point three." | «برای پول، عدد باید دقیق باشد: ۰٫۱ به‌علاوهٔ ۰٫۲ دقیقاً ۰٫۳ می‌شود.» |
| **1:15–1:30** | Click **Examples**, then the card **Strict types, on purpose**. Click the **Problems** tab. | A red error: it needs an explicit `CAST` | "Types are strict. This compares text with a number. Minab stops it before anything runs." | «نوع‌ها سخت‌گیرانه‌اند. اینجا متن با عدد مقایسه شده، و میناب پیش از اجرا جلویش را می‌گیرد.» |
| **1:30–1:50** | Click **Examples**, then the card **Names in Persian**. Click the **Result** tab. Then, in the bottom panel, click the tab **سفارش**. | A table with Persian column names and Persian rows (علی رضایی …). The bottom panel shows the Persian table too | "Names can be in any language. Here the table, the fields and the results are Persian." | «نام‌ها به هر زبانی می‌توانند باشند. اینجا جدول، فیلدها و نتیجه‌ها فارسی‌اند.» |
| **1:50–2:00** | Click the **.minab** logo (top left) to go back to the landing page | The landing page, with the web address | "It runs in your browser, and inside a NestJS server. Minab-lang dot org." | «در مرورگر شما اجرا می‌شود، و در سرور NestJS هم. minab-lang.org.» |

### The name (optional, the owner decides)

The site says why the language is named Minab (D40: in memory of the 168 children and their teachers of the school in Minab). If you want to say it on air, say it **once, at 0:00, before the first line**, in your own words. This document does not write that line for you.

### The 1-minute cut

Use this if the slot is short. Do these rows only: **0:00–0:15** (shorten to one sentence), **0:30–1:00** (bookings), **1:30–1:50** (Persian), **1:50–2:00** (close). That is about 1 minute.

---

## 3. Optional beat: debug with LOG (+20 seconds)

Between the Persian beat and the close, if you have time.

| You click | The audience sees | You say |
|---|---|---|
| **Examples**, then **Debug with LOG**. Click the **Console** tab. | "3 lines, in evaluation order": `points`, `total`, `bonus(12)` | "To see inside a program, wrap any value in LOG. It prints it and gives it back." |

---

## 4. If something goes wrong

| What happens | What you do |
|---|---|
| The toast does not appear after 20 seconds | Close the tab. Open the demo URL again (network **on**). Wait for the toast. Then turn the network off. |
| A click shows nothing | Wait 2 seconds. Click again. Do not reload. |
| You typed something wrong in the editor | Click **Examples**, then the card again. The example starts fresh. |
| The page shows an error, or goes blank | Switch to the second device. Play the backup video. Say "Here is a recording of the same demo." Do not try to fix it on air. |
| The bottom panel shows English rows (`Customer`) in the Persian beat | Click the tab **سفارش** in that panel. It still lists the table of the example you opened before. (A known small bug, see the status file.) |
| Someone asks for a feature you have not shown | "It is in the playground. The link is on screen." |

---

## 5. The offline proof

**What was tested.** `playground/tests/tv-demo.spec.ts` (Playwright, Chromium) opens `/?demo=tv`, waits for the ready flag, switches the network **off**, and then runs the whole script above, **twice in a row**, without a reload. It checks the result of every beat (Passes, Fails, `DECIMAL · exact 0.3`, the `CAST` error, the Persian rows, the Console lines). The test is part of `npm run test:site` and runs in CI (`site-checks.yml`).

**Result (2026-10-06).** On the production build served by `vite preview`: both runs pass, with the network off. The proof also holds the other way: with the preloading switched off, the script fails offline (the first click on a page that was not loaded times out). So the preloading is what makes it safe.

**What this does not prove.** It does not test `minab-lang.org` itself. The sandbox that made this could not reach the live site. **The owner does the same run once on the live URL** (rehearsal checklist, section 6). Why it should hold: the live site serves the same files. The database (PGlite) runs in the browser, and its `.wasm` files are in the page after load.

**Load time.** The demo page is ready (the toast shows) in **about 7 to 8 seconds** on the sandbox's CPU, with no network delay (a local server). The test fails if it is slower than 10 seconds. The number on the live site depends on the connection. **The owner measures it once on the real connection** and writes it in the rehearsal log below. The assets are cached for a year after the first load (`_headers`), so the second open is faster.

**Known limit.** The site has no offline mode for page loads. A reload with the network off fails. This is why section 1 says never to reload. A service worker could remove this limit (a later task, see the status file).

---

## 6. Rehearsal checklist

Do all of it once, on the real device, on the real connection, at least two days before 20 October. Tick each line.

**Device and screen**
- [ ] The device that goes on air is the one you rehearse on (same laptop, same cable, same adapter).
- [ ] Browser: Chrome or Edge, up to date. Write the version: ______ (about:version).
- [ ] The display is 1920×1080 (or what the studio gives you). Display scaling: 100%. Browser zoom: 100%. (The demo mode already makes the text bigger. Do not also zoom.)
- [ ] The screen is mirrored, or extended, as the studio wants. Check the cursor is visible on the TV (make the pointer big in the system settings if not).
- [ ] Close every other tab and window. Hide the bookmarks bar. Turn the browser to full screen (F11).

**Network off test**
- [ ] Open the demo URL with the network **on**. Time until the green toast: ______ seconds (must be under 10).
- [ ] Switch the network **off** (Wi-Fi off and cable out).
- [ ] Run the whole script, start to end, with a clock: ______ seconds.
- [ ] Without reloading, go back to the landing page and run it a second time.
- [ ] Switch the network on again.

**Power and noise**
- [ ] The laptop is on power, and the battery is above 80% anyway.
- [ ] Sleep and the screen saver are off. Do Not Disturb (focus mode) is on. All notifications are off (chat, mail, calendar, system updates).
- [ ] The microphone is the one the studio gave you. The volume is checked.
- [ ] Automatic updates are paused for the day.

**Backup**
- [ ] A **second device** has the backup video open, paused at the start, and it is charged.
- [ ] The video is also on a USB stick, and on the studio's computer if they allow it.
- [ ] The second device can play it with no network.

**The card.** Print this card, or put it on the phone:

```
LIVE DEMO       https://minab-lang.org/?demo=tv
Wait for        "Demo ready" toast, then network OFF
Never           reload, never type a URL
Backup video    second device, paused at 0:00
If it breaks    say "here is a recording", press play
Fallback site   https://minab-lang.org   (network on)
```

**Rehearsal log** (the owner fills it in)

| Date | Device and browser | Toast after (s) | Script time (s) | Network off run ok? | Notes |
|---|---|---|---|---|---|
| | | | | | |

---

## 7. The backup video

The owner records it, using the same script, on the same device.

- **Format:** 1920×1080, 30 frames per second, MP4 (H.264), stereo audio, 2 minutes at most.
- **Tool:** OBS Studio, or the system screen recorder. Record the **browser window only** (or the whole screen, with notifications off).
- **How:** Do the full rehearsal first. Record with the demo URL, in the same state as the live show (network off after the toast). One take of the English narration and one of the Persian narration, or both languages in one video as in the script. Pick what you will play on air. Keep the other as a spare.
- **Captions:** Burn in short English captions (and Persian captions under them), or add a subtitle file (`.srt`). Use the "You say" columns of section 2. TV studios often mute the video, so captions are required.
- **Files:** `minab-tv-demo-backup-en.mp4`, `minab-tv-demo-backup-fa.mp4` (and the `.srt` files). Keep them outside the repository (the files are large). Copy them to the second device, a USB stick and a cloud folder.
- **Check:** Play the video on the second device with the network off. The sound, the captions and the end of the video are right.

---

## 8. Who does what

| | |
|---|---|
| The owner | Rehearses, records the backup video, runs the live demo, owns the accounts and the domain |
| This repository | The script, the demo mode (`?demo=tv`), the offline test, the uptime check (`.github/workflows/site-uptime.yml`) |
