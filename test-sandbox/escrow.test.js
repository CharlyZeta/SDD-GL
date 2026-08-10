const { test } = require('node:test');
const assert = require('node:assert');
const EscrowAccount = require('./escrow');

// Main Flow: integration-test:FEAT-9999-main
test('Main Flow: Escrow lifecycle integration', () => {
    const escrow = new EscrowAccount("seller_1", 100.0, 10);
    assert.strictEqual(escrow.status, "INITIALIZED");
    
    escrow.deposit(100.0);
    assert.strictEqual(escrow.status, "DEPOSITED");
    
    const released = escrow.release();
    assert.strictEqual(escrow.status, "RELEASED");
    assert.ok(released > 0);
});

// AF-01: unit-test:FEAT-9999-af01
test('AF-01: Dispute period expires without buyer action -> auto-release', () => {
    const escrow = new EscrowAccount("seller_1", 100.0, 10);
    escrow.deposit(100.0);
    const released = escrow.autoRelease(11);
    assert.strictEqual(escrow.status, "RELEASED");
    assert.ok(released > 0);
});

// AF-02: unit-test:FEAT-9999-af02
test('AF-02: Refund requested before dispute period expires -> block', () => {
    const escrow = new EscrowAccount("seller_1", 100.0, 10);
    escrow.deposit(100.0);
    assert.throws(() => escrow.requestRefund(5), /Refund requested before dispute expiry/);
    assert.strictEqual(escrow.status, "DISPUTED");
});

// BR-001: unit-test:FEAT-9999-br001
test('BR-001: Escrow amount must be positive', () => {
    assert.throws(() => new EscrowAccount("seller_1", -10.0, 10), /Escrow amount must be positive/);
});

// BR-002: unit-test:FEAT-9999-br002
test('BR-002: System fee of 1.5% is deducted upon release', () => {
    const escrow = new EscrowAccount("seller_1", 100.0, 10);
    escrow.deposit(100.0);
    escrow.release();
    assert.strictEqual(escrow.feeCollected, 1.5);
    assert.strictEqual(escrow.releasedAmount, 98.5);
});

// BR-003: unit-test:FEAT-9999-br003
test('BR-003: Dispute period must be between 1 and 30 days', () => {
    assert.strictEqual(new EscrowAccount("seller_1", 100.0, 1).disputeDays, 1);
    assert.strictEqual(new EscrowAccount("seller_1", 100.0, 30).disputeDays, 30);
    assert.throws(() => new EscrowAccount("seller_1", 100.0, 0), /Dispute period must be between 1 and 30 days/);
    assert.throws(() => new EscrowAccount("seller_1", 100.0, 31), /Dispute period must be between 1 and 30 days/);
});

// BR-004: unit-test:FEAT-9999-br004
test('BR-004: Dispute penalty fee of 3% is deducted upon dispute resolution favoring Seller', () => {
    const escrow = new EscrowAccount("seller_1", 200.0, 10);
    escrow.deposit(200.0);
    // Move to DISPUTED
    assert.throws(() => escrow.requestRefund(5), /Refund requested before dispute expiry/);
    assert.strictEqual(escrow.status, "DISPUTED");
    
    // Resolve dispute in favor of Seller
    const released = escrow.resolveDispute(true);
    // 3% penalty fee on 200.0 is 6.0
    assert.strictEqual(escrow.feeCollected, 6.0);
    assert.strictEqual(released, 194.0);
    assert.strictEqual(escrow.status, "DISPUTE_RESOLVED_SELLER");
});

// AC-001: assertion:FEAT-9999-ac001
test('AC-001: GIVEN dispute period 10 days WHEN release called THEN fee is 1.5% and remaining transferred', () => {
    const escrow = new EscrowAccount("seller_1", 200.0, 10);
    escrow.deposit(200.0);
    const released = escrow.release();
    // 1.5% of 200.0 should be 3.0.
    assert.strictEqual(escrow.feeCollected, 3.0);
    assert.strictEqual(released, 197.0);
});

// AC-002: assertion:FEAT-9999-ac002
test('AC-002: GIVEN escrow with amount 0 WHEN initialized THEN it fails', () => {
    assert.throws(() => new EscrowAccount("seller_1", 0.0, 10), /Escrow amount must be positive/);
});
