const anchor = require('@project-serum/anchor');
const { Program, AnchorProvider, web3 } = anchor;
const idl = require('./idlegame.json')
const fs = require('fs');
const path = require('path');

// Load the keypair from a JSON file or environment variable for security
const keypairPath = path.resolve(__dirname, './idlegame-keypair.json');
const secret = JSON.parse(fs.readFileSync(keypairPath, 'utf8'));
const walletKeyPair = web3.Keypair.fromSecretKey(new Uint8Array(secret));

// Create a wallet instance
const wallet = new anchor.Wallet(walletKeyPair);

// Connect to the cluster
const network = "https://staging-rpc.dev2.eclipsenetwork.xyz";
const connection = new web3.Connection(network, 'processed');

// Set default provider
const provider = new AnchorProvider(connection, wallet, {
  preflightCommitment: "processed",
});
anchor.setProvider(provider);

// Program ID from IDL
const programID = new web3.PublicKey(idl.address);

// Initialize the program
const program = new Program(idl, programID, provider);

module.exports = { program };