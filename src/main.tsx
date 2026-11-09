import { createRoot } from "react-dom/client";
import "./app.css";
import App from "./app/App";
import { focusExistingAppWindow, isCameraWindow } from "./platform/windows";
import { readWorkspace } from "./platform/repository";
import { configurePopupSize } from "./platform/popupSize";

configurePopupSize();
if (isCameraWindow(window.location.href))
  document.documentElement.classList.add("camera-window");
const target = document.getElementById("app");
if (!target) throw new Error("Could not find app container");
void readWorkspace()
  .then((workspace) => (workspace.gate ? false : focusExistingAppWindow()))
  .catch(() => false)
  .then((focused) => {
    if (!focused) createRoot(target).render(<App />);
  });
