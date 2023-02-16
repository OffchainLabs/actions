# Offchain Labs GitHub Actions

Restore node_modules from cache

## Usage

In workflows:

```yml
jobs:
  workflow-using-node-modules:
    name: Restore node modules
    needs: [workflow-caching-node-modules] # Name of the jobs installing node_modules through node-module-save-cache action
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Restore cache
        uses: OffchainLabs/actions/node-modules/restore@main
```
