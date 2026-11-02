import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { subscribeSystemAppearance } from "@/lib/system-appearance";
import App from "./App";

const cleanupAppearance = subscribeSystemAppearance();
if (import.meta.hot) import.meta.hot.dispose(cleanupAppearance);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
