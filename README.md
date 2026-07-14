# Sweeper

Bare-bones spend tracker for an AIO/HELOC checking companion account. Import a checking-account CSV statement, filter out the sweep/transfer plumbing (`LNS ADV FRM`, `LNS PAY TO`, etc.) via editable rules, and track the true HELOC spendable balance forward from a manually set starting balance anchor.

## Development

```
npm install
npm run dev
```

## Build

```
npm run build
npm run package
```
