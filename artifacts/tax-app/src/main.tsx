import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installApiAuth } from "./lib/apiAuth";

// P0-4 — register the bearer-token getter before the first API call.
installApiAuth();

createRoot(document.getElementById("root")!).render(<App />);
