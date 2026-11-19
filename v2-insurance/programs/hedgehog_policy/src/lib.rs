//! Hedgehog Cover: parametric cover sold from a USDC underwriter vault (devnet).
//!
//! Hedgehog is the underwriter. A business pays a premium into the vault and gets a
//! policy that pays `payout` if a trusted attestor (our crank, reading the venue
//! resolution) reports the insured event happened. If the attestor never settles,
//! anyone can expire the policy after `expiry + grace` and the premium is refunded.
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("4H7QHtz77V8oFuGSeXAEwCrSAph7VFNb667zk5SiRbNe");

pub const UW_SEED: &[u8] = b"uw";
pub const BIZ_SEED: &[u8] = b"biz";
pub const POL_SEED: &[u8] = b"pol";
pub const PERIOD_SECS: i64 = 30 * 24 * 60 * 60;
pub const MAX_MARKET_REF: usize = 64;

#[program]
pub mod hedgehog_policy {
    use super::*;

    /// Create the singleton underwriter and its PDA-owned USDC vault (ATA).
    pub fn init_underwriter(
        ctx: Context<InitUnderwriter>,
        attestor: Pubkey,
        max_exposure: u64,
        grace_secs: i64,
    ) -> Result<()> {
        require!(grace_secs >= 0, CoverError::BadParams);
        let uw = &mut ctx.accounts.underwriter;
        uw.authority = ctx.accounts.authority.key();
        uw.attestor = attestor;
        uw.mint = ctx.accounts.mint.key();
        uw.vault = ctx.accounts.vault.key();
        uw.token_program = ctx.accounts.token_program.key();
        uw.total_exposure = 0;
        uw.max_exposure = max_exposure;
        uw.grace_secs = grace_secs;
        uw.policies_sold = 0;
        uw.bump = ctx.bumps.underwriter;
        Ok(())
    }

    /// Anyone may add USDC to the vault.
    pub fn fund_vault(ctx: Context<FundVault>, amount: u64) -> Result<()> {
        require!(amount > 0, CoverError::BadParams);
        transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.funder_token,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.funder,
            amount,
        )?;
        emit!(VaultFunded { funder: ctx.accounts.funder.key(), amount });
        Ok(())
    }

    /// Authority-only: update attestor / max exposure.
    pub fn set_underwriter(ctx: Context<SetUnderwriter>, attestor: Pubkey, max_exposure: u64) -> Result<()> {
        let uw = &mut ctx.accounts.underwriter;
        uw.attestor = attestor;
        uw.max_exposure = max_exposure;
        Ok(())
    }

    pub fn register_business(ctx: Context<RegisterBusiness>, monthly_budget: u64) -> Result<()> {
        let biz = &mut ctx.accounts.business;
        biz.owner = ctx.accounts.owner.key();
        biz.monthly_budget = monthly_budget;
        biz.spent_this_period = 0;
        biz.period_start = Clock::get()?.unix_timestamp;
        biz.policy_count = 0;
        biz.bump = ctx.bumps.business;
        Ok(())
    }

    pub fn set_budget(ctx: Context<SetBudget>, monthly_budget: u64) -> Result<()> {
        ctx.accounts.business.monthly_budget = monthly_budget;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn buy_policy(
        ctx: Context<BuyPolicy>,
        policy_id: u64,
        peril: u8,
        market_ref: String,
        trigger_hash: [u8; 32],
        premium: u64,
        payout: u64,
        expiry: i64,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(premium > 0 && payout > 0, CoverError::BadParams);
        require!(payout >= premium, CoverError::BadParams);
        require!(expiry > now, CoverError::BadParams);
        require!(market_ref.len() <= MAX_MARKET_REF, CoverError::BadParams);

        // Rolling 30-day budget.
        let biz = &mut ctx.accounts.business;
        if now >= biz.period_start.saturating_add(PERIOD_SECS) {
            biz.period_start = now;
            biz.spent_this_period = 0;
        }
        let spent = biz.spent_this_period.checked_add(premium).ok_or(CoverError::BadParams)?;
        require!(spent <= biz.monthly_budget, CoverError::BudgetExceeded);

        // Capacity: payout must be covered by free vault funds (before this premium lands)
        // and stay under the underwriter's max exposure.
        let uw = &mut ctx.accounts.underwriter;
        let free = ctx.accounts.vault.amount.saturating_sub(uw.total_exposure);
        let new_exposure = uw.total_exposure.checked_add(payout).ok_or(CoverError::InsufficientCapacity)?;
        require!(payout <= free, CoverError::InsufficientCapacity);
        require!(new_exposure <= uw.max_exposure, CoverError::InsufficientCapacity);

        transfer_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.owner_token,
            &ctx.accounts.vault,
            &ctx.accounts.mint,
            &ctx.accounts.owner,
            premium,
        )?;

        uw.total_exposure = new_exposure;
        uw.policies_sold = uw.policies_sold.saturating_add(1);
        biz.spent_this_period = spent;
        biz.policy_count = biz.policy_count.max(policy_id.saturating_add(1));

        let pol = &mut ctx.accounts.policy;
        pol.owner = ctx.accounts.owner.key();
        pol.business = biz.key();
        pol.policy_id = policy_id;
        pol.peril = peril;
        pol.market_ref = market_ref.clone();
        pol.trigger_hash = trigger_hash;
        pol.premium = premium;
        pol.payout = payout;
        pol.created_at = now;
        pol.expiry = expiry;
        pol.status = PolicyStatus::Open;
        pol.settled_at = 0;
        pol.bump = ctx.bumps.policy;

        emit!(PolicyBought {
            policy: pol.key(),
            owner: pol.owner,
            business: pol.business,
            policy_id,
            peril,
            market_ref,
            trigger_hash,
            premium,
            payout,
            expiry,
        });
        Ok(())
    }

    /// Attestor posts the outcome. YES pays `payout` to the owner; NO closes the policy.
    pub fn settle_policy(ctx: Context<SettlePolicy>, outcome: bool) -> Result<()> {
        require_keys_eq!(ctx.accounts.attestor.key(), ctx.accounts.underwriter.attestor, CoverError::NotAttestor);
        let pol = &mut ctx.accounts.policy;
        require!(pol.status == PolicyStatus::Open, CoverError::AlreadySettled);
        let payout = pol.payout;
        if outcome {
            transfer_from_vault(
                &ctx.accounts.token_program,
                &ctx.accounts.vault,
                &ctx.accounts.owner_token,
                &ctx.accounts.mint,
                &ctx.accounts.underwriter,
                payout,
            )?;
            pol.status = PolicyStatus::PaidOut;
        } else {
            pol.status = PolicyStatus::Expired;
        }
        pol.settled_at = Clock::get()?.unix_timestamp;
        let uw = &mut ctx.accounts.underwriter;
        uw.total_exposure = uw.total_exposure.saturating_sub(payout);
        emit!(PolicySettled {
            policy: pol.key(),
            owner: pol.owner,
            policy_id: pol.policy_id,
            outcome,
            paid: if outcome { payout } else { 0 },
        });
        Ok(())
    }

    /// Anyone, after expiry + grace, if the attestor never settled: refund the premium.
    pub fn expire_policy(ctx: Context<ExpirePolicy>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let grace = ctx.accounts.underwriter.grace_secs;
        let pol = &mut ctx.accounts.policy;
        require!(pol.status == PolicyStatus::Open, CoverError::AlreadySettled);
        require!(now > pol.expiry.saturating_add(grace), CoverError::NotExpired);
        let refund = pol.premium;
        transfer_from_vault(
            &ctx.accounts.token_program,
            &ctx.accounts.vault,
            &ctx.accounts.owner_token,
            &ctx.accounts.mint,
            &ctx.accounts.underwriter,
            refund,
        )?;
        pol.status = PolicyStatus::Refunded;
        pol.settled_at = now;
        let uw = &mut ctx.accounts.underwriter;
        uw.total_exposure = uw.total_exposure.saturating_sub(pol.payout);
        emit!(PolicyExpired { policy: pol.key(), owner: pol.owner, policy_id: pol.policy_id, refund });
        Ok(())
    }
}

fn transfer_from_user<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new(
            token_program.to_account_info(),
            TransferChecked {
                from: from.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: authority.to_account_info(),
            },
        ),
        amount,
        mint.decimals,
    )
}

fn transfer_from_vault<'info>(
    token_program: &Interface<'info, TokenInterface>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    underwriter: &Account<'info, Underwriter>,
    amount: u64,
) -> Result<()> {
    let bump = [underwriter.bump];
    let seeds: &[&[u8]] = &[UW_SEED, &bump];
    let signer = &[seeds];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            TransferChecked {
                from: vault.to_account_info(),
                mint: mint.to_account_info(),
                to: to.to_account_info(),
                authority: underwriter.to_account_info(),
            },
            signer,
        ),
        amount,
        mint.decimals,
    )
}

// ---------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct Underwriter {
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub token_program: Pubkey,
    pub total_exposure: u64,
    pub max_exposure: u64,
    pub grace_secs: i64,
    pub policies_sold: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Business {
    pub owner: Pubkey,
    pub monthly_budget: u64,
    pub spent_this_period: u64,
    pub period_start: i64,
    pub policy_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum PolicyStatus {
    Open,
    PaidOut,
    /// Settled with outcome NO (premium kept by the underwriter).
    Expired,
    /// Expired without settlement; premium refunded to the owner.
    Refunded,
}

#[account]
#[derive(InitSpace)]
pub struct Policy {
    pub owner: Pubkey, // offset 8: memcmp filter by owner
    pub business: Pubkey,
    pub policy_id: u64,
    pub peril: u8,
    #[max_len(64)]
    pub market_ref: String,
    pub trigger_hash: [u8; 32],
    pub premium: u64,
    pub payout: u64,
    pub created_at: i64,
    pub expiry: i64,
    pub status: PolicyStatus,
    pub settled_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitUnderwriter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Underwriter::INIT_SPACE, seeds = [UW_SEED], bump)]
    pub underwriter: Account<'info, Underwriter>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = authority,
        associated_token::mint = mint,
        associated_token::authority = underwriter,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [UW_SEED], bump = underwriter.bump, has_one = mint, has_one = vault)]
    pub underwriter: Account<'info, Underwriter>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = funder, token::token_program = token_program)]
    pub funder_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(address = underwriter.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SetUnderwriter<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [UW_SEED], bump = underwriter.bump, has_one = authority)]
    pub underwriter: Account<'info, Underwriter>,
}

#[derive(Accounts)]
pub struct RegisterBusiness<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(init, payer = owner, space = 8 + Business::INIT_SPACE, seeds = [BIZ_SEED, owner.key().as_ref()], bump)]
    pub business: Account<'info, Business>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetBudget<'info> {
    pub owner: Signer<'info>,
    #[account(mut, seeds = [BIZ_SEED, owner.key().as_ref()], bump = business.bump, has_one = owner)]
    pub business: Account<'info, Business>,
}

#[derive(Accounts)]
#[instruction(policy_id: u64)]
pub struct BuyPolicy<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut, seeds = [UW_SEED], bump = underwriter.bump, has_one = mint, has_one = vault)]
    pub underwriter: Account<'info, Underwriter>,
    #[account(mut, seeds = [BIZ_SEED, owner.key().as_ref()], bump = business.bump, has_one = owner)]
    pub business: Account<'info, Business>,
    #[account(
        init,
        payer = owner,
        space = 8 + Policy::INIT_SPACE,
        seeds = [POL_SEED, business.key().as_ref(), &policy_id.to_le_bytes()],
        bump
    )]
    pub policy: Account<'info, Policy>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(address = underwriter.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettlePolicy<'info> {
    pub attestor: Signer<'info>,
    #[account(mut, seeds = [UW_SEED], bump = underwriter.bump, has_one = mint, has_one = vault)]
    pub underwriter: Account<'info, Underwriter>,
    #[account(mut)]
    pub policy: Account<'info, Policy>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = policy.owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(address = underwriter.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ExpirePolicy<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [UW_SEED], bump = underwriter.bump, has_one = mint, has_one = vault)]
    pub underwriter: Account<'info, Underwriter>,
    #[account(mut)]
    pub policy: Account<'info, Policy>,
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = policy.owner, token::token_program = token_program)]
    pub owner_token: InterfaceAccount<'info, TokenAccount>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(address = underwriter.token_program)]
    pub token_program: Interface<'info, TokenInterface>,
}

// ---------------------------------------------------------------- events

#[event]
pub struct VaultFunded {
    pub funder: Pubkey,
    pub amount: u64,
}

#[event]
pub struct PolicyBought {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub business: Pubkey,
    pub policy_id: u64,
    pub peril: u8,
    pub market_ref: String,
    pub trigger_hash: [u8; 32],
    pub premium: u64,
    pub payout: u64,
    pub expiry: i64,
}

#[event]
pub struct PolicySettled {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub policy_id: u64,
    pub outcome: bool,
    pub paid: u64,
}

#[event]
pub struct PolicyExpired {
    pub policy: Pubkey,
    pub owner: Pubkey,
    pub policy_id: u64,
    pub refund: u64,
}

// ---------------------------------------------------------------- errors

#[error_code]
pub enum CoverError {
    #[msg("Premium would exceed the business's 30-day budget")]
    BudgetExceeded,
    #[msg("Vault has insufficient free capacity for this payout")]
    InsufficientCapacity,
    #[msg("Signer is not the underwriter's attestor")]
    NotAttestor,
    #[msg("Policy is already settled")]
    AlreadySettled,
    #[msg("Policy has not passed expiry + grace")]
    NotExpired,
    #[msg("Invalid parameters")]
    BadParams,
}
