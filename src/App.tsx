import { Outlet } from "react-router-dom";
import { ChakraBaseProvider } from "@chakra-ui/react";
import { theme } from "./theme";
import "./initGpu";
import "./initWallet";
import "./index.css";

export default function App() {
  return (
    <ChakraBaseProvider theme={theme}>
      <Outlet />
    </ChakraBaseProvider>
  );
}
