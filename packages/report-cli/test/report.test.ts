import { expect, it } from "vitest";
import { formatReport } from "../src/cli.js";

it("reports exact counterfactual blocked spend", () => {
  const output = formatReport({ totalRequests: 5, allowed: 1, requiredApproval: 1, blocked: 4, blockedUsd: 4,
    blockedByReason: [{ reasonCode: "R2_EXACT_DUPLICATE", count: 4, usd: 4 }] });
  expect(output).toContain("Blocked-request price estimate: $4.00");
  expect(output).toContain("R2_EXACT_DUPLICATE: 4 request(s), $4.00");
  expect(output).toContain("not measured invoice savings");
});
