import { Container, Center, Button } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import LicenseText from "../LicenceText";

export default function License() {
  return (
    <Container maxW="container.lg" py={2}>
      <LicenseText />
      <Center>
        <Button as={Link} to="/">
          Close
        </Button>
      </Center>
    </Container>
  );
}
