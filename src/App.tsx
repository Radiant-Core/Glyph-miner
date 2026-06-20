import { Link, Outlet } from "react-router-dom";
import { Center, ChakraBaseProvider, Container } from "@chakra-ui/react";
import { theme } from "./theme";
import "./initGpu";
import "./initWallet";
import "./index.css";

export default function App() {
  return (
    <ChakraBaseProvider theme={theme}>
      <Outlet />
      <Container maxW="container.lg" mb={2} mt={4}>
        <Center fontSize="xs" textAlign="center" mb={1} color="text.muted">
          <Link to="/license">
            Glyph Miner is distributed under the terms of the MIT License
          </Link>
        </Center>
        <Center fontSize="xs" textAlign="center" color="text.muted">
          v{APP_VERSION}
        </Center>
      </Container>
    </ChakraBaseProvider>
  );
}
