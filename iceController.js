const { program } = require('../utils/anchorBackend');
const anchor = require('@project-serum/anchor');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction } = require('@solana/spl-token');
const { PublicKey, Transaction, SystemProgram } = require('@solana/web3.js');
const { encryptResponse } = require('../utils/encryption');
const { iceLogger } = require('../utils/logger');
const { requestAirdrop } = require('../utils/requestAirdrop');
const iceMint = new PublicKey('7zB8CcWKyijQi79dVhBxckP4jnAuj3WMmDgVPG7AyF6Z'); // Replace with the correct address

// Function to create user's Associated Token Account (ATA) if it doesn't exist
const createUserTokenAccount = async (owner) => {
    const ata = await getAssociatedTokenAddress(iceMint, owner);
    const accountInfo = await program.provider.connection.getAccountInfo(ata);
    if (accountInfo === null) {
        const transaction = new Transaction().add(
            createAssociatedTokenAccountInstruction(
                program.provider.wallet.publicKey, // Payer of the transaction and new account
                ata, // Address of the new account
                owner, // Owner of the new account
                iceMint // Mint address
            )
        );

        // Sign and send the transaction
        const signature = await program.provider.send(transaction, []);

        // Confirm the transaction
        await program.provider.connection.confirmTransaction(signature, 'confirmed');

        iceLogger.info(`Created ATA: ${ata.toBase58()} with signature: ${signature}`);
    }
    return ata;
};

// Function to initialize UserState
const initializeUserState = async (userPublicKey) => {
    try {
        const userPubKey = new PublicKey(userPublicKey);
        // Vérifier le solde du compte payeur
        const payerBalance = await program.provider.connection.getBalance(program.provider.wallet.publicKey);
        console.log(`Payer balance: ${payerBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
        console.log(`UserPubKey: ${userPubKey.toBase58()}`);
        console.log(payerBalance)
        // Calculer le coût total nécessaire
        const space = program.account.userState.size;
        const lamports = await program.provider.connection.getMinimumBalanceForRentExemption(space);
        
        // Vérifier si nous avons assez de SOL
        if (payerBalance < lamports) {
            throw new Error(`Insufficient balance. Need ${lamports / anchor.web3.LAMPORTS_PER_SOL} SOL but have ${payerBalance / anchor.web3.LAMPORTS_PER_SOL} SOL`);
        }

        // Créer un nouveau Keypair pour le compte UserState
        const userStateKeypair = anchor.web3.Keypair.generate();

        // Initialise le compte UserState
        const tx = await program.methods
            .initialize()
            .accounts({
                user_state: userStateKeypair.publicKey,
                user: userPubKey,
                system_program: SystemProgram.programId,
            })
            .signers([userStateKeypair])
            .preInstructions([
                SystemProgram.createAccount({
                    fromPubkey: program.provider.wallet.publicKey,
                    newAccountPubkey: userStateKeypair.publicKey,
                    space: space,
                    lamports: lamports,
                    programId: program.programId,
                }),
            ])
            .rpc();

        console.log(`UserState initialized for user: ${userPublicKey} with tx: ${tx}`);
        console.log(`UserState account: ${userStateKeypair.publicKey.toString()}`);
        
        // Attendre la confirmation de la transaction
        await program.provider.connection.confirmTransaction(tx);
        
        return userStateKeypair.publicKey;
        
    } catch (error) {
        console.error('Error initializing UserState:', error);
        if (error.logs) {
            console.error('Transaction Logs:', error.logs);
        }
        throw error;
    }
};

// Function to mint Ice tokens to a user's account
const mintIce = async (request, reply) => {
    const { userPublicKey, amount } = request.body;

    if (!userPublicKey || !amount) {
        return reply.code(400).send({
            state: 'error',
            response: encryptResponse('userPublicKey and amount are required.'),
        });
    }

    try {
        // Initialise le UserState si nécessaire
        const userStateAccount = await initializeUserState(userPublicKey);

        const userPubKey = new PublicKey(userPublicKey);
        const connection = program.provider.connection;
        const payer = program.provider.wallet.publicKey;

        // Derive PDA for backend authority
        const [backendAuthority, bump] = await PublicKey.findProgramAddress(
            [Buffer.from('backend'), userPubKey.toBuffer()],
            program.programId
        );

        // Create ATA if it doesn't exist
        const userTokenAccount = await createUserTokenAccount(userPubKey);

        await program.methods.mintIce(new anchor.BN(amount))
            .accounts({
                user_state: userStateAccount,
                user: userPubKey,
                signer: program.provider.wallet.publicKey,
                mint_authority: program.provider.wallet.publicKey,
                ice_mint: iceMint,
                user_token_account: userTokenAccount,
                backend_authority: backendAuthority,
                token_program: TOKEN_PROGRAM_ID,
            })
            .rpc();

        return reply.code(200).send({
            state: 'success',
            response: encryptResponse('Ice tokens minted successfully.'),
        });
    } catch (error) {
        iceLogger.error('Error minting Ice tokens:', error);
        if (error.logs) {
            iceLogger.error('Transaction Logs:', error.logs.join('\n'));
        }
        return reply.code(500).send({
            state: 'error',
            response: encryptResponse(error.message),
        });
    }
};

// Function to burn Ice tokens from a user's account
const burnIce = async (request, reply) => {
    const { userPublicKey, amount } = request.body;

    if (!userPublicKey || !amount) {
        return reply.code(400).send({
            state: 'error',
            response: encryptResponse('userPublicKey and amount are required.'),
        });
    }

    try {
        const userPubKey = new PublicKey(userPublicKey);
        const connection = program.provider.connection;
        const payer = program.provider.wallet.publicKey;

        // Derive PDA for backend authority
        const [backendAuthority, bump] = await PublicKey.findProgramAddress(
            [Buffer.from('backend'), userPubKey.toBuffer()],
            program.programId
        );

        // Derive UserState account
        const [userState, _] = await PublicKey.findProgramAddress(
            [Buffer.from('user_state'), userPubKey.toBuffer()],
            program.programId
        );

        // Ensure the UserState account is initialized
        const userStateAccount = await program.account.userState.fetch(userState).catch(() => null);
        if (!userStateAccount) {
            throw new Error('UserState account is not initialized.');
        }

        // Create ATA if it doesn't exist
        const userTokenAccount = await createUserTokenAccount(userPubKey);

        await program.rpc.burnIce(new anchor.BN(amount), {
            accounts: {
                user_state: userState,
                user: userPubKey,
                signer: program.provider.wallet.publicKey,
                ice_mint: iceMint,
                user_token_account: userTokenAccount,
                backend_authority: backendAuthority,
                token_program: TOKEN_PROGRAM_ID,
            },
        });

        return reply.code(200).send({
            state: 'success',
            response: encryptResponse('Ice tokens burned successfully.'),
        });
    } catch (error) {
        iceLogger.error('Error burning Ice tokens:', error);
        if (error.logs) {
            iceLogger.error('Transaction Logs:', error.logs.join('\n'));
        }
        return reply.code(500).send({
            state: 'error',
            response: encryptResponse(error.message),
        });
    }
};

// Function to get Ice token balance of a user
const getIceBalance = async (request, reply) => {
    const { userPublicKey } = request.body;

    if (!userPublicKey) {
        return reply.code(400).send({
            state: 'error',
            response: encryptResponse('userPublicKey is required.'),
        });
    }

    try {
        const userPubKey = new PublicKey(userPublicKey);
        const connection = program.provider.connection;

        // Derive User's Associated Token Account
        const userTokenAccount = await getAssociatedTokenAddress(iceMint, userPubKey);

        const tokenAccountInfo = await connection.getParsedAccountInfo(userTokenAccount);

        if (tokenAccountInfo.value === null) {
            return reply.code(200).send({
                state: 'success',
                response: encryptResponse(0),
            });
        }

        const parsedInfo = tokenAccountInfo.value.data;
        const iceBalance = parsedInfo['parsed']['info']['tokenAmount']['uiAmount'];

        return reply.code(200).send({
            state: 'success',
            response: encryptResponse(iceBalance),
        });
    } catch (error) {
        iceLogger.error('Error retrieving Ice balance:', error);
        return reply.code(500).send({
            state: 'error',
            response: encryptResponse(error.message),
        });
    }
};

module.exports = { mintIce, burnIce, getIceBalance };