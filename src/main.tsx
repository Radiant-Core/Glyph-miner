// Side-effect import — MUST be first. Installs `globalThis.process` /
// `globalThis.Buffer` shims that `@radiant-core/radiantjs` reads at module
// init time. Without this, `tx.sign()` throws `ReferenceError: process is
// not defined` from `getRandomBuffer`, the exception escapes claimTokens,
// `ready` stays false, and every subsequent nonce is silently queued with
// no Accepted/Rejected feedback.
import "./processShim";
import { createHashRouter, RouterProvider } from "react-router-dom";
import { ChakraBaseProvider } from "@chakra-ui/react";
import ReactDOM from "react-dom/client";
import { theme } from "./theme";
import App from "./App.tsx";
import Miner from "./pages/Miner.tsx";
import License from "./pages/License.tsx";
import Settings from "./pages/Settings.tsx";
import TokenList from "./pages/TokenList.tsx";
import Quiet from "./pages/Quiet.tsx";
import ContractList from "./pages/ContractList.tsx";

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        path: "",
        element: <Miner />,
      },
      {
        path: "/tokens/:page?",
        element: <TokenList />,
      },
      {
        path: "/contracts/:firstRef",
        element: <ContractList />,
      },
      {
        path: "/license",
        element: <License />,
      },
      {
        path: "/settings",
        element: <Settings />,
      },
      {
        path: "/quiet",
        element: <Quiet />,
      },
    ],
    errorElement: <div>Error</div>,
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ChakraBaseProvider theme={theme}>
    <RouterProvider router={router} />
  </ChakraBaseProvider>
);
