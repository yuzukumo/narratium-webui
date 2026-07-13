ALTER TABLE balance_ledger
    DROP CONSTRAINT IF EXISTS balance_ledger_amount_microusd_check;

ALTER TABLE balance_ledger
    ADD CONSTRAINT balance_ledger_amount_microusd_check
    CHECK (amount_microusd <> 0 OR kind = 'quota_override');
