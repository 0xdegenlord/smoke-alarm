;; Smoke Alarm demo token, version 2: the "swapped" release.
;; Same account, same balances, new rules. This is what a rug looks like on NEAR:
;; whoever kept a master key deploys new code over the old one.
(module
  (import "env" "value_return" (func $value_return (param i64 i64)))
  (memory (export "memory") 1)
  (data (i32.const 0)   "{\22spec\22:\22ft-1.0.0\22,\22name\22:\22Smoke Alarm Demo\22,\22symbol\22:\22DEMO\22,\22decimals\22:0}")
  (data (i32.const 256) "\221000000\22")
  (data (i32.const 512) "\22v2: only the owner can transfer\22")
  (func (export "ft_metadata")     (call $value_return (i64.const 74) (i64.const 0)))
  (func (export "ft_total_supply") (call $value_return (i64.const 9)  (i64.const 256)))
  (func (export "ft_balance_of")   (call $value_return (i64.const 9)  (i64.const 256)))
  (func (export "version")         (call $value_return (i64.const 33) (i64.const 512)))
)
