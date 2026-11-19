//! Hedgehog: hedge-gated money-back promises (SPEC §3).
//!
//! A merchant locks `cap × refund_units` USDC in a vault PDA. Receipts can only be issued while
//! `sold + 1 <= hedged_capacity`, where capacity is attested from real Gemini prediction-market
//! positions. When Gemini resolves the event, a relayer posts the outcome; on YES anyone can crank
//! refunds from the vault to the receipt holders. The merchant can only recover the vault under the
//! `release` rules.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("6x27yJQSb1iGRNumQG6Et8nB8x7Zq7qiKEzLkZhbQraf");

#[cfg(not(feature = "self-mint"))]
pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
#[cfg(feature = "self-mint")]
pub const USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // replaced at build time if used
pub const ATTESTOR: Pubkey = pubkey!("5LQKRaTS8nkd1ag37huyKVNBc5iaFDRG1LnCYTvCu5Es");
pub const RELAYER: Pubkey = pubkey!("FtVpLmYRmwrC7mdyLqRCF3sTpAF2PweFj2V2zpbZkVZr");
pub const MAX_STRIP: usize = 6;
pub const MAX_SYMBOL: usize = 48;
pub const MAX_TICKER: usize = 40;
pub const MAX_CAP: u32 = 500;
pub const CENTI_MICROS: u64 = 10_000;
pub const RELAYER_TIMEOUT: i64 = 72 * 3600;
pub const ATTEST_MAX_SKEW: i64 = 300;
pub const RELEASE_GRACE: i64 = 7 * 24 * 3600;
pub const NO_CUTOFF_GRACE: i64 = 24 * 3600;
pub const MAX_HORIZON: i64 = 72 * 3600;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_SETTLED_YES: u8 = 1;
pub const STATUS_SETTLED_NO: u8 = 2;
pub const STATUS_CLOSED: u8 = 3;

pub const PHASE_OPEN: u8 = 0;
pub const PHASE_CUTOFF: u8 = 1;
pub const PHASE_PRESETTLE: u8 = 2;
pub const BIT_OPEN: u8 = 1;
pub const BIT_CUTOFF: u8 = 2;
pub const BIT_PRESETTLE: u8 = 4;

#[program]
pub mod hedgehog_promise {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn create_promise(
        ctx: Context<CreatePromise>,
        promise_id: u64,
        event_ticker: String,
        strip: Vec<String>,
        refund_units: u64,
        cap: u32,
        sales_close_ts: i64,
        expected_resolve_ts: i64,
        terms_hash: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            !event_ticker.is_empty() && event_ticker.len() <= MAX_TICKER,
            HhError::InvalidStrip
        );
        require!(
            !strip.is_empty() && strip.len() <= MAX_STRIP,
            HhError::InvalidStrip
        );
        let prefix = format!("GEMI-{}-", event_ticker);
        let mut packed = [[0u8; MAX_SYMBOL]; MAX_STRIP];
        for (i, s) in strip.iter().enumerate() {
            require!(
                s.len() <= MAX_SYMBOL && s.len() > prefix.len() && s.starts_with(&prefix),
                HhError::InvalidStrip
            );
            for t in strip.iter().take(i) {
                require!(t != s, HhError::InvalidStrip);
            }
            packed[i][..s.len()].copy_from_slice(s.as_bytes());
        }
        require!(
            refund_units >= CENTI_MICROS && refund_units % CENTI_MICROS == 0,
            HhError::InvalidAmount
        );
        require!(cap >= 1 && cap <= MAX_CAP, HhError::InvalidAmount);
        require!(
            now < sales_close_ts
                && sales_close_ts < expected_resolve_ts
                && expected_resolve_ts <= now + MAX_HORIZON,
            HhError::InvalidTimes
        );
        let lock = (cap as u64)
            .checked_mul(refund_units)
            .ok_or(HhError::InvalidAmount)?;

        let merchant = &mut ctx.accounts.merchant;
        if merchant.authority == Pubkey::default() {
            merchant.authority = ctx.accounts.authority.key();
            merchant.bump = ctx.bumps.merchant;
        }
        merchant.promises_created = merchant.promises_created.saturating_add(1);

        let p = &mut ctx.accounts.promise;
        p.merchant = ctx.accounts.authority.key();
        p.promise_id = promise_id;
        p.vault = ctx.accounts.vault.key();
        p.event_ticker = event_ticker.clone();
        p.strip_len = strip.len() as u8;
        p.strip = packed;
        p.hedged_centi = [0; MAX_STRIP];
        p.refund_units = refund_units;
        p.cap = cap;
        p.sold = 0;
        p.refunded = 0;
        p.hedged_capacity = 0;
        p.held_bps_cutoff = 0;
        p.held_bps_min = 10_000;
        p.phases_done = 0;
        p.premium_micros = 0;
        p.orders_hash = [0; 32];
        p.sales_close_ts = sales_close_ts;
        p.expected_resolve_ts = expected_resolve_ts;
        p.terms_hash = terms_hash;
        p.status = STATUS_OPEN;
        p.winning_symbol = [0; MAX_SYMBOL];
        p.outcome_hash = [0; 32];
        p.resolved_at = 0;
        p.created_at = now;
        p.bump = ctx.bumps.promise;
        p.vault_bump = ctx.bumps.vault;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.authority_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.authority.to_account_info(),
                },
            ),
            lock,
            ctx.accounts.usdc_mint.decimals,
        )?;

        emit!(PromiseCreated {
            promise: p.key(),
            merchant: p.merchant,
            event_ticker,
            strip_len: p.strip_len,
            refund_units,
            cap,
            sales_close_ts,
            terms_hash,
        });
        Ok(())
    }

    pub fn attest_hedge(
        ctx: Context<AttestHedge>,
        phase: u8,
        qty_centi: Vec<u32>,
        premium_micros: u64,
        orders_hash: [u8; 32],
        observed_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.promise;
        require!(p.status == STATUS_OPEN, HhError::AlreadySettled);
        require!(
            qty_centi.len() == p.strip_len as usize,
            HhError::InvalidStrip
        );
        require!(
            (now - observed_at).abs() <= ATTEST_MAX_SKEW,
            HhError::StaleAttestation
        );
        let mut capacity: u64 = u64::MAX;
        for q in qty_centi.iter() {
            let c = (*q as u64) * CENTI_MICROS / p.refund_units;
            capacity = capacity.min(c);
        }
        let capacity = capacity.min(u32::MAX as u64) as u32;
        let held_bps: u16;
        match phase {
            PHASE_OPEN => {
                require!(now < p.sales_close_ts, HhError::SalesClosed);
                p.hedged_capacity = capacity.min(p.cap);
                for (i, q) in qty_centi.iter().enumerate() {
                    p.hedged_centi[i] = *q;
                }
                p.premium_micros = premium_micros;
                p.orders_hash = orders_hash;
                p.phases_done |= BIT_OPEN;
                held_bps = if p.sold == 0 {
                    10_000
                } else {
                    ((capacity as u64) * 10_000 / p.sold as u64).min(10_000) as u16
                };
            }
            PHASE_CUTOFF | PHASE_PRESETTLE => {
                require!(now >= p.sales_close_ts, HhError::TooEarly);
                held_bps = if p.sold == 0 {
                    10_000
                } else {
                    ((capacity as u64) * 10_000 / p.sold as u64).min(10_000) as u16
                };
                if p.phases_done & BIT_CUTOFF == 0 {
                    p.held_bps_cutoff = held_bps;
                }
                p.held_bps_min = p.held_bps_min.min(held_bps);
                for (i, q) in qty_centi.iter().enumerate() {
                    p.hedged_centi[i] = *q;
                }
                p.phases_done |= if phase == PHASE_CUTOFF {
                    BIT_CUTOFF
                } else {
                    BIT_CUTOFF | BIT_PRESETTLE
                };
            }
            _ => return err!(HhError::InvalidAmount),
        }
        emit!(HedgeAttested {
            promise: p.key(),
            phase,
            capacity,
            held_bps,
            orders_hash,
            observed_at,
        });
        Ok(())
    }

    pub fn issue_receipt(ctx: Context<IssueReceipt>, code_hash: [u8; 32]) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let expected_ata = get_associated_token_address(&ctx.accounts.holder.key(), &USDC_MINT);
        require_keys_eq!(
            expected_ata,
            ctx.accounts.holder_ata.key(),
            HhError::ReceiptMismatch
        );
        let p = &mut ctx.accounts.promise;
        require!(p.status == STATUS_OPEN, HhError::AlreadySettled);
        require!(now < p.sales_close_ts, HhError::SalesClosed);
        require!(p.sold < p.cap, HhError::SoldOut);
        require!(p.sold + 1 <= p.hedged_capacity, HhError::Unhedged);

        let r = &mut ctx.accounts.receipt;
        r.promise = p.key();
        r.index = p.sold;
        r.holder = ctx.accounts.holder.key();
        r.holder_ata = expected_ata;
        r.code_hash = code_hash;
        r.issued_at = now;
        r.refunded = false;
        r.bump = ctx.bumps.receipt;

        p.sold += 1;
        let m = &mut ctx.accounts.merchant;
        m.receipts_issued = m.receipts_issued.saturating_add(1);
        emit!(ReceiptIssued {
            promise: p.key(),
            index: r.index,
            holder: r.holder,
        });
        Ok(())
    }

    pub fn attest_outcome(
        ctx: Context<AttestOutcome>,
        winning_symbol: String,
        canonical_hash: [u8; 32],
        resolved_at: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let p = &mut ctx.accounts.promise;
        require!(p.status == STATUS_OPEN, HhError::AlreadySettled);
        require!(
            now >= p.sales_close_ts && resolved_at >= p.sales_close_ts,
            HhError::TooEarly
        );
        require!(winning_symbol.len() <= MAX_SYMBOL, HhError::InvalidStrip);
        let mut ws = [0u8; MAX_SYMBOL];
        ws[..winning_symbol.len()].copy_from_slice(winning_symbol.as_bytes());
        let yes = !winning_symbol.is_empty()
            && p.strip[..p.strip_len as usize].iter().any(|s| *s == ws);
        p.status = if yes { STATUS_SETTLED_YES } else { STATUS_SETTLED_NO };
        p.winning_symbol = ws;
        p.outcome_hash = canonical_hash;
        p.resolved_at = resolved_at;
        if p.sold > 0 {
            let m = &mut ctx.accounts.merchant;
            if p.phases_done & BIT_CUTOFF != 0 && p.held_bps_min == 10_000 {
                m.cutoff_held_full = m.cutoff_held_full.saturating_add(1);
            } else {
                m.hedge_breaks = m.hedge_breaks.saturating_add(1);
            }
        }
        emit!(OutcomeAttested {
            promise: p.key(),
            yes,
            winning_symbol,
            canonical_hash,
            resolved_at,
            held_bps_min: p.held_bps_min,
        });
        Ok(())
    }

    pub fn refund_crank<'info>(
        ctx: Context<'_, '_, 'info, 'info, RefundCrank<'info>>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let promise_key = ctx.accounts.promise.key();
        {
            let p = &mut ctx.accounts.promise;
            if p.status == STATUS_OPEN && now > p.expected_resolve_ts + RELAYER_TIMEOUT {
                p.status = STATUS_SETTLED_YES; // customer-favoring timeout (D9)
            }
            require!(p.status == STATUS_SETTLED_YES, HhError::NotSettled);
        }
        let rem = ctx.remaining_accounts;
        require!(rem.len() % 2 == 0 && rem.len() <= 20, HhError::ReceiptMismatch);
        let merchant_key = ctx.accounts.promise.merchant;
        let id_bytes = ctx.accounts.promise.promise_id.to_le_bytes();
        let bump = [ctx.accounts.promise.bump];
        let seeds: &[&[u8]] = &[b"promise", merchant_key.as_ref(), &id_bytes, &bump];
        let signer = &[seeds];
        let amount = ctx.accounts.promise.refund_units;
        let decimals = ctx.accounts.usdc_mint.decimals;

        for pair in rem.chunks(2) {
            let receipt_info = &pair[0];
            let ata_info = &pair[1];
            require_keys_eq!(*receipt_info.owner, crate::ID, HhError::ReceiptMismatch);
            let mut receipt: Account<'info, Receipt> = Account::try_from(receipt_info)?;
            require_keys_eq!(receipt.promise, promise_key, HhError::ReceiptMismatch);
            require_keys_eq!(receipt.holder_ata, ata_info.key(), HhError::ReceiptMismatch);
            require!(!receipt.refunded, HhError::AlreadyRefunded);

            // Dead-ATA skip (D14): never let one customer fail the batch.
            let live = *ata_info.owner == token::ID && {
                let data = ata_info.try_borrow_data()?;
                match TokenAccount::try_deserialize(&mut &data[..]) {
                    Ok(ta) => ta.mint == USDC_MINT && ta.owner == receipt.holder,
                    Err(_) => false,
                }
            };
            if !live {
                emit!(RefundSkipped {
                    promise: promise_key,
                    index: receipt.index
                });
                continue;
            }
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ata_info.clone(),
                        authority: ctx.accounts.promise.to_account_info(),
                    },
                    signer,
                ),
                amount,
                decimals,
            )?;
            receipt.refunded = true;
            receipt.exit(&crate::ID)?;
            ctx.accounts.promise.refunded += 1;
            let m = &mut ctx.accounts.merchant;
            m.refunds_paid = m.refunds_paid.saturating_add(1);
            emit!(RefundPaid {
                promise: promise_key,
                index: receipt.index,
                holder: receipt.holder,
                amount,
            });
        }
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let p = &ctx.accounts.promise;
        let ok = (p.sold == 0 && p.status != STATUS_CLOSED)
            || (p.status == STATUS_SETTLED_NO
                && (p.phases_done & BIT_CUTOFF != 0
                    || now > p.expected_resolve_ts + NO_CUTOFF_GRACE))
            || (p.status == STATUS_SETTLED_YES
                && (p.refunded == p.sold || now > p.resolved_at + RELEASE_GRACE));
        require!(ok, HhError::LiabilityLocked);

        let amount = ctx.accounts.vault.amount;
        let merchant_key = p.merchant;
        let id_bytes = p.promise_id.to_le_bytes();
        let bump = [p.bump];
        let seeds: &[&[u8]] = &[b"promise", merchant_key.as_ref(), &id_bytes, &bump];
        if amount > 0 {
            token::transfer_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    TransferChecked {
                        from: ctx.accounts.vault.to_account_info(),
                        mint: ctx.accounts.usdc_mint.to_account_info(),
                        to: ctx.accounts.authority_usdc.to_account_info(),
                        authority: ctx.accounts.promise.to_account_info(),
                    },
                    &[seeds],
                ),
                amount,
                ctx.accounts.usdc_mint.decimals,
            )?;
        }
        let cancelled = ctx.accounts.promise.sold == 0;
        ctx.accounts.promise.status = STATUS_CLOSED;
        let m = &mut ctx.accounts.merchant;
        m.promises_closed = m.promises_closed.saturating_add(1);
        emit!(Released {
            promise: ctx.accounts.promise.key(),
            amount,
            cancelled,
        });
        Ok(())
    }

    pub fn close_receipts<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseReceipts<'info>>,
    ) -> Result<()> {
        let promise_key = ctx.accounts.promise.key();
        let status = ctx.accounts.promise.status;
        require!(ctx.remaining_accounts.len() <= 20, HhError::ReceiptMismatch);
        for info in ctx.remaining_accounts.iter() {
            require_keys_eq!(*info.owner, crate::ID, HhError::ReceiptMismatch);
            let receipt: Account<'info, Receipt> = Account::try_from(info)?;
            require_keys_eq!(receipt.promise, promise_key, HhError::ReceiptMismatch);
            require!(
                receipt.refunded || status == STATUS_SETTLED_NO || status == STATUS_CLOSED,
                HhError::LiabilityLocked
            );
            receipt.close(ctx.accounts.authority.to_account_info())?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Merchant {
    pub authority: Pubkey,
    pub promises_created: u32,
    pub promises_closed: u32,
    pub cutoff_held_full: u32,
    pub hedge_breaks: u32,
    pub receipts_issued: u64,
    pub refunds_paid: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Promise {
    pub merchant: Pubkey,
    pub promise_id: u64,
    pub vault: Pubkey,
    #[max_len(40)]
    pub event_ticker: String,
    pub strip_len: u8,
    pub strip: [[u8; 48]; 6],
    pub hedged_centi: [u32; 6],
    pub refund_units: u64,
    pub cap: u32,
    pub sold: u32,
    pub refunded: u32,
    pub hedged_capacity: u32,
    pub held_bps_cutoff: u16,
    pub held_bps_min: u16,
    pub phases_done: u8,
    pub premium_micros: u64,
    pub orders_hash: [u8; 32],
    pub sales_close_ts: i64,
    pub expected_resolve_ts: i64,
    pub terms_hash: [u8; 32],
    pub status: u8,
    pub winning_symbol: [u8; 48],
    pub outcome_hash: [u8; 32],
    pub resolved_at: i64,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub promise: Pubkey,
    pub index: u32,
    pub holder: Pubkey,
    pub holder_ata: Pubkey,
    pub code_hash: [u8; 32],
    pub issued_at: i64,
    pub refunded: bool,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(promise_id: u64)]
pub struct CreatePromise<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init_if_needed, payer = authority, space = 8 + Merchant::INIT_SPACE,
        seeds = [b"merchant", authority.key().as_ref()], bump
    )]
    pub merchant: Box<Account<'info, Merchant>>,
    #[account(
        init, payer = authority, space = 8 + Promise::INIT_SPACE,
        seeds = [b"promise", authority.key().as_ref(), &promise_id.to_le_bytes()], bump
    )]
    pub promise: Box<Account<'info, Promise>>,
    #[account(
        init, payer = authority, seeds = [b"vault", promise.key().as_ref()], bump,
        token::mint = usdc_mint, token::authority = promise
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = authority)]
    pub authority_usdc: Box<Account<'info, TokenAccount>>,
    #[account(address = USDC_MINT @ HhError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct AttestHedge<'info> {
    #[account(address = ATTESTOR @ HhError::UnauthorizedAttestor)]
    pub attestor: Signer<'info>,
    #[account(mut)]
    pub promise: Box<Account<'info, Promise>>,
}

#[derive(Accounts)]
pub struct IssueReceipt<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"merchant", authority.key().as_ref()], bump = merchant.bump)]
    pub merchant: Box<Account<'info, Merchant>>,
    #[account(mut, constraint = promise.merchant == authority.key() @ HhError::NotMerchant)]
    pub promise: Box<Account<'info, Promise>>,
    #[account(
        init, payer = authority, space = 8 + Receipt::INIT_SPACE,
        seeds = [b"receipt", promise.key().as_ref(), &promise.sold.to_le_bytes()], bump
    )]
    pub receipt: Box<Account<'info, Receipt>>,
    /// CHECK: customer pubkey; not a signer (the merchant pays everything).
    pub holder: UncheckedAccount<'info>,
    /// CHECK: must be the canonical USDC ATA of `holder`; may not exist yet (D14).
    pub holder_ata: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AttestOutcome<'info> {
    #[account(address = RELAYER @ HhError::UnauthorizedAttestor)]
    pub relayer: Signer<'info>,
    #[account(mut)]
    pub promise: Box<Account<'info, Promise>>,
    #[account(mut, seeds = [b"merchant", promise.merchant.as_ref()], bump = merchant.bump)]
    pub merchant: Box<Account<'info, Merchant>>,
}

#[derive(Accounts)]
pub struct RefundCrank<'info> {
    pub cranker: Signer<'info>,
    #[account(mut)]
    pub promise: Box<Account<'info, Promise>>,
    #[account(mut, seeds = [b"vault", promise.key().as_ref()], bump = promise.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [b"merchant", promise.merchant.as_ref()], bump = merchant.bump)]
    pub merchant: Box<Account<'info, Merchant>>,
    #[account(address = USDC_MINT @ HhError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"merchant", authority.key().as_ref()], bump = merchant.bump)]
    pub merchant: Box<Account<'info, Merchant>>,
    #[account(mut, constraint = promise.merchant == authority.key() @ HhError::NotMerchant)]
    pub promise: Box<Account<'info, Promise>>,
    #[account(mut, seeds = [b"vault", promise.key().as_ref()], bump = promise.vault_bump)]
    pub vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = authority)]
    pub authority_usdc: Box<Account<'info, TokenAccount>>,
    #[account(address = USDC_MINT @ HhError::WrongMint)]
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct CloseReceipts<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(constraint = promise.merchant == authority.key() @ HhError::NotMerchant)]
    pub promise: Box<Account<'info, Promise>>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct PromiseCreated {
    pub promise: Pubkey,
    pub merchant: Pubkey,
    pub event_ticker: String,
    pub strip_len: u8,
    pub refund_units: u64,
    pub cap: u32,
    pub sales_close_ts: i64,
    pub terms_hash: [u8; 32],
}
#[event]
pub struct HedgeAttested {
    pub promise: Pubkey,
    pub phase: u8,
    pub capacity: u32,
    pub held_bps: u16,
    pub orders_hash: [u8; 32],
    pub observed_at: i64,
}
#[event]
pub struct ReceiptIssued {
    pub promise: Pubkey,
    pub index: u32,
    pub holder: Pubkey,
}
#[event]
pub struct OutcomeAttested {
    pub promise: Pubkey,
    pub yes: bool,
    pub winning_symbol: String,
    pub canonical_hash: [u8; 32],
    pub resolved_at: i64,
    pub held_bps_min: u16,
}
#[event]
pub struct RefundPaid {
    pub promise: Pubkey,
    pub index: u32,
    pub holder: Pubkey,
    pub amount: u64,
}
#[event]
pub struct RefundSkipped {
    pub promise: Pubkey,
    pub index: u32,
}
#[event]
pub struct Released {
    pub promise: Pubkey,
    pub amount: u64,
    pub cancelled: bool,
}

// ---------------------------------------------------------------- errors (order is the UI contract)

#[error_code]
pub enum HhError {
    #[msg("Sales are closed for this promise")]
    SalesClosed, // 6000
    #[msg("All promises at this price are taken")]
    SoldOut, // 6001
    #[msg("No hedge, no promise: hedged capacity is used up")]
    Unhedged, // 6002
    #[msg("The vault is locked until the promise settles")]
    LiabilityLocked, // 6003
    #[msg("Signer is not the authorized attestor/relayer")]
    UnauthorizedAttestor, // 6004
    #[msg("Receipt already refunded")]
    AlreadyRefunded, // 6005
    #[msg("Promise is not settled YES")]
    NotSettled, // 6006
    #[msg("Promise already settled")]
    AlreadySettled, // 6007
    #[msg("Invalid strip or ticker")]
    InvalidStrip, // 6008
    #[msg("Invalid amount")]
    InvalidAmount, // 6009
    #[msg("Invalid times")]
    InvalidTimes, // 6010
    #[msg("Too early")]
    TooEarly, // 6011
    #[msg("Stale attestation")]
    StaleAttestation, // 6012
    #[msg("Receipt / token account mismatch")]
    ReceiptMismatch, // 6013
    #[msg("Wrong mint")]
    WrongMint, // 6014
    #[msg("Signer is not the merchant")]
    NotMerchant, // 6015
}
