import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";
import { API_BASE_URL } from "@/lib/api-url";

setBaseUrl(API_BASE_URL || null);

createRoot(document.getElementById("root")!).render(<App />);
