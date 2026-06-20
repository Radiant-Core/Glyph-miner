import { useRef } from "react";
import { Link } from "react-router-dom";
import { useSignals } from "@preact/signals-react/runtime";
import {
  Container,
  Input,
  IconButton,
  Flex,
  Icon,
  Box,
  Button,
  SimpleGrid,
  Text,
  Tooltip,
  useToast,
} from "@chakra-ui/react";
import { BsGpuCard } from "react-icons/bs";
import { Search2Icon } from "@chakra-ui/icons";
import { FaPlay, FaStop } from "react-icons/fa6";
import {
  TbActivity,
  TbCircleCheck,
  TbCircleX,
  TbListDetails,
  TbPick,
  TbWallet,
} from "react-icons/tb";
import TokenDetails from "../TokenDetails";
import miner from "../miner";
import Hashrate from "../Hashrate";
import Messages from "../Messages";
import Accepted from "../Accepted";
import Balance from "../Balance";
import {
  balance,
  contract,
  glyph,
  gpu,
  mineToAddress,
  miningEnabled,
  miningStatus,
  selectedContract,
  work,
} from "../signals";
import { changeToken, estimateMintBalanceFloorPhotons } from "../blockchain";
import Rejected from "../Rejected";
import TopBar from "../TopBar";
import "../initGpu";
import "../initWallet";
import "../index.css";
import { addMessage } from "../message";
import BottomBar from "../BottomBar";
import { isRef, photonsToRXD } from "../utils";
import { ServerStatus, serverStatus } from "../client";
import Panel from "../components/Panel";
import ConnectionStatus from "../ConnectionStatus";
import StatCard from "../components/StatCard";
import EmptyState from "../components/EmptyState";
import HashrateChart from "../components/HashrateChart";
import MonoTag from "../components/MonoTag";
import ReadinessChecklist, {
  ChecklistItem,
} from "../components/ReadinessChecklist";

export default function Miner() {
  useSignals();
  const toast = useToast();

  const { start, stop } = miner;
  const refInput = useRef<HTMLInputElement>(null);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const ref = (refInput.current?.value as string) || "";
    if (!isRef(ref)) {
      toast({
        status: "error",
        description: "Please enter a valid contract address",
        variant: "subtle",
      });
      return;
    }
    console.debug("Changing token");
    if (miningStatus.value !== "ready") {
      addMessage({ type: "stop" });
    }
    stop();
    changeToken(ref);
  };

  const startMining = () => {
    console.debug("Start mining");
    if (!contract.value) {
      return;
    }

    if (work.value) {
      addMessage({ type: "start" });
      miningEnabled.value = true;
      start();
    } else {
      console.log("Invalid work");
    }
  };

  const stopMining = async () => {
    miningEnabled.value = false;
    if (miningStatus.value !== "ready" && miningStatus.value !== "stop") {
      await stop();
      addMessage({ type: "stop" });
      console.log("Stopped miner");
    }
  };

  const gpuSupported = navigator.gpu && gpu.value !== undefined;

  // balance.value is in photons; compare against the per-contract floor.
  const balanceFloorPhotons = contract.value
    ? estimateMintBalanceFloorPhotons(contract.value)
    : Infinity;

  // Decompose the start conditions ONCE; `canStart` and the readiness checklist
  // are both derived from these same booleans so the gating logic never forks.
  const contractLoaded = contract.value !== undefined;
  const supplyRemaining =
    !!contract.value && contract.value.height < contract.value.maxHeight;
  const payoutSet = !!mineToAddress.value;
  const funded = balance.value >= balanceFloorPhotons;
  const connected = serverStatus.value === ServerStatus.CONNECTED;

  const canStart =
    contractLoaded && supplyRemaining && funded && payoutSet && connected;

  const ticker = (glyph.value?.payload.ticker as string) || "";
  // Supply and balance can only be evaluated once a contract is loaded, so
  // those rows appear progressively (avoids a misleading "fully mined" /
  // "insufficient balance" before any contract is selected).
  const readinessItems: ChecklistItem[] = [
    {
      ok: contractLoaded,
      label: contractLoaded
        ? `Contract loaded${ticker ? ` — ${ticker}` : ""}`
        : "No contract loaded",
      hint: "Enter a contract address or pick one from the list.",
      to: "/tokens",
      toLabel: "Browse",
    },
    ...(contractLoaded
      ? [
          {
            ok: supplyRemaining,
            label: supplyRemaining
              ? "Contract has remaining supply"
              : "Contract is fully mined",
            hint: "This contract is minted out — choose another.",
            to: "/tokens",
            toLabel: "Browse",
          },
        ]
      : []),
    {
      ok: payoutSet,
      label: payoutSet ? "Payout address set" : "No payout address set",
      hint: "Set the address that receives your minted tokens.",
      to: "/settings",
      toLabel: "Settings",
    },
    ...(contractLoaded
      ? [
          {
            ok: funded,
            label: funded ? "Wallet funded" : "Insufficient wallet balance",
            hint: `Fund the temporary wallet with at least ${photonsToRXD(
              balanceFloorPhotons
            )} RXD.`,
            to: "/settings",
            toLabel: "Fund",
          },
        ]
      : []),
    {
      ok: connected,
      label: connected ? "Connected to a server" : "Not connected to a server",
      hint: "Waiting for a server connection…",
    },
  ];

  return (
    <>
      <TopBar />
      <BottomBar />

      {/* Contract search */}
      <Box
        bg="surface.inset"
        mt="56px"
        borderBottom="1px solid"
        borderBottomColor="border.subtle"
      >
        <Container maxW="container.lg">
          <form onSubmit={onSubmit}>
            <Flex gap={3} mx="auto" py={4}>
              <IconButton
                display={{ base: "flex", sm: "none" }}
                as={Link}
                to="/tokens"
                icon={<Icon as={TbListDetails} />}
                aria-label="Contract list"
                variant="outline"
              />
              <Button
                display={{ base: "none", sm: "flex" }}
                as={Link}
                to="/tokens"
                leftIcon={<Icon as={TbListDetails} />}
                aria-label="Contract list"
                variant="outline"
              >
                Contracts
              </Button>
              <Input
                width="auto"
                flexGrow={1}
                type="text"
                placeholder="Enter token contract address"
                ref={refInput}
                defaultValue={selectedContract.value}
              />
              <IconButton
                icon={<Search2Icon />}
                aria-label="Search"
                type="submit"
              />
            </Flex>
          </form>
        </Container>
      </Box>

      <Container maxW="container.lg" pb={10}>
        {gpuSupported ? (
          <>
            {/* Control bar: GPU + connection + the primary Start/Stop action */}
            <Panel
              mt={4}
              display="flex"
              alignItems="center"
              gap={4}
              flexWrap="wrap"
            >
              <Icon as={BsGpuCard} boxSize={6} color="accent.fg" />
              <Box flexGrow={1} minW="120px">
                <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>
                  {gpu.value}
                </Text>
                <ConnectionStatus mt={1} />
              </Box>
              {miningEnabled.value ? (
                <Button
                  onClick={stopMining}
                  leftIcon={<Icon as={FaStop} />}
                  colorScheme="red"
                >
                  Stop mining
                </Button>
              ) : (
                <Tooltip
                  label="Resolve the items below to start"
                  isDisabled={canStart}
                  hasArrow
                >
                  <Box>
                    <Button
                      onClick={startMining}
                      isDisabled={!canStart}
                      leftIcon={<Icon as={FaPlay} />}
                    >
                      Start mining
                    </Button>
                  </Box>
                </Tooltip>
              )}
            </Panel>

            {/* Readiness checklist — explains a disabled Start button */}
            <ReadinessChecklist ready={canStart} items={readinessItems} />

            {/* Active contract summary */}
            <TokenDetails />

            {/* Payout destination */}
            {payoutSet && (
              <Flex
                align="center"
                gap={2}
                mt={3}
                fontSize="sm"
                color="text.muted"
                flexWrap="wrap"
              >
                <Icon as={TbPick} boxSize={4} />
                <Text>Mining rewards to</Text>
                <MonoTag truncate>{mineToAddress.value}</MonoTag>
              </Flex>
            )}

            {/* Live stats */}
            <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3} mt={3}>
              <StatCard
                label="Hashrate"
                icon={TbActivity}
                tone="accent"
                value={<Hashrate />}
                sub={<HashrateChart />}
              />
              <StatCard
                label="Accepted"
                icon={TbCircleCheck}
                tone="positive"
                value={<Accepted />}
              />
              <StatCard
                label="Rejected"
                icon={TbCircleX}
                tone="negative"
                value={<Rejected />}
              />
              <StatCard
                label="Balance"
                icon={TbWallet}
                value={
                  <>
                    <Balance /> <Text as="span" fontSize="md" color="text.muted">RXD</Text>
                  </>
                }
              />
            </SimpleGrid>

            {/* Activity log */}
            <Panel mt={3} bg="surface.inset" fontSize="sm">
              <Messages />
            </Panel>
          </>
        ) : (
          <EmptyState
            icon={BsGpuCard}
            title="No GPU found"
            description="Glyph Miner needs WebGPU. Please check that your browser supports it and that hardware acceleration is enabled."
          />
        )}
      </Container>
    </>
  );
}
