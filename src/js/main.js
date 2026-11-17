function parseCount(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw !== "string") return null;

  const cleaned = raw.trim().toLowerCase().replace(/,/g, "");
  const match = cleaned.match(/^([\d.]+)\s*([km])?/);
  if (!match) return null;

  const num = parseFloat(match[1]);
  if (!Number.isFinite(num)) return null;

  if (match[2] === "k") return Math.round(num * 1000);
  if (match[2] === "m") return Math.round(num * 1000000);
  return Math.round(num);
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function setVersionText(rawTag) {
  const versionEl = document.getElementById("version");
  if (!versionEl || !rawTag) return;
  const cleaned = String(rawTag)
    .trim()
    .replace(/^(?:beta-)?v/i, "");
  versionEl.textContent = `v${cleaned}`;
}

async function fetchGitHubStats() {
  let downloads = 0;
  let stars = null;
  let foundReleases = false;

  const [releasesRes, repoRes] = await Promise.allSettled([
    fetchJson(
      "https://api.github.com/repos/ancym0n/Minecraft-Bot-Panel/releases?per_page=100",
    ),
    fetchJson("https://api.github.com/repos/ancym0n/Minecraft-Bot-Panel"),
  ]);

  if (
    releasesRes.status === "fulfilled" &&
    Array.isArray(releasesRes.value) &&
    releasesRes.value.length > 0
  ) {
    const releases = releasesRes.value;
    foundReleases = true;
    if (releases[0]?.tag_name) {
      setVersionText(releases[0].tag_name);
    }
    for (const rel of releases) {
      if (Array.isArray(rel?.assets)) {
        for (const asset of rel.assets) {
          if (typeof asset?.download_count === "number") {
            downloads += asset.download_count;
          }
        }
      }
    }
  }

  if (
    repoRes.status === "fulfilled" &&
    typeof repoRes.value?.stargazers_count === "number"
  ) {
    stars = repoRes.value.stargazers_count;
  }

  if (!foundReleases) {
    try {
      const badge = await fetchJson(
        "https://img.shields.io/github/v/release/ancym0n/Minecraft-Bot-Panel.json",
      );
      if (
        badge?.value &&
        !badge.value.includes("invalid") &&
        !badge.value.includes("no releases")
      ) {
        setVersionText(badge.value);
      }
    } catch (_) {}
  }

  if (downloads === 0) {
    try {
      const dlBadge = await fetchJson(
        "https://img.shields.io/github/downloads/ancym0n/Minecraft-Bot-Panel/total.json",
      );
      const parsed = parseCount(dlBadge?.value);
      if (parsed !== null) downloads = parsed;
    } catch (_) {}
  }

  if (stars === null) {
    try {
      const starBadge = await fetchJson(
        "https://img.shields.io/github/stars/ancym0n/Minecraft-Bot-Panel.json",
      );
      const parsed = parseCount(starBadge?.value);
      if (parsed !== null) stars = parsed;
    } catch (_) {}
  }

  return { downloads, stars };
}

async function fetchMcVersionRange() {
  try {
    const versions = await fetchJson(
      "https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data/pc/common/versions.json",
    );
    if (Array.isArray(versions) && versions.length > 0) {
      for (let i = versions.length - 1; i >= 0; i--) {
        const v = String(versions[i] || "").trim();
        if (/^\d+\.\d+(?:\.\d+)?$/.test(v)) {
          return `1.8 ➙ ${v}`;
        }
      }
    }
  } catch (_) {}
  return "1.8 ➙ latest";
}

function updateStatDividers() {
  const statsContainer = document.getElementById("stats");
  if (!statsContainer || statsContainer.hidden) return;

  const markRowStarts = (items) => {
    let prevTop = null;
    for (const item of items) {
      const top = item.offsetTop;
      const isRowStart = prevTop === null || Math.abs(top - prevTop) > 4;
      item.classList.toggle("is-row-start", isRowStart);
      prevTop = top;
    }
  };

  const skeletons = Array.from(
    statsContainer.querySelectorAll(".stat-skeleton"),
  ).filter((el) => el.offsetParent !== null);
  if (skeletons.length > 0) markRowStarts(skeletons);

  const realItems = Array.from(
    statsContainer.querySelectorAll(".stat-item:not([hidden])"),
  ).filter((el) => el.offsetParent !== null);
  if (realItems.length > 0) markRowStarts(realItems);
}

async function loadAllStats() {
  const statsContainer = document.getElementById("stats");
  const totalDownloadsEl = document.getElementById("total-downloads");
  const githubStarsEl = document.getElementById("github-stars");
  const mcVersionsEl = document.getElementById("mc-versions");

  const [github, mcRange] = await Promise.all([
    fetchGitHubStats(),
    fetchMcVersionRange(),
  ]);

  if (!statsContainer) return;

  const totalDownloads = github.downloads || 0;

  let hasAnyStat = false;
  const pending = [];

  if (totalDownloadsEl && totalDownloads > 0) {
    pending.push({
      el: totalDownloadsEl,
      text: `Downloads: ${totalDownloads.toLocaleString()}`,
    });
    hasAnyStat = true;
  }

  if (githubStarsEl && typeof github.stars === "number" && github.stars >= 0) {
    pending.push({
      el: githubStarsEl,
      text: `GitHub: ★ ${github.stars.toLocaleString()}`,
    });
    hasAnyStat = true;
  }

  if (mcVersionsEl && mcRange) {
    pending.push({
      el: mcVersionsEl,
      text: `MC: ${mcRange}`,
    });
    hasAnyStat = true;
  }

  const STATS_RESIZE_MS = 450;
  // If the loading screen is still covering the page, swap instantly:
  // nobody can see it, and the items then fade in with the page entrance.
  const reduceMotion =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("is-booting");

  // Swap skeleton -> content while animating the box between its old and
  // new size, so nothing below it jumps.
  // Layout size, unaffected by the #content load-in transform
  const measure = () => {
    const cs = getComputedStyle(statsContainer);
    return { width: parseFloat(cs.width), height: parseFloat(cs.height) };
  };

  const animateResize = (mutate, onDone) => {
    const from = measure();
    mutate();
    const to = measure();

    if (
      reduceMotion ||
      (Math.abs(from.width - to.width) < 1 &&
        Math.abs(from.height - to.height) < 1)
    ) {
      onDone();
      return;
    }

    statsContainer.classList.add("is-resizing");
    statsContainer.style.width = `${from.width}px`;
    statsContainer.style.height = `${from.height}px`;
    void statsContainer.offsetWidth; // commit starting size
    statsContainer.style.width = `${to.width}px`;
    statsContainer.style.height = `${to.height}px`;

    setTimeout(() => {
      statsContainer.style.width = "";
      statsContainer.style.height = "";
      statsContainer.classList.remove("is-resizing");
      onDone();
    }, STATS_RESIZE_MS);
  };

  if (hasAnyStat) {
    animateResize(
      () => {
        for (const { el, text } of pending) {
          el.textContent = text;
          el.hidden = false;
        }
        statsContainer.removeAttribute("aria-busy");
        // Skeletons switch to an overlay (out of flow) so the box can size
        // to the real items while the shimmer stays visible until the end.
        statsContainer.classList.add("is-swapping");
        statsContainer.classList.remove("is-loading");
        updateStatDividers();
      },
      () => {
        updateStatDividers();
        // Crossfade: skeleton overlay fades out as the real items fade in
        statsContainer.classList.add("is-loaded");
        setTimeout(
          () => statsContainer.classList.remove("is-swapping"),
          reduceMotion ? 0 : 350,
        );
      },
    );
  } else {
    // Nothing to show: smoothly collapse the reserved space (including the
    // grid gap above it), then remove it from layout.
    statsContainer.removeAttribute("aria-busy");
    const gap = parseFloat(
      getComputedStyle(statsContainer.parentElement).rowGap || "0",
    );
    statsContainer.classList.add("is-resizing");
    statsContainer.style.height = `${statsContainer.offsetHeight}px`;
    void statsContainer.offsetWidth;
    statsContainer.classList.add("is-empty");
    statsContainer.style.height = "0px";
    statsContainer.style.minHeight = "0px";
    statsContainer.style.paddingTop = "0px";
    statsContainer.style.paddingBottom = "0px";
    statsContainer.style.borderWidth = "0px";
    statsContainer.style.marginTop = `${-gap}px`;
    statsContainer.style.marginBottom = "0px";
    setTimeout(
      () => {
        statsContainer.hidden = true;
        statsContainer.removeAttribute("style");
        statsContainer.classList.remove("is-resizing", "is-loading");
      },
      reduceMotion ? 0 : STATS_RESIZE_MS,
    );
  }
}

// ---------- Privacy policy "last updated" date ----------
// Uses the latest commit on the `page` branch (any file, not just the policy).
const LAST_UPDATED_CACHE_KEY = "mcbp:page-last-commit";
const LAST_UPDATED_CACHE_MS = 10 * 60 * 1000;

async function fetchPageLastCommitDate() {
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(LAST_UPDATED_CACHE_KEY) || "null",
    );
    if (cached && Date.now() - cached.at < LAST_UPDATED_CACHE_MS) {
      return cached.date;
    }
  } catch {
    /* storage unavailable: just fetch */
  }

  const commits = await fetchJson(
    "https://api.github.com/repos/ancym0n/Minecraft-Bot-Panel/commits?sha=page&per_page=1",
  );
  const commit = Array.isArray(commits) ? commits[0] : null;
  const date =
    commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
  if (!date) throw new Error("No commit date");

  try {
    sessionStorage.setItem(
      LAST_UPDATED_CACHE_KEY,
      JSON.stringify({ date, at: Date.now() }),
    );
  } catch {
    /* ignore */
  }
  return date;
}

// "HH:MM:SS DD.MM.YYYY" in the visitor's own time zone
function formatTimestamp(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${p.hour}:${p.minute}:${p.second} ${p.day}.${p.month}.${p.year}`;
}

async function loadLastUpdated() {
  const wrapper = document.getElementById("last-updated");
  const dateEl = document.getElementById("last-updated-date");
  if (!wrapper || !dateEl) return;

  // Always show a concrete timestamp: fall back to the last known commit
  // baked into the HTML if GitHub can't be reached.
  let iso = "";
  try {
    iso = await fetchPageLastCommitDate();
  } catch (_) {
    iso = dateEl.dataset.fallback || "";
  }

  if (iso) {
    const time = document.createElement("time");
    time.dateTime = iso;
    time.textContent = formatTimestamp(new Date(iso));
    dateEl.replaceChildren(time);
    dateEl.title = `Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  } else {
    dateEl.textContent = "see history on GitHub";
  }
  wrapper.removeAttribute("aria-busy");
  dateEl.classList.add("is-ready");
}

// ---------- Loading screen ----------
const LOADER_MIN_MS = 350; // avoid a jarring flash on fast connections
const LOADER_MAX_MS = 1500; // slow APIs fall back to the stats skeleton
const LOADER_EXIT_MS = 380;
const loaderStart = performance.now();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setLoaderProgress(value) {
  const loader = document.getElementById("loader");
  if (loader) loader.style.setProperty("--progress", String(value));
}

function trackLoadTasks(tasks) {
  let done = 0;
  const bump = () => {
    done += 1;
    // Keep a little headroom so the bar finishes on the final reveal
    setLoaderProgress(0.12 + (done / tasks.length) * 0.78);
  };
  return Promise.allSettled(tasks.map((t) => Promise.resolve(t).finally(bump)));
}

async function hideLoader() {
  const root = document.documentElement;
  const loader = document.getElementById("loader");
  if (!loader || !root.classList.contains("is-booting")) {
    root.classList.remove("is-booting");
    return;
  }

  const elapsed = performance.now() - loaderStart;
  if (elapsed < LOADER_MIN_MS) await wait(LOADER_MIN_MS - elapsed);

  setLoaderProgress(1);
  await wait(170); // let the bar visibly reach the end

  // Hand off: loader fades/lifts away while the page entrance plays beneath
  loader.classList.add("is-leaving");
  loader.setAttribute("aria-hidden", "true");
  root.classList.remove("is-booting");
  await wait(LOADER_EXIT_MS);
  loader.remove();
}

function setupScrollCue() {
  const cueWrap = document.getElementById("scroll-cue-wrap");
  const faq = document.getElementById("faq");
  if (!cueWrap || !faq) return;

  const update = () => {
    const faqTop = faq.getBoundingClientRect().top;
    const isFaqVisible = faqTop <= window.innerHeight - 36;
    cueWrap.classList.toggle("is-hidden", isFaqVisible);
  };

  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update, { passive: true });
  update();
}

function setupDocsInteractions() {
  document.querySelectorAll(".script-card-title").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("script-name-active");
    });
  });

  document.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const box = btn.closest(".code-box");
      const codeEl = box ? box.querySelector("pre code, pre") : null;
      if (!codeEl) return;

      try {
        await navigator.clipboard.writeText(codeEl.textContent || "");
        btn.textContent = "Copied!";
        btn.classList.add("is-copied");
        setTimeout(() => {
          btn.textContent = "Copy";
          btn.classList.remove("is-copied");
        }, 1500);
      } catch (_) {}
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setLoaderProgress(0.12);
  setupScrollCue();
  setupDocsInteractions();
  updateStatDividers();
  window.addEventListener("resize", updateStatDividers, { passive: true });

  const pageLoaded = new Promise((resolve) => {
    if (document.readyState === "complete") resolve();
    else window.addEventListener("load", resolve, { once: true });
  });
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const stats = loadAllStats();
  const lastUpdated = loadLastUpdated();

  const tasks = [pageLoaded, fontsReady];
  // Keep the loader up until the stats bar is ready (index page only)
  if (document.getElementById("stats")?.classList.contains("is-loading")) {
    tasks.push(stats);
  }
  // Subpages: keep the loader up until the last-updated date is in
  if (document.getElementById("last-updated")) tasks.push(lastUpdated);

  Promise.race([trackLoadTasks(tasks), wait(LOADER_MAX_MS)]).then(hideLoader);
});
