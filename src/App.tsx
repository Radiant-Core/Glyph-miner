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
      <Container maxW="container.lg" mb={2}>
        <Center fontSize="small" textAlign="center" mb={1}>
          <Link to="/license">
            Glyph Miner is distributed under the terms of the MIT License
          </Link>
        </Center>
        <Center fontSize="small" textAlign="center" color="gray.500">
          v{APP_VERSION}
        </Center>
      </Container>
    </ChakraBaseProvider>
  );
}
