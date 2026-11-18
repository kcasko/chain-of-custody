# Bedrock Managed Agents access requests (drafts for Keith to send)

Prepared November 18, 2026 from the T09 findings. Not sent. Keith sends these himself. Replace `[account ID]` before sending; it is deliberately not stored in the repository.

Evidence behind every claim: docs/research/2026-11-18-t09-spike-report.md.

Send all three today. Two other participants reported the same block on November 13 and 17 with support cases still unanswered, so do not wait on one channel.

## 1. AWS Sales contact form

Where: https://aws.amazon.com/contact-us/sales-support/ (the route named in the GPT-5.6 Luna error message).

> Subject: Request to enable Bedrock Managed Agents (preview) and OpenAI GPT-5.6 models
>
> Hi,
>
> I'm requesting access to Amazon Bedrock Managed Agents (preview) and the OpenAI GPT-5.6 models for AWS account [account ID]. I'm building an entry for the AWS Builder Center hackathon "Agents, your rules: Bedrock Managed Agents build", which closes December 2, 2026.
>
> On November 18, 2026:
>
> 1. POST /openai/v1/agents/sessions on bedrock-mantle returns HTTP 401 "Bedrock Managed Agents is not available for this account." in us-east-1, us-west-2 and us-east-2.
> 2. A chat completion to openai.gpt-5.6-luna returns HTTP 401 "not available for this account" and points to AWS Sales.
> 3. openai.gpt-oss-20b works with the same credentials, and GET /v1/models lists openai.gpt-5.6-luna, so signing and IAM are working.
>
> Everything else for the project is built and tested on this account, including the AgentCore Gateway and Policy setup the agent will use. Account access is the only blocker.
>
> Please enable Bedrock Managed Agents and openai.gpt-5.6-luna for this account in us-east-1, or let me know what else is needed. I can provide request IDs and timestamps.
>
> Thank you,
> Keith

## 2. AWS Support case

Where: AWS Support Center, if your support plan allows a case for service access. On the Basic plan, try "Account and billing" with the same text; technical cases need a paid plan.

> Subject: Bedrock Managed Agents and GPT-5.6 Luna return "not available for this account"
>
> Hello,
>
> I'm contacting you regarding account-level access to Amazon Bedrock Managed Agents (preview) and openai.gpt-5.6-luna on account [account ID].
>
> Region: us-east-1 (also tested us-west-2 and us-east-2)
> Time: November 18, 2026, approximately 13:45 to 14:10 UTC
> Endpoint: bedrock-mantle, SigV4 service bedrock-mantle
> Caller: an IAM Identity Center AdministratorAccess role
>
> 1. POST /openai/v1/agents/sessions: HTTP 401, "Bedrock Managed Agents is not available for this account."
> 2. POST /v1/chat/completions with model openai.gpt-5.6-luna: HTTP 401, "openai.gpt-5.6-luna is not available for this account."
> 3. POST /v1/chat/completions with model openai.gpt-oss-20b: HTTP 200.
> 4. GET /v1/models: HTTP 200 and lists openai.gpt-5.6-luna.
>
> Because another model works with the same credentials and the caller has administrator permissions, this looks like an account entitlement rather than an IAM or configuration issue.
>
> Please enable Bedrock Managed Agents and openai.gpt-5.6-luna for this account, or confirm the correct process to request it. I need access for the "Agents, your rules" hackathon, which ends December 2, 2026.
>
> Thank you,
> Keith

## 3. Comment on the hackathon thread

Where: the Discussion post "Bedrock Managed Agents 'not available for this account': is there an access step for participants?"

> Same wall here as of Nov 18. bedrock-mantle lists openai.gpt-5.6-luna, but /openai/v1/agents/sessions returns 401 in all three preview regions, and a plain chat completion to gpt-5.6-luna returns 401 pointing at AWS Sales. gpt-oss-20b works on the same credentials, so it's account entitlement, not setup.
>
> Everything around it is built and tested: AgentCore Gateway with Cedar policies in ENFORCE, a tool Lambda that validates on its own, and a test role standing in for the session role. The only missing piece is the agent the hackathon is named after.
>
> Organizers: is there an access path for participants, or is building on AgentCore with another model acceptable until access comes through? Knowing which one decides how a lot of people spend the next two weeks.
