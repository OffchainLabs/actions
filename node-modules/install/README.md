# Offchain Labs GitHub Actions

Install and cache node_modules

## Usage

In workflows:

```yml
jobs:
  install:
    name: Install node modules
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Install node_modules
        uses: OffchainLabs/actions/node-module-save-cache@main
        with:
          cache-key: ${{ runner.os }}-yarn-${{ hashFiles('yarn.lock') }}
```