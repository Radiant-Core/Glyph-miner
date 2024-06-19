import { CloseIcon } from "@chakra-ui/icons";
import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Center,
  Code,
  Container,
  Flex,
  FormControl,
  FormHelperText,
  FormLabel,
  Heading,
  IconButton,
  Input,
  Select,
  useClipboard,
  useToast,
} from "@chakra-ui/react";
import { QRCodeSVG } from "qrcode.react";
import { useReducer, useState } from "react";
import { CheckIcon, CopyIcon } from "@chakra-ui/icons";
import { useSignals } from "@preact/signals-react/runtime";
import {
  contractsUrl,
  hideMessages,
  mineToAddress,
  mintMessage,
  wallet,
} from "../signals";
import Balance from "../Balance";
import { server, sweepWallet } from "../blockchain";
import { Script } from "@radiantblockchain/radiantjs";
import { Link } from "react-router-dom";

export default function Settings() {
  useSignals();
  const [showMnemonic, setShowMnemonic] = useState(false);
  const { onCopy, hasCopied } = useClipboard(wallet.value?.address || "");
  const toast = useToast();
  const onClickSweep = async () => {
    await sweepWallet();
    toast({
      status: "success",
      description: `All coins sent to ${mineToAddress.value}`,
      variant: "subtle",
    });
  };

  const [error, setError] = useState("");
  const formReducer = (
    state: { [key: string]: string },
    event: { name: string; value: string }
  ) => {
    return { ...state, [event.name]: event.value };
  };
  const [form, setForm] = useReducer(formReducer, {
    mineToAddress: mineToAddress.value,
    mintMessage: mintMessage.value,
    hideMessages: hideMessages.value ? "1" : "",
    server: server.value,
    contractsUrl: contractsUrl.value,
  });
  const onFormChange = ({
    target: { name, value },
  }: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm({ name, value });
  };
  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      Script.buildPublicKeyHashOut(form.mineToAddress).toHex();
    } catch {
      setError("Invalid address");
      return;
    }
    if (form.mineToAddress === wallet.value?.address) {
      setError("Cannot mine to temporary wallet");
      return;
    }
    mineToAddress.value = form.mineToAddress;
    mintMessage.value = form.mintMessage;
    hideMessages.value = form.hideMessages === "1";
    contractsUrl.value = form.contractsUrl;
    server.value = form.server;
    localStorage.setItem("mineToAddress", form.mineToAddress);
    localStorage.setItem("mintMessage", form.mintMessage);
    localStorage.setItem("hideMessages", form.hideMessages);
    localStorage.setItem("server", form.server);
    localStorage.setItem("contractsUrl", form.contractsUrl);
    toast({
      status: "success",
      description: "Saved",
      variant: "subtle",
    });
  };

  return (
    <>
      <Box bg="bg.300">
        <Container maxW="container.lg">
          <Flex
            justifyContent="space-between"
            h={{ base: "64px", md: "128px" }}
            alignItems="center"
          >
            <Heading size="lg" fontWeight="400">
              Settings
            </Heading>
            <IconButton
              icon={<CloseIcon />}
              as={Link}
              aria-label="Close"
              to="/"
              ml={4}
            />
          </Flex>
        </Container>
      </Box>
      <Container maxW="container.lg" py={4}>
        <Box gap={4} bg="bg.100" p={4} mb={4} as="form" onSubmit={onSave}>
          {error && (
            <Alert status="error" mb={4}>
              {error}
            </Alert>
          )}
          <FormControl mb={4} isRequired>
            <FormLabel>Mine to address</FormLabel>
            <Input
              name="mineToAddress"
              defaultValue={form.mineToAddress}
              onChange={onFormChange}
            />
            <FormHelperText>
              Radiant address to send mined tokens to
            </FormHelperText>
          </FormControl>
          <FormControl mb={4}>
            <FormLabel>Mint message</FormLabel>
            <Input
              name="mintMessage"
              defaultValue={form.mintMessage}
              maxLength={80}
              onChange={onFormChange}
            />
            <FormHelperText>Written on-chain on successful mint</FormHelperText>
          </FormControl>
          <FormControl mb={4}>
            <FormLabel>Hide messages from other miners</FormLabel>
            <Select
              name="hideMessages"
              defaultValue={form.hideMessages}
              onChange={onFormChange}
            >
              <option value="">No</option>
              <option value="1">Yes</option>
            </Select>
          </FormControl>
          <FormControl mb={4}>
            <FormLabel>Server</FormLabel>
            <Input
              name="server"
              defaultValue={form.server}
              onChange={onFormChange}
            />
          </FormControl>
          <FormControl mb={4}>
            <FormLabel>Contracts URL</FormLabel>
            <Input
              name="contractsUrl"
              defaultValue={form.contractsUrl}
              onChange={onFormChange}
            />
          </FormControl>
          <Center>
            <Button type="submit">Save</Button>
          </Center>
        </Box>
        <Box gap={4} bg="bg.100" p={4} mb={4}>
          {wallet.value ? (
            <>
              <Alert status="warning">
                <AlertIcon />
                <Box>
                  <b>
                    This is a temporary wallet that is not password protected.
                  </b>{" "}
                  Do not send more coins than necessary for paying transaction
                  fees. You must sweep any remaining funds when you are finished
                  mining.
                </Box>
              </Alert>
              <Flex direction="column" alignItems="center" mt={4}>
                <Heading fontSize="large">Temporary Address</Heading>
                <Box>
                  <Code>{wallet.value.address}</Code>
                  <IconButton
                    display="inline"
                    onClick={onCopy}
                    icon={
                      hasCopied ? (
                        <CheckIcon color="lightGreen.A400" />
                      ) : (
                        <CopyIcon color="lightGreen.A400" />
                      )
                    }
                    variant="ghost"
                    aria-label="Copy"
                    size="xs"
                  />
                </Box>
                <Box bgColor="white" p={2} mt={2}>
                  <QRCodeSVG size={128} value={wallet.value.address} />
                </Box>
                <Heading fontSize="large" mt={4}>
                  Balance
                </Heading>
                <Balance /> RXD
                <Heading fontSize="large" mt={4}>
                  Recovery phrase:
                </Heading>
                <Box
                  textAlign="center"
                  p={2}
                  mt={2}
                  borderWidth="2px"
                  alignSelf="stretch"
                >
                  {showMnemonic ? (
                    wallet.value.mnemonic.split(" ").map((word, i) => (
                      <Code mr={1} key={i}>
                        {word}
                      </Code>
                    ))
                  ) : (
                    <Button onClick={() => setShowMnemonic(true)}>Show</Button>
                  )}
                </Box>
              </Flex>
            </>
          ) : (
            <Alert status="error">
              <AlertIcon />
              No wallet found
            </Alert>
          )}
        </Box>
        <Box gap={4} bg="bg.100" p={4}>
          <Heading size="md">Sweep</Heading>
          <Box my={4}>
            Sweeping will send all coins to your address:{" "}
            <Code>{mineToAddress.value || "no address set"}</Code>
          </Box>

          <Center>
            <Button
              mr={3}
              onClick={onClickSweep}
              disabled={!mineToAddress.value}
            >
              Sweep
            </Button>
          </Center>
        </Box>
      </Container>
    </>
  );
}
