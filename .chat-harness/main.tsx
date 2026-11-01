import { createRoot } from "react-dom/client";
import "../src/chatview/index.css";
import { ChatPaneV2 } from "../src/chatview/components/v2/chat-pane";
createRoot(document.getElementById("root")!).render(<ChatPaneV2 />);
