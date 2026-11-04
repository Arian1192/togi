import { SrtSandbox } from "../srt-sandbox.ts";
import { runConformance } from "./suite.ts";

runConformance("SrtSandbox", {
  skip: process.platform === "darwin" ? undefined : "SrtSandbox solo funciona en macOS (Seatbelt)",
  create: (s) => new SrtSandbox({ togiHome: s.togiHome, home: s.home, runtimePaths: [s.nodeBin] }),
});
