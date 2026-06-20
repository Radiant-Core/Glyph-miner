import { Container, Center, Button } from "@chakra-ui/react";
import { Link } from "react-router-dom";
import LicenseText from "../LicenceText";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";

export default function License() {
  return (
    <>
      <PageHeader title="License">
        <Button as={Link} to="/" variant="outline" size="sm">
          Close
        </Button>
      </PageHeader>
      <Container maxW="container.md" py={6}>
        <Panel color="text.secondary" lineHeight="tall">
          <LicenseText />
        </Panel>
        <Center mt={6}>
          <Button as={Link} to="/" variant="outline">
            Close
          </Button>
        </Center>
      </Container>
    </>
  );
}
