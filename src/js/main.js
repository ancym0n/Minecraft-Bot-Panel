const REPO_SLUG = "ancym0n/Minecraft-Bot-Panel";
const RELEASES_API_URL = `https://api.github.com/repos/${REPO_SLUG}/releases?per_page=100`;
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO_SLUG}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${REPO_SLUG}/releases`;
const LATEST_RELEASE_PAGE_URL = `${RELEASES_PAGE_URL}/latest`;
const RELEASE_CACHE_KEY = "mcbp:latest-release-v1";
const DM_AUTO_REFRESH_MS = 60 * 1000;

let latestReleaseData = null;
let activeOsFilter = null;
let dmRefreshTimer = null;
let isRefreshingRelease = false;
let dmSwitchTimeout = null;
let dmResizeTimeout = null;

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

function normalizeTag(rawTag) {
  if (!rawTag || typeof rawTag !== "string") return "";
  const cleaned = rawTag.trim().replace(/^(?:beta-)?v/i, "");
  if (!cleaned) return "";
  return `v${cleaned}`;
}

function setVersionText(rawTag) {
  const tag = normalizeTag(rawTag);
  if (!tag) return;

  const versionEl = document.getElementById("version");
  if (versionEl) {
    versionEl.textContent = tag;
  }

  const dmPill = document.getElementById("dm-version-pill");
  const dmSep = document.getElementById("dm-footer-sep");
  if (dmPill) {
    dmPill.textContent = tag;
    dmPill.hidden = false;
  }
  if (dmSep) {
    dmSep.hidden = false;
  }
}

// ---------- Client System Detection ----------

function detectClientSystem() {
  const ua = navigator.userAgent || "";
  const platform =
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    "";
  const combined = `${platform} ${ua}`.toLowerCase();

  let os = "windows";
  if (/mac|darwin/i.test(combined) && !/iphone|ipad|ipod/i.test(combined)) {
    os = "macos";
  } else if (
    /linux|x11|ubuntu|debian|fedora|arch|cros/i.test(combined) &&
    !/android/i.test(combined)
  ) {
    os = "linux";
  } else if (/win/i.test(combined)) {
    os = "windows";
  }

  let distro = null;
  if (os === "linux") {
    if (/ubuntu|debian|mint|pop!_os|kali|elementary|zorin/i.test(ua)) {
      distro = "debian";
    } else if (/fedora|rhel|centos|rocky|alma|suse|opensuse/i.test(ua)) {
      distro = "rpm";
    } else if (/arch|manjaro|endeavouros|garuda|cachyos/i.test(ua)) {
      distro = "arch";
    }
  }

  let arch = "x64";
  if (/aarch64|arm64|armv8/i.test(combined)) {
    arch = "arm64";
  } else if (
    /i686|i386|x86(?!_64)/i.test(combined) &&
    !/x86_64|amd64|win64|x64/i.test(combined)
  ) {
    arch = "x86";
  }

  return { os, arch, distro };
}

let clientSystem = detectClientSystem();

async function enhanceClientSystem() {
  if (!navigator.userAgentData?.getHighEntropyValues) return;
  try {
    const hints = await navigator.userAgentData.getHighEntropyValues([
      "architecture",
      "bitness",
    ]);
    const archRaw = (hints.architecture || "").toLowerCase();
    const bitness = String(hints.bitness || "");

    if (archRaw.includes("arm")) {
      clientSystem.arch = "arm64";
    } else if (archRaw.includes("x86")) {
      clientSystem.arch = bitness === "32" ? "x86" : "x64";
    }
    renderDownloadManager();
  } catch {
    /* ignore */
  }
}

// ---------- Release Asset Classification ----------

const IGNORED_ASSET_RE =
  /(\.blockmap|\.nsis\.7z|\.sha256|\.sha512|\.sig|\.asc|\.zsync|^latest(-[a-z0-9]+)?\.ya?ml$|^builder-.*\.ya?ml$)$/i;

const OS_META = {
  windows: { label: "Windows", order: 1 },
  linux: { label: "Linux", order: 2 },
  macos: { label: "macOS", order: 3 },
  android: { label: "Android", order: 4 },
};

function formatBytes(bytes) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${Math.round(mb)} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function parseReleaseAsset(raw) {
  if (!raw || typeof raw.name !== "string") return null;
  const name = raw.name.trim();
  if (!name || IGNORED_ASSET_RE.test(name)) return null;

  const lower = name.toLowerCase();

  let ext = "";
  let iconType = "package";
  let title = "Package";
  let defaultOs = null;
  let basePriority = 50;
  let distro = null;

  if (lower.endsWith(".pkg.tar.zst") || lower.endsWith(".pacman")) {
    ext = lower.endsWith(".pkg.tar.zst") ? ".pkg.tar.zst" : ".pacman";
    iconType = "package";
    title = "Arch Package";
    defaultOs = "linux";
    distro = "arch";
    basePriority = 90;
  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    ext = lower.endsWith(".tgz") ? ".tgz" : ".tar.gz";
    iconType = "archive";
    title = "Portable";
    defaultOs = "linux";
    basePriority = 55;
  } else if (lower.endsWith(".tar.xz") || lower.endsWith(".txz")) {
    ext = lower.endsWith(".txz") ? ".txz" : ".tar.xz";
    iconType = "archive";
    title = "Portable";
    defaultOs = "linux";
    basePriority = 56;
  } else if (lower.endsWith(".tar.bz2")) {
    ext = ".tar.bz2";
    iconType = "archive";
    title = "Portable";
    defaultOs = "linux";
    basePriority = 54;
  } else if (lower.endsWith(".appimage")) {
    ext = ".AppImage";
    iconType = "appimage";
    title = "AppImage";
    defaultOs = "linux";
    basePriority = 96;
  } else if (lower.endsWith(".deb")) {
    ext = ".deb";
    iconType = "package";
    title = "Debian / Ubuntu";
    defaultOs = "linux";
    distro = "debian";
    basePriority = 93;
  } else if (lower.endsWith(".rpm")) {
    ext = ".rpm";
    iconType = "package";
    title = "Fedora / RPM";
    defaultOs = "linux";
    distro = "rpm";
    basePriority = 91;
  } else if (lower.endsWith(".flatpak")) {
    ext = ".flatpak";
    iconType = "package";
    title = "Flatpak";
    defaultOs = "linux";
    basePriority = 88;
  } else if (lower.endsWith(".snap")) {
    ext = ".snap";
    iconType = "package";
    title = "Snap";
    defaultOs = "linux";
    basePriority = 85;
  } else if (lower.endsWith(".exe")) {
    ext = ".exe";
    const isSetup = /setup|install/i.test(name);
    iconType = "installer";
    title = isSetup ? "Installer" : "Executable";
    defaultOs = "windows";
    basePriority = isSetup ? 98 : 86;
  } else if (lower.endsWith(".msi")) {
    ext = ".msi";
    iconType = "installer";
    title = "MSI Installer";
    defaultOs = "windows";
    basePriority = 95;
  } else if (lower.endsWith(".dmg")) {
    ext = ".dmg";
    iconType = "installer";
    title = "Disk Image";
    defaultOs = "macos";
    basePriority = 96;
  } else if (lower.endsWith(".pkg")) {
    ext = ".pkg";
    iconType = "installer";
    title = "Installer";
    defaultOs = "macos";
    basePriority = 92;
  } else if (lower.endsWith(".apk")) {
    ext = ".apk";
    iconType = "installer";
    title = "Android APK";
    defaultOs = "android";
    basePriority = 95;
  } else if (lower.endsWith(".zip")) {
    ext = ".zip";
    iconType = "archive";
    title = "Portable";
    basePriority = 62;
  } else if (lower.endsWith(".7z")) {
    ext = ".7z";
    iconType = "archive";
    title = "Portable";
    basePriority = 58;
  } else {
    const dotIdx = name.lastIndexOf(".");
    ext = dotIdx > 0 ? name.slice(dotIdx) : "";
    title = ext ? ext.slice(1).toUpperCase() : "Package";
  }

  let os = defaultOs;
  if (/(^|[-_.\s])(win(32|64|dows)?)(?=[-_.\s]|$)/i.test(name)) {
    os = "windows";
  } else if (
    /(^|[-_.\s])(linux|ubuntu|debian|fedora|arch|appimage)(?=[-_.\s]|$)/i.test(
      name,
    )
  ) {
    os = "linux";
  } else if (/(^|[-_.\s])(mac(os)?|darwin|osx)(?=[-_.\s]|$)/i.test(name)) {
    os = "macos";
  } else if (/(^|[-_.\s])(android)(?=[-_.\s]|$)/i.test(name)) {
    os = "android";
  }
  if (!os) os = "windows";

  let arch = "x64";
  if (/arm64|aarch64/i.test(name)) {
    arch = "arm64";
  } else if (
    /ia32|i386|i686|win32|(?<!x86_)x86(?!_64)/i.test(name) &&
    !/x86_64|amd64|win64|x64/i.test(name)
  ) {
    arch = "x86";
  }

  return {
    name,
    url: raw.browser_download_url || RELEASES_PAGE_URL,
    sizeLabel: formatBytes(raw.size),
    ext: ext || "file",
    iconType,
    title,
    os,
    arch,
    distro,
    basePriority,
  };
}

function buildFallbackRelease(tagStr) {
  const tag = normalizeTag(tagStr || "v0.2.0");
  const ver = tag.replace(/^v/i, "");
  const base = `https://github.com/${REPO_SLUG}/releases/download/${tag}`;

  return {
    tag_name: tag,
    html_url: `${RELEASES_PAGE_URL}/tag/${tag}`,
    assets: [
      {
        name: `MCBPv${ver}-win.x64-setup.exe`,
        browser_download_url: `${base}/MCBPv${ver}-win.x64-setup.exe`,
      },
      {
        name: `MCBPv${ver}-win.x64.zip`,
        browser_download_url: `${base}/MCBPv${ver}-win.x64.zip`,
      },
      {
        name: `Minecraft-Bot-Panel-${ver}-x86_64.AppImage`,
        browser_download_url: `${base}/Minecraft-Bot-Panel-${ver}-x86_64.AppImage`,
      },
      {
        name: `MCBPv${ver}-linux.x64.zip`,
        browser_download_url: `${base}/MCBPv${ver}-linux.x64.zip`,
      },
    ],
  };
}

function saveCachedRelease(release) {
  if (!release || !release.tag_name) return;
  try {
    localStorage.setItem(
      RELEASE_CACHE_KEY,
      JSON.stringify({ release, savedAt: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

function loadCachedRelease() {
  try {
    const raw = localStorage.getItem(RELEASE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.release?.tag_name && Array.isArray(parsed.release.assets)) {
      return parsed.release;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function scoreAsset(asset, sys) {
  let score = asset.basePriority;
  if (asset.arch === sys.arch) score += 25;
  if (asset.os === "linux" && sys.distro && asset.distro === sys.distro) {
    score += 6;
  }
  return score;
}

// ---------- SVG Icons ----------

function createSvgIcon(kind, size = 20) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");

  const addPath = (d, stroke = false) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    if (stroke) {
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", "2.4");
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    } else {
      p.setAttribute("fill", "currentColor");
    }
    svg.appendChild(p);
  };

  if (kind === "windows") {
    addPath(
      "M3 5.45 10.95 4.3v7.1H3V5.45zm8.85-1.28L21 2.85v8.55h-9.15V4.17zM3 12.3h7.95v7.15L3 18.3V12.3zm8.85 0H21v8.85l-9.15-1.32V12.3z",
    );
  } else if (kind === "linux") {
    addPath(
      "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z",
      true,
    );
    addPath("m8 10 3 2.5L8 15m5 0h3", true);
  } else if (kind === "macos") {
    addPath(
      "M16.5 12.6c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3.1-1.7-1.3-.1-2.5.8-3.2.8-.7 0-1.7-.8-2.8-.7-1.4 0-2.7.8-3.5 2.1-1.5 2.6-.4 6.4 1.1 8.5.7 1 1.6 2.2 2.7 2.1 1.1 0 1.5-.7 2.8-.7s1.7.7 2.8.7c1.2 0 1.9-1 2.6-2.1.8-1.2 1.2-2.3 1.2-2.4-.1 0-2.4-.9-2.4-3.4zm-2.1-6.2c.6-.7 1-1.7.9-2.7-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.6 1 .1 1.9-.5 2.5-1.2z",
    );
  } else if (kind === "installer") {
    addPath("M20 7.5 12 3 4 7.5v9L12 21l8-4.5v-9z", true);
    addPath("M12 8v6m0 0-2.6-2.6M12 14l2.6-2.6", true);
  } else if (kind === "appimage") {
    addPath("M13 3 4 14h7l-1 7 9-11h-7l1-7z", true);
  } else if (kind === "archive") {
    addPath(
      "M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z",
      true,
    );
    addPath("M12 5v14M10 9h4m-4 4h4", true);
  } else if (kind === "star") {
    addPath(
      "m12 3.3 2.6 5.3 5.9.8-4.3 4.2 1 5.9L12 16.7l-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.3z",
    );
  } else if (kind === "download") {
    addPath("M12 4v11m0 0-4.2-4.2M12 15l4.2-4.2M5 19h14", true);
  } else {
    addPath(
      "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3zm-8 4.5 8 4.5 8-4.5M12 12v9",
      true,
    );
  }

  return svg;
}

// ---------- Download Modal Rendering & Smooth Animations ----------

function syncOsTabSlider() {
  const tabsEl = document.getElementById("dm-os-tabs");
  if (!tabsEl) return;

  const activeBtn = tabsEl.querySelector(".dm-os-tab.is-active");
  const slider = tabsEl.querySelector(".dm-tab-slider");
  if (!activeBtn || !slider) return;

  const w = activeBtn.offsetWidth;
  const h = activeBtn.offsetHeight;
  if (w === 0 || h === 0) return;

  slider.style.width = `${w}px`;
  slider.style.height = `${h}px`;
  slider.style.transform = `translate(${activeBtn.offsetLeft}px, ${activeBtn.offsetTop}px)`;
  slider.classList.add("is-ready");
  tabsEl.classList.add("has-slider");
}

function renderDownloadSkeletons() {
  const listEl = document.getElementById("dm-asset-list");
  if (!listEl) return;

  listEl.innerHTML = `
    <div class="dm-skeleton-card" aria-hidden="true"></div>
    <div class="dm-skeleton-card" aria-hidden="true"></div>
  `;
}

function buildAssetCards(currentList) {
  const hasMultipleArchs = new Set(currentList.map((a) => a.arch)).size > 1;
  return currentList.map((asset, idx) => {
    const isRec = idx === 0;

    const card = document.createElement("a");
    card.className = `dm-card${isRec ? " is-recommended" : ""}`;
    card.style.setProperty("--i", String(idx));
    card.href = asset.url;
    card.setAttribute("download", "");
    card.rel = "noopener";
    card.setAttribute("role", "listitem");

    const left = document.createElement("span");
    left.className = "dm-card-left";
    left.appendChild(createSvgIcon(asset.iconType, 20));

    const titleSpan = document.createElement("span");
    titleSpan.className = "dm-card-title";
    titleSpan.textContent = asset.title;
    left.appendChild(titleSpan);

    if (isRec) {
      const star = document.createElement("span");
      star.className = "dm-star-badge";
      star.title = "Recommended";
      star.appendChild(createSvgIcon("star", 14));
      left.appendChild(star);
    }

    const right = document.createElement("span");
    right.className = "dm-card-right";

    const pillParts = [asset.ext];
    if (asset.sizeLabel) pillParts.push(asset.sizeLabel);
    if (hasMultipleArchs || asset.arch !== "x64") {
      pillParts.push(asset.arch.toUpperCase());
    }

    const pill = document.createElement("span");
    pill.className = "dm-pill";
    pill.textContent = pillParts.join(" · ");

    const dlIcon = createSvgIcon("download", 18);
    dlIcon.classList.add("dm-dl-arrow");

    right.append(pill, dlIcon);
    card.append(left, right);
    return card;
  });
}

function renderDownloadManager(animateSwitch = false) {
  const modal = document.getElementById("download-modal");
  if (!modal) return;

  const versionPillEl = document.getElementById("dm-version-pill");
  const sepEl = document.getElementById("dm-footer-sep");
  const tabsEl = document.getElementById("dm-os-tabs");
  const listEl = document.getElementById("dm-asset-list");
  const releaseLinkEl = document.getElementById("dm-release-link");

  if (!latestReleaseData) {
    renderDownloadSkeletons();
    return;
  }

  const tag = normalizeTag(latestReleaseData.tag_name);
  if (versionPillEl && tag) {
    versionPillEl.textContent = tag;
    versionPillEl.href = latestReleaseData.html_url || LATEST_RELEASE_PAGE_URL;
    versionPillEl.hidden = false;
    if (sepEl) sepEl.hidden = false;
  }

  if (releaseLinkEl) {
    releaseLinkEl.href = latestReleaseData.html_url || RELEASES_PAGE_URL;
  }

  const parsedAssets = (latestReleaseData.assets || [])
    .map(parseReleaseAsset)
    .filter(Boolean);

  const osGroups = new Map();
  for (const a of parsedAssets) {
    if (!osGroups.has(a.os)) osGroups.set(a.os, []);
    osGroups.get(a.os).push(a);
  }

  const availableOsList = Array.from(osGroups.keys()).sort(
    (a, b) => (OS_META[a]?.order || 99) - (OS_META[b]?.order || 99),
  );

  if (!activeOsFilter || !osGroups.has(activeOsFilter)) {
    activeOsFilter = osGroups.has(clientSystem.os)
      ? clientSystem.os
      : availableOsList[0] || "windows";
  }

  if (tabsEl) {
    const existingKeys = Array.from(tabsEl.querySelectorAll(".dm-os-tab")).map(
      (b) => b.dataset.os,
    );
    const sameTabs =
      existingKeys.length === availableOsList.length &&
      existingKeys.every((k, i) => k === availableOsList[i]);

    if (!sameTabs) {
      tabsEl.textContent = "";
      const slider = document.createElement("span");
      slider.className = "dm-tab-slider";
      slider.setAttribute("aria-hidden", "true");
      tabsEl.appendChild(slider);

      for (const osKey of availableOsList) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.role = "tab";
        btn.dataset.os = osKey;
        const isActive = activeOsFilter === osKey;
        btn.className = `dm-os-tab${isActive ? " is-active" : ""}`;
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
        btn.appendChild(createSvgIcon(osKey, 17));
        const label = document.createElement("span");
        label.textContent = OS_META[osKey]?.label || osKey;
        btn.appendChild(label);
        btn.addEventListener("click", () => {
          if (activeOsFilter === osKey) return;
          activeOsFilter = osKey;
          renderDownloadManager(true);
        });
        tabsEl.appendChild(btn);
      }
    } else {
      for (const btn of tabsEl.querySelectorAll(".dm-os-tab")) {
        const isActive = btn.dataset.os === activeOsFilter;
        btn.classList.toggle("is-active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      }
    }

    requestAnimationFrame(syncOsTabSlider);
  }

  const currentList = [...(osGroups.get(activeOsFilter) || parsedAssets)].sort(
    (a, b) => scoreAsset(b, clientSystem) - scoreAsset(a, clientSystem),
  );

  if (!listEl) return;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (!animateSwitch || reduceMotion || modal.hidden) {
    listEl.replaceChildren(...buildAssetCards(currentList));
    return;
  }

  if (dmSwitchTimeout) clearTimeout(dmSwitchTimeout);
  if (dmResizeTimeout) clearTimeout(dmResizeTimeout);

  const fromHeight = listEl.offsetHeight;
  listEl.classList.add("is-switching");

  dmSwitchTimeout = setTimeout(() => {
    listEl.style.height = "";
    listEl.replaceChildren(...buildAssetCards(currentList));
    const toHeight = listEl.offsetHeight;

    if (Math.abs(fromHeight - toHeight) > 1) {
      listEl.classList.add("is-resizing");
      listEl.style.height = `${fromHeight}px`;
      void listEl.offsetHeight;
      listEl.style.height = `${toHeight}px`;

      dmResizeTimeout = setTimeout(() => {
        listEl.style.height = "";
        listEl.classList.remove("is-resizing");
      }, 340);
    }

    requestAnimationFrame(() => {
      listEl.classList.remove("is-switching");
    });
  }, 130);
}

async function refreshLatestRelease() {
  if (isRefreshingRelease) return;
  isRefreshingRelease = true;

  try {
    const latest = await fetchJson(LATEST_RELEASE_API_URL);
    if (latest && latest.tag_name && Array.isArray(latest.assets)) {
      latestReleaseData = latest;
      saveCachedRelease(latest);
      setVersionText(latest.tag_name);
      renderDownloadManager(false);
    }
  } catch {
    if (!latestReleaseData) {
      const cached = loadCachedRelease();
      if (cached) {
        latestReleaseData = cached;
      } else {
        const fallbackTag =
          document.getElementById("version")?.textContent || "v0.2.0";
        latestReleaseData = buildFallbackRelease(fallbackTag);
      }
      renderDownloadManager(false);
    }
  } finally {
    isRefreshingRelease = false;
  }
}

function openDownloadModal() {
  const modal = document.getElementById("download-modal");
  if (!modal) return;

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-modal-open");

  renderDownloadManager(false);
  if (!latestReleaseData) {
    refreshLatestRelease();
  }

  requestAnimationFrame(() => {
    modal.classList.add("is-open");
    syncOsTabSlider();
    document.getElementById("dm-close")?.focus({ preventScroll: true });
  });

  if (dmRefreshTimer) clearInterval(dmRefreshTimer);
  dmRefreshTimer = setInterval(() => {
    if (!modal.hidden) refreshLatestRelease();
  }, DM_AUTO_REFRESH_MS);
}

function closeDownloadModal() {
  const modal = document.getElementById("download-modal");
  if (!modal || modal.hidden) return;

  modal.classList.remove("is-open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-modal-open");

  if (dmRefreshTimer) {
    clearInterval(dmRefreshTimer);
    dmRefreshTimer = null;
  }

  setTimeout(() => {
    if (!modal.classList.contains("is-open")) {
      modal.hidden = true;
    }
  }, 280);
}

function setupDownloadManager() {
  const downloadBtn = document.getElementById("download-btn");
  const modal = document.getElementById("download-modal");
  const backdrop = document.getElementById("dm-backdrop");
  const closeBtn = document.getElementById("dm-close");
  const tabsEl = document.getElementById("dm-os-tabs");

  if (!downloadBtn || !modal) return;

  const cached = loadCachedRelease();
  if (cached && !latestReleaseData) {
    latestReleaseData = cached;
    if (cached.tag_name) setVersionText(cached.tag_name);
  }

  downloadBtn.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    openDownloadModal();
  });

  backdrop?.addEventListener("click", closeDownloadModal);
  closeBtn?.addEventListener("click", closeDownloadModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) {
      closeDownloadModal();
    }
  });

  window.addEventListener(
    "resize",
    () => {
      if (!modal.hidden) syncOsTabSlider();
    },
    { passive: true },
  );

  if (tabsEl && typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(() => {
      if (!modal.hidden) syncOsTabSlider();
    });
    ro.observe(tabsEl);
  }

  if (window.location.hash === "#download") {
    openDownloadModal();
  }
}

// ---------- GitHub Stats & Page Loader ----------

async function fetchGitHubStats() {
  let downloads = 0;
  let stars = null;
  let foundReleases = false;
  let resolvedTag = "";

  const [releasesRes, repoRes] = await Promise.allSettled([
    fetchJson(RELEASES_API_URL),
    fetchJson(`https://api.github.com/repos/${REPO_SLUG}`),
  ]);

  if (
    releasesRes.status === "fulfilled" &&
    Array.isArray(releasesRes.value) &&
    releasesRes.value.length > 0
  ) {
    const releases = releasesRes.value;
    foundReleases = true;
    const latest =
      releases.find((r) => !r.draft && !r.prerelease) || releases[0];
    if (latest) {
      latestReleaseData = latest;
      saveCachedRelease(latest);
      if (latest.tag_name) {
        resolvedTag = latest.tag_name;
        setVersionText(latest.tag_name);
      }
      renderDownloadManager(false);
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
        `https://img.shields.io/github/v/release/${REPO_SLUG}.json`,
      );
      if (
        badge?.value &&
        !badge.value.includes("invalid") &&
        !badge.value.includes("no releases")
      ) {
        resolvedTag = badge.value;
        setVersionText(badge.value);
      }
    } catch (_) {}

    if (!latestReleaseData) {
      const cached = loadCachedRelease();
      latestReleaseData =
        cached || buildFallbackRelease(resolvedTag || "v0.2.0");
      renderDownloadManager(false);
    }
  }

  if (downloads === 0) {
    try {
      const dlBadge = await fetchJson(
        `https://img.shields.io/github/downloads/${REPO_SLUG}/total.json`,
      );
      const parsed = parseCount(dlBadge?.value);
      if (parsed !== null) downloads = parsed;
    } catch (_) {}
  }

  if (stars === null) {
    try {
      const starBadge = await fetchJson(
        `https://img.shields.io/github/stars/${REPO_SLUG}.json`,
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
    `https://api.github.com/repos/${REPO_SLUG}/commits?sha=page&per_page=1`,
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
  setupDownloadManager();
  enhanceClientSystem();
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
