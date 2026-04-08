import { ArchiveDB } from "../db/archive.js";

export class SnapshotProvider {
  public db: ArchiveDB;
  public readonly mode: string = "snapshot";

  constructor(db: ArchiveDB) {
    this.db = db;
  }

  async getAccount(publicKey: string) {
    const result = await this.db.query(
      `SELECT pk.value as public_key, t.value as token_id,
              ai.id as account_identifier_id,
              ti.initial_minimum_balance, ti.cliff_time, ti.cliff_amount,
              ti.vesting_period, ti.vesting_increment
       FROM public_keys pk
       JOIN account_identifiers ai ON ai.public_key_id = pk.id
       JOIN tokens t ON t.id = ai.token_id
       LEFT JOIN timing_info ti ON ti.account_identifier_id = ai.id
       WHERE pk.value = $1`,
      [publicKey]
    );
    return result.rows;
  }

  async getBlock(heightOrHash: string | number) {
    const isHash = typeof heightOrHash === "string" && heightOrHash.length > 10;
    const result = await this.db.query(
      `SELECT b.id, b.state_hash, b.height, b.global_slot_since_genesis,
              b.timestamp, b.chain_status,
              pk_creator.value as creator,
              pk_winner.value as winner,
              parent.state_hash as parent_hash,
              slh.value as snarked_ledger_hash
       FROM blocks b
       JOIN public_keys pk_creator ON pk_creator.id = b.creator_id
       JOIN public_keys pk_winner ON pk_winner.id = b.block_winner_id
       LEFT JOIN blocks parent ON parent.id = b.parent_id
       LEFT JOIN snarked_ledger_hashes slh ON slh.id = b.snarked_ledger_hash_id
       WHERE ${isHash ? "b.state_hash = $1" : "b.height = $1"}
       ORDER BY b.timestamp DESC LIMIT 1`,
      [heightOrHash]
    );
    return result.rows[0] ?? null;
  }

  async listBlocks(limit = 20, offset = 0, status?: string) {
    const conditions = status ? "WHERE b.chain_status = $3" : "";
    const params: unknown[] = [limit, offset];
    if (status) params.push(status);

    const result = await this.db.query(
      `SELECT b.id, b.state_hash, b.height, b.global_slot_since_genesis,
              b.timestamp, b.chain_status,
              pk_creator.value as creator,
              (SELECT count(*) FROM blocks_user_commands buc WHERE buc.block_id = b.id) as user_command_count,
              (SELECT count(*) FROM blocks_internal_commands bic WHERE bic.block_id = b.id) as internal_command_count,
              (SELECT count(*) FROM blocks_zkapp_commands bzc WHERE bzc.block_id = b.id) as zkapp_command_count
       FROM blocks b
       JOIN public_keys pk_creator ON pk_creator.id = b.creator_id
       ${conditions}
       ORDER BY b.height DESC
       LIMIT $1 OFFSET $2`,
      params
    );
    return result.rows;
  }

  async getTransaction(hash: string) {
    // Try user commands first
    const userCmd = await this.db.query(
      `SELECT uc.hash, uc.command_type, uc.nonce, uc.amount, uc.fee, uc.memo, uc.valid_until,
              pk_fee.value as fee_payer, pk_src.value as source, pk_recv.value as receiver,
              buc.status, buc.failure_reason,
              b.state_hash as block_hash, b.height as block_height, b.timestamp as block_timestamp
       FROM user_commands uc
       JOIN public_keys pk_fee ON pk_fee.id = uc.fee_payer_id
       JOIN public_keys pk_src ON pk_src.id = uc.source_id
       JOIN public_keys pk_recv ON pk_recv.id = uc.receiver_id
       LEFT JOIN blocks_user_commands buc ON buc.user_command_id = uc.id
       LEFT JOIN blocks b ON b.id = buc.block_id
       WHERE uc.hash = $1
       ORDER BY b.height DESC LIMIT 1`,
      [hash]
    );

    if (userCmd.rows.length > 0) {
      return { type: "user_command", ...userCmd.rows[0] };
    }

    // Try internal commands
    const intCmd = await this.db.query(
      `SELECT ic.hash, ic.command_type, ic.fee,
              pk_recv.value as receiver,
              b.state_hash as block_hash, b.height as block_height, b.timestamp as block_timestamp
       FROM internal_commands ic
       JOIN public_keys pk_recv ON pk_recv.id = ic.receiver_id
       LEFT JOIN blocks_internal_commands bic ON bic.internal_command_id = ic.id
       LEFT JOIN blocks b ON b.id = bic.block_id
       WHERE ic.hash = $1
       ORDER BY b.height DESC LIMIT 1`,
      [hash]
    );

    if (intCmd.rows.length > 0) {
      return { type: "internal_command", ...intCmd.rows[0] };
    }

    return null;
  }

  async searchTransactions(opts: {
    sender?: string;
    receiver?: string;
    minAmount?: string;
    maxAmount?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (opts.sender) {
      conditions.push(`pk_src.value = $${paramIndex++}`);
      params.push(opts.sender);
    }
    if (opts.receiver) {
      conditions.push(`pk_recv.value = $${paramIndex++}`);
      params.push(opts.receiver);
    }
    if (opts.minAmount) {
      conditions.push(`uc.amount::numeric >= $${paramIndex++}::numeric`);
      params.push(opts.minAmount);
    }
    if (opts.maxAmount) {
      conditions.push(`uc.amount::numeric <= $${paramIndex++}::numeric`);
      params.push(opts.maxAmount);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 20;
    const offset = opts.offset ?? 0;
    params.push(limit, offset);

    const result = await this.db.query(
      `SELECT uc.hash, uc.command_type, uc.nonce, uc.amount, uc.fee, uc.memo,
              pk_src.value as source, pk_recv.value as receiver,
              buc.status,
              b.height as block_height, b.timestamp as block_timestamp
       FROM user_commands uc
       JOIN public_keys pk_fee ON pk_fee.id = uc.fee_payer_id
       JOIN public_keys pk_src ON pk_src.id = uc.source_id
       JOIN public_keys pk_recv ON pk_recv.id = uc.receiver_id
       LEFT JOIN blocks_user_commands buc ON buc.user_command_id = uc.id
       LEFT JOIN blocks b ON b.id = buc.block_id AND b.chain_status = 'canonical'
       ${where}
       ORDER BY b.height DESC NULLS LAST
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
    );
    return result.rows;
  }

  async getStakingLedger(epoch?: number) {
    const result = await this.db.query(
      `SELECT pk.value as public_key, ai.id as account_id,
              t.value as token_id,
              ti.initial_minimum_balance
       FROM account_identifiers ai
       JOIN public_keys pk ON pk.id = ai.public_key_id
       JOIN tokens t ON t.id = ai.token_id
       LEFT JOIN timing_info ti ON ti.account_identifier_id = ai.id
       ORDER BY pk.value
       LIMIT 100`
    );
    return result.rows;
  }

  async getStats() {
    const result = await this.db.query(
      `SELECT
         (SELECT count(*) FROM blocks) as total_blocks,
         (SELECT count(*) FROM blocks WHERE chain_status = 'canonical') as canonical_blocks,
         (SELECT max(height) FROM blocks) as max_height,
         (SELECT count(*) FROM user_commands) as total_user_commands,
         (SELECT count(*) FROM internal_commands) as total_internal_commands,
         (SELECT count(*) FROM public_keys) as total_public_keys,
         (SELECT count(*) FROM zkapp_commands) as total_zkapp_commands`
    );
    return result.rows[0];
  }

  async rawQuery(sql: string, params?: unknown[]) {
    return this.db.queryReadOnly(sql, params);
  }
}
