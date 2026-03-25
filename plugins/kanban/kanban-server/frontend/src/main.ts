import { mount } from "svelte";
import App from "./App.svelte";
import "./global.css";

try {
  const app = mount(App, { target: document.getElementById("app")! });
} catch (err) {
  console.error("MOUNT ERROR:", err);
  document.getElementById("app")!.textContent = "Error: " + err;
}
