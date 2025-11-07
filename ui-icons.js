(function (global) {
  "use strict";

  const ICON_MAP = {
    edit:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm14.71-9.21l-1.75 1.75-3.75-3.75 1.75-1.75a1 1 0 0 1 1.41 0l2.34 2.34a1 1 0 0 1 0 1.41zM20 7.5L9.5 18H6v-3.5L16.5 4 20 7.5z"/></svg>',
    trash:
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zm3 2h2v10H9V9zm4 0h2v10h-2V9zm6-4h-3.5l-1-1h-5l-1 1H5v2h14V5z"/></svg>',
  };

  function createIcon(name) {
    const markup = ICON_MAP[name];
    if (!markup) return null;
    const span = document.createElement("span");
    span.className = "icon";
    span.innerHTML = markup;
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function decorate(button, name, options = {}) {
    if (!button) return;
    const { label = "", showLabel = false } = options;
    const icon = createIcon(name);
    if (!icon) {
      if (!showLabel && label && !button.textContent) {
        button.textContent = label;
      } else if (showLabel && label && !button.textContent) {
        button.textContent = label;
      }
      return;
    }
    button.classList.add("icon-button");
    if (showLabel) {
      button.classList.add("icon-with-label");
      button.innerHTML = "";
      button.append(icon);
      if (label) {
        const textSpan = document.createElement("span");
        textSpan.className = "icon-button-label";
        textSpan.textContent = label;
        button.append(textSpan);
        button.title = label;
      }
      button.removeAttribute("aria-label");
    } else {
      button.classList.remove("icon-with-label");
      button.innerHTML = "";
      button.append(icon);
      if (label) {
        button.setAttribute("aria-label", label);
        if (!button.title) {
          button.title = label;
        }
      }
    }
  }

  global.CaliGymIcons = {
    create: createIcon,
    decorate,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
