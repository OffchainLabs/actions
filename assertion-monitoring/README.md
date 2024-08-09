# Assertion Monitor GitHub Action

This GitHub Action checks for chains that have not posted an assertion in the last seven days. It's part of the Arbitrum monitoring toolkit developed by OffchainLabs.

## Description

The Assertion Monitor is designed to help maintain the health and security of Arbitrum chains by alerting when assertions haven't been posted within a specified timeframe. This action can be integrated into your CI/CD pipeline to automate the monitoring process.

## Usage

To use this action in your workflow, create a `.github/workflows/assertion-monitor.yml` file in your repository with the following content:

```yaml
name: Assertion Monitor

on:
  schedule:
    - cron: '0 0 * * *'  # Run daily at midnight UTC
  workflow_dispatch:  # Allow manual triggering

jobs:
  check-assertions:
    runs-on: ubuntu-latest
    steps:
      - name: Run Assertion Monitor
        uses: OffchainLabs/actions/assertion-monitor@main
        env:
          # if using slack notifications
          ASSERTION_MONITORING_SLACK_TOKEN: ${{ secrets.ASSERTION_MONITORING_SLACK_TOKEN }}
          ASSERTION_MONITORING_SLACK_CHANNEL: ${{ secrets.ASSERTION_MONITORING_SLACK_CHANNEL }}
        with:
          config: |
            {
              "childChains": [
                {
                  "chainId": 37714555429,
                  "parentChainId": 421614,
                  "name": "Xai Testnet",
                  "parentRpcUrl": "https://sepolia-rollup.arbitrum.io/rpc",
                  "ethBridge": {
                    "rollup": "0xeedE9367Df91913ab149e828BDd6bE336df2c892"
                  }
                }
              ]
            }
          enable-alerting: 'true'
```

This workflow will run the Assertion Monitor daily at midnight UTC and can also be triggered manually.

## Inputs

| Input             | Description                                        | Required | Default |
| ----------------- | -------------------------------------------------- | -------- | ------- |
| `config`          | JSON configuration for the child chains to monitor | Yes      | -       |
| `from-block`      | Starting block number for scanning                 | No       | -       |
| `to-block`        | Ending block number for scanning                   | No       | -       |
| `enable-alerting` | Enable error generation and reporting to Slack     | No       | `false` |

## Configuration

The `config` input should be a JSON string containing the configuration for the chains you want to monitor. The essential fields for each chain in the `childChains` array are:

- `chainId`: The ID of the child chain
- `parentChainId`: The ID of the parent chain
- `name`: The name of the chain
- `parentRpcUrl`: The RPC URL of the parent chain
- `ethBridge.rollup`: The address of the rollup contract on the parent chain

You can include multiple chains in the `childChains` array if needed.

## Block Range Specification

You can optionally specify a block range to scan by using the `from-block` and `to-block` inputs. If not provided, the action will use its default behavior (checking for assertions within the past week).

## Slack Alerting

To enable Slack alerting:

1. Set `enable-alerting` to `true` in the action inputs.
2. Set up the following secrets in your GitHub repository:
   - `ASSERTION_MONITORING_SLACK_TOKEN`: Your Slack bot token
   - `ASSERTION_MONITORING_SLACK_CHANNEL`: The Slack channel ID for alerts

To set up these secrets:
1. Go to your GitHub repository
2. Click on "Settings" > "Secrets and variables" > "Actions"
3. Click "New repository secret"
4. Add the secrets with the names and values mentioned above

Make sure to obtain the Slack bot token and channel ID from your Slack workspace administrator.
