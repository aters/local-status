import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./theme-styles/palettes.css";
import "./theme-styles/materials.css";
import "./theme-styles/layouts.css";

createRoot(document.getElementById("root")!).render(<App />);
