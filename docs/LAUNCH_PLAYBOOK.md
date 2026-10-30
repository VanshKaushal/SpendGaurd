# Launch Spend Guard

Spend Guard helps teams control paid tool purchases made by coding agents. Each routed request is checked against a task budget, request history, and repository state, with a recorded decision reason.

## Customer and offer

Start with a small engineering team or agency using separately metered search, sandboxes, or APIs. Model-token-only users are outside current coverage. Generic budgets/MCP permissions have competitors; validate whether task context leads to better decisions.

The local core is free under MIT. The proposed assisted pilot is $149 for four weeks: one provider, one task workflow, setup help, policy tuning, and weekly review of incidents/false blocks. Confirm scope and availability personally before accepting payment. A recurring team plan remains an experiment until customers request ongoing managed features; shared cloud policies and remote approvals are not implemented.

The website collects pilot enquiries, not payments. Revenue remains zero until a real customer pays. Funding, grants, downloads, and estimated blocked-request value are not customer revenue.

## Four-week operating plan

1. Interview 10 teams. Record providers, actual bills, specific duplicate/retry incidents, current controls, and installation willingness. Aim for 3 concrete dollar-quantified incidents.
2. Onboard 2 willing teams to supported workflows. Observe installation and compare configured prices with actual provider charges.
3. Review blocks with each team. Separate confirmed unnecessary purchases from legitimate false blocks. Track routed value, incident count, false-block rate, time to first guarded call, and continued weekly use.
4. Seek one paid pilot and a renewal decision. Revisit the workflow/customer choice if teams lack paid-tool spending or cannot accept an interceptor.

These are targets, not achieved traction.

## Distribution and showcase

Record a short demo: first approval, equivalent retry blocked, different query allowed, hard cap enforced, ledger verified. Share the working archive and exact install instructions in communities that allow it. Personally onboard the first users.

Draft outreach: "I'm building Spend Guard for coding agents that buy paid search, sandbox runs, or API resources. Have you had a specific repeated purchase or runaway run? I'd like to understand the bill and try it on one workflow. The local core is free; assisted pilots are $149 for four weeks."

No customer outreach has been sent by this work. Do not invent customers, acceptance, savings, or revenue for a pitch. YC/showcase evidence should emphasize actual behavior and adoption when it exists.

Solana showcase: demonstrate authorization before an external signer, one clearly labeled test purchase, a receipt, and a blocked retry. The current core is TypeScript; a Rust migration is not proof of adoption or on-chain integration. Live settlement is unverified.

## Owner actions

Choose the public GitHub destination and publish the source/archive. Set up a payment account and create a real pilot payment link after agreeing scope with a customer. Configure a contact email if wanted. Review private `pilot_requests` through Sites database tools; enquiries are not emailed automatically. Never ask users for wallet keys or repository secrets.
