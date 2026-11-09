export function configurePopupSize() {
  if (
    typeof chrome === "undefined" ||
    !chrome.extension?.getViews?.({ type: "popup" }).includes(window)
  )
    return;
  document.documentElement.classList.add("toolbar-popup");
  window.addEventListener(
    "resize",
    () => document.documentElement.classList.add("toolbar-popup-sized"),
    { once: true },
  );
}
