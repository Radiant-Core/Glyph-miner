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
  Center,
  Button,
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
  miningStatus,
  selectedContract,
  work,
} from "../signals";
import { blockchain } from "../blockchain";
import Rejected from "../Rejected";
import TopBar from "../TopBar";
import "../initGpu";
import "../initWallet";
import "../index.css";
import { addMessage } from "../message";

export default function Miner() {
  useSignals();

  const { start, stop } = miner;
  const refInput = useRef<HTMLInputElement>(null);

  const changeToken = async (event: React.FormEvent) => {
    console.debug("Changing token");
    event.preventDefault();
    stop();
    await blockchain.changeToken((refInput.current?.value as string) || "");
  };

  const startMining = () => {
    console.debug("Start mining");
    if (!contract.value) {
      return;
    }

    if (work.value) {
      addMessage({ type: "start" });
      start();
    } else {
      console.log("Invalid work");
    }
  };

  const stopMining = async () => {
    if (miningStatus.value !== "ready" && miningStatus.value !== "stop") {
      await stop();
      addMessage({ type: "stop" });
      console.log("Stopped miner");
    }
  };

  const gpuSupported = navigator.gpu && gpu.value !== undefined;
  const canStart =
    contract.value !== undefined &&
    contract.value.height < contract.value.maxHeight &&
    balance.value > 0 &&
    mineToAddress.value;

  return (
    <>
      <TopBar />
      <Box bg="bg.300">
        <Container maxW="container.lg">
          <form onSubmit={changeToken}>
            <Flex gap={4} mx="auto" py={4}>
              <Button
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
            {miningStatus.value === "ready" ? (
              <IconButton
                onClick={startMining}
                isDisabled={!canStart}
                icon={
                  <Icon
                    as={FaPlay}
                    color={canStart ? "lightGreen.A400" : undefined}
                  />
                }
                aria-label="Start mining"
              />
            ) : (
              <IconButton
                onClick={stopMining}
                icon={<Icon as={FaStop} />}
                aria-label="Stop mining"
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
                >
                  <Icon as={TbPick} boxSize={6} color="gray.500" />
                  <Box flexGrow={1}>
                    Mine to
                    <Text
                      bgColor="blackAlpha.400"
                      as="span"
                      px={1}
                      ml={1}
                      fontFamily="Overpass Mono Variable"
                    >
                      {mineToAddress.value}
                    </Text>
                  </Box>
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
            <Text>Please check your browser supports WebGPU</Text>
          </Flex>
        )}
        <Center fontSize="small">
          <Link to="/license">
            Glyph Miner is distributed under the terms of the MIT License
          </Link>
        </Center>
      </Container>
    </>
  );
}
