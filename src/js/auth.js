(() => {
  const pageType = document.body.dataset.page || "welcome";

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  if (pageType === "welcome") {
    ["microsoft", "offline"].forEach((mode) => {
      const btn = document.getElementById(mode);
      if (btn) {
        btn.addEventListener("click", () => {
          window.api.send("login" + mode);
        });
      }
    });
  } else if (pageType === "microsoft") {
    const emailInput = document.getElementById("email");
    const mailForm = document.getElementById("mailForm");
    const continueBtn = document.getElementById("continue");
    const quickContinueBtn = document.getElementById("quick-continue");
    const backBtn = document.getElementById("back-btn");
    const savedSection = document.getElementById("msa-saved-section");
    const savedList = document.getElementById("msa-saved-list");
    const codeBox = document.getElementById("msa-code-box");
    const codeValue = document.getElementById("msa-code-value");
    const copyBadge = document.getElementById("msa-copy-badge");
    const openPopupBtn = document.getElementById("msa-open-popup");
    const openBrowserBtn = document.getElementById("msa-open-browser");
    const statusText = document.getElementById("msa-status-text");

    let currentMsaCode = "";
    let currentMsaUri = "https://www.microsoft.com/link";
    let isAuthenticating = false;

    if (emailInput) {
      emailInput.addEventListener("input", () => {
        if (emailInput.value.includes(" ")) {
          emailInput.value = emailInput.value.replace(/\s+/g, "");
        }
      });
    }

    function renderSavedAccounts(accounts) {
      if (!savedSection || !savedList) return;
      if (!Array.isArray(accounts) || accounts.length === 0) {
        savedSection.hidden = true;
        savedList.innerHTML = "";
        return;
      }

      savedSection.hidden = false;
      savedList.innerHTML = accounts
        .map((acc) => {
          const id = escapeHtml(acc.id);
          const mcName = escapeHtml(acc.mcName || acc.id);
          const sub =
            acc.mcName && acc.mcName.toLowerCase() !== acc.id.toLowerCase()
              ? `<span class="msa-acc-sub">${id}</span>`
              : `<span class="msa-acc-sub">Cached Profile</span>`;
          return `
            <div class="msa-saved-item" data-id="${id}" data-mcname="${mcName}">
              <div class="msa-acc-info">
                <span class="msa-acc-badge">MSA</span>
                <div class="msa-acc-text">
                  <span class="msa-acc-name">${mcName}</span>
                  ${sub}
                </div>
              </div>
              <div class="msa-acc-buttons">
                <button type="button" class="action-pill msa-use-btn" data-id="${id}" data-mcname="${mcName}">Use</button>
                <button type="button" class="action-pill msa-verify-btn" data-id="${id}" title="Verify / refresh token">Verify</button>
                <button type="button" class="action-pill msa-remove-btn" data-id="${id}" title="Remove cached account">×</button>
              </div>
            </div>
          `;
        })
        .join("");

      savedList.querySelectorAll(".msa-use-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id") || "MicrosoftAccount";
          const mcName = btn.getAttribute("data-mcname") || id;
          window.api.sendFormData({ email: id, mcName });
        });
      });

      savedList.querySelectorAll(".msa-verify-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id") || "MicrosoftAccount";
          if (emailInput) emailInput.value = id;
          startInteractiveMsa(id);
        });
      });

      savedList.querySelectorAll(".msa-remove-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-id");
          if (!id || !window.api.msaRemoveAccount) return;
          const updated = await window.api.msaRemoveAccount(id);
          renderSavedAccounts(updated);
        });
      });
    }

    if (window.api && typeof window.api.msaGetAccounts === "function") {
      window.api
        .msaGetAccounts()
        .then(renderSavedAccounts)
        .catch(() => {});
    }

    function startInteractiveMsa(overrideId) {
      const accountId =
        overrideId ||
        (emailInput && emailInput.value.trim()) ||
        "MicrosoftAccount";
      if (emailInput && !emailInput.value.trim()) {
        emailInput.value = accountId;
      }
      isAuthenticating = true;
      if (continueBtn) continueBtn.textContent = "Authenticating...";
      if (statusText) {
        statusText.textContent =
          "Contacting Microsoft Xbox Live authentication service...";
        statusText.classList.remove("status-error");
      }
      window.api.msaStartLogin({ accountId, openPopup: true });
    }

    function quickContinueToPanel() {
      const accountId =
        (emailInput && emailInput.value.trim()) || "MicrosoftAccount";
      window.api.sendFormData({ email: accountId, mcName: accountId });
    }

    if (window.api && typeof window.api.onMsaCode === "function") {
      window.api.onMsaCode((data) => {
        if (!data || !data.userCode) return;
        currentMsaCode = data.userCode;
        currentMsaUri =
          data.verificationUri || "https://www.microsoft.com/link";
        if (codeBox) codeBox.hidden = false;
        if (codeValue) codeValue.textContent = currentMsaCode;
        if (copyBadge) copyBadge.textContent = "Copied to clipboard!";
        if (statusText) {
          statusText.innerHTML = `Enter code <b>${escapeHtml(currentMsaCode)}</b> in the sign-in window or browser. Panel opens automatically once approved.`;
        }
      });
    }

    if (window.api && typeof window.api.onMsaStatus === "function") {
      window.api.onMsaStatus((status) => {
        if (!status) return;
        if (status.state === "authenticating") {
          if (statusText) {
            statusText.textContent = status.message || "Authenticating...";
            statusText.classList.remove("status-error");
          }
        } else if (status.state === "error") {
          isAuthenticating = false;
          if (continueBtn) continueBtn.textContent = "Sign In with Microsoft";
          if (statusText) {
            statusText.textContent = `Auth error: ${status.message || "Failed to authenticate"}`;
            statusText.classList.add("status-error");
          }
        } else if (status.state === "idle") {
          isAuthenticating = false;
          if (continueBtn) continueBtn.textContent = "Sign In with Microsoft";
        }
      });
    }

    if (codeValue) {
      codeValue.addEventListener("click", () => {
        if (!currentMsaCode) return;
        window.api.copyText(currentMsaCode);
        if (copyBadge) copyBadge.textContent = "Copied again!";
      });
    }

    if (openPopupBtn) {
      openPopupBtn.addEventListener("click", () => {
        window.api.msaOpenPopup({
          verificationUri: currentMsaUri,
          userCode: currentMsaCode,
        });
      });
    }

    if (openBrowserBtn) {
      openBrowserBtn.addEventListener("click", () => {
        if (currentMsaCode) window.api.copyText(currentMsaCode);
        window.api.openExternal(currentMsaUri);
      });
    }

    if (mailForm) {
      mailForm.addEventListener("submit", (event) => {
        event.preventDefault();
        startInteractiveMsa();
      });
    }

    if (continueBtn) {
      continueBtn.addEventListener("click", () => {
        if (isAuthenticating) {
          startInteractiveMsa();
        } else {
          startInteractiveMsa();
        }
      });
    }

    if (quickContinueBtn) {
      quickContinueBtn.addEventListener("click", () => quickContinueToPanel());
    }

    if (backBtn) {
      backBtn.addEventListener("click", () => {
        if (window.api.msaCancelLogin) window.api.msaCancelLogin();
        window.api.backToWelcome();
      });
    }
  } else if (pageType === "offline") {
    const usernameInput = document.getElementById("username");
    const offlineForm = document.getElementById("offlineForm");
    const continueBtn = document.getElementById("continue");
    const backBtn = document.getElementById("back-btn");

    function submitOffline(event) {
      if (event) event.preventDefault();
      const username = usernameInput ? usernameInput.value.trim() : "";
      if (!username) {
        if (usernameInput) usernameInput.focus();
        return;
      }
      window.api.sendFormData({ username });
    }

    if (offlineForm) {
      offlineForm.addEventListener("submit", (event) => submitOffline(event));
    }
    if (continueBtn) {
      continueBtn.addEventListener("click", (event) => submitOffline(event));
    }
    if (backBtn) {
      backBtn.addEventListener("click", () => window.api.backToWelcome());
    }
  }

  if (window.api && typeof window.api.onSetVersion === "function") {
    window.api.onSetVersion((version) => {
      const clean = String(version || "").replace(/^v/i, "");
      if (pageType === "microsoft") {
        document.title = `MCBP v${clean} > Login > Microsoft`;
      } else if (pageType === "offline") {
        document.title = `MCBP v${clean} > Login > Offline`;
      } else {
        document.title = `MCBP v${clean} > Login`;
      }
      if (typeof applyFooterVersion === "function") {
        applyFooterVersion(clean);
      }
    });
  }
})();
