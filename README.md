# NyLi

NyLi is an orchestrator first repo for building and maintaining the NyLi Copilot Studio agent and its worker ecosystem.

NyLi is designed to do three things well.

1. Route work to action workers when you ask for something that requires execution
2. Keep answers grounded in knowledge files and worker outputs
3. Stay easy to extend by adding workers and knowledge without rewriting the whole agent

This repo is the source of truth for NyLi.

## What NyLi is

NyLi is your primary orchestrator agent. It does not pretend to execute tasks. It decides what path to take, validates inputs, and then either responds from knowledge or routes to a worker.

NyLi supports four outcomes for every user request.

1. Knowledge answer using attached knowledge sources
2. Worker execution using an action worker
3. Input capture when required details are missing
4. Refusal when a request is unsafe or outside scope

## What NyLi is not

1. Not a general purpose chatbot
2. Not a worker that performs actions directly
3. Not a system that invents tools, permissions, or results

## Core rules

1. Do not guess
2. Do not claim execution without a worker result
3. Ask only for the smallest set of missing inputs
4. Keep outputs deterministic for operational work
5. When a machine payload is required, return a single valid JSON object only

## Worker ecosystem

NyLi routes work to these workers.

1. MS365 Worker
2. OneDrive SharePoint Worker
3. Jira Worker
4. Teams Worker

Each worker owns execution inside its system boundary. NyLi owns routing, validation, and response shaping.

## Repo contents

Use this repo as the single place to maintain NyLi.

1. Copilot Studio paste ready text for agent fields
2. Knowledge files to upload as knowledge sources
3. Worker manifests and routing guidance
4. Regression prompts for stability checks
5. Docs and runbooks for changes and releases

## Folder guide

copilot_studio  
Contains the text you paste into Copilot Studio fields.

knowledge  
Contains the files you upload to Copilot Studio as knowledge sources.

workers  
Contains worker manifests and worker specific notes.

governance  
Contains truth rules, routing policy, and output constraints.

prompts  
Contains test prompts for regression and routing validation.

docs  
Contains overview docs, architecture, setup, release process, and testing guidance.

templates  
Contains reusable templates for new workers and new knowledge files.

## Copilot Studio setup

Create the NyLi agent and load it from this repo.

Step 1  
Create the agent in Copilot Studio.

Step 2  
Set the agent description using this file.  
copilot_studio agent_description.txt

Step 3  
Set the agent instructions using this file.  
copilot_studio agent_instructions.txt

Step 4  
Upload the knowledge files from the knowledge folder as knowledge sources.

Step 5  
Create topics that implement worker calls and routing patterns. Use this as a starting pattern.  
copilot_studio topic_bootstrap_pattern.md

## How to use NyLi

NyLi works best when you ask in an execution oriented way.

Examples that should route to a worker.

1. Show me my meetings for tomorrow
2. Draft an email reply to this message
3. Find the file named X in OneDrive and summarize it
4. Update this Jira issue with a new status
5. Post this update to a Teams channel

Examples that should be answered from knowledge.

1. What are NyLi truth rules
2. What is the routing policy
3. How do we format machine payload outputs

If you ask for something that needs execution but you do not provide required details, NyLi should ask for only what is needed to proceed.

## Output standards

NyLi produces two kinds of outputs.

Human output  
Short, direct, actionable.

Machine output  
Only when requested or required. Return a single valid JSON object only. No extra text. Minified.

## Testing

Use the prompts in prompts regression_prompts.md to validate behavior after any change.

At minimum, validate these areas.

1. Correct routing to a worker vs knowledge answer
2. Input validation asks for the smallest missing details
3. No claims of execution without worker output
4. JSON only responses are valid, single object, minified

## Release process

Use a simple release flow.

1. Update files in this repo
2. Run regression prompts in Copilot Studio test chat
3. Update Copilot Studio agent fields and knowledge sources
4. Tag the commit when the Copilot Studio build is published

## Contributing

See CONTRIBUTING.md for contribution rules, quality bar, and naming standards.

## Security

See SECURITY.md for vulnerability reporting.

## License

MIT License. See LICENSE.
