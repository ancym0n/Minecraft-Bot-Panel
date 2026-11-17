// Themed dropdowns that replace native <select> popups and <datalist>
// suggestions so every picker in the panel shares the same look.
(() => {
  let openState = null;

  function closeOpen() {
    if (!openState) return;
    const { menu, host, onClose } = openState;
    openState = null;
    menu.remove();
    host.classList.remove("dd-open");
    if (typeof onClose === "function") onClose();
  }

  function positionMenu(menu, anchor) {
    const rect = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const wanted = Math.min(menu.scrollHeight, 260);
    const openUp =
      spaceBelow < Math.min(wanted, 160) && spaceAbove > spaceBelow;
    const maxH = Math.max(80, Math.min(260, openUp ? spaceAbove : spaceBelow));
    menu.style.maxHeight = `${maxH}px`;
    menu.style.minWidth = `${rect.width}px`;
    menu.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 6))}px`;
    menu.classList.toggle("dd-menu-up", openUp);
    if (openUp) {
      menu.style.top = "";
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      menu.style.bottom = "";
      menu.style.top = `${rect.bottom + 4}px`;
    }
  }

  function buildMenu(items, activeValue, onPick) {
    const menu = document.createElement("div");
    menu.className = "dd-menu";
    menu.setAttribute("role", "listbox");
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "dd-empty";
      empty.textContent = "No matches";
      menu.appendChild(empty);
      return menu;
    }
    let lastGroup = null;
    items.forEach((item) => {
      if (item.group && item.group !== lastGroup) {
        lastGroup = item.group;
        const head = document.createElement("div");
        head.className = "dd-group";
        head.textContent = item.group;
        menu.appendChild(head);
      }
      const opt = document.createElement("div");
      opt.className = "dd-option";
      opt.setAttribute("role", "option");
      opt.dataset.value = item.value;
      if (item.value === activeValue) opt.classList.add("dd-selected");
      const label = document.createElement("span");
      label.className = "dd-label";
      label.textContent = item.label ?? item.value;
      opt.appendChild(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "dd-hint";
        hint.textContent = item.hint;
        opt.appendChild(hint);
      }
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onPick(item);
      });
      menu.appendChild(opt);
    });
    return menu;
  }

  function moveActive(menu, dir) {
    const opts = [...menu.querySelectorAll(".dd-option")];
    if (!opts.length) return;
    let idx = opts.findIndex((o) => o.classList.contains("dd-active"));
    if (idx < 0)
      idx = opts.findIndex((o) => o.classList.contains("dd-selected"));
    opts.forEach((o) => o.classList.remove("dd-active"));
    idx = idx < 0 ? 0 : (idx + dir + opts.length) % opts.length;
    opts[idx].classList.add("dd-active");
    opts[idx].scrollIntoView({ block: "nearest" });
  }

  function openMenu(host, anchor, items, activeValue, onPick, onClose) {
    closeOpen();
    const menu = buildMenu(items, activeValue, (item) => {
      closeOpen();
      onPick(item);
    });
    document.body.appendChild(menu);
    host.classList.add("dd-open");
    openState = { menu, host, anchor, onClose };
    positionMenu(menu, anchor);
    const sel = menu.querySelector(".dd-selected");
    if (sel) sel.scrollIntoView({ block: "nearest" });
    return menu;
  }

  function pickActive() {
    if (!openState) return false;
    const active = openState.menu.querySelector(".dd-option.dd-active");
    if (!active) return false;
    active.dispatchEvent(new MouseEvent("mousedown"));
    return true;
  }

  document.addEventListener("mousedown", (e) => {
    if (!openState) return;
    if (openState.menu.contains(e.target) || openState.host.contains(e.target))
      return;
    closeOpen();
  });
  window.addEventListener("resize", closeOpen);
  document.addEventListener(
    "scroll",
    (e) => {
      if (!openState || openState.menu.contains(e.target)) return;
      positionMenu(openState.menu, openState.anchor);
    },
    true,
  );

  function selectItems(select) {
    return [...select.options].map((o) => ({
      value: o.value,
      label: o.textContent.trim(),
      hint: o.dataset.hint || "",
      group:
        o.parentElement?.tagName === "OPTGROUP" ? o.parentElement.label : "",
    }));
  }

  // Wraps a native <select>; the select stays the source of truth.
  function enhanceSelect(select) {
    if (!select || select._dd) return select?._dd;
    const host = document.createElement("div");
    host.className = "dd";
    select.parentNode.insertBefore(host, select);
    host.appendChild(select);
    select.classList.add("dd-native");
    select.tabIndex = -1;

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dd-trigger";
    if (select.id) {
      const lbl = document.querySelector(`label[for="${select.id}"]`);
      if (lbl) lbl.addEventListener("click", () => trigger.focus());
    }
    const text = document.createElement("span");
    text.className = "dd-value";
    const chev = document.createElement("span");
    chev.className = "dd-chevron";
    chev.setAttribute("aria-hidden", "true");
    trigger.append(text, chev);
    host.appendChild(trigger);

    const sync = () => {
      const opt = select.options[select.selectedIndex];
      text.textContent = opt ? opt.textContent.trim() : "";
      trigger.title = text.textContent;
      trigger.disabled = select.disabled;
    };

    const toggle = () => {
      if (openState?.host === host) return closeOpen();
      openMenu(host, trigger, selectItems(select), select.value, (item) => {
        if (select.value !== item.value) {
          select.value = item.value;
          sync();
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        trigger.focus();
      });
    };

    trigger.addEventListener("click", toggle);
    trigger.addEventListener("keydown", (e) => {
      const isOpen = openState?.host === host;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen) toggle();
        else moveActive(openState.menu, e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!isOpen || !pickActive()) toggle();
      } else if (e.key === "Escape" || e.key === "Tab") {
        closeOpen();
      }
    });

    new MutationObserver(sync).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    select.addEventListener("change", sync);
    sync();
    select._dd = { host, trigger, sync };
    return select._dd;
  }

  // Free-text input with a themed suggestion list (replaces <datalist>).
  function attachCombo(input, { items = [], emptyValue = "" } = {}) {
    if (!input || input._combo) return input?._combo;
    let allItems = items;
    const host = document.createElement("div");
    host.className = "dd dd-combo";
    input.parentNode.insertBefore(host, input);
    host.appendChild(input);
    input.removeAttribute("list");
    input.setAttribute("autocomplete", "off");

    const chev = document.createElement("button");
    chev.type = "button";
    chev.className = "dd-combo-toggle";
    chev.tabIndex = -1;
    chev.title = "Show options";
    const icon = document.createElement("span");
    icon.className = "dd-chevron";
    chev.appendChild(icon);
    host.appendChild(chev);

    const show = (filter) => {
      const q = filter ? input.value.trim().toLowerCase() : "";
      const list = q
        ? allItems.filter(
            (it) =>
              String(it.value).toLowerCase().includes(q) ||
              String(it.label || "")
                .toLowerCase()
                .includes(q),
          )
        : allItems;
      const current = input.value.trim() || emptyValue;
      openMenu(host, input, list, current, (item) => {
        input.value = item.value === emptyValue ? "" : item.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    };

    chev.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (openState?.host === host) closeOpen();
      else {
        input.focus();
        show(false);
      }
    });
    input.addEventListener("input", (e) => {
      if (e.isTrusted) show(true);
    });
    input.addEventListener("keydown", (e) => {
      const isOpen = openState?.host === host;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!isOpen) show(false);
        else moveActive(openState.menu, e.key === "ArrowDown" ? 1 : -1);
      } else if (e.key === "Enter" && isOpen) {
        if (pickActive()) e.preventDefault();
        else closeOpen();
      } else if (e.key === "Escape" || e.key === "Tab") {
        closeOpen();
      }
    });
    input.addEventListener("blur", () => {
      if (openState?.host === host) closeOpen();
    });

    input._combo = {
      host,
      setItems(next) {
        allItems = Array.isArray(next) ? next : [];
      },
    };
    return input._combo;
  }

  window.mcbpDropdown = { enhanceSelect, attachCombo, close: closeOpen };
})();
