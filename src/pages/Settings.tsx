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
  Text,
  Textarea,
  useClipboard,
  useToast,
} from "@chakra-ui/react";
import { QRCodeSVG } from "qrcode.react";
import { ReactNode, useReducer, useState } from "react";
import { CheckIcon, CopyIcon } from "@chakra-ui/icons";
import { useSignals } from "@preact/signals-react/runtime";
import {
  autoReseed,
  contractsUrl,
  hideMessages,
  mineToAddress,
  miningStatus,
  mintMessage,
  restApiUrl,
  servers,
  useIndexerApi,
  wallet,
} from "../signals";
import Balance from "../Balance";
import { Script } from "@radiant-core/radiantjs";
import { Link } from "react-router-dom";
import { connect } from "../client";
import { sweepWallet } from "../sweep";
import { NETWORK_STORAGE_KEY, networkName } from "../network";
import PageHeader from "../components/PageHeader";
import Panel from "../components/Panel";
import MonoTag from "../components/MonoTag";
import StatusPill from "../components/StatusPill";

const parseServers = (value: string): string[] =>
  value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

function SectionTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <Box mb={5}>
      <Heading size="sm">{children}</Heading>
      {sub && (
        <Text fontSize="sm" color="text.muted" mt={1}>
          {sub}
        </Text>
      )}
    </Box>
  );
}

export default function Settings() {
  useSignals();
  const [showMnemonic, setShowMnemonic] = useState(false);
  const { onCopy, hasCopied } = useClipboard(wallet.value?.address || "");
  const toast = useToast();
  const onClickSweep = async () => {
    const result = await sweepWallet();
    if (result.success) {
      toast({
        status: "success",
        description: `All coins sent to ${mineToAddress.value} (txid: ${result.txid})`,
        variant: "subtle",
        duration: 10000,
        isClosable: true,
      });
    } else {
      toast({
        status: "error",
        description: `Broadcast failed${
          result.reason ? ` (${result.reason})` : ""
        }`,
        variant: "subtle",
      });
    }
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
    autoReseed: autoReseed.value ? "1" : "0",
    servers: servers.value.join("\n"),
    contractsUrl: contractsUrl.value,
    restApiUrl: restApiUrl.value,
    useIndexerApi: useIndexerApi.value ? "1" : "",
    network: networkName,
  });
  const onFormChange = ({
    target: { name, value },
  }: React.ChangeEvent<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >) => {
    setForm({ name, value });
  };

  const moveServer = (index: number, direction: -1 | 1) => {
    const list = parseServers(form.servers);
    const target = index + direction;
    if (target < 0 || target >= list.length) {
      return;
    }

    [list[index], list[target]] = [list[target], list[index]];
    setForm({ name: "servers", value: list.join("\n") });
  };

  const serverList = parseServers(form.servers);

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    // Network change requires a reload: the radiantjs network (key/address
    // derivation) and the default server list are resolved once at module
    // load. Persist the choice, clear the stored server list so the new
    // network's defaults seed cleanly on reload, then reload. Mainnet is the
    // default and clears the override entirely.
    if (form.network !== networkName) {
      const proceed = window.confirm(
        `Switch network to ${form.network}? The app will reload and your ` +
          `temporary wallet address will change to the ${form.network} ` +
          `format. Mainnet is the default — only switch if you are testing ` +
          `against a local regtest/testnet stack.`
      );
      if (!proceed) return;
      if (form.network === "mainnet") {
        localStorage.removeItem(NETWORK_STORAGE_KEY);
      } else {
        localStorage.setItem(NETWORK_STORAGE_KEY, form.network);
      }
      // Drop the stored server list so initWallet re-seeds the new network's
      // defaults (the curated mainnet list, or the loopback regtest indexer).
      localStorage.removeItem("servers");
      window.location.reload();
      return;
    }

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

    const serversArray = parseServers(form.servers);

    // Check if server has changed and reconnect
    const didChangeServer = serversArray[0] !== servers.value[0];

    mineToAddress.value = form.mineToAddress;
    mintMessage.value = form.mintMessage;
    hideMessages.value = form.hideMessages === "1";
    autoReseed.value = form.autoReseed === "1";
    contractsUrl.value = form.contractsUrl;
    restApiUrl.value = form.restApiUrl;
    useIndexerApi.value = form.useIndexerApi === "1";
    servers.value = serversArray;

    localStorage.setItem("mineToAddress", form.mineToAddress);
    localStorage.setItem("mintMessage", form.mintMessage);
    localStorage.setItem("hideMessages", form.hideMessages);
    localStorage.setItem("autoReseed", form.autoReseed);
    localStorage.setItem("servers", JSON.stringify(serversArray));
    localStorage.setItem("contractsUrl", form.contractsUrl);
    localStorage.setItem("restApiUrl", form.restApiUrl);
    localStorage.setItem("useIndexerApi", form.useIndexerApi);

    // Update work
    if (miningStatus.value === "mining") {
      miningStatus.value = "change";
    }

    if (didChangeServer) {
      console.debug("Server changed, reconnecting");
      connect(true);
    }

    toast({
      status: "success",
      description: "Saved",
      variant: "subtle",
    });
  };

  return (
    <>
      <PageHeader title="Settings">
        <IconButton
          icon={<CloseIcon />}
          as={Link}
          aria-label="Close"
          to="/"
          variant="ghost"
          size="sm"
        />
      </PageHeader>

      <Container maxW="container.lg" py={6}>
        <Box as="form" onSubmit={onSave}>
          {error && (
            <Alert status="error" mb={4} borderRadius="xl">
              <AlertIcon />
              {error}
            </Alert>
          )}

          {/* Mining */}
          <Panel mb={4}>
            <SectionTitle sub="How and where your mined tokens are paid out.">
              Mining
            </SectionTitle>
            <FormControl mb={5} isRequired>
              <FormLabel fontWeight="semibold" fontSize="sm">Mine to address</FormLabel>
              <Input
                name="mineToAddress"
                defaultValue={form.mineToAddress}
                onChange={onFormChange}
              />
              <FormHelperText fontSize="xs">
                Radiant address to send mined tokens to
              </FormHelperText>
            </FormControl>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">Mint message</FormLabel>
              <Input
                name="mintMessage"
                defaultValue={form.mintMessage}
                maxLength={80}
                onChange={onFormChange}
              />
              <FormHelperText fontSize="xs">Written on-chain on successful mint</FormHelperText>
            </FormControl>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">Hide messages from other miners</FormLabel>
              <Select
                name="hideMessages"
                defaultValue={form.hideMessages}
                onChange={onFormChange}
                title="Hide messages from other miners"
              >
                <option value="">No</option>
                <option value="1">Yes</option>
              </Select>
            </FormControl>
            <FormControl>
              <FormLabel fontWeight="semibold" fontSize="sm">Auto-reseed nonce space</FormLabel>
              <Select
                name="autoReseed"
                defaultValue={form.autoReseed}
                onChange={onFormChange}
                title="Automatically reseed work entropy"
              >
                <option value="1">Yes (continue mining)</option>
                <option value="">No (stop after full nonce space)</option>
              </Select>
              <FormHelperText fontSize="xs">
                When enabled, miner mutates mint-message entropy and continues after exhausting 32-bit nonce space.
              </FormHelperText>
            </FormControl>
          </Panel>

          {/* Network & servers */}
          <Panel mb={4}>
            <SectionTitle sub="Where contracts are discovered and which nodes the miner talks to.">
              Network &amp; servers
            </SectionTitle>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">Network</FormLabel>
              <Select
                name="network"
                defaultValue={form.network}
                onChange={onFormChange}
                title="Network"
              >
                <option value="mainnet">Mainnet (default)</option>
                <option value="testnet">Testnet</option>
                <option value="regtest">Regtest (local testing)</option>
              </Select>
              <FormHelperText fontSize="xs">
                Mainnet is the default. Regtest/testnet are for local testing
                against a stack on{" "}
                <Code fontSize="xs">ws://localhost:50020</Code> and reload the app
                when changed.
              </FormHelperText>
            </FormControl>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">Use RXinDexer API</FormLabel>
              <Select
                name="useIndexerApi"
                defaultValue={form.useIndexerApi}
                onChange={onFormChange}
                title="Use RXinDexer API for contract discovery"
              >
                <option value="1">Yes (recommended)</option>
                <option value="">No (use fallback URL)</option>
              </Select>
              <FormHelperText fontSize="xs">
                Fetch contracts from RXinDexer dMint API. Falls back to URL if unavailable.
              </FormHelperText>
            </FormControl>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">RXinDexer REST API URL</FormLabel>
              <Input
                name="restApiUrl"
                defaultValue={form.restApiUrl}
                onChange={onFormChange}
                placeholder="https://indexer.example.com/api"
              />
              <FormHelperText fontSize="xs">
                REST API endpoint for contract discovery (e.g., https://indexer.example.com/api)
              </FormHelperText>
            </FormControl>
            <FormControl mb={5}>
              <FormLabel fontWeight="semibold" fontSize="sm">Contracts URL (fallback)</FormLabel>
              <Input
                name="contractsUrl"
                defaultValue={form.contractsUrl}
                onChange={onFormChange}
              />
              <FormHelperText fontSize="xs">
                Used when RXinDexer API is disabled or unavailable
              </FormHelperText>
            </FormControl>
            <FormControl>
              <FormLabel fontWeight="semibold" fontSize="sm">Servers</FormLabel>
              <Textarea
                name="servers"
                value={form.servers}
                onChange={onFormChange}
                rows={3}
              ></Textarea>
              <Box mt={2}>
                {serverList.map((server, index) => (
                  <Flex key={`${server}-${index}`} align="center" gap={2} mb={2}>
                    <MonoTag flex="1" p={2} truncate>
                      {server}
                    </MonoTag>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => moveServer(index, -1)}
                      isDisabled={index === 0}
                    >
                      Up
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => moveServer(index, 1)}
                      isDisabled={index === serverList.length - 1}
                    >
                      Down
                    </Button>
                  </Flex>
                ))}
              </Box>
              <FormHelperText fontSize="xs">
                List of servers in order of preference (top is tried first)
              </FormHelperText>
            </FormControl>
          </Panel>

          <Center mb={4}>
            <Button type="submit" size="lg" px={12}>Save</Button>
          </Center>
        </Box>

        {/* Temporary wallet */}
        <Panel mb={4}>
          {wallet.value ? (
            <>
              <SectionTitle>Temporary wallet</SectionTitle>
              <Alert status="warning">
                <AlertIcon />
                <Box fontSize="sm">
                  <b>
                    This is a temporary wallet that is not password protected.
                  </b>{" "}
                  Do not send more coins than necessary for paying transaction
                  fees. You must sweep any remaining funds when you are finished
                  mining.
                </Box>
              </Alert>
              <Flex direction="column" alignItems="center" mt={6} gap={2}>
                <Text fontSize="xs" fontWeight="bold" letterSpacing="wider" textTransform="uppercase" color="text.muted">
                  Address
                </Text>
                <Flex align="center" gap={1} maxW="100%">
                  <MonoTag truncate>{wallet.value.address}</MonoTag>
                  <IconButton
                    onClick={onCopy}
                    icon={
                      hasCopied ? (
                        <CheckIcon color="accent.fg" />
                      ) : (
                        <CopyIcon color="accent.fg" />
                      )
                    }
                    variant="ghost"
                    aria-label="Copy address"
                    size="xs"
                  />
                </Flex>
                <Box bgColor="white" p={2} mt={3} borderRadius="lg">
                  <QRCodeSVG size={128} value={wallet.value.address} />
                </Box>
                <Text fontSize="xs" fontWeight="bold" letterSpacing="wider" textTransform="uppercase" color="text.muted" mt={5}>
                  Balance
                </Text>
                <Text fontWeight="semibold"><Balance /> RXD</Text>
                <Text fontSize="xs" fontWeight="bold" letterSpacing="wider" textTransform="uppercase" color="text.muted" mt={5}>
                  Recovery phrase
                </Text>
                <Box
                  textAlign="center"
                  p={3}
                  mt={1}
                  borderWidth="1px"
                  borderColor="border.default"
                  borderRadius="xl"
                  alignSelf="stretch"
                >
                  {showMnemonic ? (
                    wallet.value.mnemonic.split(" ").map((word, i) => (
                      <Code key={i} mr={1} mb={1}>
                        {word}
                      </Code>
                    ))
                  ) : (
                    <Button onClick={() => setShowMnemonic(true)} variant="outline" size="sm">Show</Button>
                  )}
                </Box>
              </Flex>
            </>
          ) : (
            <Alert status="error" borderRadius="xl">
              <AlertIcon />
              No wallet found
            </Alert>
          )}
        </Panel>

        {/* Sweep */}
        <Panel>
          <SectionTitle sub="Send all funds from the temporary wallet to your payout address.">
            Sweep
          </SectionTitle>
          <Flex align="center" gap={2} mb={4} fontSize="sm" flexWrap="wrap">
            <Text color="text.muted">Sweeps all coins to</Text>
            {mineToAddress.value ? (
              <MonoTag truncate>{mineToAddress.value}</MonoTag>
            ) : (
              <StatusPill tone="warning">No payout address set</StatusPill>
            )}
          </Flex>
          <Center>
            <Button
              onClick={onClickSweep}
              isDisabled={!mineToAddress.value}
            >
              Sweep
            </Button>
          </Center>
        </Panel>
      </Container>
    </>
  );
}
