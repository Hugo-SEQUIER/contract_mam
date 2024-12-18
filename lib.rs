use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("7zB8CcWKyijQi79dVhBxckP4jnAuj3WMmDgVPG7AyF6Z");

#[program]
pub mod idlegame {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        user_state.user = ctx.accounts.user.key();
        user_state.backend_authority = None;
        user_state.bump = 0;
        msg!("Program initialized for user: {:?}", ctx.accounts.user.key());
        Ok(())
    }

    /// Temporarily approve the backend to act on behalf of the user
    pub fn approve_backend(ctx: Context<ApproveBackend>, authority_bump: u8) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        user_state.backend_authority = Some(ctx.accounts.backend_authority.key());
        user_state.bump = authority_bump;
        msg!("Backend approved with PDA: {:?}", ctx.accounts.backend_authority.key());
        Ok(())
    }

    /// Revoke backend approval
    pub fn revoke_backend(ctx: Context<RevokeBackend>) -> Result<()> {
        let user_state = &mut ctx.accounts.user_state;
        user_state.backend_authority = None;
        user_state.bump = 0;
        msg!("Backend approval revoked");
        Ok(())
    }

    /// Mint X amount of Ice tokens to the user's account
    pub fn mint_ice(ctx: Context<MintIce>, amount: u64) -> Result<()> {
        let user_state = &ctx.accounts.user_state;
        if ctx.accounts.signer.key() != user_state.user
            && Some(ctx.accounts.signer.key()) != user_state.backend_authority
        {
            return Err(ErrorCode::Unauthorized.into());
        }

        let authority = if ctx.accounts.signer.key() == user_state.user {
            ctx.accounts.mint_authority.to_account_info()
        } else {
            ctx.accounts.backend_authority.to_account_info()
        };

        let cpi_accounts = MintTo {
            mint: ctx.accounts.ice_mint.to_account_info(),
            to: ctx.accounts.user_token_account.to_account_info(),
            authority,
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::mint_to(cpi_ctx, amount)?;
        Ok(())
    }

    /// Burn X amount of Ice tokens from the user's account
    pub fn burn_ice(ctx: Context<BurnIce>, amount: u64) -> Result<()> {
        let user_state = &ctx.accounts.user_state;
        if ctx.accounts.signer.key() != user_state.user
            && Some(ctx.accounts.signer.key()) != user_state.backend_authority
        {
            return Err(ErrorCode::Unauthorized.into());
        }

        let authority = if ctx.accounts.signer.key() == user_state.user {
            ctx.accounts.user.to_account_info()
        } else {
            ctx.accounts.backend_authority.to_account_info()
        };

        let cpi_accounts = Burn {
            from: ctx.accounts.user_token_account.to_account_info(),
            mint: ctx.accounts.ice_mint.to_account_info(),
            authority,
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::burn(cpi_ctx, amount)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = user, space = 8 + 32 + 1 + 1)]
    pub user_state: Account<'info, UserState>,
    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authority_bump: u8)]
pub struct ApproveBackend<'info> {
    #[account(mut, has_one = user)]
    pub user_state: Account<'info, UserState>,
    /// CHECK: This is a PDA that is only used as a signing authority
    #[account(
        seeds = [b"backend", user.key().as_ref()],
        bump = authority_bump
    )]
    pub backend_authority: AccountInfo<'info>,
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeBackend<'info> {
    #[account(mut, has_one = user)]
    pub user_state: Account<'info, UserState>,
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct MintIce<'info> {
    #[account(mut)]
    pub user_state: Account<'info, UserState>,
    pub user: Signer<'info>,
    /// CHECK: This account is either the user or the backend PDA
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub mint_authority: Signer<'info>,
    #[account(mut)]
    pub ice_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is the backend PDA that is validated in the instruction
    pub backend_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct BurnIce<'info> {
    #[account(mut)]
    pub user_state: Account<'info, UserState>,
    pub user: Signer<'info>,
    /// CHECK: This account is either the user or the backend PDA
    pub signer: AccountInfo<'info>,
    #[account(mut)]
    pub ice_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    /// CHECK: This is the backend PDA that is validated in the instruction
    pub backend_authority: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct UserState {
    pub user: Pubkey,
    pub backend_authority: Option<Pubkey>,
    pub bump: u8,
}

impl UserState {
    pub fn backend_pda(user: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[b"backend", user.as_ref()], program_id)
    }
}

#[error_code]
pub enum ErrorCode {
    #[msg("Unauthorized: You cannot perform this action.")]
    Unauthorized,
}
