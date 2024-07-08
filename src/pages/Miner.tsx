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
  Text,
  Button,
  useToast,
} from "@chakra-ui/react";
import { BsGpuCard } from "react-icons/bs";
import { Search2Icon, SettingsIcon } from "@chakra-ui/icons";
import { FaPlay, FaStop } from "react-icons/fa6";
import { TbPick, TbListDetails } from "react-icons/tb";
import TokenDetails from "../TokenDetails";
import miner from "../miner";
import Hashrate from "../Hashrate";
import Messages from "../Messages";
import Accepted from "../Accepted";
import {
  balance,
  contract,
  gpu,
  mineToAddress,
  miningEnabled,
  miningStatus,
  selectedContract,
  work,
} from "../signals";
import { changeToken } from "../blockchain";
import Rejected from "../Rejected";
import TopBar from "../TopBar";
import "../initGpu";
import "../initWallet";
import "../index.css";
import { addMessage } from "../message";
import BottomBar from "../BottomBar";
import { isRef } from "../utils";
import { ServerStatus, serverStatus } from "../client";

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
  const reward = Number(contract.value?.reward || 0) / 100000000;
  const canStart =
    contract.value !== undefined &&
    contract.value.height < contract.value.maxHeight &&
    balance.value > 0.01 + reward &&
    mineToAddress.value &&
    serverStatus.value === ServerStatus.CONNECTED;

  return (
    <>
      <TopBar />
      <BottomBar />
      <Box bg="bg.300" mt="56px">
        <Container maxW="container.lg">
          <form onSubmit={onSubmit}>
            <Flex gap={4} mx="auto" py={4}>
              <IconButton
                display={{ base: "flex", sm: "none" }}
                as={Link}
                to="/tokens"
                icon={<Icon as={TbListDetails} />}
                aria-label="Contract list"
              />
              <Button
                display={{ base: "none", sm: "flex" }}
                as={Link}
                to="/tokens"
                leftIcon={<Icon as={TbListDetails} />}
                aria-label="Contract list"
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
      <Container maxW="container.lg">
        {gpuSupported && (
          <Flex
            bg="bg.100"
            py={2}
            px={4}
            mt={4}
            alignItems="center"
            justifyContent="space-between"
            gap={4}
          >
            <Icon as={BsGpuCard} boxSize={6} color="gray.500" />
            <Box flexGrow={1}>{gpu.value}</Box>
            <Box>
              <Hashrate />
            </Box>
            {miningEnabled.value ? (
              <IconButton
                onClick={stopMining}
                icon={<Icon as={FaStop} />}
                aria-label="Stop mining"
              />
            ) : (
              <IconButton
                onClick={startMining}
                isDisabled={!canStart}
                icon={
                  <Icon
                    as={FaPlay}
                    color={canStart ? "lightGreen.A200" : undefined}
                  />
                }
                aria-label="Start mining"
              />
            )}
          </Flex>
        )}

        <TokenDetails />

        {gpuSupported ? (
          <>
            {mineToAddress.value ? (
              <>
                <Flex
                  bg="bg.100"
                  p={4}
                  mt={2}
                  alignItems="center"
                  justifyContent="space-between"
                  gap={4}
                  flexWrap={{ base: "wrap", md: "initial" }}
                >
                  <Flex flexGrow={1} wordBreak="break-all" alignItems="center">
                    <Icon as={TbPick} boxSize={6} color="gray.500" mr={2} />
                    <Text>Mine to</Text>
                    <Text bgColor="blackAlpha.400" as="span" px={1} ml={1}>
                      {mineToAddress.value}
                    </Text>
                  </Flex>
                  <Box
                    borderRight="2px"
                    borderRightColor="whiteAlpha.400"
                    pr={4}
                  >
                    Accepted:{" "}
                    <b>
                      <Accepted />
                    </b>
                  </Box>
                  <Box>
                    Rejected:{" "}
                    <b>
                      <Rejected />
                    </b>
                  </Box>
                </Flex>
                <Box mt={2} mb={8} bgColor="bg.400" p={2} px={4}>
                  <Messages />
                </Box>
              </>
            ) : (
              <Flex direction="column" alignItems="center" my={24}>
                <Text fontSize="x-large" mb={2}>
                  Please configure the miner and fund the wallet
                </Text>
                <Button as={Link} leftIcon={<SettingsIcon />} to="/settings">
                  Settings
                </Button>
              </Flex>
            )}
          </>
        ) : (
          <Flex direction="column" alignItems="center" my={24}>
            <Icon as={BsGpuCard} width={16} height={16} mb={4} />
            <Text fontSize="x-large" mb={2}>
              No GPU found
            </Text>
            <Text textAlign="center">
              Please check your browser supports WebGPU
            </Text>
          </Flex>
        )}
      </Container>
    </>
  );
}
