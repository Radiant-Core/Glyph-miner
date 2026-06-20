import { describe, expect, it } from "vitest";
import { dropLoopbackServers, isLoopbackServer } from "../network";

describe("network loopback server scrubbing", () => {
  it("flags loopback indexer endpoints", () => {
    expect(isLoopbackServer("ws://localhost:50020")).toBe(true);
    expect(isLoopbackServer("ws://127.0.0.1:50020")).toBe(true);
    expect(isLoopbackServer("wss://localhost:50022")).toBe(true);
    expect(isLoopbackServer("ws://[::1]:50020")).toBe(true);
    expect(isLoopbackServer("ws://0.0.0.0:50020")).toBe(true);
    expect(isLoopbackServer("  ws://localhost:50020  ")).toBe(true);
  });

  it("keeps public mainnet endpoints", () => {
    expect(isLoopbackServer("wss://electrumx.radiantcore.org")).toBe(false);
    expect(isLoopbackServer("wss://radiantus.bladenet.online:50022")).toBe(false);
    expect(isLoopbackServer("wss://electrumx.radiant4people.com:50022")).toBe(
      false
    );
  });

  it("does not throw on unparseable entries and keeps them", () => {
    expect(isLoopbackServer("not a url")).toBe(false);
    expect(isLoopbackServer("")).toBe(false);
  });

  it("drops only loopback endpoints from a mixed list", () => {
    const list = [
      "ws://localhost:50020",
      "wss://electrumx.radiantcore.org",
      "ws://127.0.0.1:50020",
      "wss://radiantus.bladenet.online:50022",
    ];
    expect(dropLoopbackServers(list)).toEqual([
      "wss://electrumx.radiantcore.org",
      "wss://radiantus.bladenet.online:50022",
    ]);
  });

  it("returns an empty list when every entry is loopback", () => {
    expect(dropLoopbackServers(["ws://localhost:50020"])).toEqual([]);
  });
});
