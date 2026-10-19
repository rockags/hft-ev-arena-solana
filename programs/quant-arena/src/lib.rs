use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("QuantArena111111111111111111111111111111111");

#[program]
pub mod quant_arena {
    use super::*;

    /// 1. Initialize Protocol Global State
    pub fn initialize(ctx: Context<Initialize>, founder: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.global_state;
        state.authority = ctx.accounts.authority.key();
        state.founder = founder;
        state.cushion_reserve = 0;
        state.house_revenue = 0;
        state.total_volume = 0;
        state.total_rolls = 0;
        state.epoch_id = 1;
        state.bump = ctx.bumps.global_state;
        state.vault_bump = ctx.bumps.vault;
        msg!("⚡ Quant Arena Protocol Initialized with Non-Custodial Vault!");
        Ok(())
    }

    /// 2. Initialize a Specific Table (Flash, Classic, Whale)
    pub fn initialize_table(
        ctx: Context<InitializeTable>,
        table_id: u8,
        price_lamports: u64,
        friction_lamports: u64,
        refund_lamports: u64,
        min_pot_lamports: u64,
    ) -> Result<()> {
        let table = &mut ctx.accounts.table;
        table.table_id = table_id;
        table.price_lamports = price_lamports;
        table.friction_lamports = friction_lamports;
        table.refund_lamports = refund_lamports;
        table.min_pot_lamports = min_pot_lamports;
        table.pot_lamports = 0;
        table.total_volume = 0;
        table.total_rolls = 0;
        table.total_won = 0;
        table.bump = ctx.bumps.table;
        msg!("🎲 Table #{} initialized! Price: {} lamports", table_id, price_lamports);
        Ok(())
    }

    /// 3. Non-Custodial User Deposit into User's Escrow PDA
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ArenaError::InvalidAmount);

        // Transfer SOL from user to the Program Vault PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        transfer(cpi_context, amount)?;

        // Credit the User's Escrow account balance
        let user_escrow = &mut ctx.accounts.user_escrow;
        user_escrow.owner = ctx.accounts.user.key();
        user_escrow.balance_lamports = user_escrow.balance_lamports.checked_add(amount).unwrap();
        user_escrow.bump = ctx.bumps.user_escrow;

        msg!("💰 User deposited {} lamports. Current balance: {}", amount, user_escrow.balance_lamports);
        Ok(())
    }

    /// 4. UNCONDITIONAL WITHDRAWAL (Guaranteed by Code)
    /// The user can withdraw 100% of their uncommitted escrow balance at any time.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        let user_escrow = &mut ctx.accounts.user_escrow;
        require!(user_escrow.balance_lamports >= amount, ArenaError::InsufficientBalance);

        // Deduct from user escrow
        user_escrow.balance_lamports = user_escrow.balance_lamports.checked_sub(amount).unwrap();

        // Transfer SOL from Program Vault PDA back to user wallet
        let vault_bump = ctx.accounts.global_state.vault_bump;
        let seeds = &[b"vault".as_ref(), &[vault_bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_context, amount)?;

        msg!("🚀 Non-custodial withdrawal executed! Sent {} lamports to {}", amount, ctx.accounts.user.key());
        Ok(())
    }

    /// 5. Claim Accumulated Rakeback
    pub fn claim_rakeback(ctx: Context<Withdraw>) -> Result<()> {
        let user_escrow = &mut ctx.accounts.user_escrow;
        let rakeback = user_escrow.rakeback_pending;
        require!(rakeback > 0, ArenaError::ZeroRakeback);

        user_escrow.rakeback_pending = 0;
        user_escrow.rakeback_total_claimed = user_escrow.rakeback_total_claimed.checked_add(rakeback).unwrap();

        let vault_bump = ctx.accounts.global_state.vault_bump;
        let seeds = &[b"vault".as_ref(), &[vault_bump]];
        let signer_seeds = &[&seeds[..]];

        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            signer_seeds,
        );
        transfer(cpi_context, rakeback)?;

        msg!("💸 Claimed {} lamports in Rakeback cashback!", rakeback);
        Ok(())
    }

    /// 6. Auto-Refuel Mechanism
    /// Rebalances depleted tables using the Cushion Reserve from accumulated fees
    pub fn auto_refuel(ctx: Context<AutoRefuel>, refuel_amount: u64) -> Result<()> {
        let state = &mut ctx.accounts.global_state;
        let table = &mut ctx.accounts.table;

        require!(state.cushion_reserve >= refuel_amount, ArenaError::InsufficientCushion);
        require!(table.pot_lamports < table.min_pot_lamports, ArenaError::TableNotDepleted);

        state.cushion_reserve = state.cushion_reserve.checked_sub(refuel_amount).unwrap();
        table.pot_lamports = table.pot_lamports.checked_add(refuel_amount).unwrap();

        msg!("🔄 AUTO-REFUEL TRIGGERED! Added {} lamports to Table #{}. Pot restored to: {}", refuel_amount, table.table_id, table.pot_lamports);
        Ok(())
    }
}

// -------------------------------------------------------------
// ACCOUNT CONTEXTS
// -------------------------------------------------------------

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalState::LEN,
        seeds = [b"global_state"],
        bump
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    /// CHECK: Vault PDA holding all deposited protocol liquidity
    #[account(
        seeds = [b"vault"],
        bump
    )]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(table_id: u8)]
pub struct InitializeTable<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + TableAccount::LEN,
        seeds = [b"table", &[table_id]],
        bump
    )]
    pub table: Box<Account<'info, TableAccount>>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserEscrow::LEN,
        seeds = [b"user_escrow", user.key().as_ref()],
        bump
    )]
    pub user_escrow: Box<Account<'info, UserEscrow>>,

    /// CHECK: Vault PDA
    #[account(mut, seeds = [b"vault"], bump)]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [b"user_escrow", user.key().as_ref()],
        bump = user_escrow.bump,
        has_one = owner @ ArenaError::Unauthorized
    )]
    pub user_escrow: Box<Account<'info, UserEscrow>>,

    #[account(seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    /// CHECK: Vault PDA
    #[account(mut, seeds = [b"vault"], bump = global_state.vault_bump)]
    pub vault: AccountInfo<'info>,

    #[account(mut)]
    pub user: Signer<'info>,
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AutoRefuel<'info> {
    #[account(mut, seeds = [b"global_state"], bump = global_state.bump)]
    pub global_state: Box<Account<'info, GlobalState>>,

    #[account(mut, seeds = [b"table", &[table.table_id]], bump = table.bump)]
    pub table: Box<Account<'info, TableAccount>>,

    pub authority: Signer<'info>,
}

// -------------------------------------------------------------
// STATE SCHEMAS
// -------------------------------------------------------------

#[account]
pub struct GlobalState {
    pub authority: Pubkey,         // 32
    pub founder: Pubkey,           // 32
    pub cushion_reserve: u64,      // 8 (Auto-refuel stabilization fund)
    pub house_revenue: u64,        // 8 (Founder profit)
    pub total_volume: u64,         // 8
    pub total_rolls: u64,          // 8
    pub epoch_id: u32,             // 4
    pub bump: u8,                  // 1
    pub vault_bump: u8,            // 1
}

impl GlobalState {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 8 + 4 + 1 + 1;
}

#[account]
pub struct TableAccount {
    pub table_id: u8,              // 1 (1: Flash, 2: Classic, 3: Whale)
    pub price_lamports: u64,       // 8
    pub friction_lamports: u64,    // 8
    pub refund_lamports: u64,      // 8 (Soft-refund 99.8%)
    pub min_pot_lamports: u64,     // 8 (Threshold for auto-refuel)
    pub pot_lamports: u64,         // 8 (Current live pot)
    pub total_volume: u64,         // 8
    pub total_rolls: u64,          // 8
    pub total_won: u64,            // 8
    pub bump: u8,                  // 1
}

impl TableAccount {
    pub const LEN: usize = 1 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[account]
pub struct UserEscrow {
    pub owner: Pubkey,                  // 32
    pub balance_lamports: u64,          // 8
    pub rakeback_pending: u64,          // 8
    pub rakeback_total_claimed: u64,    // 8
    pub total_spent: u64,               // 8
    pub total_won: u64,                 // 8
    pub rolls_count: u64,               // 8
    pub bump: u8,                       // 1
}

impl UserEscrow {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 1;
}

// -------------------------------------------------------------
// ERROR CODES
// -------------------------------------------------------------

#[error_code]
pub enum ArenaError {
    #[msg("Amount must be greater than 0")]
    InvalidAmount,
    #[msg("Insufficient uncommitted escrow balance for withdrawal")]
    InsufficientBalance,
    #[msg("Unauthorized access to user escrow account")]
    Unauthorized,
    #[msg("No rakeback available to claim")]
    ZeroRakeback,
    #[msg("Insufficient funds in the Auto-Refuel Cushion reserve")]
    InsufficientCushion,
    #[msg("Table pot has not dropped below minimum refuel threshold")]
    TableNotDepleted,
}
