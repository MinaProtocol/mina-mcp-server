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
          coinbaseReceiever
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
          coinbaseReceiever
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

  // Both mutations accept an optional $signature. When null, the daemon
  // signs with its own keys (tutorial-mode lightnet). When set, the daemon
  // verifies the provided signature and submits — required path for live
  // mode against public daemons that don't hold user keys. JSON.stringify
  // drops `undefined` from variables, so callers that don't pass a
  // signature still see the daemon-signed path.
  sendPayment: `mutation SendPayment($input: SendPaymentInput!, $signature: SignatureInput) {
    sendPayment(input: $input, signature: $signature) {
      payment {
        id hash kind nonce
        source { publicKey }
        receiver { publicKey }
        amount fee memo
      }
    }
  }`,

  sendDelegation: `mutation SendDelegation($input: SendDelegationInput!, $signature: SignatureInput) {
    sendDelegation(input: $input, signature: $signature) {
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
