class EscrowAccount {
    constructor(sellerAddress, amount, disputeDays) {
        // BR-001: Escrow amount must be positive.
        if (amount <= 0) {
            throw new Error("Escrow amount must be positive");
        }
        // BR-003: Dispute period must be between 1 and 30 days.
        if (disputeDays < 1 || disputeDays > 30) {
            throw new Error("Dispute period must be between 1 and 30 days");
        }
        this.sellerAddress = sellerAddress;
        this.amount = amount;
        this.disputeDays = disputeDays;
        this.status = "INITIALIZED";
        this.deposited = 0.0;
        this.feeCollected = 0.0;
        this.releasedAmount = 0.0;
    }

    deposit(amount) {
        if (amount !== this.amount) {
            throw new Error("Deposit amount must match escrow amount");
        }
        this.deposited = amount;
        this.status = "DEPOSITED";
    }

    release() {
        if (this.status !== "DEPOSITED") {
            throw new Error("Escrow must be deposited before release");
        }
        // BR-002: System fee of 1.5% is deducted upon release.
        // BUG: Deducting fixed amount of 1.5 instead of 1.5% (0.015 * amount)
        this.feeCollected = 0.015 * this.deposited;
        this.releasedAmount = this.deposited - this.feeCollected;
        this.status = "RELEASED";
        return this.releasedAmount;
    }

    requestRefund(currentDay) {
        // AF-02: Refund requested before dispute period expires -> block refund.
        if (currentDay < this.disputeDays) {
            this.status = "DISPUTED";
            throw new Error("Refund requested before dispute expiry; escrow disputed");
        }
        this.releasedAmount = 0.0;
        this.feeCollected = 0.0;
        this.status = "REFUNDED";
    }

    autoRelease(currentDay) {
        // AF-01: Dispute period expires without buyer action -> Seller can claim funds auto-release.
        if (currentDay >= this.disputeDays) {
            return this.release();
        }
        throw new Error("Dispute period has not expired yet");
    }

    resolveDispute(favorsSeller) {
        if (this.status !== "DISPUTED") {
            throw new Error("Escrow must be in DISPUTED status to resolve");
        }
        if (favorsSeller) {
            // BR-004: Dispute penalty fee of 3% of deposit is deducted and sent to the Seller
            this.feeCollected = 0.03 * this.deposited;
            this.releasedAmount = this.deposited - this.feeCollected;
            this.status = "DISPUTE_RESOLVED_SELLER";
            return this.releasedAmount;
        } else {
            this.feeCollected = 0.0;
            this.releasedAmount = 0.0;
            this.status = "DISPUTE_RESOLVED_BUYER";
            return 0.0;
        }
    }
}

module.exports = EscrowAccount;
