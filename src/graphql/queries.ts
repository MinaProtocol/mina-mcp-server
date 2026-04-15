export const QUERIES = {
  syncStatus: `{ syncStatus }`,

  daemonStatus: `{
    daemonStatus {
      numAccounts
      blockchainLength
      highestBlockLengthReceived
      highestUnvalidatedBlockLengthReceived
      uptimeSecs
      ledgerMerkleRoot
      stateHash
      chainId
      commitId
      peers { peerId host libp2pPort }
      syncStatus
      catchupStatus
      blockProductionKeys
      coinbaseReceiver
      addrsAndPorts {
        externalIp
        bindIp
        clientPort
        libp2pPort
      }
    }
  }`,

  account: `query Account($publicKey: PublicKey!, $token: TokenId) {
    account(publicKey: $publicKey, token: $token) {
      publicKey
      balance { total blockHeight }
      nonce
      delegate
      votingFor
      timing {
        initialMinimumBalance
        cliffTime
        cliffAmount
        vestingPeriod
        vestingIncrement
      }
      tokenId
      tokenSymbol
      receiptChainHash
      permissions {
        editState send receive access setDelegate
        setPermissions setVerificationKey setZkappUri
        editActionState setTokenSymbol incrementNonce setVotingFor setTiming
      }
      zkappState
      provedState
      zkappUri
    }
  }`,

  bestChain: `query BestChain($maxLength: Int) {
    bestChain(maxLength: $maxLength) {
      stateHash
      protocolState {
        consensusState {
          blockHeight
          epoch
          slot
          slotSinceGenesis
          blockCreator
          coinbaseReceiver
          stakingEpochData { epochLength }
        }
        previousStateHash
        blockchainState {
          date
          utcDate
          snarkedLedgerHash
          stagedLedgerHash
        }
      }
      transactions {
        userCommands {
          id hash kind nonce
          source { publicKey }
          receiver { publicKey }
          amount fee memo
          failureReason
        }
      }
    }
  }`,

  block: `query Block($stateHash: String, $height: Int) {
    block(stateHash: $stateHash, height: $height) {
      stateHash
      protocolState {
        consensusState {
          blockHeight
          epoch
          slot
          slotSinceGenesis
          blockCreator
          coinbaseReceiver
        }
        previousStateHash
        blockchainState {
          date
          utcDate
          snarkedLedgerHash
          stagedLedgerHash
        }
      }
      transactions {
        userCommands {
          id hash kind nonce
          source { publicKey }
          receiver { publicKey }
          amount fee memo
          failureReason
        }
        feeTransfer { recipient fee type }
        coinbase
        coinbaseReceiverAccount { publicKey }
      }
    }
  }`,

  pooledUserCommands: `query PooledUserCommands($publicKey: PublicKey) {
    pooledUserCommands(publicKey: $publicKey) {
      id hash kind nonce
      source { publicKey }
      receiver { publicKey }
      amount fee memo
      failureReason
    }
  }`,

  sendPayment: `mutation SendPayment($input: SendPaymentInput!) {
    sendPayment(input: $input) {
      payment {
        id hash kind nonce
        source { publicKey }
        receiver { publicKey }
        amount fee memo
      }
    }
  }`,

  sendDelegation: `mutation SendDelegation($input: SendDelegationInput!) {
    sendDelegation(input: $input) {
      delegation {
        id hash kind nonce
        source { publicKey }
        receiver { publicKey }
        fee memo
      }
    }
  }`,

  transactionStatus: `query TransactionStatus($payment: ID, $zkappTransaction: ID) {
    transactionStatus(payment: $payment, zkappTransaction: $zkappTransaction)
  }`,

  genesisConstants: `{
    genesisConstants {
      genesisTimestamp
      coinbase
      accountCreationFee
    }
  }`,

  networkID: `{ networkID }`,
} as const;
