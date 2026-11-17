function mcbpLog(tag, message, ...extra) {
  console.log(
    `%c MCBP · ${tag} %c ${message} `,
    "background: #6b4ce6; color: #f2edff; padding: 3px 6px; border-radius: 4px 0 0 4px; font-weight: bold; font-family: sans-serif;",
    "background: #b197fc; color: #251b45; padding: 3px 6px; border-radius: 0 4px 4px 0; font-weight: bold; font-family: sans-serif;",
    ...extra,
  );
}

mcbpLog("main.js", "loaded");

function applyFooterVersion(rawVersion) {
  if (!rawVersion) return;
  const clean = String(rawVersion).replace(/^v/i, "");
  const versionEl =
    document.getElementById("app-version") ||
    document.getElementById("version");
  if (versionEl) {
    versionEl.textContent = `v${clean}`;
  }
}

if (window.api && typeof window.api.onCustomTheme === "function") {
  window.api.onCustomTheme((cssText) => {
    let styleEl = document.getElementById("mcbp-custom-theme");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "mcbp-custom-theme";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!target || typeof target.closest !== "function") return;

  const link = target.closest("a");
  if (link && link.href && link.href.startsWith("http")) {
    if (window.api && typeof window.api.openExternal === "function") {
      event.preventDefault();
      window.api.openExternal(link.href);
    }
    return;
  }

  const btnTarget = target.closest(
    ".mButton, .action-pill, .back-button, .script-name",
  );
  if (btnTarget) {
    btnTarget.classList.add("transform-scale");
    setTimeout(() => {
      btnTarget.classList.remove("transform-scale");
    }, 220);
  }
});

// Optional update prompt: never forced, "Later" hides it for that version.
(() => {
  if (!window.api || !window.api.onUpdateAvailable) return;
  const toast = document.getElementById("update-toast");
  const text = document.getElementById("update-text");
  const install = document.getElementById("update-install");
  const later = document.getElementById("update-later");
  if (!toast || !text || !install || !later) return;

  const skipKey = "skipped-update";
  let version = "";

  window.api.onUpdateAvailable((info) => {
    if (localStorage.getItem(skipKey) === info.version) return;
    version = info.version;
    text.textContent = `Version ${version} is available`;
    install.textContent = info.direct ? "Update" : "Open release";
    toast.hidden = false;
  });
  later.addEventListener("click", () => {
    localStorage.setItem(skipKey, version);
    toast.hidden = true;
  });
  install.addEventListener("click", () => {
    install.disabled = later.disabled = true;
    text.textContent = "Downloading update...";
    window.api.installUpdate();
  });
  window.api.onUpdateProgress((pct) => {
    text.textContent = `Downloading update... ${Math.round(pct * 100)}%`;
  });
  window.api.onUpdateDone((result) => {
    install.disabled = later.disabled = false;
    if (result === "opened") toast.hidden = true;
    else text.textContent = "Installing update...";
  });
})();
