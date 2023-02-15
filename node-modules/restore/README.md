# Offchain Labs GitHub Actions

Restore node_modules from cache

## Usage

In workflows:

```yml
jobs:
  install:
    name: Install node modules
    needs: [install] # Name of the jobs installing node_modules through node-module-save-cache action
    runs-on: ubuntu-latest
    steps:
      - name: restore cache
        uses: OffchainLabs/actions/node-module-restore-cache@main
```
