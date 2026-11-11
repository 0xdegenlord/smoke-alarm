# Live demo: watch a token get swapped

This walks through the whole story on NEAR **testnet**, where tokens are free and worthless.
You will make a token, keep its master key, swap its code, and see the alarm fire.
No Rust, no real money. About 15 minutes the first time.

The demo token is in `demo/`. It is a deliberately tiny stand-in for a real token, written by hand
(`token-v1.wat` and `token-v2.wat`) so the demo needs no Rust. Version 1 says
"transfers open to everyone". Version 2 says "only the owner can transfer". Same account, new rules.

## 1. Install the NEAR command line tool (once)

```bash
npm install -g near-cli-rs@0.31.1
near --version
```

You should see `near-cli-rs 0.31.1`. Every command below was checked against that version. If `npm install -g` asks for permission, see
https://github.com/near/near-cli-rs for other install options.

## 2. Make a free testnet account (once)

Pick a name nobody else has, for example `smoke-demo-degen.testnet`. Below, replace
`YOUR-NAME.testnet` with it everywhere.

```bash
near account create-account sponsor-by-faucet-service YOUR-NAME.testnet autogenerate-new-keypair save-to-keychain network-config testnet create
```

You should see that the account was created. The faucet pays for it. The new master key is saved on
your computer, which is exactly the "someone still holds a master key" situation we want to show.

If your system has no keychain, use `save-to-legacy-keychain` here and `sign-with-legacy-keychain` in the
deploy commands below. If any command complains about its arguments, run `near` with nothing after it and
pick the same choices from the menus.

## Shortcut: one command for steps 3 to 5

After steps 1 and 2, this runs the rest for you and pauses before the swap:

- Windows (Command Prompt): `demo\run-demo YOUR-NAME.testnet`
- Mac or Linux: `bash demo/run-demo.sh YOUR-NAME.testnet`

Or follow steps 3 to 5 by hand below.

## 3. Deploy the honest version

```bash
near contract deploy YOUR-NAME.testnet use-file demo/token-v1.wasm without-init-call network-config testnet sign-with-keychain send
```

Check it answers like a token:

```bash
near contract call-function as-read-only YOUR-NAME.testnet version json-args {} network-config testnet now
```

You should see `"v1: transfers open to everyone"`.

## 4. Start watching it

In a second terminal, from this project folder:

```bash
npm run scan -- --network testnet --every 10 YOUR-NAME.testnet
```

You should see `DEMO  YOUR-NAME.testnet  1 master key(s)` and then a new check every 10 seconds.
Leave it running.

## 5. Swap the code (the "rug")

Back in the first terminal:

```bash
near contract deploy YOUR-NAME.testnet use-file demo/token-v2.wasm without-init-call network-config testnet sign-with-keychain send
```

Within about 10 seconds the watching terminal prints:

```
[CRITICAL] DEMO (YOUR-NAME.testnet): the token's code changed while someone held a master key. One person could have rewritten the rules.
```

If Telegram is set up (see the README), the same alert lands on your phone.

Prove the rules really changed:

```bash
near contract call-function as-read-only YOUR-NAME.testnet version json-args {} network-config testnet now
```

You should now see `"v2: only the owner can transfer"`. The balance is untouched; only the rules changed.
That is the whole point: nothing about the balance warned you.

## Starting over

The scanner remembers testnet snapshots in `data-testnet/`. Delete that folder to start fresh.
