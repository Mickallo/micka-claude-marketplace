import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

try {
  mount(App, { target: document.getElementById("app")! });
} catch (err) {
  console.error("MOUNT ERROR:", err);
  document.getElementById("app")!.textContent = "Error: " + err;
}
